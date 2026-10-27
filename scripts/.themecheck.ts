import { promises as fs } from "node:fs";
import path from "node:path";
import { researchFromCache } from "../lib/niche";
import { buildRows, clusterThemes } from "../lib/stats";
import type { RawReel } from "../lib/types";

async function main() {
  for (const slug of ["daily-vlogs-india", "ai-automation"]) {
    const stored = JSON.parse(
      await fs.readFile(path.join("data", "niches", `${slug}.json`), "utf8"),
    ) as { payload: RawReel[]; fetchedAt: string };
    const research = researchFromCache(slug.replace(/-/g, " "), stored.payload, {
      fetchedAt: stored.fetchedAt,
    });
    const rows = buildRows(research);
    console.log(`\n══ ${slug}`);
    for (const t of clusterThemes(rows).slice(0, 6)) {
      console.log(
        `  ${String(t.accounts.length).padStart(2)} accts  ${t.medianRatio.toFixed(1)}x  label=${JSON.stringify(t.label)}`,
      );
    }
  }
}
void main();
