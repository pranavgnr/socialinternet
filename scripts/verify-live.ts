/**
 * Does watching the reel actually settle what the caption would not?
 *
 * Pulls ONE page of a search (1 credit), then reads the reels the text gate is
 * unsure about — the video, locally, for nothing — and prints both verdicts
 * side by side so the difference can be judged by eye rather than trusted.
 *
 *   npx tsx --env-file=.env.local scripts/verify-live.ts "english music covers"
 *
 * Writes the pull to data/_verify_probe.json so the same page can be re-read
 * offline afterwards without paying again.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { creditLedger, harvestInstagramSearch, resetCreditLedger } from "../lib/harvest";
import { accountProfile, dominantLanguage, inLanguage, languageInQuery, readLanguage } from "../lib/lang";
import type { RawReel } from "../lib/types";
import { watchToVerify } from "../lib/verifyLang";

const PROBE = path.join(process.cwd(), "data", "_verify_probe.json");

async function main() {
  const query = process.argv[2] ?? "english music covers";
  const offline = process.argv.includes("--offline");

  let reels: RawReel[];
  if (offline && existsSync(PROBE)) {
    reels = (JSON.parse(readFileSync(PROBE, "utf8")) as { payload: RawReel[] }).payload;
  } else {
    resetCreditLedger();
    reels = await harvestInstagramSearch(query);
    writeFileSync(PROBE, JSON.stringify({ query, payload: reels }), "utf8");
    const l = creditLedger();
    console.log(`pulled ${reels.length} reels for "${query}" · ${l.spent} credits\n`);
  }

  const want = languageInQuery(query)?.code ?? dominantLanguage(reels);
  const providers = new Map<string, number>();
  for (const r of reels) providers.set(r.language ?? "-", (providers.get(r.language ?? "-") ?? 0) + 1);
  console.log(`room: ${want} · provider language tags: ${JSON.stringify(Object.fromEntries(providers))}`);
  console.log(`media links on ${reels.filter((r) => r.mediaUrl).length} of ${reels.length} reels\n`);

  const before = describe(reels, want);
  const { kept, dropped, stats } = await watchToVerify(reels, want, { max: 10 });
  const after = describe(kept, want);

  console.log("before watching: ", JSON.stringify(before));
  console.log("after watching:  ", JSON.stringify(after));
  console.log("watch stats:     ", JSON.stringify(stats), "\n");

  for (const reel of reels) {
    const was = inLanguage(reel, want, profileFor(reels, reel.account, want));
    const isDropped = dropped.some((d) => d.reel.id === reel.id);
    const read = readLanguage(reel);
    const line = [
      isDropped ? "DROPPED" : was.keep ? "kept   " : "dropped",
      (read.code ?? "-").padEnd(4),
      (was.why ?? "").padEnd(20),
      `@${reel.account}`,
    ].join(" ");
    console.log(
      line.padEnd(60),
      JSON.stringify((reel.spoken ?? "").slice(0, 40) || (reel.onScreenText ?? "").slice(0, 40) || (reel.caption ?? "").replace(/\s+/g, " ").slice(0, 40)),
    );
  }
  for (const d of dropped) {
    console.log(`\nwatched away: @${d.reel.account} — ${d.why}`);
  }
}

function profileFor(reels: RawReel[], handle: string, want: string | null) {
  const list = reels.filter((r) => r.account === handle);
  const p = accountProfile(list, want);
  return p.mixed ? null : p;
}

function describe(reels: RawReel[], want: string | null) {
  const kept = reels.filter((r) => inLanguage(r, want, profileFor(reels, r.account, want)).keep);
  const byWhy: Record<string, number> = {};
  for (const r of reels) {
    const why = inLanguage(r, want, profileFor(reels, r.account, want)).why;
    byWhy[why] = (byWhy[why] ?? 0) + 1;
  }
  return { kept: kept.length, of: reels.length, byWhy };
}

main();
