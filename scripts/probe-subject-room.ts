/**
 * Did the subject gate actually run on a real cached room, and what did it do?
 *
 *   npx tsx scripts/probe-subject-room.ts english-music-covers
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { keepOnSubject } from "../lib/subject";
import type { RawReel } from "../lib/types";

const name = process.argv[2] ?? "english-music-covers";
const d = JSON.parse(readFileSync(path.join(process.cwd(), "data", "niches", `${name}.json`), "utf8"));
const payload = (d.payload ?? []) as RawReel[];
const query = String(d.query ?? name.replace(/-/g, " "));

const res = keepOnSubject(payload, query);
console.log(`query: ${query}`);
console.log(`applied=${res.applied}`);
console.log(`reason: ${res.reason ?? "-"}`);
console.log(`vocab: ${res.vocab.slice(0, 20).join(" ")}`);
console.log(`kept ${res.kept.length} of ${payload.length}`);
for (const d2 of res.dropped) {
  console.log(`  drop @${d2.reel.account} ${d2.reel.views}v "${(d2.reel.caption ?? "").replace(/\n/g, " ").slice(0, 70)}"`);
}
