import { randomUUID } from "node:crypto";
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { configureCloudinary, type CloudinaryClient } from "../lib/cloudinary-config";

const router = Router();
type StyleRow = { id: string; name: string; prompt: string; folderName: string; isBuiltin: boolean; isActive: boolean };
type FolderCleanupResult = {
  folder: string;
  assetsDeleted: number;
  folderDeleted: boolean;
  missing: boolean;
  errors: string[];
  fatal: boolean;
};
const BUILTIN_STYLES: Array<Omit<StyleRow, "isActive">> = [
  ["normal", "Normal Photo", "normal photo, fully clothed, casual"],
  ["nude", "Nude 🔞", "nude, fully naked, explicit"],
  ["seminude", "Semi Nude", "semi nude, partially undressed"],
  ["breast", "Breast Show", "topless, showing breasts, bare chest"],
  ["halfbreast", "Half Breast", "half breast visible, deep cleavage, low cut top"],
  ["cleavage", "Cleavage", "deep cleavage, low neckline, cleavage showing"],
  ["lowneck", "Low Neckline", "low neckline, low cut dress, revealing neckline"],
  ["lingerie", "Lingerie", "wearing lingerie, bra and panties, underwear"],
  ["buttocks", "Buttocks", "showing buttocks, from behind, revealing buttocks"],
  ["highslit", "High Slit", "high slit dress, thigh high slit, leg revealing slit"],
  ["seductive", "Seductive", "seductive pose, alluring, provocative look"],
  ["wet", "Wet Clothes", "wet clothes, drenched, see through wet fabric"],
  ["legs", "Legs Spread", "legs spread wide, revealing pose"],
  ["saree", "Saree Tuck", "lifting saree up, revealing thighs, traditional saree"],
  ["sleeping", "Sleeping", "sleeping pose, exposed, lying down"],
].map(([id, name, prompt]) => ({ id, name, prompt, folderName: id, isBuiltin: true }));
let schemaPromise: Promise<void> | null = null;

const keyOf = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
function dbOrThrow() { if (!db) throw new Error("Photo Style database is not configured"); return db; }
function styleName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 120 || /[/\\\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Style name is required and cannot contain path separators or control characters");
  }
  return name;
}
function cl() {
  return configureCloudinary("Photo Styles Cloudinary");
}
function missing(error: any) {
  const message = String(error?.message ?? error?.error?.message ?? "").toLowerCase();
  return (error?.http_code ?? error?.statusCode ?? error?.status) === 404 ||
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("no such resource");
}
function cloudinaryError(error: any): string {
  const message = String(error?.message ?? error?.error?.message ?? error ?? "Unknown Cloudinary error");
  const status = error?.http_code ?? error?.statusCode ?? error?.status;
  return status ? `${message} (HTTP ${status})` : message;
}
async function girls(c: CloudinaryClient) {
  const result = await (c.api as any).sub_folders("my-girls");
  return (result?.folders ?? []).map((x: any) => String(x.name ?? "")).filter((x: string) => x && x !== "meta" && x !== "global_styles");
}
async function create(c: CloudinaryClient, folder: string) {
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  await c.uploader.upload(`data:image/png;base64,${pixel}`, { public_id: `${folder}/placeholder`, resource_type: "image", overwrite: true, invalidate: true });
}
async function clearTrack(c: CloudinaryClient, folder: string) {
  const key = `track_${folder.replace(/[^a-zA-Z0-9]/g, "_")}`;
  await c.uploader.upload(`data:application/json;base64,${Buffer.from("[]").toString("base64")}`, {
    public_id: `my-girls/meta/${key}`, resource_type: "raw", overwrite: true, invalidate: true,
  } as any);
}
async function remove(c: CloudinaryClient, folder: string): Promise<FolderCleanupResult> {
  const result: FolderCleanupResult = {
    folder,
    assetsDeleted: 0,
    folderDeleted: false,
    missing: false,
    errors: [],
    fatal: false,
  };

  for (const resource_type of ["image", "video", "raw"]) {
    try {
      let nextCursor: string | undefined;
      do {
        const options: Record<string, unknown> = { resource_type, type: "upload", invalidate: true };
        if (nextCursor) options.next_cursor = nextCursor;
        const page = await (c.api as any).delete_resources_by_prefix(`${folder}/`, options);
        result.assetsDeleted += Object.keys(page?.deleted ?? {}).length;
        nextCursor = page?.next_cursor;
      } while (nextCursor);
    } catch (error) {
      if (missing(error)) result.missing = true;
      else {
        result.fatal = true;
        result.errors.push(`${resource_type}: ${cloudinaryError(error)}`);
      }
    }
  }

  // The tracking document lives outside the style folder. Only rewrite it when
  // this cleanup actually removed assets, otherwise a missing folder should
  // remain a no-op instead of creating a new Cloudinary object.
  if (result.assetsDeleted > 0) {
    try {
      await clearTrack(c, folder);
    } catch (error) {
      if (!missing(error)) {
        result.fatal = true;
        result.errors.push(`tracking metadata: ${cloudinaryError(error)}`);
      }
    }
  }

  try {
    await (c.api as any).delete_folder(folder);
    result.folderDeleted = true;
  } catch (error) {
    if (missing(error)) result.missing = true;
    else {
      result.fatal = true;
      result.errors.push(`folder: ${cloudinaryError(error)}`);
    }
  }
  return result;
}
async function styleFolders(c: CloudinaryClient, folderName: string): Promise<string[]> {
  const girlFolders = (await girls(c)).map(girl => `my-girls/${girl}/${folderName}`);
  return [`my-girls/global_styles/${folderName}`, ...girlFolders];
}
async function rollbackFolders(c: CloudinaryClient, folders: string[]): Promise<FolderCleanupResult[]> {
  const results: FolderCleanupResult[] = [];
  for (const folder of [...folders].reverse()) {
    results.push(await remove(c, folder));
  }
  return results;
}
async function ensureSchema() {
  const database = dbOrThrow();
  if (!schemaPromise) {
    schemaPromise = database.execute(sql`
      CREATE TABLE IF NOT EXISTS photo_styles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        prompt TEXT NOT NULL DEFAULT '', folder_name TEXT NOT NULL,
        is_builtin BOOLEAN NOT NULL DEFAULT FALSE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(async () => {
      for (const s of BUILTIN_STYLES) {
        await database.execute(sql`
          INSERT INTO photo_styles (id,name,name_key,prompt,folder_name,is_builtin,is_active)
          VALUES (${s.id},${s.name},${keyOf(s.name)},${s.prompt},${s.folderName},TRUE,TRUE)
          ON CONFLICT (id) DO NOTHING
        `);
      }
    }).catch(error => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
}
function out(row: any): StyleRow {
  return { id: String(row.id), name: String(row.name), prompt: String(row.prompt ?? ""), folderName: String(row.folder_name), isBuiltin: Boolean(row.is_builtin), isActive: Boolean(row.is_active) };
}

router.get("/photo-styles", async (req, res) => {
  try {
    await ensureSchema();
    const result = await dbOrThrow().execute(sql`
      SELECT id,name,prompt,folder_name,is_builtin,is_active FROM photo_styles
      WHERE is_active = TRUE OR ${req.query.includeInactive === "true"}
      ORDER BY is_builtin DESC, created_at ASC, name ASC
    `);
    res.json({ styles: (result.rows ?? []).map(out) });
  } catch (error: any) { res.status(503).json({ error: error?.message || "Photo Styles unavailable" }); }
});

router.post("/photo-styles", async (req, res) => {
  try {
    await ensureSchema();
    const name = styleName(req.body?.name);
    const key = keyOf(name);
    const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : name.toLowerCase();
    const database = dbOrThrow();
    const duplicate = await database.execute(sql`SELECT id FROM photo_styles WHERE name_key = ${key} LIMIT 1`);
    if ((duplicate.rows ?? []).length) return res.status(409).json({ error: "A Photo Style with this name already exists" });
    const c = cl();
    const folderList = await styleFolders(c, name);
    const created: string[] = [];
    try {
      for (const folder of folderList) {
        try {
          await create(c, folder);
          created.push(folder);
        } catch (error) {
          const rollback = await rollbackFolders(c, created);
          const rollbackErrors = rollback.flatMap(item => item.errors);
          const suffix = rollbackErrors.length ? ` Rollback errors: ${rollbackErrors.join(" | ")}` : "";
          throw new Error(`Cloudinary folder creation failed at ${folder}: ${cloudinaryError(error)}.${suffix}`);
        }
      }
    } catch (error) {
      throw error;
    }
    const id = randomUUID();
    try {
      await database.execute(sql`
        INSERT INTO photo_styles (id,name,name_key,prompt,folder_name,is_builtin,is_active)
        VALUES (${id},${name},${key},${prompt},${name},FALSE,TRUE)
      `);
    } catch (error) {
      const rollback = await rollbackFolders(c, created);
      const rollbackErrors = rollback.flatMap(item => item.errors);
      const suffix = rollbackErrors.length ? ` Folder rollback errors: ${rollbackErrors.join(" | ")}` : "";
      throw new Error(`Photo Style database insert failed: ${cloudinaryError(error)}.${suffix}`);
    }
    res.status(201).json({
      style: { id, name, prompt, folderName: name, isBuiltin: false, isActive: true },
      folders: folderList,
    });
  } catch (error: any) { res.status(error?.message?.includes("already exists") ? 409 : 500).json({ error: error?.message || "Photo Style creation failed" }); }
});

router.post("/photo-styles/:id/restore", async (req, res) => {
  try {
    await ensureSchema();
    const database = dbOrThrow();
    const result = await database.execute(sql`SELECT * FROM photo_styles WHERE id = ${req.params.id} LIMIT 1`);
    const row = result.rows?.[0] as any;
    if (!row || !row.is_builtin) return res.status(404).json({ error: "Built-in Photo Style not found" });
    const c = cl();
    const folderList = await styleFolders(c, String(row.folder_name));
    const folderResults: Array<{ folder: string; created: boolean; error?: string }> = [];
    for (const folder of folderList) {
      try {
        await create(c, folder);
        folderResults.push({ folder, created: true });
      } catch (error) {
        folderResults.push({ folder, created: false, error: cloudinaryError(error) });
      }
    }
    const failedFolders = folderResults.filter(item => !item.created);
    if (failedFolders.length > 0) {
      return res.status(502).json({
        error: "Built-in Photo Style restore failed in Cloudinary",
        folders: folderResults,
      });
    }
    await database.execute(sql`UPDATE photo_styles SET is_active = TRUE, updated_at = NOW() WHERE id = ${row.id}`);
    res.json({ style: out({ ...row, is_active: true }), folders: folderResults });
  } catch (error: any) { res.status(500).json({ error: error?.message || "Photo Style restore failed" }); }
});

router.delete("/photo-styles/:id", async (req, res) => {
  try {
    await ensureSchema();
    const database = dbOrThrow();
    const result = await database.execute(sql`SELECT * FROM photo_styles WHERE id = ${req.params.id} LIMIT 1`);
    const row = result.rows?.[0] as any;
    if (!row) return res.status(404).json({ error: "Photo Style not found" });
    const c = cl();
    const folders = await styleFolders(c, String(row.folder_name));
    const deleted: FolderCleanupResult[] = [];
    for (const folder of folders) deleted.push(await remove(c, folder));
    const fatalErrors = deleted.flatMap(item => item.errors);
    if (fatalErrors.length > 0) {
      return res.status(502).json({
        error: "Cloudinary Photo Style cleanup failed",
        styleId: row.id,
        folders: deleted,
      });
    }
    if (row.is_builtin) await database.execute(sql`UPDATE photo_styles SET is_active = FALSE, updated_at = NOW() WHERE id = ${row.id}`);
    else await database.execute(sql`DELETE FROM photo_styles WHERE id = ${row.id}`);
    res.json({ ok: true, styleId: row.id, folders: deleted });
  } catch (error: any) { res.status(500).json({ error: error?.message || "Photo Style deletion failed" }); }
});

export default router;