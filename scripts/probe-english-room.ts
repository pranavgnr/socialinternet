/**
 * Eyeball the room the gate actually built.
 *
 * The eval scores the gate against labels; this prints what survived, reel by
 * reel, so a human can read it and disagree. "No leaks in the numbers" is not
 * the same as "no Telugu in the English pull".
 *
 *   npx tsx scripts/probe-english-room.ts "english music covers"
 *
 * Costs nothing: reads data/niches/<slug>.json.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { accountProfile, inLanguage, isSuspect, languageName, roomLanguage } from "../lib/lang";
import type { RawReel } from "../lib/types";

const query = process.argv[2] ?? "english music covers";
const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const file = path.join(process.cwd(), "data", "niches", `${slug}.json`);
const payload = (JSON.parse(readFileSync(file, "utf8")).payload ?? []) as RawReel[];

const room = roomLanguage(query, { own: [], pull: payload });
const want = room.code;

const byAccount = new Map<string, RawReel[]>();
for (const r of payload) {
  const list = byAccount.get(r.account) ?? [];
  list.push(r);
  byAccount.set(r.account, list);
}
const accountLang = new Map(
  [...byAccount].map(([h, list]) => {
    const p = accountProfile(list, want);
    return [h, p.mixed ? null : p] as const;
  }),
);

const kept: { r: RawReel; why: string }[] = [];
const dropped: { r: RawReel; why: string }[] = [];
for (const r of payload) {
  const v = inLanguage(r, want, accountLang.get(r.account) ?? null);
  if (v.keep && !isSuspect(v.why)) kept.push({ r, why: v.why });
  else dropped.push({ r, why: v.why });
}

console.log(`${query} → room ${languageName(want)} [${room.basis}]`);
console.log(`${payload.length} reels · kept ${kept.length} · dropped ${dropped.length}\n`);

console.log("KEPT");
for (const { r, why } of kept.sort((a, b) => (b.r.views ?? 0) - (a.r.views ?? 0))) {
  const cap = (r.caption ?? "").replace(/\s+/g, " ").slice(0, 64);
  console.log(`  ${String(r.views ?? 0).padStart(8)}  @${r.account.padEnd(22)} [${why}] ${cap}`);
}

console.log("\nDROPPED (first 25)");
for (const { r, why } of dropped.slice(0, 25)) {
  const cap = (r.caption ?? "").replace(/\s+/g, " ").slice(0, 48);
  console.log(`  @${r.account.padEnd(22)} [${why}] ${cap}`);
}
