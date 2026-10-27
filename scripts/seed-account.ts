/**
 * Builds one complete account offline from a cached niche pull, so the app can
 * be looked at without spending a single credit.
 *
 *   npx tsx scripts/seed-account.ts <account-id> [niche-slug] [handle]
 *
 * Reads data/niches/<slug>.json, writes plan/profile/ideas into
 * data/accounts/<account-id>/ — the same directory the web app uses.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { researchFromCache, profileFromNiche } from "../lib/niche";
import { buildPlan, inferNiche } from "../lib/plan";
import { runPipeline } from "../lib/pipeline";
import { createStore } from "../lib/store";
import type { RawReel } from "../lib/types";

async function main() {
  const accountId = process.argv[2];
  if (!accountId) throw new Error("usage: seed-account.ts <account-id> [slug] [handle]");

  const slug = process.argv[3] ?? "telugu-music-covers";
  const file = path.join(process.cwd(), "data", "niches", `${slug}.json`);
  const stored = JSON.parse(await fs.readFile(file, "utf8")) as {
    payload: RawReel[];
    fetchedAt: string;
  };

  const counts = new Map<string, number>();
  for (const r of stored.payload) {
    counts.set(r.account, (counts.get(r.account) ?? 0) + 1);
  }
  const handle =
    process.argv[4] ??
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  /**
   * The account's own feed is not always inside the niche pull. A seeded test
   * handle (data/handles/<handle>.json) is fetched separately from the cohort,
   * exactly as a real visitor's feed is, so prefer that file when it exists —
   * otherwise ownReels is empty and inferNiche rightly refuses to guess.
   */
  const ownFile = path.join(process.cwd(), "data", "handles", `${handle}.json`);
  let ownReels = stored.payload.filter((r) => r.account === handle);
  try {
    const own = JSON.parse(await fs.readFile(ownFile, "utf8")) as RawReel[] | { reels?: RawReel[] };
    const list = Array.isArray(own) ? own : own.reels ?? [];
    if (list.length) {
      ownReels = list.map((r) => ({ ...r, account: handle }));
    }
  } catch {
    /* no separate handle file — the niche payload is the only source */
  }
  if (!ownReels.length) {
    throw new Error(
      `No own reels for @${handle}: not in the ${slug} pull and no data/handles/${handle}.json`,
    );
  }

  const research = researchFromCache(slug.replace(/-/g, " "), stored.payload, {
    fetchedAt: stored.fetchedAt,
  });
  const guess = await inferNiche(ownReels);
  const plan = buildPlan({ handle, research, ownReels });

  const db = createStore(path.join(process.cwd(), "data", "accounts", accountId));
  await db.savePlan(plan);

  const profile = profileFromNiche(research, null);
  await runPipeline({
    profile,
    seedReels: stored.payload,
    db,
  });

  console.log(`seeded @${handle} into data/accounts/${accountId}`);
  console.log(`niche: ${plan.niche} · moves: ${plan.moves.length} · ideas: ${(await db.getIdeas()).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
