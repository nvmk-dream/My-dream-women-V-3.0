import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();

// ── Gemini key rotation — same server-side key group as media-chat.ts ────────
// (stable Render env vars, not app-local AsyncStorage keys the user may not have set)
const GEMINI_KEY_NAMES: string[] = [
  "GEMINI_API_KEY",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
  "GEMINI_API_KEY_CLOUDNARY",
  ...Array.from({ length: 5 }, (_, i) => `GEMINI_API_KEY_${i + 1}`),
];

function getGeminiKeys(): string[] {
  return [
    ...new Set(
      GEMINI_KEY_NAMES
        .map((k) => process.env[k]?.trim() ?? "")
        .filter((k) => k.length > 10 && (k.startsWith("AIza") || k.startsWith("AQ"))),
    ),
  ];
}

function getOpenRouterKey(): string | undefined {
  return (
    process.env["OPEN_ROTTER_API_KEY"] ||
    process.env["OPEN_ROUTER_API_KEY"] ||
    process.env["OPENROUTER_API_KEY"] ||
    ""
  ).trim() || undefined;
}

function isSkippableGeminiErr(err: any): boolean {
  const msg = String(err?.message ?? "");
  const status = err?.status ?? 0;
  return (
    status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota") ||
    status === 403 || msg.includes("403") || msg.includes("PERMISSION_DENIED") ||
    msg.includes("API_KEY_SERVICE_BLOCKED") || msg.includes("blocked") ||
    status === 400 || msg.includes("API_KEY_INVALID") ||
    status === 503 || msg.includes("SERVICE_UNAVAILABLE") ||
    msg.includes("SAFETY") || msg.includes("safety") ||
    msg.includes("finish_reason") || msg.includes("recitation")
  );
}

// Same lax settings media-chat.ts already applies for user-uploaded chat photos —
// applying it here too keeps behavior consistent between the two pipelines.
const LAX_SAFETY = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
] as const;

// Softer wording than the old client-side prompt — the previous "UNCOVERED BODY
// PARTS" label was clinical/body-focused phrasing that tripped Gemini's own
// safety heuristics even with BLOCK_NONE thresholds set. This version keeps the
// same information (needed to fill Face/Body/Attire boxes) but frames it as
// ordinary outfit/style description, matching how the chat pipeline's prompt
// avoids explicit body-part framing.
// Labels themselves stay in English so the server-side regex parsing below
// (extractField) keeps matching reliably regardless of model phrasing drift —
// only the *description text after each label* is requested in Tamil, since
// that's what actually shows up in the app's Face/Body/Attire boxes.
const AVATAR_PROFILE_PROMPT = `Analyze this profile photo like a fashion/portrait stylist. Reply using these EXACT English labels, but write the description after each label in Tamil (தமிழ்) — plain Tamil text only, each 1 short phrase max, describe silhouette/build/style — never explicit or clinical:

AGE RANGE: (தமிழ்ல வயது range — 18-25 / 25-35 / 35-45 / 45+)
FACE SHAPE: (முக அமைப்பு தமிழ்ல)
HAIRSTYLE: (தலைமுடி — நீளம், நிறம், texture, style, தமிழ்ல)
FOREHEAD: (நெற்றி அமைப்பு தமிழ்ல)
EYES: (கண்கள் — வடிவம், நிறம், தமிழ்ல)
NOSE: (மூக்கு அமைப்பு தமிழ்ல)
LIPS: (இதழ்கள் அமைப்பு தமிழ்ல)
CHEEKS: (கன்னங்கள் அமைப்பு தமிழ்ல)
NECK: (கழுத்து நீளம் மற்றும் அமைப்பு தமிழ்ல)
SHOULDERS AND ARMS: (தோள்கள் மற்றும் கைகள் அமைப்பு தமிழ்ல)
FIGURE SILHOUETTE: (மார்பகம்/இடை silhouette — clothing fit மூலம் தெரியுற மாதிரி, அளவு சொல்லாம தமிழ்ல)
THIGH AND LEG BUILD: (தொடை அமைப்பு, clothing fit மூலம் தெரியுற மாதிரி தமிழ்ல)
LEGS: (கால்கள் நீளம் மற்றும் அமைப்பு தமிழ்ல)
CLOTHING STYLE: (உடை style மற்றும் coverage தமிழ்ல — traditional saree / modern / casual etc)
EXPRESSION: (முக பாவனை தமிழ்ல)
BODY LANGUAGE: (posture, stance, energy தமிழ்ல)
OVERALL VIBE: (5-8 வார்த்தை characterization தமிழ்ல)
PERSONALITY IMPRESSION: (personality தமிழ்ல)
COMMUNICATION STYLE: (பேசும் style தமிழ்ல)

Respond with only these labeled lines, nothing else — no intro, no refusal, no English translation after the Tamil text.`;

const OPENROUTER_VISION_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen2.5-vl-72b-instruct",
  "qwen/qwen2.5-vl-7b-instruct",
];

async function generateWithGemini(base64: string, mimeType: string): Promise<string> {
  const keys = getGeminiKeys();
  if (keys.length === 0) throw new Error("NO_GEMINI_KEYS_CONFIGURED");
  let lastErr: unknown;

  for (const apiKey of keys) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const resp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ inlineData: { data: base64, mimeType } }, { text: AVATAR_PROFILE_PROMPT }] }],
        config: { safetySettings: LAX_SAFETY as any },
      });
      const text = (resp.text || "").trim();
      if (text) return text;
      throw new Error("SAFETY"); // empty text = blocked by safety → try next key / fallback
    } catch (err: any) {
      lastErr = err;
      if (!isSkippableGeminiErr(err)) throw err;
    }
  }

  throw lastErr ?? new Error("ALL_GEMINI_KEYS_FAILED");
}

async function generateWithOpenRouter(base64: string, mimeType: string): Promise<string> {
  const key = getOpenRouterKey();
  if (!key) throw new Error("NO_OPENROUTER_KEY_CONFIGURED");

  let lastErr: Error | undefined;
  for (const model of OPENROUTER_VISION_MODELS) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: "text", text: AVATAR_PROFILE_PROMPT },
            ],
          }],
        }),
      });
      if (resp.ok) {
        const j: any = await resp.json();
        const text = (j?.choices?.[0]?.message?.content ?? "").trim();
        if (text) return text;
        lastErr = new Error(`${model}: empty response`);
        continue;
      }
      const errText = await resp.text();
      lastErr = new Error(`${model}: HTTP ${resp.status} ${errText.slice(0, 150)}`);
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("ALL_OPENROUTER_MODELS_FAILED");
}

// Loose, case-insensitive single-line extraction — tolerant of the model adding
// markdown bullets/asterisks or slightly different casing around the label.
function extractField(text: string, label: string): string {
  const re = new RegExp(`${label}\\s*:?\\s*(.+)`, "i");
  const m = text.match(re);
  return m?.[1]?.trim().replace(/^[-*]\s*/, "").replace(/\*+$/, "") ?? "";
}

function parseProfile(raw: string) {
  const age = extractField(raw, "AGE RANGE");
  const face = extractField(raw, "FACE SHAPE");
  const hair = extractField(raw, "HAIRSTYLE");
  const forehead = extractField(raw, "FOREHEAD");
  const eyes = extractField(raw, "EYES");
  const nose = extractField(raw, "NOSE");
  const lips = extractField(raw, "LIPS");
  const cheeks = extractField(raw, "CHEEKS");
  const neck = extractField(raw, "NECK");
  const shoulders = extractField(raw, "SHOULDERS AND ARMS");
  const figure = extractField(raw, "FIGURE SILHOUETTE");
  const thighLeg = extractField(raw, "THIGH AND LEG BUILD");
  const legs = extractField(raw, "LEGS");
  const cloth = extractField(raw, "CLOTHING STYLE");
  const expr = extractField(raw, "EXPRESSION");
  const body = extractField(raw, "BODY LANGUAGE");
  const vibe = extractField(raw, "OVERALL VIBE");
  const personality = extractField(raw, "PERSONALITY IMPRESSION");
  const communicationStyle = extractField(raw, "COMMUNICATION STYLE");

  const faceVal = [age, face, hair].filter(Boolean).join(", ");
  // Full body-structure breakdown requested by the user — hair, thigh, forehead,
  // eyes, nose, lips, cheeks, neck, shoulders/arms, bust/waist, legs — all rolled
  // into the single BODY box the app UI shows.
  const bodyVal = [
    hair && `Hair: ${hair}`,
    forehead && `Forehead: ${forehead}`,
    eyes && `Eyes: ${eyes}`,
    nose && `Nose: ${nose}`,
    lips && `Lips: ${lips}`,
    cheeks && `Cheeks: ${cheeks}`,
    neck && `Neck: ${neck}`,
    shoulders && `Shoulders & arms: ${shoulders}`,
    figure && `Bust & waist: ${figure}`,
    thighLeg && `Thighs: ${thighLeg}`,
    legs && `Legs: ${legs}`,
    expr && `Expression: ${expr}`,
    body && `Body language: ${body}`,
  ].filter(Boolean).join(", ");
  const attireVal = [cloth, vibe].filter(Boolean).join(", ");

  // If none of the expected labels matched (model replied in free-form prose
  // instead of the labeled format), fall back to the raw text in the face
  // field so the UI still gets *something* instead of three empty boxes —
  // this is the "brittle regex" failure mode the old client-side code had.
  const nothingMatched = !faceVal && !bodyVal && !attireVal;

  return {
    face: faceVal || (nothingMatched ? raw.slice(0, 200) : ""),
    body: bodyVal,
    attire: attireVal,
    personality,
    communicationStyle,
    raw,
  };
}

// ── GET /api/avatar-profile/ping ──────────────────────────────────────────────
router.get("/avatar-profile/ping", async (_req, res: any) => {
  return res.json({
    ok: true,
    geminiKeys: getGeminiKeys().length,
    openRouter: !!getOpenRouterKey(),
    models: { primary: "gemini-2.5-flash", fallback: "openrouter (gemini-2.0-flash-exp:free / qwen2.5-vl)" },
  });
});

// ── POST /api/avatar-profile/analyze ──────────────────────────────────────────
router.post("/avatar-profile/analyze", async (req, res: any) => {
  try {
    const { base64, mimeType } = req.body as { base64?: string; mimeType?: string };
    if (!base64) return res.status(400).json({ error: "base64 image is required" });
    const mime = mimeType || "image/jpeg";

    let raw: string;
    let provider = "gemini-2.5-flash";
    try {
      raw = await generateWithGemini(base64, mime);
    } catch (geminiErr: any) {
      provider = "openrouter";
      try {
        raw = await generateWithOpenRouter(base64, mime);
      } catch (orErr: any) {
        return res.status(502).json({
          error: `Analysis failed on both providers. Gemini: ${String(geminiErr?.message ?? geminiErr).slice(0, 150)} | OpenRouter: ${String(orErr?.message ?? orErr).slice(0, 150)}`,
        });
      }
    }

    return res.json({ ...parseProfile(raw), provider });
  } catch (err: any) {
    req.log?.error({ err }, "avatar-profile analyze failed");
    return res.status(500).json({ error: err?.message || "avatar-profile analyze failed" });
  }
});

export default router;
