import { Router } from "express";
import {
  generateServerAiResponse,
  isKeyError,
  isQuotaError,
  ServerAiProviderError,
} from "./ai-provider";

const router = Router();

router.post("/chat", async (req, res) => {
  try {
    const { messages, systemPrompt, apiKey: clientApiKey, mode } = req.body as {
      messages: { role: string; content: string }[];
      systemPrompt?: string;
      apiKey?: string;
      mode?: string;
    };

    if (!messages || messages.length === 0) {
      res.status(400).json({ error: "messages required" });
      return;
    }

    const content = await generateServerAiResponse({
      messages,
      systemPrompt,
      clientApiKey,
      mode,
      log: req.log,
    });
    res.json({ content });
  } catch (err: any) {
    const providerError = err instanceof ServerAiProviderError ? err : null;
    const stats = providerError?.stats;
    const lastError = stats?.lastError ?? err;
    const quotaErrCount = stats?.quotaErrorCount ?? (isQuotaError(lastError) ? 1 : 0);
    const noKeysAtAll = stats?.noKeysAtAll ?? false;
    let friendly: string;
    let status: number;

    if (noKeysAtAll) {
      friendly = "⚙️ Server பிழை. சற்று நேரம் கழித்து மீண்டும் try பண்ணுங்க.";
      status = 503;
    } else if (quotaErrCount > 0) {
      friendly = "⏳ இன்னைக்கு server busy. நாளைக்கு மீண்டும் try பண்ணுங்க.";
      status = 429;
    } else if (isKeyError(lastError)) {
      friendly = "🔑 API key valid இல்ல. Keys screen-ல check பண்ணுங்க.";
      status = 401;
    } else {
      friendly = "⚠️ பதில் வரல. கொஞ்ச நேரம் கழிச்சு try பண்ணுங்க.";
      status = 502;
    }
    if (!providerError) {
      req.log.error({ err: err?.message?.slice(0, 500), stack: err?.stack?.slice(0, 500) }, "Chat handler crashed");
      res.status(500).json({ error: "⚠️ Server error ஆச்சு. கொஞ்ச நேரம் கழிச்சு try பண்ணுங்க." });
      return;
    }
    res.status(status).json({ error: friendly });
  }
});

export default router;
