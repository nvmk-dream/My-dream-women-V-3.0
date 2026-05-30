import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Client } from "@gradio/client";

const router = Router();

interface Job {
  status: "processing" | "done" | "error";
  result_url?: string;
  error?: string;
  createdAt: number;
}
const jobs = new Map<string, Job>();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
}, 10 * 60 * 1000);

function upd(jobId: string, data: Partial<Job>) {
  const j = jobs.get(jobId);
  if (j) jobs.set(jobId, { ...j, ...data });
}

router.get("/face-swap/ping", (_req, res) => res.json({ status: "ok" }));

router.get("/face-swap/result/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(job);
});

router.post("/face-swap", async (req, res) => {
  const { source_url, target_url } = req.body as { source_url: string; target_url: string };
  if (!source_url || !target_url) {
    res.status(400).json({ error: "source_url and target_url required" });
    return;
  }
  const jobId = randomUUID();
  jobs.set(jobId, { status: "processing", createdAt: Date.now() });
  res.json({ jobId });
  processSwap(jobId, source_url, target_url).catch(() => {});
});

async function urlToBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("Invalid data URI");
    const bytes = Buffer.from(m[2], "base64");
    return new Blob([bytes], { type: m[1] });
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`fetch failed ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Blob([buf], { type: r.headers.get("content-type") || "image/jpeg" });
}

// Try a Gradio space using @gradio/client (proper SDK)
async function tryGradioSpace(
  spaceName: string,
  faceBlob: Blob,
  targetBlob: Blob,
  timeoutMs = 120000,
): Promise<string | null> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${spaceName} timeout`)), timeoutMs),
  );

  const run = (async () => {
    const client = await Client.connect(spaceName);
    const result = await client.predict("/predict", [faceBlob, targetBlob]) as any;
    const out = result?.data?.[0];
    if (!out) return null;
    if (typeof out === "string" && (out.startsWith("http") || out.startsWith("data:"))) return out;
    if (out?.url) return out.url as string;
    if (out?.path) {
      const host = spaceName.toLowerCase().replace("/", "-");
      return `https://${host}.hf.space/file=${out.path}`;
    }
    return null;
  })();

  return Promise.race([run, timer]);
}

// Fallback: raw REST for spaces that still support /run/predict
async function tryRestSpace(
  spaceHost: string,
  faceB64: string,
  bodyB64: string,
): Promise<string | null> {
  const res = await fetch(`https://${spaceHost}.hf.space/run/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [faceB64, bodyB64], fn_index: 0 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) return null;
  const json = await res.json() as any;
  const out = json?.data?.[0];
  if (!out) return null;
  if (typeof out === "string" && (out.startsWith("http") || out.startsWith("data:"))) return out;
  if (out?.url) return out.url as string;
  if (out?.path) return `https://${spaceHost}.hf.space/file=${out.path}`;
  return null;
}

async function processSwap(jobId: string, bodyUrl: string, faceDataUri: string) {
  try {
    const [faceBlob, bodyBlob] = await Promise.all([
      urlToBlob(faceDataUri),
      urlToBlob(bodyUrl),
    ]);

    // Convert face to base64 for REST fallback
    const faceB64 = await faceBlob.arrayBuffer().then(b => Buffer.from(b).toString("base64"));
    const bodyB64 = await bodyBlob.arrayBuffer().then(b => Buffer.from(b).toString("base64"));

    let resultUrl: string | null = null;

    // 1. tonyassi/face-swap — most reliable free HF space
    if (!resultUrl) {
      try { resultUrl = await tryGradioSpace("tonyassi/face-swap", faceBlob, bodyBlob, 120000); }
      catch (e: any) { console.error("[faceswap] tonyassi failed:", e?.message?.slice(0, 100)); }
    }

    // 2. Dentro/face-swap
    if (!resultUrl) {
      try { resultUrl = await tryGradioSpace("Dentro/face-swap", faceBlob, bodyBlob, 90000); }
      catch (e: any) { console.error("[faceswap] Dentro failed:", e?.message?.slice(0, 100)); }
    }

    // 3. felixrosberg/face-swap
    if (!resultUrl) {
      try { resultUrl = await tryGradioSpace("felixrosberg/face-swap", faceBlob, bodyBlob, 90000); }
      catch (e: any) { console.error("[faceswap] felixrosberg failed:", e?.message?.slice(0, 100)); }
    }

    // 4. Raw REST fallback — blackhool roop
    if (!resultUrl) {
      try { resultUrl = await tryRestSpace("blackhool-roop-face-swap", faceB64, bodyB64); }
      catch (e: any) { console.error("[faceswap] blackhool REST failed:", e?.message?.slice(0, 100)); }
    }

    if (resultUrl) {
      upd(jobId, { status: "done", result_url: resultUrl });
    } else {
      upd(jobId, {
        status: "error",
        error: "Face swap தற்போது கிடைக்கவில்லை. சில நிமிடம் கழித்து மீண்டும் try பண்ணுங்க.",
      });
    }
  } catch (err: any) {
    upd(jobId, { status: "error", error: err?.message || "Face swap failed" });
  }
}

export default router;
