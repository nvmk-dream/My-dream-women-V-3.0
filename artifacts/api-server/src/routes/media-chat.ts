import { Router } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { GoogleGenAI } from "@google/genai";
import type { Request } from "express";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Cloudinary config (Render env group "Cloudnary") ─────────────────────────
function cfgCloudinary() {
  cloudinary.config({
    cloud_name: process.env["CLOUDNARY_USER_NAME"]   || process.env["CLOUDINARY_CLOUD_NAME"],
    api_key:    process.env["API_KEY"]               || process.env["CLOUDINARY_API_KEY"],
    api_secret: process.env["API_SECRET"]            || process.env["CLOUDINARY_API_SECRET"],
  });
  return cloudinary;
}

// ── Gemini key rotation (Render env group "Multimedia" — keys 1–5) ───────────
const GEMINI_KEY_NAMES = [
  "GEMINI_API_KEY_1",
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEY_3",
  "GEMINI_API_KEY_4",
  "GEMINI_API_KEY_5",
  // fallbacks for local dev / other setups
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_CLOUDNARY",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
];

function getGeminiKeys(): string[] {
  return GEMINI_KEY_NAMES
    .map((k) => process.env[k] ?? "")
    .filter(Boolean)
    .map((k) => k.trim());
}

async function generateWithRotation(
  fn: (key: string) => Promise<string>,
): Promise<string> {
  const keys = getGeminiKeys();
  if (keys.length === 0) throw new Error("No Gemini API key found");
  let lastErr: unknown;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (err: any) {
      const is429 = err?.status === 429 || String(err?.message ?? "").includes("429") ||
        String(err?.message ?? "").includes("quota") || String(err?.message ?? "").includes("RESOURCE_EXHAUSTED");
      lastErr = err;
      if (!is429) throw err;
    }
  }
  throw lastErr;
}

// ── Lax safety settings ──────────────────────────────────────────────────────
const LAX_SAFETY = [
  { category: "HARM_CATEGORY_HARASSMENT",       threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
] as const;

// ── Upload buffer → Cloudinary (unsigned preset) ─────────────────────────────
const UPLOAD_PRESET = "my_girls_upload";

async function uploadBufferToCloudinary(
  buffer: Buffer,
  mimeType: string,
  folder = "my-girls/chat",
): Promise<{ secure_url: string; public_id: string }> {
  const cl      = cfgCloudinary();
  const isVideo = mimeType.startsWith("video");
  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const result  = await cl.uploader.unsigned_upload(dataUri, UPLOAD_PRESET, {
    folder,
    resource_type: isVideo ? "video" : "auto",
  });
  return { secure_url: result.secure_url, public_id: result.public_id };
}

// ── GET /api/media-chat/ping — health check ───────────────────────────────────
router.get("/media-chat/ping", async (_req, res: any) => {
  try {
    const cl       = cfgCloudinary();
    const ping     = await cl.api.ping();
    const cloudName = (process.env["CLOUDNARY_USER_NAME"] ?? process.env["CLOUDINARY_CLOUD_NAME"] ?? "").slice(0, 6) + "***";
    const keyCount  = getGeminiKeys().length;
    return res.json({ ok: true, ping, cloudName, geminiKeys: keyCount });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message, http_code: err?.http_code });
  }
});

// ── POST /api/media-chat ──────────────────────────────────────────────────────
// multipart/form-data: file (image/video), caption?, persona?
// Response: { mediaUrl, aiResponse }
router.post(
  "/media-chat",
  upload.single("file"),
  async (req: Request, res: any) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "file field is required" });

      const caption:  string = (req.body["caption"]  as string) || "";
      const persona:  string = (req.body["persona"]  as string) || "Kaviya";
      const mimeType: string = file.mimetype || "image/jpeg";
      const isVideo          = mimeType.startsWith("video");

      // ── 1. Cloudinary upload ───────────────────────────────────────────────
      const { secure_url: mediaUrl } = await uploadBufferToCloudinary(file.buffer, mimeType);

      // ── 2. Tamil romantic persona system instruction ───────────────────────
      const systemInstruction = `நீ ${persona} — user-ஓட romantic partner.
Image-ல என்ன நடக்குது, எப்படி இருக்காங்க என்று பாத்து, அன்போட, affectionate-ஆ தமிழில் reply பண்ணு.
Spoken Tamil (பேச்சு வழக்கு) மட்டும் use பண்ணு — formal இல்ல.
User என்ன சொன்னாலும் அதுக்கு ஏத்தமாதிரி warm-ஆ, personal-ஆ பதில் சொல்லு.
AI, assistant, model என்று ஒருபோதும் சொல்லாதே — நீ real partner மாதிரி இரு.`;

      const userText = caption
        ? `இந்த ${isVideo ? "video" : "photo"}-ல நாங்க இப்படி இருக்கோம். ${caption}`
        : `இந்த ${isVideo ? "video" : "photo"} பாரு — என்னன்னு சொல்லு!`;

      // ── 3. Gemini multimodal (with key rotation) ──────────────────────────
      let aiResponse: string;

      if (isVideo) {
        aiResponse = await generateWithRotation(async (apiKey) => {
          const ai = new GoogleGenAI({ apiKey });
          const videoBlob = new Blob([file.buffer], { type: mimeType });
          const uploadResult: any = await (ai.files as any).upload({
            file: videoBlob,
            config: { mimeType, displayName: file.originalname || "video" },
          });

          const deadline = Date.now() + 120_000;
          let fileUri = "";
          while (Date.now() < deadline) {
            const info: any = await (ai.files as any).get({ name: uploadResult.name });
            if (info.state === "ACTIVE") { fileUri = info.uri ?? info.fileUri ?? ""; break; }
            if (info.state === "FAILED") throw new Error("Gemini File API: upload FAILED");
            await new Promise((r) => setTimeout(r, 4000));
          }
          if (!fileUri) throw new Error("Gemini File API: ACTIVE state timeout");

          const resp = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ fileData: { fileUri, mimeType } }, { text: userText }] }],
            config: { systemInstruction, safetySettings: LAX_SAFETY as any },
          });

          await (ai.files as any).delete({ name: uploadResult.name }).catch(() => {});
          return (resp.text || "").trim() || "பதில் வரல 😅";
        });

      } else {
        const b64 = file.buffer.toString("base64");
        aiResponse = await generateWithRotation(async (apiKey) => {
          const ai   = new GoogleGenAI({ apiKey });
          const resp = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ inlineData: { data: b64, mimeType } }, { text: userText }] }],
            config: { systemInstruction, safetySettings: LAX_SAFETY as any },
          });
          return (resp.text || "").trim() || "பதில் வரல 😅";
        });
      }

      // ── 4. Return ─────────────────────────────────────────────────────────
      return res.json({ mediaUrl, aiResponse });

    } catch (err: any) {
      req.log?.error({ err }, "media-chat failed");
      return res.status(500).json({ error: err?.message || "media-chat failed" });
    }
  },
);

export default router;
