/**
 * Who lands in "general"? Read-only. Prints each general account with a couple
 * of caption snippets so the missing vocabulary is visible rather than guessed.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { detectArchetype } from "../lib/archetype";
import type { RawReel } from "../lib/types";

interface Stored {
  payload: RawReel[];
  fetchedAt: string;
}

async function main() {
  const dir = path.join(process.cwd(), "data", "niches");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const seen = new Set<string>();

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

    for (const [handle, reels] of byAccount) {
      if (seen.has(handle)) continue;
      const shape = detectArchetype(reels, slug.replace(/-/g, " "));
      if (shape.id !== "general") continue;
      seen.add(handle);
      const caps = reels
        .slice(0, 2)
        .map((r) => (r.caption ?? "").replace(/\s+/g, " ").slice(0, 95));
      console.log(`\n@${handle}  [${slug}] reels=${reels.length}`);
      caps.forEach((c) => console.log(`   · ${c}`));
    }
  }
  console.log(`\ntotal general accounts: ${seen.size}`);
}

main();
