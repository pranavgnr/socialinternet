/**
 * Offline: when the cohort is the wrong room, does the plan say so?
 *
 * Reads data/ only — no credits, no model. Pairs each cached handle with a
 * cached niche pull and prints the verdict plus the sentence the page shows.
 */
import { promises as fs } from "node:fs";

import { detectArchetype } from "../lib/archetype";
import { cohortFitness } from "../lib/cohort";
import { researchFromCache } from "../lib/niche";
import { buildPlan } from "../lib/plan";
import type { RawReel } from "../lib/types";

async function niche(slug: string): Promise<RawReel[]> {
  try {
    const f = JSON.parse(await fs.readFile(`data/niches/${slug}.json`, "utf8")) as {
      payload: RawReel[];
      fetchedAt?: string;
    };
    return f.payload ?? [];
  } catch {
    return [];
  }
}

async function main() {
  const pairs: [string, string][] = [
    ["rachana.kannegulla", "comedy-funny-dance-telugu"],
    ["natgeo", "daily-vlogs-india"],
  ];

  for (const [handle, slug] of pairs) {
    const stored = JSON.parse(
      await fs.readFile(`data/handles/${handle}.json`, "utf8"),
    ) as { reels: RawReel[] };
    const cohort = (await niche(slug)).filter(
      (r) => (r.account ?? "").toLowerCase() !== handle.toLowerCase(),
    );
    const shape = detectArchetype(stored.reels);
    const fit = cohortFitness({
      query: slug.replace(/-/g, " "),
      creator: stored.reels,
      cohort,
      shape,
    });
    const plan = buildPlan({
      handle,
      research: researchFromCache(slug.replace(/-/g, " "), cohort, {
        fetchedAt: new Date().toISOString(),
      }),
      ownReels: stored.reels,
      archetype: shape,
      nicheFit: fit,
    });

    console.log(`@${handle}  verdict=${fit.verdict} ok=${fit.ok} score=${fit.score.toFixed(2)}`);
    console.log(`  dropped  : ${fit.off.join(", ") || "none"}`);
    const tail = plan.diagnosis.split(/(?<=\.)\s/).slice(-2).join(" ");
    console.log(`  page says: ${tail}\n`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
