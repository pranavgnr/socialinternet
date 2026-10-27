/**
 * Rebuild the idea feed of every stored account from what is already on disk.
 *
 * A stored idea outlives the code that wrote it: titles generated before the
 * templates were grounded on the pattern's own subject still read "My daily
 * vlogs india routine", and songs rejected by the current extractor still show
 * as "Cover “ending is hilaaaarious”". This replays adapt + rank over the stored
 * profile and patterns, so no credits are spent and no model is called.
 *
 *   npx tsx scripts/.rebuild-ideas.ts [account-id ...]
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { adapt } from "../lib/adapt";
import { rank } from "../lib/rank";
import { readsLikeSongTitle } from "../lib/songs";
import { createStore } from "../lib/store";

async function main() {
  const root = path.join(process.cwd(), "data", "accounts");
  const only = process.argv.slice(2);
  const ids = (await fs.readdir(root)).filter(
    (id) => !only.length || only.includes(id),
  );

  for (const id of ids) {
    const db = createStore(path.join(root, id));
    const [profile, patterns, signals, clusters] = await Promise.all([
      db.getProfile(),
      db.getPatterns(),
      db.getSignals(),
      db.getClusters(),
    ]);
    if (!profile || !patterns.length) {
      console.log(`${id.slice(0, 8)}  skipped (no profile/patterns)`);
      continue;
    }

    /**
     * The plan carries its own copy of the song list, so it needs the same
     * repair: a stored plan built before the extractor was tuned listed
     * "ending is hilaaaarious" under "songs worth covering".
     */
    const plan = await db.getPlan();
    if (plan?.songs?.length) {
      const clean = plan.songs.filter((s) => readsLikeSongTitle(s.title));
      if (clean.length !== plan.songs.length) {
        await db.savePlan({ ...plan, songs: clean.length ? clean : undefined });
        console.log(
          `${id.slice(0, 8)}  plan songs ${plan.songs.length} → ${clean.length}`,
        );
      }
    }

    const drafts = await adapt(profile, patterns);
    const before = await db.getIdeas();
    const kept = before.filter((i) => i.status !== "new");
    const ideas = rank(drafts, signals, profile, kept, 10, clusters);
    await db.saveIdeas([...ideas, ...kept].slice(0, 60));
    console.log(
      `${id.slice(0, 8)}  ${profile.archetype ?? "?"}  ${drafts.length} drafts → ${ideas.length} ideas`,
    );
    for (const i of ideas.slice(0, 4)) console.log(`      • ${i.title}`);
  }
}

main();
