import { Router } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { characterUrlRotation, characterUrls } from "@workspace/db/schema";

const router = Router();
const database = db!;

let schemaPromise: Promise<void> | null = null;

function ensureDatabaseSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS character_urls (
          id SERIAL PRIMARY KEY,
          character_id TEXT NOT NULL,
          url TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await database.execute(sql`
        CREATE INDEX IF NOT EXISTS character_urls_character_sort_idx
        ON character_urls (character_id, sort_order, id)
      `);
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS character_url_rotation (
          character_id TEXT PRIMARY KEY,
          current_index INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

router.use(async (req, res, next) => {
  if (!db) {
    res.status(503).json({ success: false, message: "Character URL database is not configured" });
    return;
  }
  try {
    await ensureDatabaseSchema();
    next();
  } catch (error) {
    req.log.error({ error }, "Character URL database schema is unavailable");
    res.status(503).json({ success: false, message: "Character URL database is unavailable" });
  }
});

function characterIdFrom(req: { params: Record<string, string | undefined> }): string | null {
  const value = req.params.characterId?.trim();
  return value ? value : null;
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function parseSortOrder(value: unknown): number | null {
  if (value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

async function ensureRotationRow(characterId: string) {
  await database
    .insert(characterUrlRotation)
    .values({ characterId, currentIndex: 0 })
    .onConflictDoNothing({ target: characterUrlRotation.characterId });
}

router.get("/character-urls/:characterId", async (req, res) => {
  const characterId = characterIdFrom(req);
  if (!characterId) {
    res.status(400).json({ success: false, message: "characterId is required" });
    return;
  }

  try {
    const urls = await database
      .select()
      .from(characterUrls)
      .where(eq(characterUrls.characterId, characterId))
      .orderBy(asc(characterUrls.sortOrder), asc(characterUrls.id));
    res.json({ success: true, urls });
  } catch (error) {
    req.log.error({ error, characterId }, "Failed to list character URLs");
    res.status(500).json({ success: false, message: "Unable to load character URLs" });
  }
});

router.post("/character-urls/:characterId", async (req, res) => {
  const characterId = characterIdFrom(req);
  const url = parseUrl(req.body?.url);
  if (!characterId || !url) {
    res.status(400).json({ success: false, message: "A valid http/https URL is required" });
    return;
  }

  const suppliedSort = parseSortOrder(req.body?.sortOrder);
  if (req.body?.sortOrder !== undefined && suppliedSort === null) {
    res.status(400).json({ success: false, message: "sortOrder must be a non-negative integer" });
    return;
  }

  try {
    const last = await database
      .select({ sortOrder: characterUrls.sortOrder })
      .from(characterUrls)
      .where(eq(characterUrls.characterId, characterId))
      .orderBy(desc(characterUrls.sortOrder), desc(characterUrls.id))
      .limit(1);
    const sortOrder = suppliedSort ?? ((last[0]?.sortOrder ?? -1) + 1);
    const inserted = await database
      .insert(characterUrls)
      .values({
        characterId,
        url,
        sortOrder,
        isActive: req.body?.isActive !== false,
      })
      .returning();
    res.status(201).json({ success: true, url: inserted[0] });
  } catch (error) {
    req.log.error({ error, characterId }, "Failed to add character URL");
    res.status(500).json({ success: false, message: "Unable to save URL" });
  }
});

router.put("/character-urls/:characterId/:urlId", async (req, res) => {
  const characterId = characterIdFrom(req);
  const urlId = Number(req.params.urlId);
  let url: string | undefined;
  if (req.body?.url !== undefined) {
    const parsedUrl = parseUrl(req.body.url);
    if (!parsedUrl) {
      res.status(400).json({ success: false, message: "A valid http/https URL is required" });
      return;
    }
    url = parsedUrl;
  }
  const sortOrder = parseSortOrder(req.body?.sortOrder);
  if (!characterId || !Number.isInteger(urlId) || urlId <= 0) {
    res.status(400).json({ success: false, message: "A valid characterId and urlId are required" });
    return;
  }
  if (req.body?.sortOrder !== undefined && sortOrder === null) {
    res.status(400).json({ success: false, message: "sortOrder must be a non-negative integer" });
    return;
  }
  if (url === undefined && sortOrder === null) {
    res.status(400).json({ success: false, message: "Nothing to update" });
    return;
  }

  try {
    const updated = await database
      .update(characterUrls)
      .set({
        ...(url === undefined ? {} : { url }),
        ...(sortOrder === null ? {} : { sortOrder }),
        updatedAt: new Date(),
      })
      .where(and(eq(characterUrls.id, urlId), eq(characterUrls.characterId, characterId)))
      .returning();
    if (!updated[0]) {
      res.status(404).json({ success: false, message: "URL not found for this character" });
      return;
    }
    res.json({ success: true, url: updated[0] });
  } catch (error) {
    req.log.error({ error, characterId, urlId }, "Failed to edit character URL");
    res.status(500).json({ success: false, message: "Unable to update URL" });
  }
});

router.delete("/character-urls/:characterId/:urlId", async (req, res) => {
  const characterId = characterIdFrom(req);
  const urlId = Number(req.params.urlId);
  if (!characterId || !Number.isInteger(urlId) || urlId <= 0) {
    res.status(400).json({ success: false, message: "A valid characterId and urlId are required" });
    return;
  }

  try {
    const deleted = await database
      .delete(characterUrls)
      .where(and(eq(characterUrls.id, urlId), eq(characterUrls.characterId, characterId)))
      .returning({ id: characterUrls.id });
    if (!deleted[0]) {
      res.status(404).json({ success: false, message: "URL not found for this character" });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    req.log.error({ error, characterId, urlId }, "Failed to delete character URL");
    res.status(500).json({ success: false, message: "Unable to delete URL" });
  }
});

router.patch("/character-urls/:characterId/:urlId/active", async (req, res) => {
  const characterId = characterIdFrom(req);
  const urlId = Number(req.params.urlId);
  if (!characterId || !Number.isInteger(urlId) || urlId <= 0 || typeof req.body?.isActive !== "boolean") {
    res.status(400).json({ success: false, message: "isActive must be true or false" });
    return;
  }

  try {
    const updated = await database
      .update(characterUrls)
      .set({ isActive: req.body.isActive, updatedAt: new Date() })
      .where(and(eq(characterUrls.id, urlId), eq(characterUrls.characterId, characterId)))
      .returning();
    if (!updated[0]) {
      res.status(404).json({ success: false, message: "URL not found for this character" });
      return;
    }
    res.json({ success: true, url: updated[0] });
  } catch (error) {
    req.log.error({ error, characterId, urlId }, "Failed to toggle character URL");
    res.status(500).json({ success: false, message: "Unable to change URL status" });
  }
});

router.post("/character-urls/:characterId/next", async (req, res) => {
  const characterId = characterIdFrom(req);
  if (!characterId) {
    res.status(400).json({ success: false, message: "characterId is required" });
    return;
  }

  try {
    // The unique row is created before the transaction. Concurrent callers then
    // serialize on the row lock below, so each request receives a different URL.
    await ensureRotationRow(characterId);
    const result = await database.transaction(async (tx) => {
      const [rotation] = await tx
        .select()
        .from(characterUrlRotation)
        .where(eq(characterUrlRotation.characterId, characterId))
        .for("update");
      const activeUrls = await tx
        .select()
        .from(characterUrls)
        .where(and(eq(characterUrls.characterId, characterId), eq(characterUrls.isActive, true)))
        .orderBy(asc(characterUrls.sortOrder), asc(characterUrls.id));

      if (!rotation || activeUrls.length === 0) return null;

      const currentIndex =
        rotation.currentIndex >= 0 ? rotation.currentIndex % activeUrls.length : 0;
      const selected = activeUrls[currentIndex];
      const nextIndex = (currentIndex + 1) % activeUrls.length;
      await tx
        .update(characterUrlRotation)
        .set({ currentIndex: nextIndex, updatedAt: new Date() })
        .where(eq(characterUrlRotation.characterId, characterId));
      return {
        url: selected.url,
        urlId: selected.id,
        index: currentIndex,
        nextIndex,
      };
    });

    if (!result) {
      res.status(404).json({
        success: false,
        message: "No active URLs saved for this character",
      });
      return;
    }
    res.json({ success: true, ...result });
  } catch (error) {
    req.log.error({ error, characterId }, "Failed to rotate character URL");
    res.status(500).json({ success: false, message: "Unable to get the next URL" });
  }
});

export default router;