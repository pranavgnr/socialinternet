import { availableProviders, providerSummary } from "../lib/providers";
const combos = [
  { label: "both keys, HikerAPI at Start rate", env: { HIKERAPI_KEY: "x", SOCIALCRAWL_API_KEY: "y" } },
  { label: "both keys, HikerAPI Standard unlocked", env: { HIKERAPI_KEY: "x", SOCIALCRAWL_API_KEY: "y", HIKERAPI_USD_PER_CALL: "0.001" } },
  { label: "socialcrawl only", env: { SOCIALCRAWL_API_KEY: "y", HIKERAPI_KEY: "" } },
  { label: "hikerapi only, Start", env: { HIKERAPI_KEY: "x", SOCIALCRAWL_API_KEY: "" } },
];
const saved = { ...process.env };
for (const c of combos) {
  process.env = { ...saved, ...c.env } as NodeJS.ProcessEnv;
  const order = availableProviders().map((p) => `${p.id} @ $${p.cost.usdPerCall}/call`);
  console.log(`\n${c.label}\n  order: ${order.join("  →  ") || "(none)"}`);
}
process.env = saved as NodeJS.ProcessEnv;
console.log("\n=== configured vendors ===");
for (const p of providerSummary()) console.log(`  ${p.id}: configured=${p.configured} · ${p.cost.label}`);
