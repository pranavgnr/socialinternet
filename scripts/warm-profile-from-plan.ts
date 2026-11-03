/**
 * Warm one stored profile view from a saved plan on disk.
 *
 *   CREATORS_DATA_DIR=/path/to/data \
 *     npx tsc scripts/warm-profile-from-plan.ts --module commonjs --target es2022 \
 *       --moduleResolution node --outDir .tmp-build --skipLibCheck --esModuleInterop \
 *       --lib es2022,dom --types node
 *   CREATORS_DATA_DIR=/path/to/data node .tmp-build/scripts/warm-profile-from-plan.js \
 *     /path/to/data/accounts/<id>/plan.json
 *
 * No vendor is called. The plan is enriched from the handle and comment caches
 * the same run already wrote, turned into the neutral competitor view, and
 * written to `<CREATORS_DATA_DIR>/profiles/<handle>.json` so the founder can
 * open `/profile/<handle>` free.
 */
import { promises as fs } from "node:fs";

import { toCompetitorView } from "../lib/competitor";
import { enrichProfilePlan } from "../lib/profileData";
import { buildProfileView } from "../lib/profileView";
import { saveProfileView } from "../lib/profileStore";
import type { GrowthPlan } from "../lib/types";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    throw new Error(
      "usage: warm-profile-from-plan.js <path-to-plan.json>",
    );
  }

  const plan = JSON.parse(await fs.readFile(file, "utf8")) as GrowthPlan;
  if (!plan?.handle) throw new Error("the plan has no handle");

  const enriched = enrichProfilePlan(plan);
  const neutral = toCompetitorView(enriched);
  const view = buildProfileView(neutral, { own: false });
  await saveProfileView(plan.handle, view);

  console.log(
    JSON.stringify(
      {
        handle: view.handle,
        source: file,
        niche: view.niche,
        verified: view.nicheVerified,
        reels: view.vitals.reelsRead,
        winners: view.winners.length,
        flops: view.flops.length,
        comments: view.commentIntel ? view.commentIntel.requests.length : 0,
        ideas: view.ideas.length,
        target: `${process.env.CREATORS_DATA_DIR ?? "./data"}/profiles/${view.handle}.json`,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[warm-profile]", (err as Error).message);
  process.exitCode = 1;
});
