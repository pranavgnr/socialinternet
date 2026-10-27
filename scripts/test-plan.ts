/**
 * Offline check for the plan engine: replay a cached niche pull, pretend one of
 * its accounts is "ours", and print the plan. Costs zero credits.
 *
 *   npx tsx scripts/test-plan.ts [niche-slug] [handle]
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { researchFromCache } from "../lib/niche";
import { buildPlan, inferNiche } from "../lib/plan";
import type { RawReel } from "../lib/types";

async function main() {
  const slug = process.argv[2] ?? "telugu-music-covers";
  const file = path.join(process.cwd(), "data", "niches", `${slug}.json`);
  const stored = JSON.parse(await fs.readFile(file, "utf8")) as {
    payload: RawReel[];
    fetchedAt: string;
  };

  const counts = new Map<string, number>();
  for (const r of stored.payload) counts.set(r.account, (counts.get(r.account) ?? 0) + 1);
  const handle =
    process.argv[3] ??
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const ownReels = stored.payload.filter((r) => r.account === handle);
  const research = researchFromCache(slug.replace(/-/g, " "), stored.payload, {
    fetchedAt: stored.fetchedAt,
  });

  const guess = await inferNiche(ownReels);
  const plan = buildPlan({ handle, research, ownReels });

  console.log(`\nhandle: @${handle} (${ownReels.length} reels)`);
  console.log(`inferred niche: "${guess.query}" via ${guess.source}`);
  console.log(`cohort: ${plan.cohort.accounts} accounts — ${plan.cohort.basis}`);
  console.log(`\nDIAGNOSIS\n${plan.diagnosis}\n`);
  console.log("GAPS");
  for (const g of plan.gaps) console.log(`  ${g.label}: ${g.you} vs ${g.cohort}`);
  console.log("\nMOVES");
  for (const m of plan.moves) {
    console.log(`\n  ${m.priority}. ${m.title}`);
    console.log(`     why: ${m.why}`);
    console.log(`     do:  ${m.action}`);
    for (const e of m.evidence) console.log(`     cite: ${e.handle} — ${e.metric}`);
  }
  const uncited = plan.moves.filter((m) => !m.evidence.length);
  console.log(
    `\nchecks: moves=${plan.moves.length} uncited=${uncited.length} gaps=${plan.gaps.length}`,
  );
}

void main();
