import { Router } from "express";
import { randomUUID } from "node:crypto";

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
  // source_url = preset body image; target_url = user selfie (base64 data URI or URL)
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

async function toBase64(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    if (m) return m[1];
    throw new Error("Invalid data URI");
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`fetch failed ${r.status}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

// ── BLACKHOOL/Roop-face-swap Gradio space ──────────────────────────
// Space: https://blackhool-roop-face-swap.hf.space
// Endpoint: /run/predict
// Inputs: [source_face_base64, target_image_base64]
async function tryBlackhoolRoop(faceB64: string, bodyB64: string): Promise<string | null> {
  const SPACE = "https://blackhool-roop-face-swap.hf.space";

  // Step 1: get queue info (may need session hash)
  const sessionHash = randomUUID().replace(/-/g, "").slice(0, 11);

  // Try REST predict endpoint first
  const predictRes = await fetch(`${SPACE}/run/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [faceB64, bodyB64],
      session_hash: sessionHash,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (predictRes.ok) {
    const json = await predictRes.json() as any;
    const out = json?.data?.[0];
    if (out) {
      if (typeof out === "string" && (out.startsWith("http") || out.startsWith("data:"))) return out;
      if (out?.url) return out.url as string;
      if (out?.path) return `${SPACE}/file=${out.path}`;
    }
  }

  // Step 2: Try queue/join + queue/status SSE approach
  const joinRes = await fetch(`${SPACE}/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [faceB64, bodyB64],
      fn_index: 0,
      session_hash: sessionHash,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!joinRes.ok) throw new Error(`queue/join failed: ${joinRes.status}`);

  // Poll queue/status
  for (let i = 0; i < 40; i++) {
    await new Promise<void>(r => setTimeout(r, 3000));
    const statusRes = await fetch(`${SPACE}/queue/status?session_hash=${sessionHash}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!statusRes.ok) continue;
    const data = await statusRes.json() as any;
    if (data?.msg === "process_completed") {
      const output = data?.output?.data?.[0];
      if (!output) return null;
      if (typeof output === "string" && (output.startsWith("http") || output.startsWith("data:"))) return output;
      if (output?.url) return output.url as string;
      if (output?.path) return `${SPACE}/file=${output.path}`;
      return null;
    }
    if (data?.msg === "process_errored") throw new Error("Roop space returned error");
  }
  throw new Error("Roop space timeout");
}

// ── Fallback: tonyassi space ─────────────────────────────────────
async function tryFallbackSpace(faceB64: string, bodyB64: string): Promise<string | null> {
  const spaces = [
    { slug: "tonyassi-face-swap",     ep: "run_inference" },
    { slug: "Dentro-face-swap",       ep: "predict"       },
    { slug: "felixrosberg-face-swap", ep: "predict"       },
  ];
  for (const s of spaces) {
    try {
      const res = await fetch(`https://${s.slug}.hf.space/run/${s.ep}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [faceB64, bodyB64] }),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) continue;
      const json = await res.json() as any;
      const out = json?.data?.[0];
      if (!out) continue;
      if (typeof out === "string" && (out.startsWith("http") || out.startsWith("data:"))) return out;
      if (out?.url) return out.url as string;
      if (out?.path) return `https://${s.slug}.hf.space/file=${out.path}`;
    } catch { continue; }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────
async function processSwap(jobId: string, bodyUrl: string, faceDataUri: string) {
  try {
    // Convert both to base64
    const [bodyB64, faceB64] = await Promise.all([
      toBase64(bodyUrl),
      toBase64(faceDataUri),
    ]);

    // 1. Primary: BLACKHOOL/Roop-face-swap
    let resultUrl: string | null = null;
    try {
      resultUrl = await tryBlackhoolRoop(faceB64, bodyB64);
    } catch (e: any) {
      req_log(`Roop failed: ${e?.message}`);
    }

    // 2. Fallback: other HF spaces
    if (!resultUrl) {
      try { resultUrl = await tryFallbackSpace(faceB64, bodyB64); } catch { /* ignore */ }
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

function req_log(msg: string) { console.error("[faceswap]", msg); }

export default router;
