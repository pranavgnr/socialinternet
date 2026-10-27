/**
 * What does the niche guess actually say for a cached account? Costs ~300
 * tokens, zero credits.
 *
 *   npx tsx --env-file=.env.local scripts/probe-niche.ts [handle]
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { inferNiche } from "../lib/plan";
import type { RawReel } from "../lib/types";

async function main() {
  const handle = (process.argv[2] ?? "rachana.kannegulla").replace(/^@/, "");
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "handles", `${handle}.json`),
    "utf8",
  );
  const stored = JSON.parse(raw) as { reels: RawReel[]; niche?: string };
  console.log(`@${handle}: stored niche = ${stored.niche ?? "(none)"}, ${stored.reels.length} reels`);

  const guess = await inferNiche(stored.reels);
  console.log(JSON.stringify(guess, null, 2));
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
