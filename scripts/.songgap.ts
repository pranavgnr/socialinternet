import { promises as fs } from "node:fs";
import path from "node:path";
import { detectArchetype } from "../lib/archetype";
import { researchFromCache } from "../lib/niche";
import { buildPlan } from "../lib/plan";
import { buildRows } from "../lib/stats";
import { rankSongs, songOf } from "../lib/songs";
import type { RawReel } from "../lib/types";

const TARGETS: Record<string, string[]> = {
  "kannadasongs-kannada-singing": ["swar.alahari", "debbarma_priyanka"],
  "music-covers-in-india": ["diamehta_15"],
  "telugu-music-covers": ["siddharth_rebba"],
};

async function main() {
  const dir = path.join(process.cwd(), "data", "niches");
  for (const [slug, handles] of Object.entries(TARGETS)) {
    const stored = JSON.parse(
      await fs.readFile(path.join(dir, `${slug}.json`), "utf8"),
    ) as { payload: RawReel[]; fetchedAt: string };
    const query = slug.replace(/-/g, " ");
    const research = researchFromCache(query, stored.payload, {
      fetchedAt: stored.fetchedAt,
    });

    for (const handle of handles) {
      const own = stored.payload.filter((r) => r.account === handle);
      const shape = detectArchetype(own, query);
      const rows = buildRows(research, handle);
      const ranked = rankSongs(rows, handle);
      const plan = buildPlan({ handle, research, ownReels: own, archetype: shape });

      console.log(`\n══ @${handle}  (${slug})  archetype=${shape.id}/${shape.recommendation}`);
      console.log(`   own posts: ${own.map((r) => `${r.views}=${JSON.stringify(songOf(r))}`).join(", ")}`);
      console.log(`   rankSongs survivors: ${ranked.length}`);
      for (const s of ranked.slice(0, 6))
        console.log(
          `      ${s.strength.padEnd(9)} ${s.medianRatio.toFixed(2).padStart(6)}x  accts=${s.accounts.length}  ${JSON.stringify(s.title)}`,
        );
      console.log(`   plan.songs=${plan.songs?.length ?? 0}  moves=${plan.moves.length}`);
      for (const m of plan.moves) console.log(`      [${m.id}] ${m.title}`);
    }
  }
}
void main();
