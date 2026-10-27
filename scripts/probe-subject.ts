/**
 * Offline check of the subject gate against cached niche pulls.
 *
 * Costs nothing: it reads `data/niches/*.json`, which are pulls that were
 * already paid for, and reports what the gate keeps, drops and stands down on.
 * Used to tune the relevance rule without spending a credit to find out.
 *
 *   npx tsx scripts/probe-subject.ts [slug ...]
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { keepOnSubject } from "../lib/subject";

const dir = path.join(process.cwd(), "data", "niches");
const only = process.argv.slice(2);

const all = readdirSync(dir).filter((f) => f.endsWith(".json"));
const picked = only.length ? all.filter((f) => only.some((o) => f.includes(o))) : all;

for (const file of picked) {
  const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
    query: string;
    payload: { account?: string; caption?: string; hashtags?: string[]; views?: number; url?: string }[];
  };
  const posts = raw.payload.map((p) => ({
    account: p.account ?? "",
    caption: p.caption ?? "",
    hashtags: p.hashtags ?? [],
    views: p.views ?? 0,
    url: p.url ?? "",
  }));
  /** Old cache files predate the stored `query`; the slug says the same thing. */
  const query = raw.query ?? file.replace(/\.json$/, "").replace(/-/g, " ");
  const v = keepOnSubject(posts, query);
  const accountsBefore = new Set(posts.map((p) => p.account)).size;
  const accountsAfter = new Set(v.kept.map((p) => p.account)).size;

  console.log(
    `\n=== ${file}  (${posts.length} reels, ${accountsBefore} accounts)`,
  );
  console.log(
    `    applied=${v.applied} kept=${v.kept.length} dropped=${v.dropped.length} ` +
      `accounts kept=${accountsAfter}`,
  );
  if (v.reason) console.log(`    reason: ${v.reason}`);
  console.log(`    vocab: ${v.vocab.slice(0, 14).join(", ")}`);

  const byWhy = new Map<string, number>();
  for (const d of v.dropped) byWhy.set(d.why, (byWhy.get(d.why) ?? 0) + 1);
  for (const [why, n] of byWhy) console.log(`    dropped(${n}): ${why}`);

  for (const d of v.dropped.slice(0, 6)) {
    console.log(`    · ${d.reel.account} — ${d.reel.caption.slice(0, 70)}`);
  }
}
