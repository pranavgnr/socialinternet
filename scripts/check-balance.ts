/**
 * What is left on the SocialCrawl key — free, and the first thing to ask before
 * any paid step. Exists because `tsx -e` cannot top-level await a balance call.
 *
 *   npx tsx --env-file=.env.local scripts/check-balance.ts
 */
import { checkBalance } from "../lib/harvest";

async function main() {
  const { balance, spentLast24h, error } = await checkBalance();
  console.log(
    balance === null
      ? `balance: unknown${error ? ` (${error})` : ""}`
      : `balance: ${balance} credits · spent last 24h: ${spentLast24h ?? "?"}`,
  );
}

main();
