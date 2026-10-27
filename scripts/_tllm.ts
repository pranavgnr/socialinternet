import { jsonCall, llmLabel, llmReady } from "../lib/llm";
(async () => {
  console.log("ready:", llmReady(), "|", llmLabel());
  try {
    const r = await jsonCall<{ ok: string }>(
      "Return JSON only.",
      'Reply with {"ok":"yes"}',
      { maxTokens: 200 },
    );
    console.log("LLM replied:", JSON.stringify(r));
  } catch (e) {
    console.log("LLM FAILED:", (e as Error).message.slice(0, 300));
  }
})();
