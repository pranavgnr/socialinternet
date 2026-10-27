/**
 * Per-family plan quality. Read-only, zero credits.
 * Tells us whether "general" is thin because of classification or because the
 * craft/format playbooks themselves are thin.
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

  type Row = { n: number; moves: number; formats: number; hooks: number; songs: number };
  const byFamily = new Map<string, Row>();
  const byArch = new Map<string, Row>();
  const bump = (m: Map<string, Row>, k: string, moves: number, f: number, h: number, s: number) => {
    const r = m.get(k) ?? { n: 0, moves: 0, formats: 0, hooks: 0, songs: 0 };
    r.n += 1; r.moves += moves; r.formats += f; r.hooks += h; r.songs += s;
    m.set(k, r);
  };
  const sampleLeads = new Map<string, string[]>();

  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const stored = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as Stored;
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
      const f = plan.formats?.length ?? 0;
      const h = plan.hooks?.length ?? 0;
      const s = plan.songs?.length ?? 0;
      bump(byFamily, shape.recommendation, plan.moves.length, f, h, s);
      bump(byArch, shape.id, plan.moves.length, f, h, s);
      const arr = sampleLeads.get(shape.id) ?? [];
      if (arr.length < 2) arr.push(`${handle}: ${plan.moves[0]?.title ?? "(none)"}`);
      sampleLeads.set(shape.id, arr);
    }
  }

  const show = (title: string, m: Map<string, Row>, extra?: boolean) => {
    console.log(`\n${title}`);
    for (const [k, r] of [...m.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const p = (x: number) => `${Math.round((x / r.n) * 100)}%`;
      console.log(
        `  ${k.padEnd(10)} n=${String(r.n).padStart(3)}  moves/acc=${(r.moves / r.n).toFixed(2)}  ` +
          `formats=${p(r.formats)}  hooks=${p(r.hooks)}  songs=${p(r.songs)}`,
      );
    }
    if (extra) {
      for (const [k, leads] of sampleLeads) {
        if (k !== "general" && k !== "maker") continue;
        console.log(`\n  -- ${k} leads --`);
        leads.forEach((l) => console.log(`     ${l}`));
      }
    }
  };

  show("BY ADVICE FAMILY", byFamily);
  show("BY ARCHETYPE", byArch, true);
}

main();
