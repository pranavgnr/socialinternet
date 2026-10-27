/**
 * Offline: does a cached handle now get a label someone would search, and is
 * the cohort that phrase bought actually the right room?
 *
 * Only reads data/ — no credits, no model required.
 */
import { promises as fs } from "node:fs";

import { detectArchetype, searchSubject } from "../lib/archetype";
import { cohortFitness } from "../lib/cohort";
import { coherentLabel, nicheQuality } from "../lib/nicheLabel";
import { inferNiche } from "../lib/plan";
import type { RawReel } from "../lib/types";

async function main() {
  const files = await fs.readdir("data/handles");
  for (const f of files) {
    const handle = f.replace(/\.json$/, "");
    const stored = JSON.parse(await fs.readFile(`data/handles/${f}`, "utf8")) as {
      reels: RawReel[];
      niche?: string;
    };
    const shape = detectArchetype(stored.reels);
    const guess = await inferNiche(stored.reels, {
      subject: searchSubject(shape.id) || shape.label,
      language: shape.language,
    });
    const q = nicheQuality(guess.query);
    const tags = coherentLabel(
      (stored.reels.flatMap((r) => r.hashtags ?? []) as string[]).map((tag) => ({
        tag,
        count: 1,
      })),
      handle,
    );

    let fit = "no cohort pull cached";
    const slug = guess.query.replace(/[^a-z0-9]+/g, "-");
    const tokens = `${guess.query} ${shape.label} ${shape.language ?? ""}`
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const filesNiche = await fs.readdir("data/niches").catch(() => [] as string[]);
    const candidates = [
      `${slug}.json`,
      ...filesNiche.filter((n) => tokens.some((t) => n.includes(t))),
    ];
    for (const name of candidates) {
      try {
        const n = JSON.parse(await fs.readFile(`data/niches/${name}`, "utf8")) as {
          payload: RawReel[];
        };
        const cohort = n.payload.filter(
          (r) => (r.account ?? "").toLowerCase() !== handle.toLowerCase(),
        );
        const checked = cohortFitness({
          query: guess.query,
          creator: stored.reels,
          cohort,
          shape,
        });
        fit = `${checked.verdict} (${checked.score.toFixed(2)}) off=[${checked.off.join(", ")}]  via ${name}`;
        break;
      } catch {
        /* try the next one */
      }
    }

    console.log(`@${handle}`);
    console.log(`  shape    : ${shape.label} / ${shape.language || "-"} (${shape.confidence.toFixed(2)})`);
    console.log(`  stored   : "${stored.niche ?? ""}"`);
    console.log(`  label    : "${guess.query}"  source=${guess.source}  quality=${q.ok ? "ok" : `REJECT ${q.reason}`}`);
    console.log(`  fromTags : "${tags}"`);
    console.log(`  cohortFit: ${fit}`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
