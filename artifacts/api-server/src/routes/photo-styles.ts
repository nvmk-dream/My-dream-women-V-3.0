import { randomUUID } from "node:crypto";
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { v2 as cloudinary } from "cloudinary";

const router = Router();
type StyleRow = { id: string; name: string; prompt: string; folderName: string; isBuiltin: boolean; isActive: boolean };
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
  cloudinary.config({
    cloud_name: process.env["CLOUDINARY_CLOUD_NAME"] || "dazmrxsyc",
    api_key: process.env["API_KEY"] || process.env["CLOUDINARY_API_KEY"] || process.env["Cloudinary_abi_key"],
    api_secret: process.env["API_SECRET"] || process.env["CLOUDINARY_API_SECRET"] || process.env["Cloudinary_secret"],
  });
  return cloudinary;
}
function missing(error: any) {
  const message = String(error?.message ?? error?.error?.message ?? "").toLowerCase();
  return (error?.http_code ?? error?.statusCode) === 404 || message.includes("not found") || message.includes("does not exist");
}
async function girls(c: typeof cloudinary) {
  const result = await (c.api as any).sub_folders("my-girls");
  return (result?.folders ?? []).map((x: any) => String(x.name ?? "")).filter((x: string) => x && x !== "meta" && x !== "global_styles");
}
async function create(c: typeof cloudinary, folder: string) {
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  await c.uploader.upload(`data:image/png;base64,${pixel}`, { public_id: `${folder}/placeholder`, resource_type: "image", overwrite: true, invalidate: true });
}
async function clearTrack(c: typeof cloudinary, folder: string) {
  const key = `track_${folder.replace(/[^a-zA-Z0-9]/g, "_")}`;
  await c.uploader.upload(`data:application/json;base64,${Buffer.from("[]").toString("base64")}`, {
    public_id: `my-girls/meta/${key}`, resource_type: "raw", overwrite: true, invalidate: true,
  } as any);
}
async function remove(c: typeof cloudinary, folder: string) {
  let assetsDeleted = 0;
  for (const resource_type of ["image", "video", "raw"]) {
    try {
      const result = await (c.api as any).delete_resources_by_prefix(`${folder}/`, { resource_type, type: "upload", invalidate: true });
      assetsDeleted += Object.keys(result?.deleted ?? {}).length;
    } catch (error) { if (!missing(error)) throw error; }
  }
  await clearTrack(c, folder);
  try { await (c.api as any).delete_folder(folder); return { assetsDeleted, folderDeleted: true }; }
  catch (error) { if (missing(error)) return { assetsDeleted, folderDeleted: false }; throw error; }
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
    const database = dbOrThrow();
    const duplicate = await database.execute(sql`SELECT id FROM photo_styles WHERE name_key = ${key} LIMIT 1`);
    if ((duplicate.rows ?? []).length) return res.status(409).json({ error: "A Photo Style with this name already exists" });
    const c = cl();
    const folderList = (await girls(c)).map(girl => `my-girls/${girl}/${name}`);
    const created: string[] = [];
    try {
      for (const folder of folderList) { await create(c, folder); created.push(folder); }
    } catch (error) {
      for (const folder of created.reverse()) { try { await remove(c, folder); } catch {} }
      throw new Error(`Cloudinary folder creation failed: ${String(error)}`);
    }
    const id = randomUUID();
    try {
      await database.execute(sql`
        INSERT INTO photo_styles (id,name,name_key,prompt,folder_name,is_builtin,is_active)
        VALUES (${id},${name},${key},${typeof req.body?.prompt === "string" ? req.body.prompt.trim() : name.toLowerCase()},${name},FALSE,TRUE)
      `);
    } catch (error) {
      for (const folder of created.reverse()) { try { await remove(c, folder); } catch {} }
      throw error;
    }
    res.status(201).json({ style: { id, name, prompt: req.body?.prompt?.trim() || name.toLowerCase(), folderName: name, isBuiltin: false, isActive: true }, folders: folderList.length });
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
    for (const girl of await girls(c)) await create(c, `my-girls/${girl}/${row.folder_name}`);
    await database.execute(sql`UPDATE photo_styles SET is_active = TRUE, updated_at = NOW() WHERE id = ${row.id}`);
    res.json({ style: out({ ...row, is_active: true }) });
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
    const folders = [...(await girls(c)).map(girl => `my-girls/${girl}/${row.folder_name}`), `my-girls/global_styles/${row.folder_name}`];
    const deleted = [];
    for (const folder of folders) deleted.push({ folder, ...(await remove(c, folder)) });
    if (row.is_builtin) await database.execute(sql`UPDATE photo_styles SET is_active = FALSE, updated_at = NOW() WHERE id = ${row.id}`);
    else await database.execute(sql`DELETE FROM photo_styles WHERE id = ${row.id}`);
    res.json({ ok: true, styleId: row.id, folders: deleted });
  } catch (error: any) { res.status(500).json({ error: error?.message || "Photo Style deletion failed" }); }
});

export default router;