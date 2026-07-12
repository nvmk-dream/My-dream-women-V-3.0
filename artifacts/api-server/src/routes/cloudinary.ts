import { Router } from "express";
import { v2 as cloudinary } from "cloudinary";

const router = Router();

// ── Track Store (Cloudinary meta — survives Render redeploy + app reinstall) ──
type TrackEntry = { url: string; public_id: string; created_at: string };
const trackCache = new Map<string, TrackEntry[]>(); // in-memory for speed

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
    const entries = Array.isArray(data) ? data : [];
    trackCache.set(folder, entries);
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
    if (resources.length === 0) {
      try {
        const r3 = await cl.api.resources({ asset_folder: folder, max_results: 50, resource_type: "image" } as any);
        if (r3?.resources?.length) resources = r3.resources;
      } catch {}
    }
    const images = resources.map((r: any) => ({
      url: r.secure_url, public_id: r.public_id,
      width: r.width, height: r.height, created_at: r.created_at,
    }));
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
    await cfg().uploader.destroy(public_id);
    res.json({ success: true });
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
    if (resources.length === 0) {
      try {
        const r3 = await (cl.api as any).resources({ asset_folder: folder, max_results: 100, resource_type: "video" });
        if (r3?.resources?.length) resources = r3.resources;
      } catch {}
    }
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

  // Method 1: Admin API create_folder (fastest, no asset created)
  try {
    await (cl.api as any).create_folder(folderPath);
    return res.json({ ok: true, folder: folderPath, method: 'admin' });
  } catch (err: any) {
    const msg: string = err?.message || err?.error?.message || JSON.stringify(err).slice(0, 300);
    // Already exists = success
    if (msg.includes('already exists') || (err?.http_code ?? err?.error?.http_code) === 409) {
      return res.json({ ok: true, folder: folderPath, existed: true });
    }
    req.log.warn({ err: msg, folderPath }, 'Admin create_folder failed, trying upload fallback');
  }

  // Method 2: Unsigned upload fallback — upload tiny placeholder to create folder
  try {
    // Note: public_id must NOT start with '.' — Cloudinary rejects it.
    // Use '_keep' as a valid placeholder name.
    await cl.uploader.unsigned_upload(
      `data:image/png;base64,${PLACEHOLDER_B64}`,
      PRESET_NAME,
      { folder: folderPath, public_id: '_keep', resource_type: 'image' }
    );
    return res.json({ ok: true, folder: folderPath, method: 'upload' });
  } catch (err2: any) {
    const msg2: string = err2?.message || err2?.error?.message || JSON.stringify(err2).slice(0, 300);
    // Already exists = success
    if (msg2.includes('already exists') || (err2?.http_code ?? err2?.error?.http_code) === 409) {
      return res.json({ ok: true, folder: folderPath, existed: true, method: 'upload' });
    }
    req.log.error({ err: msg2, folderPath }, 'Both folder creation methods failed');
    return res.status(500).json({ error: msg2, folderPath });
  }
});

export default router;
