import { promises as fs } from "node:fs";
import path from "node:path";
import { detectArchetype } from "../lib/archetype";
import { researchFromCache } from "../lib/niche";
import { buildPlan } from "../lib/plan";
import type { RawReel } from "../lib/types";

(async () => {
  const dir = path.join(process.cwd(), "data", "niches");
  let total = 0, zero = 0, stayThere = 0, noEvidence = 0;
  const ids = new Map<string, number>();
  for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const slug = file.replace(/\.json$/, "");
    const stored = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
    if (!stored.payload?.length) continue;
    const map = new Map<string, RawReel[]>();
    for (const r of stored.payload) {
      if (!r.account) continue;
      const l = map.get(r.account) ?? []; l.push(r); map.set(r.account, l);
    }
    const research = researchFromCache(slug.replace(/-/g, " "), stored.payload, { fetchedAt: stored.fetchedAt });
    for (const [handle, reels] of map) {
      const plan = buildPlan({ handle, research, ownReels: reels, archetype: detectArchetype(reels) });
      total++;
      if (!plan.moves.length) zero++;
      if (/stay there/i.test(plan.moves[0]?.title ?? "")) stayThere++;
      for (const m of plan.moves) { if (!m.evidence.length) noEvidence++; ids.set(m.id, (ids.get(m.id) ?? 0) + 1); }
    }
  }
  console.log(`accounts: ${total} | empty plans: ${zero} | 'stay there' leads: ${stayThere} | moves with no proof: ${noEvidence}`);
  console.log("lead move ids:", [...ids.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join("  "));
})();
