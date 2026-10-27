/**
 * Offline check for the cohort check itself: take a creator's own feed and a
 * cached niche pull, and ask whether the pull compares like with like.
 *
 *   npx tsx scripts/check-cohort.ts <handle> <niche-slug> [niche-slug ...]
 *
 * Costs zero credits — both inputs are already on disk.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { detectArchetype } from "../lib/archetype";
import { cohortFitness, pruneCohort } from "../lib/cohort";
import { researchFromCache } from "../lib/niche";
import { buildPlan } from "../lib/plan";
import type { RawReel } from "../lib/types";

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function main() {
  const handle = (process.argv[2] ?? "rachana.kannegulla").replace(/^@/, "");
  const slugs = process.argv.slice(3);
  if (!slugs.length) slugs.push("comedy-funny-dance-telugu");

  const own = await readJson<{ reels: RawReel[] }>(
    path.join(process.cwd(), "data", "handles", `${handle}.json`),
  );
  const shape = detectArchetype(own.reels);
  console.log(`\n@${handle} — ${own.reels.length} reels`);
  console.log(`  shape: ${shape.label}${shape.language ? ` · ${shape.language}` : ""} (${shape.confidence.toFixed(2)})`);

  for (const slug of slugs) {
    const stored = await readJson<{ payload: RawReel[]; fetchedAt: string }>(
      path.join(process.cwd(), "data", "niches", `${slug}.json`),
    );
    const query = slug.replace(/-/g, " ");
    const key = handle.toLowerCase();
    const cohort = stored.payload.filter((r) => (r.account ?? "").toLowerCase() !== key);

    const fit = cohortFitness({ query, creator: own.reels, cohort, shape });
    const before = researchFromCache(query, stored.payload, {
      handle,
      fetchedAt: stored.fetchedAt,
    });

    const pruned = pruneCohort(stored.payload, fit.off, handle);
    const after = researchFromCache(query, pruned, {
      handle,
      fetchedAt: stored.fetchedAt,
    });

    console.log(`\n—— searched "${query}"`);
    console.log(
      `  verdict: ${fit.verdict} (score ${fit.score}, ${fit.off.length}/${fit.accounts.length} off)`,
    );
    console.log(`  cohort median: ${before.nicheMedianViews} → ${after.nicheMedianViews} after pruning`);
    console.log(`  accounts: ${before.accounts.length} → ${after.accounts.length}`);
    for (const r of fit.reasons) console.log(`  · ${r}`);
    for (const a of fit.accounts.slice(0, 8)) {
      console.log(
        `    ${a.off ? "drop" : "keep"}  ${a.fit.toFixed(2)}  @${a.handle} (${a.reels})${a.why ? ` — ${a.why}` : ""}`,
      );
    }

    // The plan the pruning actually produces, and what it says the account is up against.
    const plan = buildPlan({
      handle,
      research: after,
      ownReels: own.reels,
      archetype: shape,
      nicheFit: fit,
      nicheSource: "hashtags",
    });
    console.log(
      `  plan: niche "${plan.niche}" · cohort ${plan.cohort.accounts} accounts (${plan.cohort.basis}) · vsNiche ${plan.standing.vsNiche.toFixed(2)}x`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
