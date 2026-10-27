/**
 * Ask the vendor what the key is worth right now. Free (the balance endpoint
 * costs 0 credits), so it is always safe to run before a paid step.
 *
 *   npx tsx --env-file=.env.local scripts/probe-balance.ts
 */
import { checkBalance } from "../lib/harvest";
import { providerSummary } from "../lib/providers";

async function main() {
  console.log("providers:", JSON.stringify(providerSummary()).slice(0, 400));
  const r = await checkBalance();
  console.log("balance:", JSON.stringify(r).slice(0, 400));
}

main();
