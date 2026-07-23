import { Router } from "express";
import { randomUUID } from "node:crypto";

const router = Router();

// ── In-memory job store ───────────────────────────────────────────
interface Job {
  status: "processing" | "done" | "error";
  result?: { b64_json: string; mimeType: string };
  error?: string;
  createdAt: number;
}
const jobs = new Map<string, Job>();
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
}, 10 * 60 * 1000);

// ── Prompt builder ────────────────────────────────────────────────
function buildPrompt(params: {
  imagePrompt?: string;
  personaName?: string;
  imgFace?: string;
  imgBody?: string;
  imgAttire?: string;
}): string {
  if (params.imagePrompt) return params.imagePrompt;
  const parts: string[] = [];
  if (params.personaName) parts.push(`${params.personaName}, beautiful Tamil woman`);
  if (params.imgFace)    parts.push(params.imgFace);
  if (params.imgBody)    parts.push(params.imgBody);
  if (params.imgAttire)  parts.push(params.imgAttire);
  parts.push("photorealistic, high quality, detailed, 8k, cinematic lighting, sharp focus");
  return parts.join(", ");
}

// ── 1. Pollinations.ai — 100% FREE, no key, no card ──────────────
async function generateViaPollinations(prompt: string): Promise<{ b64_json: string; mimeType: string }> {
  const seed = Math.floor(Math.random() * 999999);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=512&height=768&model=flux&nologo=true&seed=${seed}&nofeed=true`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(90000),
    headers: { Accept: "image/*" },
  });
  if (!res.ok) throw new Error(`Pollinations error ${res.status}`);

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 1000) throw new Error("Pollinations returned empty image");
  const b64 = Buffer.from(buffer).toString("base64");
  return { b64_json: b64, mimeType: contentType.split(";")[0] };
}

// ── 2. fal.ai Flux Schnell — fast if credits available ───────────
async function generateViaFal(prompt: string): Promise<{ b64_json: string; mimeType: string }> {
  const key = process.env["FAL_KEY"];
  if (!key) throw new Error("FAL_KEY not configured");

  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_size: "portrait_4_3",
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  const data = await res.json() as any;
  if (!res.ok) throw new Error(data?.error?.message || data?.detail || `fal error ${res.status}`);
  const imgUrl: string = data?.images?.[0]?.url;
  if (!imgUrl) throw new Error("No image URL in fal response");

  const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(30000) });
  if (!imgRes.ok) throw new Error("Image download failed");
  const buffer = await imgRes.arrayBuffer();
  return { b64_json: Buffer.from(buffer).toString("base64"), mimeType: "image/jpeg" };
}


// ── 3. HuggingFace Inference API — uses HUGGING_FACE_KEY ─────────
async function generateViaHuggingFace(prompt: string): Promise<{ b64_json: string; mimeType: string }> {
  const key = process.env["HUGGING_FACE_KEY"] || process.env["HUGGING_FACE_API_KEY"] || process.env["HF_TOKEN"];
  if (!key) throw new Error("HUGGING_FACE_KEY not configured");

  const model = "black-forest-labs/FLUX.1-schnell";
  const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "x-wait-for-model": "true",
    },
    body: JSON.stringify({ inputs: prompt, parameters: { width: 512, height: 768, num_inference_steps: 4 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HuggingFace error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { b64_json: Buffer.from(buf).toString("base64"), mimeType: mime };
}

// ── Background processor (tries in order) ────────────────────────
async function processGenerate(jobId: string, prompt: string) {
  const update = (data: Partial<Job>) => {
    const j = jobs.get(jobId);
    if (j) jobs.set(jobId, { ...j, ...data });
  };

  // Try HuggingFace first (if key set), then Pollinations (free), then fal.ai fallback
  const providers: Array<{ name: string; fn: () => Promise<{ b64_json: string; mimeType: string }> }> = [
    { name: "HuggingFace",   fn: () => generateViaHuggingFace(prompt) },
    { name: "Pollinations",  fn: () => generateViaPollinations(prompt) },
    { name: "fal.ai Flux",   fn: () => generateViaFal(prompt) },
  ];

  for (const p of providers) {
    try {
      const result = await p.fn();
      update({ status: "done", result });
      return;
    } catch { continue; }
  }

  update({ status: "error", error: "Image generate ஆகவில்லை. மீண்டும் try பண்ணுங்க." });
}

// ── Poll endpoint ─────────────────────────────────────────────────
router.get("/generate-image/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(job.status === "done"
    ? { status: "done",  result: job.result }
    : job.status === "error"
    ? { status: "error", error: job.error }
    : { status: "processing" });
});

// ── Start endpoint ────────────────────────────────────────────────
router.post("/generate-image/start", async (req, res) => {
  const params = req.body as {
    imagePrompt?: string;
    personaName?: string;
    imgFace?: string;
    imgBody?: string;
    imgAttire?: string;
  };
  const jobId = randomUUID();
  jobs.set(jobId, { status: "processing", createdAt: Date.now() });
  res.json({ jobId });
  processGenerate(jobId, buildPrompt(params)).catch(() => {});
});

export default router;
