/**
 * Smoke test for the model connection: confirms the key works, JSON mode parses,
 * and reasoning tokens are not eating the response. Costs a few hundred tokens.
 *
 *   npx tsx scripts/test-llm.ts
 */
import { jsonCall, llmLabel, llmReady } from "../lib/llm";

async function main() {
  console.log(`llmReady: ${llmReady()}  (${llmLabel()})`);
  if (!llmReady()) throw new Error("no key configured");

  const t0 = Date.now();
  const out = await jsonCall<{ hook: string; topic: string }>(
    'You write original short-form video hooks. Answer only with JSON: {"hook": string, "topic": string}',
    "Creator: a freelance video editor in Bengaluru who posts editing breakdowns. " +
      "Give one hook about cutting a 40-minute podcast into 6 reels. Specific, not a template.",
    { temperature: 0.85, maxTokens: 600 },
  );
  console.log(`\n${Date.now() - t0}ms`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
