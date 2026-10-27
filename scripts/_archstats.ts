/**
 * Baseline measurement: how well does archetype detection cover real accounts?
 * Read-only, zero credits. Prints coverage by family so a change can be scored.
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

const GENERIC = /Post on the idea behind the biggest post here/;

async function main() {
  const dir = path.join(process.cwd(), "data", "niches");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));

  const families: Record<string, number> = {};
  let accounts = 0;
  let withFormats = 0;
  let withHooks = 0;
  let withSongs = 0;
  let genericLead = 0;
  let oneMove = 0;
  const thin: string[] = [];

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

    for (const [handle, reels] of byAccount) {
      const shape = detectArchetype(reels, slug.replace(/-/g, " "));
      const plan = buildPlan({ handle, research, ownReels: reels, archetype: shape });
      accounts += 1;
      families[shape.id] = (families[shape.id] ?? 0) + 1;
      if ((plan.formats?.length ?? 0) > 0) withFormats += 1;
      if ((plan.hooks?.length ?? 0) > 0) withHooks += 1;
      if ((plan.songs?.length ?? 0) > 0) withSongs += 1;
      if (GENERIC.test(plan.moves[0]?.title ?? "")) genericLead += 1;
      if (plan.moves.length <= 1) oneMove += 1;
      if (shape.id === "general" && reels.length >= 5) {
        thin.push(`${slug} @${handle} reels=${reels.length}`);
      }
    }
  }

  const pct = (n: number) => `${((n / accounts) * 100).toFixed(1)}%`;
  console.log(`accounts            ${accounts}`);
  console.log(`families            ${JSON.stringify(families)}`);
  console.log(`has formats>0       ${withFormats} (${pct(withFormats)})`);
  console.log(`has hooks>0         ${withHooks} (${pct(withHooks)})`);
  console.log(`has songs>0         ${withSongs} (${pct(withSongs)})`);
  console.log(`generic lead        ${genericLead} (${pct(genericLead)})`);
  console.log(`only one move       ${oneMove} (${pct(oneMove)})`);
  console.log(`\n"general" despite 5+ reels (${thin.length}):`);
  thin.slice(0, 25).forEach((t) => console.log(`  ${t}`));
}

main();
