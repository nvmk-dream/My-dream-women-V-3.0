import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { sql } from "drizzle-orm";
import { db, kallaatamStoriesTable, type KallaatamStoryCharacter } from "@workspace/db";
import {
  getMultimediaKeys,
  getOpenAIKeys,
  getOpenRouterKeys,
  isKeyError,
  isQuotaError,
  MODELS,
  tryOpenAICompatible,
  withTimeout,
} from "./chat";
import { GoogleGenAI } from "@google/genai";

const router = Router();
const ATTEMPT_TIMEOUT_MS = 25_000;
const MAX_STORY_LENGTH = 20_000;
const PERSONA_ID = "kallaatam";

type StorySaveResult = {
  storySaved: true;
  extracted: true;
  reused: boolean;
  outline: string;
  characters: KallaatamStoryCharacter[];
};

type LogLike = {
  info?: (data: unknown, message?: string) => void;
  warn?: (data: unknown, message?: string) => void;
  error?: (data: unknown, message?: string) => void;
};

const inFlight = new Map<string, Promise<StorySaveResult>>();
let schemaReady: Promise<void> | null = null;

function storyHash(personaId: string, story: string): string {
  return createHash("sha256").update(`${personaId}\u0000${story}`).digest("hex");
}

function requireDatabase() {
  if (!db) {
    throw Object.assign(new Error("Database is not configured"), { status: 503 });
  }
  return db;
}

function ensureDatabaseSchema(): Promise<void> {
  const database = requireDatabase();
  if (!schemaReady) {
    schemaReady = database.execute(sql`
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
    `).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
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
  if (error?.status === 429) return 429;
  if (error?.status === 401) return 401;
  if (error?.status === 504) return 504;
  if (error?.status === 503) return 503;
  if (error?.code === "PARSE_ERROR") return 502;
  if (isQuotaError(error)) return 429;
  if (isKeyError(error)) return 401;
  if (error?.code === "TIMEOUT" || error?.name === "AbortError") return 504;
  return 502;
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
  const messages = [{ role: "user", content: prompt }];
  const multimediaKeys = getMultimediaKeys();
  let lastError: any = null;
  let quotaCount = 0;

  for (const [keyIndex, key] of multimediaKeys.entries()) {
    const ai = new GoogleGenAI({
      apiKey: key,
      ...(process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"]
        ? { httpOptions: { apiVersion: "", baseUrl: process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"] } }
        : {}),
    });
    for (const model of MODELS) {
      try {
        const result = await withTimeout(
          ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
              safetySettings: [
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
              ],
              systemInstruction: systemPrompt,
            },
          }),
          ATTEMPT_TIMEOUT_MS,
          `story extraction ${model}`,
        );
        const content = result.text?.trim() ?? "";
        if (!content) throw new Error("empty story extraction response");
        log.info?.({ provider: "gemini", keyIndex, model }, "Story extraction succeeded");
        return parseExtraction(content);
      } catch (error: any) {
        lastError = error;
        if (isQuotaError(error)) quotaCount++;
        log.warn?.({ provider: "gemini", keyIndex, model, message: String(error?.message ?? error).slice(0, 200) }, "Story extraction attempt failed");
        if (isKeyError(error)) break;
      }
    }
  }

  const fallbackModels = [
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
  ];
  for (const key of getOpenRouterKeys()) {
    for (const model of fallbackModels) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
      try {
        const content = await tryOpenAICompatible(
          "https://openrouter.ai/api/v1",
          key,
          model,
          systemPrompt,
          messages,
          controller.signal,
        );
        log.info?.({ provider: "openrouter", model }, "Story extraction succeeded");
        return parseExtraction(content);
      } catch (error: any) {
        lastError = error;
        if (isQuotaError(error)) quotaCount++;
        log.warn?.({ provider: "openrouter", model, message: String(error?.message ?? error).slice(0, 200) }, "Story extraction fallback failed");
      } finally {
        clearTimeout(timer);
      }
    }
  }

  for (const key of getOpenAIKeys()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const content = await tryOpenAICompatible(
        "https://api.openai.com/v1",
        key,
        "gpt-4o-mini",
        systemPrompt,
        messages,
        controller.signal,
      );
      log.info?.({ provider: "openai", model: "gpt-4o-mini" }, "Story extraction succeeded");
      return parseExtraction(content);
    } catch (error: any) {
      lastError = error;
      if (isQuotaError(error)) quotaCount++;
      log.warn?.({ provider: "openai", message: String(error?.message ?? error).slice(0, 200) }, "Story extraction final fallback failed");
    } finally {
      clearTimeout(timer);
    }
  }

  if (!lastError) {
    throw Object.assign(new Error("No AI provider is configured"), { status: 503 });
  }
  if (quotaCount > 0) throw Object.assign(lastError, { status: 429 });
  throw lastError;
}

async function saveStory(story: string, log: LogLike, hash: string): Promise<StorySaveResult> {
  const database = requireDatabase();
  await ensureDatabaseSchema();
  const existingRows = await database
    .select()
    .from(kallaatamStoriesTable)
    .where(sql`${kallaatamStoriesTable.personaId} = ${PERSONA_ID} AND ${kallaatamStoriesTable.storyHash} = ${hash}`)
    .limit(1);
  const existing = existingRows[0];
  if (existing?.outline?.trim() && Array.isArray(existing.characters) && existing.characters.length > 0) {
    return {
      storySaved: true,
      extracted: true,
      reused: true,
      outline: existing.outline,
      characters: existing.characters,
    };
  }

  const [draft] = await database
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

  const extraction = await generateExtraction(story, log);
  const [saved] = await database
    .update(kallaatamStoriesTable)
    .set({
      outline: extraction.outline,
      characters: extraction.characters,
      updatedAt: new Date(),
    })
    .where(sql`${kallaatamStoriesTable.id} = ${draft.id}`)
    .returning();
  if (!saved) throw new Error("Story extraction could not be saved");

  return {
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
    res.status(400).json({ error: "Story content is required" });
    return;
  }
  const story = rawStory.trim();
  if (story.length > MAX_STORY_LENGTH) {
    res.status(413).json({ error: `Story must be ${MAX_STORY_LENGTH} characters or less` });
    return;
  }

  const hash = storyHash(PERSONA_ID, story);
  const active = inFlight.get(hash);
  if (active) {
    try {
      res.json(await active);
    } catch (error: any) {
      res.status(errorStatus(error)).json({ error: "Story save or extraction failed. Please try again." });
    }
    return;
  }

  const log = (req as Request & { log?: LogLike }).log ?? {};
  const operation = saveStory(story, log, hash);
  inFlight.set(hash, operation);
  try {
    res.json(await operation);
  } catch (error: any) {
    log.error?.({ message: String(error?.message ?? error).slice(0, 500) }, "Story save failed");
    const status = error?.status ?? errorStatus(error);
    res.status(status).json({
      error:
        status === 429
          ? "AI quota busy. Please try again later."
          : status === 504
            ? "Story extraction timed out. Please try again."
            : status === 503
              ? "Story AI service is not configured right now."
              : "Story save or extraction failed. Please try again.",
    });
  } finally {
    inFlight.delete(hash);
  }
});

export default router;