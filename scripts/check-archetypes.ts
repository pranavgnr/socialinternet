/**
 * Offline check: does the engine give each kind of account the right KIND of
 * advice? Replays every cached niche pull, classifies each real account, and
 * prints the family it lands in plus the first move it earns. Zero credits.
 *
 *   npx tsx scripts/check-archetypes.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { detectArchetype } from "../lib/archetype";
import { researchFromCache } from "../lib/niche";
import { buildPlan } from "../lib/plan";
import type { RawReel } from "../lib/types";

interface Stored {
  payload: RawReel[];
  fetchedAt: string;
}

async function main() {
  const dir = path.join(process.cwd(), "data", "niches");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const stored = JSON.parse(
      await fs.readFile(path.join(dir, file), "utf8"),
    ) as Stored;
    if (!stored.payload?.length) continue;

    const byAccount = new Map<string, RawReel[]>();
    for (const r of stored.payload) {
      if (!r.account) continue;
      const list = byAccount.get(r.account) ?? [];
      list.push(r);
      byAccount.set(r.account, list);
    }

    const research = researchFromCache(slug.replace(/-/g, " "), stored.payload, {
      fetchedAt: stored.fetchedAt,
    });

    console.log(`\n══ ${slug} — ${byAccount.size} accounts, ${stored.payload.length} posts`);
    for (const [handle, reels] of byAccount) {
      // Same call production makes: the account's own posts, plus the niche it
      // was found in as a prior. Auditing without the prior measured something
      // the product never does, and under-reported every thin account as
      // "general".
      const shape = detectArchetype(reels, slug.replace(/-/g, " "));
      const plan = buildPlan({
        handle,
        research,
        ownReels: reels,
        archetype: shape,
      });
      const songs = plan.songs?.length ?? 0;
      const formats = plan.formats?.length ?? 0;
      const hooks = plan.hooks?.length ?? 0;
      const lead = plan.moves[0];
      console.log(
        `  @${handle.padEnd(26)} ${shape.id.padEnd(10)} ${shape.recommendation.padEnd(
          8,
        )} songs=${songs} formats=${formats} hooks=${hooks} moves=${plan.moves.length}`,
      );
      if (lead) console.log(`     lead: ${lead.title.slice(0, 96)}`);
    }
  }
}

void main();
