import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { sql } from "drizzle-orm";
import { db, kallaatamStoriesTable, type KallaatamStoryCharacter } from "@workspace/db";
import {
  generateServerAiResponse,
  isKeyError,
  isQuotaError,
  ServerAiProviderError,
  type ServerAiLog,
} from "./ai-provider";

const router = Router();
const EXTRACTION_TOTAL_TIMEOUT_MS = 70_000;
const MAX_STORY_LENGTH = 20_000;
const PERSONA_ID = "kallaatam";

type StorySaveResult = {
  success: true;
  storySaved: true;
  extracted: true;
  reused: boolean;
  outline: string;
  characters: KallaatamStoryCharacter[];
};

type LogLike = ServerAiLog;

const inFlight = new Map<string, Promise<StorySaveResult>>();
let schemaReady: Promise<void> | null = null;

function storyHash(personaId: string, story: string): string {
  return createHash("sha256").update(`${personaId}\u0000${story}`).digest("hex");
}

function storyError(code: string, message: string, status: number, cause?: unknown): Error & { code: string; status: number } {
  const error = Object.assign(new Error(message), { code, status });
  if (cause) Object.assign(error, { cause });
  return error;
}

function requireDatabase() {
  if (!db) {
    throw storyError("DATABASE_NOT_CONFIGURED", "Story database is not configured right now.", 503);
  }
  return db;
}

function databaseUnavailable(error: unknown): Error & { code: string; status: number } {
  if ((error as any)?.code === "DATABASE_NOT_CONFIGURED") return error as any;
  return storyError("DATABASE_UNAVAILABLE", "Story database is unavailable right now.", 503, error);
}

function storySaveFailed(error: unknown): Error & { code: string; status: number } {
  if ((error as any)?.code === "DATABASE_NOT_CONFIGURED") return error as any;
  return storyError("STORY_SAVE_FAILED", "Story could not be saved right now.", 500, error);
}

function extractionTimeout(): Error & { code: string; status: number } {
  return storyError("EXTRACTION_TIMEOUT", "Story extraction timed out. Please try again.", 504);
}

function ensureDatabaseSchema(): Promise<void> {
  const database = requireDatabase();
  if (!schemaReady) {
    const ready: Promise<void> = database.execute(sql`
      CREATE TABLE IF NOT EXISTS kallaatam_stories (
        id SERIAL PRIMARY KEY,
        persona_id TEXT NOT NULL,
        story_hash TEXT NOT NULL,
        story TEXT NOT NULL,
        outline TEXT NOT NULL DEFAULT '',
        characters JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT kallaatam_stories_persona_story_hash_key UNIQUE (persona_id, story_hash)
      )
    `).then((): void => undefined).catch((error: unknown): never => {
      schemaReady = null;
      throw databaseUnavailable(error);
    });
    schemaReady = ready;
    return ready;
  }
  return schemaReady;
}

function parseExtraction(raw: string): {
  outline: string;
  characters: KallaatamStoryCharacter[];
} {
  const trimmed = raw.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? "",
  ].filter(Boolean);
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      const outlineValue = value.outline ?? value.storyOutline;
      const outline = typeof outlineValue === "string" ? outlineValue.trim() : "";
      const rawCharacters = value.characters ?? value.chars;
      const characters: KallaatamStoryCharacter[] = [];
      const seen = new Set<string>();
      if (Array.isArray(rawCharacters)) {
        for (const item of rawCharacters) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name.trim() : "";
          const descriptionValue = record.description ?? record.role;
          const description = typeof descriptionValue === "string" ? descriptionValue.trim() : "";
          const key = name.toLocaleLowerCase().replace(/\s+/g, " ");
          if (!key || seen.has(key)) continue;
          seen.add(key);
          characters.push({ name, description });
        }
      }
      if (outline || characters.length > 0) {
        return { outline, characters: characters.slice(0, 20) };
      }
    } catch {
      // Try the next JSON candidate before returning a parse error.
    }
  }
  throw Object.assign(new Error("AI returned invalid story extraction JSON"), { code: "PARSE_ERROR" });
}

function errorStatus(error: any): number {
  const code = String(error?.code ?? "");
  if (code === "DATABASE_NOT_CONFIGURED" || code === "DATABASE_UNAVAILABLE") return 503;
  if (code === "STORY_SAVE_FAILED") return 500;
  if (code === "AI_NOT_CONFIGURED") return 503;
  if (code === "EXTRACTION_TIMEOUT") return 504;
  if (code === "INVALID_EXTRACTION_RESPONSE") return 502;
  if (code === "AI_QUOTA" || isQuotaError(error)) return 429;
  if (code === "AI_PROVIDER_FAILED" || isKeyError(error)) return 502;
  if (error?.code === "TIMEOUT" || error?.name === "AbortError") return 504;
  return 502;
}

function errorResponse(error: any) {
  const code = String(error?.code ?? "STORY_SAVE_FAILED");
  const known = new Set([
    "DATABASE_NOT_CONFIGURED", "DATABASE_UNAVAILABLE", "STORY_SAVE_FAILED",
    "AI_NOT_CONFIGURED", "EXTRACTION_TIMEOUT", "INVALID_EXTRACTION_RESPONSE",
    "AI_QUOTA", "AI_PROVIDER_FAILED",
  ]);
  const normalizedCode = known.has(code) ? code : isQuotaError(error) ? "AI_QUOTA" : "STORY_SAVE_FAILED";
  const messages: Record<string, string> = {
    DATABASE_NOT_CONFIGURED: "Story database is not configured right now.",
    DATABASE_UNAVAILABLE: "Story database is unavailable right now.",
    STORY_SAVE_FAILED: "Story could not be saved right now.",
    AI_NOT_CONFIGURED: "Story AI service is not configured right now.",
    EXTRACTION_TIMEOUT: "Story extraction timed out. Please try again.",
    INVALID_EXTRACTION_RESPONSE: "Story extraction returned an invalid response. Please try again.",
    AI_QUOTA: "Story AI quota is busy. Please try again later.",
    AI_PROVIDER_FAILED: "Story AI provider failed. Please try again.",
  };
  return { success: false, error: normalizedCode, message: messages[normalizedCode] };
}
async function generateExtraction(story: string, log: LogLike): Promise<{
  outline: string;
  characters: KallaatamStoryCharacter[];
}> {
  const systemPrompt = `You extract structured story data for the Kallaatam character engine.
Return JSON only in this exact shape:
{"outline":"short story outline","characters":[{"name":"character name","description":"character role or description in the story"}]}
Include every meaningful character found in the story, with an empty description when unknown. Do not invent characters.`;
  const prompt = `Read this story and extract its outline and meaningful characters:\n\n${story}`;
  let content: string;
  try {
    content = await generateServerAiResponse({
      messages: [{ role: "user", content: prompt }],
      systemPrompt,
      mode: "story",
      log,
      deadline: Date.now() + EXTRACTION_TOTAL_TIMEOUT_MS,
    });
  } catch (error: any) {
    if (error instanceof ServerAiProviderError) {
      const { stats } = error;
      const lastError = stats.lastError as any;
      if (stats.noKeysAtAll) {
        throw storyError("AI_NOT_CONFIGURED", "Story AI service is not configured right now.", 503, error);
      }
      if (stats.timedOut || lastError?.code === "TIMEOUT" || lastError?.name === "AbortError") {
        throw extractionTimeout();
      }
      if (stats.quotaErrorCount > 0 || isQuotaError(lastError)) {
        throw storyError("AI_QUOTA", "Story AI quota is busy. Please try again later.", 429, error);
      }
      if (isKeyError(lastError)) {
        throw storyError("AI_PROVIDER_FAILED", "Story AI provider failed. Please try again.", 502, error);
      }
    }
    throw error;
  }

  try {
    return parseExtraction(content);
  } catch (error: any) {
    if (error?.code === "PARSE_ERROR") {
      throw storyError("INVALID_EXTRACTION_RESPONSE", "Story extraction returned an invalid response. Please try again.", 502, error);
    }
    throw error;
  }
}

async function saveStory(story: string, log: LogLike, hash: string): Promise<StorySaveResult> {
  const database = requireDatabase();
  try {
    await ensureDatabaseSchema();
    const existingRows = await database
      .select()
      .from(kallaatamStoriesTable)
      .where(sql`${kallaatamStoriesTable.personaId} = ${PERSONA_ID} AND ${kallaatamStoriesTable.storyHash} = ${hash}`)
      .limit(1);
    const existing = existingRows[0];
    if (existing?.outline?.trim() && Array.isArray(existing.characters) && existing.characters.length > 0) {
      return {
        success: true,
        storySaved: true,
        extracted: true,
        reused: true,
        outline: existing.outline,
        characters: existing.characters,
      };
    }
  } catch (error) {
    throw databaseUnavailable(error);
  }

  let draft: any;
  try {
    [draft] = await database
      .insert(kallaatamStoriesTable)
      .values({
        personaId: PERSONA_ID,
        storyHash: hash,
        story,
        outline: "",
        characters: [],
      })
      .onConflictDoUpdate({
        target: [kallaatamStoriesTable.personaId, kallaatamStoriesTable.storyHash],
        set: { story, updatedAt: new Date() },
      })
      .returning();
    if (!draft) throw new Error("Story could not be saved");
  } catch (error) {
    throw storySaveFailed(error);
  }

  const extraction = await generateExtraction(story, log);
  let saved: any;
  try {
    [saved] = await database
      .update(kallaatamStoriesTable)
      .set({
        outline: extraction.outline,
        characters: extraction.characters,
        updatedAt: new Date(),
      })
      .where(sql`${kallaatamStoriesTable.id} = ${draft.id}`)
      .returning();
    if (!saved) throw new Error("Story extraction could not be saved");
  } catch (error) {
    throw storySaveFailed(error);
  }

  return {
    success: true,
    storySaved: true,
    extracted: true,
    reused: false,
    outline: extraction.outline,
    characters: extraction.characters,
  };
}
router.post("/story/save", async (req: Request, res) => {
  const rawStory = req.body?.story;
  if (typeof rawStory !== "string" || !rawStory.trim()) {
    res.status(400).json({ success: false, error: "STORY_REQUIRED", message: "Story content is required." });
    return;
  }
  const story = rawStory.trim();
  if (story.length > MAX_STORY_LENGTH) {
    res.status(413).json({ success: false, error: "STORY_TOO_LONG", message: `Story must be ${MAX_STORY_LENGTH} characters or less.` });
    return;
  }

  const hash = storyHash(PERSONA_ID, story);
  const active = inFlight.get(hash);
  if (active) {
    try {
      res.json(await active);
    } catch (error: any) {
      const status = errorStatus(error);
      res.status(status).json(errorResponse(error));
    }
    return;
  }

  const log = (req as Request & { log?: LogLike }).log ?? {};
  const operation = saveStory(story, log, hash);
  inFlight.set(hash, operation);
  try {
    res.json(await operation);
  } catch (error: any) {
    const status = errorStatus(error);
    log.error?.({ code: String(error?.code ?? "STORY_SAVE_FAILED"), message: String(error?.message ?? error).slice(0, 300) }, "Story save failed");
    res.status(status).json(errorResponse(error));
  } finally {
    inFlight.delete(hash);
  }
});

export default router;