/** Offline: what does the archetype/label pipeline say about a cached handle? */
import { promises as fs } from "node:fs";

import { detectArchetype } from "../lib/archetype";
import type { RawReel } from "../lib/types";

async function main() {
  const handle = (process.argv[2] ?? "rachana.kannegulla").replace(/^@/, "");
  const stored = JSON.parse(
    await fs.readFile(`data/handles/${handle}.json`, "utf8"),
  ) as { reels: RawReel[]; niche?: string };
  const guess = process.argv[3] ?? stored.niche ?? "";
  const a = detectArchetype(stored.reels, guess);
  console.log(`@${handle}  niche="${guess}"`);
  console.log(`archetype: ${JSON.stringify(a)}`);

  const niche = `${guess.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")}`;
  try {
    const n = JSON.parse(await fs.readFile(`data/niches/${niche}.json`, "utf8")) as {
      payload: RawReel[];
    };
    const by = new Map<string, number>();
    for (const r of n.payload) {
      const k = r.account || "?";
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    console.log(`cohort (${by.size} accounts):`);
    console.log([...by.entries()].map(([k, v]) => `${k}:${v}`).join("  "));
  } catch {
    console.log(`no cached niche pull at data/niches/${niche}.json`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
