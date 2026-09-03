import { GoogleGenAI } from "@google/genai";

const ATTEMPT_TIMEOUT_MS = 25_000;

export type ServerAiMessage = {
  role: string;
  content: string;
};

export type ServerAiLog = {
  info?: (data: unknown, message?: string) => void;
  warn?: (data: unknown, message?: string) => void;
  error?: (data: unknown, message?: string) => void;
};

export type ServerAiRequest = {
  messages: ServerAiMessage[];
  systemPrompt?: string;
  clientApiKey?: string;
  mode?: string;
  log?: ServerAiLog;
  deadline?: number;
};

export type ServerAiProviderStats = {
  lastError: unknown;
  quotaErrorCount: number;
  geminiAttempts: number;
  openRouterKeyCount: number;
  openAIKeyCount: number;
  noKeysAtAll: boolean;
  timedOut: boolean;
};

export class ServerAiProviderError extends Error {
  readonly code = "AI_PROVIDER_FAILED";
  readonly status = 502;

  constructor(readonly stats: ServerAiProviderStats) {
    super("All server AI providers were exhausted");
    this.name = "ServerAiProviderError";
  }
}

function getServerKeys(): string[] {
  const candidates: (string | undefined)[] = [
    process.env["AI_INTEGRATIONS_GEMINI_API_KEY"],
    process.env["GEMINI_API_KEY"],
  ];
  for (let i = 1; i <= 20; i++) {
    candidates.push(process.env[`GEMINI_API_KEY_${i}`]);
  }
  const keys = candidates.filter((key): key is string => typeof key === "string" && key.trim().length > 0);
  return Array.from(new Set(keys.map((key) => key.trim())));
}

export function getOpenRouterKeys(): string[] {
  const candidates: (string | undefined)[] = [
    process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"],
    process.env["OPENROUTER_API_KEY"],
    process.env["OPENROUTER_API_KEY_2"],
    process.env["OPENROUTER_API_KEY_3"],
  ];
  const keys = candidates.filter((key): key is string => typeof key === "string" && key.trim().length > 0);
  return Array.from(new Set(keys.map((key) => key.trim())));
}

export function getOpenAIKeys(): string[] {
  const candidates: (string | undefined)[] = [
    process.env["OPENAI_API_KEY"],
    process.env["OPENAI_API_KEY_2"],
    process.env["OPENAI_API_KEY_3"],
  ];
  const keys = candidates.filter((key): key is string => typeof key === "string" && key.trim().length > 0);
  return Array.from(new Set(keys.map((key) => key.trim())));
}

// Story/multimedia mode intentionally uses the same server key pool as /api/chat.
export function getMultimediaKeys(): string[] {
  const candidates: (string | undefined)[] = [
    process.env["GEMINI_API_KEY"],
    process.env["AI_INTEGRATIONS_GEMINI_API_KEY"],
  ];
  for (let i = 1; i <= 5; i++) {
    candidates.push(process.env[`GEMINI_API_KEY_${i}`]);
  }
  const keys = candidates.filter((key): key is string => typeof key === "string" && key.trim().length > 0);
  return Array.from(new Set(keys.map((key) => key.trim())));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error: any = new Error(`${label} timeout after ${ms}ms`);
      error.code = "TIMEOUT";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function tryOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string | undefined,
  messages: ServerAiMessage[],
  signal: AbortSignal,
): Promise<string> {
  const body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })),
    ],
    max_tokens: 2048,
  };
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://my-dream-women-v2.onrender.com",
      "X-Title": "My Dream Women Tamil AI Chat",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    const error: any = new Error(`${response.status} ${text.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  const json: any = await response.json();
  const content = json?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("empty_openai_response");
  return content;
}

export const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

export function isQuotaError(error: any): boolean {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  const status = error?.status ?? error?.statusCode ?? error?.code;
  return (
    status === 429 ||
    message.includes("429") ||
    message.includes("quota") ||
    message.includes("exceeded") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit")
  );
}

export function isKeyError(error: any): boolean {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  const status = error?.status ?? error?.statusCode ?? error?.code;
  if (status === 401 || status === 403) return true;
  return (
    message.includes("api key not valid") ||
    message.includes("api_key_invalid") ||
    message.includes("permission_denied") ||
    message.includes("unauthenticated") ||
    message.includes("invalid api key")
  );
}

function remainingAttemptTime(deadline?: number): number {
  if (!deadline) return ATTEMPT_TIMEOUT_MS;
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    const error: any = new Error("server AI provider deadline exceeded");
    error.code = "TIMEOUT";
    throw error;
  }
  return Math.min(ATTEMPT_TIMEOUT_MS, remaining);
}

export async function generateServerAiResponse(request: ServerAiRequest): Promise<string> {
  const {
    messages,
    systemPrompt,
    clientApiKey,
    mode,
    log = {},
    deadline,
  } = request;
  const serverKeys = mode === "story" ? getMultimediaKeys() : getServerKeys();
  const tryKeys: string[] = [];
  if (clientApiKey?.trim()) tryKeys.push(clientApiKey.trim());
  for (const key of serverKeys) {
    if (!tryKeys.includes(key)) tryKeys.push(key);
  }

  // A client key calls Google directly. Without one, use the configured
  // Replit AI proxy, exactly as the existing /api/chat path does.
  const baseUrl = clientApiKey?.trim()
    ? undefined
    : process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  let lastError: any = null;
  let quotaErrorCount = 0;
  let geminiAttempts = 0;
  let timedOut = false;

  for (let keyIndex = 0; keyIndex < tryKeys.length; keyIndex++) {
    const key = tryKeys[keyIndex];
    const ai = new GoogleGenAI({
      apiKey: key,
      ...(baseUrl ? { httpOptions: { apiVersion: "", baseUrl } } : {}),
    });

    for (const model of MODELS) {
      geminiAttempts++;
      try {
        const result = await withTimeout(
          ai.models.generateContent({
            model,
            contents,
            config: {
              maxOutputTokens: 8192,
              safetySettings: [
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
              ] as any,
              ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
            },
          }),
          remainingAttemptTime(deadline),
          `gemini ${model}`,
        );
        const blockReason = (result as any)?.candidates?.[0]?.finishReason;
        const text = result.text?.trim() ?? "";
        if (!text) {
          lastError = new Error(`empty_response: ${blockReason ?? "unknown"}`);
          log.warn?.({ keyIdx: keyIndex, model, blockReason }, "Empty response — trying next model/key");
          continue;
        }
        log.info?.({ keyIdx: keyIndex, model, blockReason }, "Chat success");
        return text;
      } catch (error: any) {
        lastError = error;
        const quota = isQuotaError(error);
        const keyBad = isKeyError(error);
        if (error?.code === "TIMEOUT" || error?.name === "AbortError") timedOut = true;
        log.warn?.(
          { keyIdx: keyIndex, model, quota, keyBad, msg: error?.message?.slice(0, 200) },
          "Chat attempt failed",
        );
        if (quota) quotaErrorCount++;
        if (keyBad) break;
      }
    }
  }

  const openRouterKeys = getOpenRouterKeys();
  const openRouterModels = [
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
  ];
  for (const key of openRouterKeys) {
    for (const model of openRouterModels) {
      const controller = new AbortController();
      const attemptTimeout = remainingAttemptTime(deadline);
      const timer = setTimeout(() => controller.abort(), attemptTimeout);
      try {
        const content = await tryOpenAICompatible(
          "https://openrouter.ai/api/v1",
          key,
          model,
          systemPrompt,
          messages,
          controller.signal,
        );
        clearTimeout(timer);
        log.info?.({ provider: "openrouter", model }, "Chat success via fallback");
        return content;
      } catch (error: any) {
        clearTimeout(timer);
        lastError = error;
        if (isQuotaError(error)) quotaErrorCount++;
        if (error?.name === "AbortError") timedOut = true;
        log.warn?.(
          { provider: "openrouter", model, msg: error?.message?.slice(0, 200) },
          "OpenRouter attempt failed",
        );
      }
    }
  }

  const openAIKeys = getOpenAIKeys();
  for (const key of openAIKeys) {
    const controller = new AbortController();
    const attemptTimeout = remainingAttemptTime(deadline);
    const timer = setTimeout(() => controller.abort(), attemptTimeout);
    try {
      const content = await tryOpenAICompatible(
        "https://api.openai.com/v1",
        key,
        "gpt-4o-mini",
        systemPrompt,
        messages,
        controller.signal,
      );
      clearTimeout(timer);
      log.info?.({ provider: "openai", model: "gpt-4o-mini" }, "Chat success via final fallback");
      return content;
    } catch (error: any) {
      clearTimeout(timer);
      lastError = error;
      if (isQuotaError(error)) quotaErrorCount++;
      if (error?.name === "AbortError") timedOut = true;
      log.warn?.({ provider: "openai", msg: error?.message?.slice(0, 200) }, "OpenAI attempt failed");
    }
  }

  const stats: ServerAiProviderStats = {
    lastError,
    quotaErrorCount,
    geminiAttempts,
    openRouterKeyCount: openRouterKeys.length,
    openAIKeyCount: openAIKeys.length,
    noKeysAtAll: geminiAttempts === 0 && openRouterKeys.length === 0 && openAIKeys.length === 0,
    timedOut,
  };
  log.error?.(
    {
      lastErrMsg: lastError?.message?.slice(0, 500),
      quotaErrCount: quotaErrorCount,
      geminiAttempts,
      orKeys: openRouterKeys.length,
      oaKeys: openAIKeys.length,
    },
    "All chat providers exhausted",
  );
  throw new ServerAiProviderError(stats);
}