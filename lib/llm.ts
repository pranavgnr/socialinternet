import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const cfg = () => ({
  baseUrl: (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(
    /\/$/,
    "",
  ),
  apiKey: process.env.LLM_API_KEY || "",
  model: process.env.LLM_MODEL || "deepseek-flash",
  /**
   * deepseek-flash and deepseek-v4-pro are reasoning models: they spend
   * completion tokens on hidden reasoning BEFORE emitting content, so a low
   * max_tokens returns an empty string with finish_reason "length". "none"
   * turns the thinking off — ~2x faster, no wasted tokens, and structured
   * JSON extraction does not need chain-of-thought.
   */
  effort: process.env.LLM_REASONING_EFFORT || "none",
});

export const llmReady = () => Boolean(process.env.LLM_API_KEY);

export const llmLabel = () =>
  llmReady() ? `${cfg().model} @ ${new URL(cfg().baseUrl).host}` : "mock (no API key)";

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("LLM returned no JSON");
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Token accounting, so a run's real cost is visible instead of guessed.
 * Appended as JSONL; never fatal if the disk is read-only.
 */
async function logUsage(row: Record<string, unknown>) {
  try {
    await mkdir("data", { recursive: true });
    await appendFile(
      join("data", "llm-usage.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`,
    );
  } catch {
    /* metrics are a nicety, not a requirement */
  }
}

/**
 * One structured call. Cheap by default: DeepSeek-flash class models do all the
 * bulk extraction, and only the final polish deserves a frontier model.
 */
export async function jsonCall<T>(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; effort?: string } = {},
): Promise<T> {
  const { baseUrl, apiKey, model, effort } = cfg();
  if (!apiKey) throw new Error("LLM_API_KEY missing");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    try {
      const body: Record<string, unknown> = {
        model,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
      // Only send when set: some gateways reject an unknown field outright.
      const level = opts.effort ?? effort;
      if (level && level !== "default") body.reasoning_effort = level;

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);

      const data = (await res.json()) as {
        choices: { message: { content: string }; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      const choice = data.choices?.[0];
      const content = choice?.message?.content ?? "";
      const reasoning =
        data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

      await logUsage({
        model,
        effort: level,
        ok: Boolean(content.trim()),
        ms: Date.now() - started,
        attempt,
        prompt: data.usage?.prompt_tokens ?? null,
        completion: data.usage?.completion_tokens ?? null,
        reasoning,
      });

      /**
       * Reasoning models can return "" with finish_reason "length" when the
       * thinking ate the whole budget. Treating that as a parse error is
       * misleading ("no JSON"), so name the real cause and retry.
       */
      if (!content.trim()) {
        throw new Error(
          `LLM returned empty content (reasoning_tokens=${reasoning}, finish=${choice?.finish_reason}). Raise max_tokens or set LLM_REASONING_EFFORT=none`,
        );
      }
      return extractJson(content) as T;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
