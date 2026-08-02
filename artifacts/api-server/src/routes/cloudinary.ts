import { Router } from "express";
import { v2 as cloudinary } from "cloudinary";

const router = Router();

// ── Track Store (Cloudinary meta — survives Render redeploy + app reinstall) ──
type TrackEntry = { url: string; public_id: string; created_at: string };
const trackCache   = new Map<string, TrackEntry[]>(); // in-memory for speed
const syncedFolders = new Set<string>(); // folders already Admin-API-synced this session

function cfg() {
  cloudinary.config({
    cloud_name: process.env["CLOUDINARY_CLOUD_NAME"],
    api_key:    process.env["API_KEY"] || process.env["CLOUDINARY_API_KEY"],
    api_secret: process.env["API_SECRET"] || process.env["CLOUDINARY_API_SECRET"],
  });
  return cloudinary;
}

function trackMetaKey(folder: string): string {
  // e.g. "my-girls/storage/breast" → "track_my_girls_storage_breast"
  return "track_" + folder.replace(/[^a-zA-Z0-9]/g, "_");
}

async function getTracked(folder: string, cl: typeof cloudinary): Promise<TrackEntry[]> {
  if (trackCache.has(folder)) return trackCache.get(folder)!;
  try {
    const key = trackMetaKey(folder);
    const info = await cl.api.resource(`my-girls/meta/${key}`, { resource_type: "raw" });
    const resp = await fetch(info.secure_url + `?_t=${Date.now()}`);
    const data = await resp.json() as TrackEntry[];
    const raw = Array.isArray(data) ? data : [];
    // Self-heal: a since-fixed bug (broken asset_folder filter) previously wrote
    // OTHER folders' photos into this folder's track file. Any entry whose
    // public_id isn't actually inside this folder is pollution — drop it and
    // persist the cleaned list so future reads don't need to re-filter.
    const prefix = folder + "/";
    const entries = raw.filter(e => typeof e.public_id === "string" && e.public_id.startsWith(prefix));
    trackCache.set(folder, entries);
    if (entries.length !== raw.length) {
      saveTracked(folder, entries, cl).catch(() => {});
    }
    return entries;
  } catch {
    return [];
  }
}

async function saveTracked(folder: string, entries: TrackEntry[], cl: typeof cloudinary): Promise<void> {
  trackCache.set(folder, entries);
  const key = trackMetaKey(folder);
  const b64 = Buffer.from(JSON.stringify(entries)).toString("base64");
  await cl.uploader.upload(`data:application/json;base64,${b64}`, {
    public_id: `my-girls/meta/${key}`,
    resource_type: "raw",
    overwrite: true,
    invalidate: true,
  } as any);
}

// Run Admin API once per server-session per folder in background.
// Merges any photos uploaded while server was sleeping (never tracked) into track store.
async function backgroundSyncFolder(folder: string, cl: typeof cloudinary): Promise<void> {
  if (syncedFolders.has(folder)) return;
  syncedFolders.add(folder);
  try {
    let resources: any[] = [];
    try {
      const r = await (cl.api as any).resources_by_asset_folder(folder, { max_results: 100, resource_type: "image" });
      if (r?.resources?.length) resources = r.resources;
    } catch {}
    if (resources.length === 0) {
      try {
        const r = await cl.api.resources({ type: "upload", resource_type: "image", prefix: folder + "/", max_results: 100 });
        if (r?.resources?.length) resources = r.resources;
      } catch {}
    }
    if (resources.length === 0) return;

    const existing = await getTracked(folder, cl);
    const existingIds = new Set(existing.map((e: TrackEntry) => e.public_id));
    const missing = resources
      .filter((r: any) => !existingIds.has(r.public_id))
      .map((r: any): TrackEntry => ({
        url: r.secure_url,
        public_id: r.public_id,
        created_at: r.created_at || new Date().toISOString(),
      }));
    if (missing.length > 0) {
      await saveTracked(folder, [...missing, ...existing], cl);
    }
  } catch { /* best-effort */ }
}

const PRESET_NAME = "my_girls_upload";
let presetReady = false;

async function ensurePreset() {
  if (presetReady) return;
  const cl = cfg();
  const presetOpts = {
    unsigned: true,
    folder: "",
    use_asset_folder_as_public_id_prefix: true,
    unique_filename: true,
    overwrite: false,
  };
  try {
    await cl.api.update_upload_preset(PRESET_NAME, presetOpts);
    presetReady = true;
  } catch {
    try {
      await cl.api.create_upload_preset({ name: PRESET_NAME, ...presetOpts });
      presetReady = true;
    } catch (err: any) {
      if (err?.http_code === 409 || String(err?.message).includes("already exists")) {
        presetReady = true;
      }
    }
  }
}

ensurePreset().catch(() => {/* silent */});

router.get("/cloudinary/config", async (_req, res) => {
  await ensurePreset();
  res.json({
    cloudName: process.env["CLOUDINARY_CLOUD_NAME"],
    uploadPreset: PRESET_NAME,
  });
});

router.post("/cloudinary/upload", async (req, res) => {
  try {
    const { b64_json, mimeType = "image/jpeg", folder = "my-girls" } = req.body as {
      b64_json: string; mimeType?: string; folder?: string;
    };
    if (!b64_json) { res.status(400).json({ error: "b64_json is required" }); return; }
    await ensurePreset();
    const cl = cfg();
    const dataUri = `data:${mimeType};base64,${b64_json}`;
    const result = await cl.uploader.unsigned_upload(dataUri, PRESET_NAME, {
      folder,
      resource_type: "image",
    });
    res.json({ url: result.secure_url, public_id: result.public_id, width: result.width, height: result.height });
  } catch (err: any) {
    req.log.error({ err }, "Cloudinary upload failed");
    res.status(500).json({ error: err?.message || "Upload failed" });
  }
});

router.get("/cloudinary/list", async (req, res) => {
  try {
    const folder = (req.query["folder"] as string) || "my-girls";
    const cl = cfg();

    // Primary: Cloudinary meta track store — survives Render redeploy + app reinstall
    const tracked = await getTracked(folder, cl);
    if (tracked.length > 0) {
      const images = tracked.map(t => ({ url: t.url, public_id: t.public_id, created_at: t.created_at }));
      res.json({ images, source: "track" });
      // Background: once per server-session, sync Admin API to catch photos uploaded
      // while server was sleeping (fire-and-forget — does not delay response)
      backgroundSyncFolder(folder, cl).catch(() => {});
      return;
    }

    // Fallback: Admin API (3 methods)
    let resources: any[] = [];
    try {
      const r1 = await (cl.api as any).resources_by_asset_folder(folder, { max_results: 50, resource_type: "image" });
      if (r1?.resources?.length) resources = r1.resources;
    } catch {}
    if (resources.length === 0) {
      try {
        const r2 = await cl.api.resources({ type: "upload", resource_type: "image", prefix: folder + "/", max_results: 50 });
        if (r2?.resources?.length) resources = r2.resources;
      } catch {}
    }
    // NOTE: a 3rd fallback using `resources({ asset_folder: folder })` used to exist here.
    // Cloudinary's generic resources() endpoint silently ignores an `asset_folder` filter,
    // so it returned unfiltered account-wide results — causing every empty folder to show
    // random photos from OTHER folders. Removed; if methods 1+2 find nothing, the folder
    // is genuinely empty.
    const images = resources.map((r: any) => ({
      url: r.secure_url, public_id: r.public_id,
      width: r.width, height: r.height, created_at: r.created_at,
    }));
    // Write-through: save Admin API results to track store so future reads don't need Admin API
    if (images.length > 0) {
      const entries: TrackEntry[] = images.map(i => ({
        url: i.url, public_id: i.public_id,
        created_at: i.created_at || new Date().toISOString(),
      }));
      saveTracked(folder, entries, cl).catch(() => {});
    }
    res.json({ images, source: "admin_api" });
  } catch (err: any) {
    req.log.error({ err }, "Cloudinary list failed");
    res.status(500).json({ error: err?.message || "List failed" });
  }
});

router.get("/cloudinary/debug-all", async (req, res) => {
  try {
    const cl = cfg();
    const result = await cl.api.resources({ type: "upload", resource_type: "image", prefix: "my-girls/", max_results: 50 });
    res.json({
      total: result.resources?.length,
      paths: result.resources?.map((r: any) => ({ public_id: r.public_id, folder: r.folder, url: r.secure_url?.slice(0, 100) })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

router.delete("/cloudinary/delete", async (req, res) => {
  try {
    const { public_id } = req.body as { public_id: string };
    if (!public_id) { res.status(400).json({ error: "public_id is required" }); return; }
    const cl = cfg();

    // The client doesn't tell us whether this is an image or a video, and
    // Cloudinary requires the correct resource_type to actually destroy it —
    // destroying with the wrong type silently no-ops (result !== "ok").
    // Try image first (the common case), then video.
    let result = await cl.uploader.destroy(public_id, { resource_type: "image", invalidate: true });
    if (result?.result !== "ok") {
      result = await cl.uploader.destroy(public_id, { resource_type: "video", invalidate: true });
    }

    // Remove from ALL ancestor folder track stores — otherwise the deleted
    // image reappears on the next sync because parent-folder tracks (e.g.
    // my-girls root) still hold a reference even after the direct-parent
    // track is cleaned. Walk up every level: my-girls/kavya/breast →
    // my-girls/kavya → my-girls.
    const parts = public_id.split('/');
    parts.pop(); // strip filename, keep folder segments only
    while (parts.length > 0) {
      const folder = parts.join('/');
      try {
        const existing = await getTracked(folder, cl);
        const filtered = existing.filter(e => e.public_id !== public_id);
        if (filtered.length !== existing.length) {
          await saveTracked(folder, filtered, cl);
        }
      } catch { /* best-effort */ }
      parts.pop(); // move up one level
    }

    res.json({ success: true, result: result?.result });
  } catch (err: any) {
    req.log.error({ err }, "Cloudinary delete failed");
    res.status(500).json({ error: err?.message || "Delete failed" });
  }
});

router.get("/cloudinary/videos", async (req, res) => {
  try {
    const folder = (req.query["folder"] as string) || "my-girls/videos";
    const cl = cfg();
    let resources: any[] = [];
    try {
      const r1 = await (cl.api as any).resources_by_asset_folder(folder, { max_results: 100, resource_type: "video" });
      if (r1?.resources?.length) resources = r1.resources;
    } catch {}
    if (resources.length === 0) {
      try {
        const r2 = await cl.api.resources({ type: "upload", resource_type: "video", prefix: folder + "/", max_results: 100 });
        if (r2?.resources?.length) resources = r2.resources;
      } catch {}
    }
    // NOTE: a fallback using `resources({ asset_folder: folder })` used to exist here.
    // Cloudinary's generic resources() endpoint silently ignores an `asset_folder` filter,
    // so it returned unfiltered account-wide results instead of an empty/real list. Removed.
    if (resources.length === 0) {
      try {
        const parentParts = folder.split("/");
        const subname = parentParts.pop() || "";
        const parentFolder = parentParts.join("/") || "my-girls/videos";
        const r4 = await cl.api.resources({ type: "upload", resource_type: "video", prefix: parentFolder + "/", max_results: 300 });
        if (r4?.resources?.length) {
          resources = r4.resources.filter((r: any) => {
            const pid: string = r.public_id || "";
            const af: string = r.asset_folder || "";
            return pid.includes(subname) || af.includes(subname) || af === folder;
          });
        }
      } catch {}
    }
    const videos = resources.map((r: any) => ({
      url: r.secure_url || r.url, public_id: r.public_id, format: r.format || "mp4", duration: r.duration,
    }));
    res.json({ videos });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Video list failed" });
  }
});

// ── POST /api/cloudinary/track ────────────────────────────────────────────
// Saves upload metadata to Cloudinary meta (survives Render redeploy + reinstall)
router.post("/cloudinary/track", async (req, res) => {
  try {
    const { folder, public_id, url, created_at } = req.body as {
      folder: string; public_id: string; url: string; created_at?: string;
    };
    if (!folder || !public_id || !url) {
      res.status(400).json({ error: "folder, public_id, url required" });
      return;
    }
    const cl = cfg();
    const entry: TrackEntry = { url, public_id, created_at: created_at || new Date().toISOString() };
    const existing = await getTracked(folder, cl);
    if (!existing.find(e => e.public_id === public_id)) {
      const updated = [entry, ...existing];
      trackCache.set(folder, updated); // immediate in-memory update
      saveTracked(folder, updated, cl).catch(() => {}); // async save to Cloudinary meta
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/cloudinary/meta ───────────────────────────────────────────────
// Fix 2a: Retrieve custom folder metadata stored in Cloudinary as a raw JSON file
router.get("/cloudinary/meta", async (req, res) => {
  const key = (req.query["key"] as string) || "custom_chars";
  try {
    const cl = cfg();
    const info = await cl.api.resource(`my-girls/meta/${key}`, { resource_type: "raw" });
    const resp = await fetch(info.secure_url);
    const data = await resp.json();
    res.json({ data });
  } catch {
    res.json({ data: null });
  }
});

// ── POST /api/cloudinary/meta ──────────────────────────────────────────────
// Fix 2b: Save custom folder metadata to Cloudinary as a raw JSON file
router.post("/cloudinary/meta", async (req, res) => {
  const { key, data } = req.body as { key: string; data: unknown };
  if (!key) { res.status(400).json({ error: "key required" }); return; }
  try {
    const cl = cfg();
    const json = JSON.stringify(data);
    const b64 = Buffer.from(json).toString("base64");
    await cl.uploader.upload(`data:application/json;base64,${b64}`, {
      public_id: `my-girls/meta/${key}`,
      resource_type: "raw",
      overwrite: true,
      invalidate: true,
    } as any);
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Cloudinary meta save failed");
    res.status(500).json({ error: err?.message || "Save failed" });
  }
});

// ── POST /api/cloudinary/create-folder ────────────────────────────────────
// Creates a Cloudinary folder using Admin API (requires api_key + api_secret)
// PLACEHOLDER_PNG: 1x1 transparent PNG (base64)
const PLACEHOLDER_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

router.post("/cloudinary/create-folder", async (req, res) => {
  const { folderPath } = req.body as { folderPath: string };
  if (!folderPath || folderPath.endsWith('/')) {
    return res.status(400).json({ error: "folderPath required" });
  }
  const cl = cfg();

  // IMPORTANT: Cloudinary Admin API create_folder() creates an invisible system
  // entry that does NOT appear in the Media Library console. The ONLY reliable way
  // to make a folder visible in the Cloudinary console is to upload an actual file.
  // We use a signed upload (api_key + api_secret) of a 1×1 transparent placeholder
  // PNG so the folder appears immediately in the console after creation.
  try {
    await cl.uploader.upload(
      `data:image/png;base64,${PLACEHOLDER_B64}`,
      {
        public_id: `${folderPath}/placeholder`,
        resource_type: 'image',
        overwrite: true,
        invalidate: true,
      }
    );
    return res.json({ ok: true, folder: folderPath, method: 'signed_upload' });
  } catch (err: any) {
    const msg: string = err?.message || err?.error?.message || JSON.stringify(err).slice(0, 300);
    req.log.error({ err: msg, folderPath }, 'Signed placeholder upload failed');
    return res.status(500).json({ error: msg, folderPath });
  }
});

// ── GET /api/cloudinary/characters ─────────────────────────────────────────
// Lists all character IDs (direct sub-folder names under my-girls/)
router.get("/cloudinary/characters", async (_req, res) => {
  const cl = cfg();
  try {
    const result = await (cl.api as any).sub_folders('my-girls');
    const ids: string[] = (result?.folders ?? []).map((f: any) => f.name as string);
    return res.json({ ok: true, characters: ids });
  } catch {
    try {
      const r = await cl.api.resources({
        type: 'upload', resource_type: 'image',
        prefix: 'my-girls/', max_results: 500,
      });
      const ids = [...new Set(
        (r?.resources ?? [])
          .map((x: any) => (x.public_id as string).split('/')[1])
          .filter(Boolean),
      )] as string[];
      return res.json({ ok: true, characters: ids, method: 'prefix-scan' });
    } catch (err2: any) {
      return res.status(500).json({ error: String(err2?.message ?? err2) });
    }
  }
});

// ── DELETE /api/cloudinary/delete-style-folder ─────────────────────────────
// Deletes a photo style folder across ALL character folders:
//   my-girls/{charId}/{styleId}/ → delete all assets + the empty folder itself
router.delete("/cloudinary/delete-style-folder", async (req, res) => {
  const { styleId } = req.body as { styleId?: string };
  if (!styleId || typeof styleId !== 'string') {
    return res.status(400).json({ error: 'styleId required' });
  }
  const cl = cfg();

  // Collect all character IDs from Cloudinary sub-folders
  let charIds: string[] = [];
  try {
    const result = await (cl.api as any).sub_folders('my-girls');
    charIds = (result?.folders ?? []).map((f: any) => f.name as string);
  } catch {
    try {
      const r = await cl.api.resources({
        type: 'upload', resource_type: 'image',
        prefix: 'my-girls/', max_results: 500,
      });
      charIds = [...new Set(
        (r?.resources ?? [])
          .map((x: any) => (x.public_id as string).split('/')[1])
          .filter(Boolean),
      )] as string[];
    } catch { /* no chars found */ }
  }

  const results: { charId: string; deleted: number; folderDeleted: boolean; error?: string }[] = [];

  for (const charId of charIds) {
    const folder = `my-girls/${charId}/${styleId}`;
    let deleted = 0;
    let folderDeleted = false;
    try {
      // Collect assets: from track cache first, then Admin API prefix scan
      let publicIds: string[] = [];
      try {
        const tracked = await getTracked(folder, cl);
        publicIds = tracked.map(t => t.public_id);
      } catch {}
      if (publicIds.length === 0) {
        try {
          const r = await cl.api.resources({
            type: 'upload', resource_type: 'image',
            prefix: folder + '/', max_results: 500,
          });
          publicIds = (r?.resources ?? []).map((x: any) => x.public_id as string);
        } catch {}
      }
      // Delete each asset (try image, fallback to video)
      for (const pid of publicIds) {
        try {
          const r: any = await cl.uploader.destroy(pid, { resource_type: 'image', invalidate: true });
          if (r?.result !== 'ok') {
            await cl.uploader.destroy(pid, { resource_type: 'video', invalidate: true });
          }
          deleted++;
        } catch {}
      }
      // Clear track cache for this folder
      trackCache.delete(folder);
      // Delete _keep placeholder if it exists
      try {
        await cl.uploader.destroy(`${folder}/_keep`, { resource_type: 'image', invalidate: true });
      } catch {}
      // Delete the now-empty folder via Admin API
      try {
        await (cl.api as any).delete_folder(folder);
        folderDeleted = true;
      } catch {}
      results.push({ charId, deleted, folderDeleted });
    } catch (err: any) {
      results.push({ charId, deleted, folderDeleted, error: String(err?.message ?? err) });
    }
  }

  return res.json({ ok: true, styleId, charCount: charIds.length, results });
});

// ── DELETE /api/cloudinary/delete-folder ───────────────────────────────────
// Permanently deletes a custom photo-style global folder from Cloudinary and
// removes the style entry from the meta store.
// Cloudinary path: my-girls/global_styles/{styleId}/
router.delete("/cloudinary/delete-folder", async (req, res) => {
  const { styleId } = req.body as { styleId?: string };
  if (!styleId || typeof styleId !== 'string') {
    return res.status(400).json({ error: 'styleId required' });
  }
  const cl = cfg();
  const folderPath = `my-girls/global_styles/${styleId}`;

  let assetsDeleted = 0;
  let folderDeleted = false;

  // Step a: Delete all assets inside the style folder using Admin API prefix delete
  try {
    const r = await (cl.api as any).delete_resources_by_prefix(`${folderPath}/`);
    assetsDeleted = Object.keys(r?.deleted ?? {}).length;
  } catch (err: any) {
    req.log.warn({ err: String(err?.message ?? err), styleId }, 'delete_resources_by_prefix failed');
  }
  // Clear any in-memory track cache for this folder
  trackCache.delete(folderPath);

  // Step b: Delete the now-empty Cloudinary folder itself
  try {
    await (cl.api as any).delete_folder(folderPath);
    folderDeleted = true;
  } catch (err: any) {
    req.log.warn({ err: String(err?.message ?? err), styleId }, 'delete_folder failed');
  }

  // Step c: Remove the style entry from the global_photo_styles meta store permanently
  try {
    const metaKey = 'global_photo_styles';
    const info = await cl.api.resource(`my-girls/meta/${metaKey}`, { resource_type: 'raw' });
    const resp = await fetch(info.secure_url + `?_t=${Date.now()}`);
    const raw = await resp.json() as { hidden?: string[]; custom?: { id: string }[] };
    const updated = {
      hidden: Array.isArray(raw.hidden) ? raw.hidden : [],
      custom: Array.isArray(raw.custom) ? raw.custom.filter((s: any) => s.id !== styleId) : [],
    };
    const b64 = Buffer.from(JSON.stringify(updated)).toString('base64');
    await cl.uploader.upload(`data:application/json;base64,${b64}`, {
      public_id: `my-girls/meta/${metaKey}`,
      resource_type: 'raw',
      overwrite: true,
      invalidate: true,
    } as any);
  } catch (err: any) {
    req.log.warn({ err: String(err?.message ?? err), styleId }, 'meta update failed — style entry may remain');
  }

  return res.json({ ok: true, styleId, assetsDeleted, folderDeleted });
});

export default router;
