/**
 * Offline check: does the tag-based labeller name real accounts correctly?
 *
 * Zero credits — it re-reads the niche pulls already on disk. Prints one row
 * per room for the account the pull returned first, plus the two validation
 * cases that caused a live bug (a category label with an underscore reaching
 * the page).
 *
 *   npx tsx scripts/check-label.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { coherentLabel, labelFromCaptions, nicheQuality, normaliseNiche } from "../lib/nicheLabel";

function statsFor(reels: { hashtags?: string[]; views?: number }[]) {
  const counts = new Map<string, { count: number; views: number }>();
  for (const r of reels) {
    for (const t of r.hashtags ?? []) {
      const c = counts.get(t) ?? { count: 0, views: 0 };
      c.count += 1;
      c.views += r.views ?? 0;
      counts.set(t, c);
    }
  }
  return [...counts.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.count - a.count);
}

const bad = nicheQuality("pets_animals");
console.log("validation");
console.log(`  "pets_animals" accepted? ${bad.ok}  (${bad.reason ?? "no reason"})`);
console.log(`  "comedy"       accepted? ${nicheQuality("comedy").ok}`);
console.log(`  "kannada song covers" accepted? ${nicheQuality("kannada song covers").ok}`);
console.log(`  normaliseNiche("Pets_Animals") -> ${JSON.stringify(normaliseNiche("Pets_Animals"))}`);

const dir = path.join(process.cwd(), "data", "niches");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

console.log("\nlabelled accounts");
for (const file of files) {
  const stored = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
    payload?: { account?: string; hashtags?: string[]; views?: number }[];
  };
  const payload = stored.payload ?? [];
  if (!payload.length) continue;

  const byAccount = new Map<string, typeof payload>();
  for (const r of payload) {
    const a = r.account ?? "";
    byAccount.set(a, [...(byAccount.get(a) ?? []), r]);
  }
  const richest = [...byAccount.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!richest) continue;
  const [handle, reels] = richest;
  const fromTags = coherentLabel(statsFor(reels), handle);
  const fromCaptions = labelFromCaptions(reels, handle);
  const label = fromTags || fromCaptions;
  const via = fromTags ? "tags" : fromCaptions ? "captions" : "—";
  console.log(
    `  ${file.replace(/\.json$/, "").padEnd(26)} @${handle.padEnd(24)} ${via.padEnd(9)} -> ${label ? `"${label}"` : "(none — falls back)"}`,
  );
}
