/**
 * Does the language gate actually work? Measured, not assumed.
 *
 * The gate is the part a customer never sees and everything else depends on:
 * the medians, the outlier ratios, "what works in your space" and the ideas are
 * all computed over whichever reels survive it. So it is scored against
 * hand-labelled truth in data/fixtures/lang-labels.json — reels whose language
 * was read by eye from the reel itself, not from what the gate said.
 *
 *   npx tsx scripts/eval-language.ts
 *
 * Precision is "of the reels we kept, how many really were the room's";
 * recall is "of the reels that were the room's, how many did we keep". Both
 * matter — a gate that keeps nothing scores 100% precision and is useless —
 * but precision is the one the complaint was about: random Telugu and Turkish
 * reels turning up inside an English pull. Exits non-zero when the bar is not
 * met, so this can gate a release.
 *
 * Costs nothing: it reads the cached pulls in data/niches, not the provider.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { accountProfile, inLanguage, languageName, roomLanguage } from "../lib/lang";
import type { RawReel } from "../lib/types";

interface Fixture {
  want: string;
  accounts: Record<string, string>;
  reels: Record<string, string>;
}

const DIR = path.join(process.cwd(), "data");
const FIXTURE = path.join(DIR, "fixtures", "lang-labels.json");
const PRECISION_BAR = 0.9;
const RECALL_BAR = 0.85;

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, Fixture | string>;
let labelled = 0;
let expectedKeep = 0;
let tp = 0;
let fp = 0;
let fn = 0;
const falsePositives: string[] = [];
const falseNegatives: string[] = [];

for (const [slug, entry] of Object.entries(fixture)) {
  if (slug.startsWith("_") || typeof entry === "string") continue;
  const file = path.join(DIR, "niches", `${slug}.json`);
  if (!existsSync(file)) {
    console.log(`\n=== ${slug}: no cached pull, skipped`);
    continue;
  }
  const stored = JSON.parse(readFileSync(file, "utf8")) as { query?: string; payload?: RawReel[] };
  const query = stored.query ?? slug.replace(/-/g, " ");
  const payload = (stored.payload ?? []) as RawReel[];
  /**
   * The room's language is worked out exactly as the pipeline works it out, so
   * the score measures the gate and not a reimplementation of it.
   */
  const room = roomLanguage(query, { pull: payload });
  const want = room.code ?? entry.want;

  const perAccount = new Map<string, RawReel[]>();
  for (const r of payload) {
    const list = perAccount.get(r.account) ?? [];
    list.push(r);
    perAccount.set(r.account, list);
  }
  const profiles = new Map<string, ReturnType<typeof accountProfile>>();
  for (const [handle, list] of perAccount) profiles.set(handle, accountProfile(list, want));

  let n = 0;
  let keep = 0;
  let okKeep = 0;
  let missed = 0;
  let leaked = 0;
  let nicheExpected = 0;
  for (const r of payload) {
    const label = entry.reels[r.id] ?? entry.accounts[r.account];
    if (!label || label === "?") continue;
    const profile = profiles.get(r.account) ?? null;
    const verdict = inLanguage(r, want, profile?.mixed ? null : profile);
    const shouldKeep = label === want;
    n += 1;
    if (shouldKeep) {
      expectedKeep += 1;
      nicheExpected += 1;
    }
    if (verdict.keep) keep += 1;
    if (verdict.keep && shouldKeep) okKeep += 1;
    if (verdict.keep && !shouldKeep) {
      leaked += 1;
      fp += 1;
      falsePositives.push(
        `kept a ${languageName(label)} reel: @${r.account} "${(r.caption ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 42)}" [${verdict.why}]`,
      );
    }
    if (!verdict.keep && shouldKeep) {
      missed += 1;
      fn += 1;
      falseNegatives.push(
        `dropped a ${languageName(label)} reel: @${r.account} "${(r.caption ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 42)}" [${verdict.why}]`,
      );
    }
  }
  labelled += n;
  tp += okKeep;
  const precision = keep ? okKeep / keep : 1;
  const recall = nicheExpected ? okKeep / nicheExpected : 1;
  console.log(
    `\n=== ${query}  →  ${languageName(want)}  [${room.basis}]\n` +
      `   labelled ${n} · expected to keep ${nicheExpected} · kept ${keep} (${okKeep} right)\n` +
      `   precision ${(precision * 100).toFixed(1)}% · recall ${(recall * 100).toFixed(1)}%` +
      ` · leaked ${leaked} · missed ${missed}`,
  );
}

const precision = tp + fp ? tp / (tp + fp) : 1;
const recall = expectedKeep ? tp / expectedKeep : 1;
console.log(
  `\n=== overall: ${labelled} labelled reels · precision ${(precision * 100).toFixed(1)}%` +
    ` · recall ${(recall * 100).toFixed(1)}% · ${fp} leaked · ${fn} missed`,
);
if (falsePositives.length) {
  console.log("\nleaks (wrong room, kept — the complaint):");
  for (const line of falsePositives.slice(0, 20)) console.log(`   ${line}`);
}
if (falseNegatives.length) {
  console.log("\nmisses (right room, dropped — lost data):");
  for (const line of falseNegatives.slice(0, 20)) console.log(`   ${line}`);
}

const pass = precision >= PRECISION_BAR && recall >= RECALL_BAR;
console.log(
  `\n${pass ? "PASS" : "FAIL"}: bar is ${PRECISION_BAR * 100}% precision and ${RECALL_BAR * 100}% recall`,
);
process.exitCode = pass ? 0 : 1;
