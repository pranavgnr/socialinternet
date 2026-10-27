import { promises as fs } from "node:fs";
import path from "node:path";
import { songOf } from "../lib/songs";
import type { RawReel } from "../lib/types";

async function main() {
  const dir = path.join(process.cwd(), "data", "niches");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  let total = 0, hit = 0;
  for (const file of files) {
    const stored = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as { payload: RawReel[] };
    if (!stored.payload?.length) continue;
    console.log(`\n══ ${file}`);
    for (const r of stored.payload) {
      total++;
      const s = songOf(r);
      if (s) hit++;
      if (s) console.log(`  "${s}"  <=  ${JSON.stringify(r.caption.split("\n")[0].slice(0, 68))}`);
    }
  }
  console.log(`\nextracted ${hit}/${total}`);
}
void main();
