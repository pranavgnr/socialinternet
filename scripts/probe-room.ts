/**
 * Score one niche end to end, without the HTTP layer in the way.
 *
 * Prints the raw signals a room produces and the five score components, so a
 * change to the search or the maths can be checked without a rebuild.
 *
 *   npx tsx --env-file=.env.local scripts/probe-room.ts "sourdough baking" --force
 */
import { researchNiche } from "../lib/niche";
import { scoreNiche, signalsFrom } from "../lib/opportunity";

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const queries = argv.filter((a) => !a.startsWith("--"));
  if (!queries.length) {
    console.error("usage: probe-room.ts <query> [query...] [--force]");
    process.exit(1);
  }

  for (const q of queries) {
    const t0 = Date.now();
    let research;
    try {
      research = await researchNiche({ query: q, force });
    } catch (err) {
      console.log(`\n### ${q}\n  FAILED: ${(err as Error).message}`);
      continue;
    }

    const s = signalsFrom(research);
    const o = scoreNiche(s);
    const known = research.accounts.filter((a) => a.followers).length;

    console.log(`\n### ${q}   (${Date.now() - t0}ms)`);
    console.log(
      `  reels=${s.reels.length} accounts=${research.accounts.length} followersKnown=${known} nicheMedian=${research.nicheMedianViews}`,
    );
    console.log(
      `  score=${o.score}  "${o.verdict}"  medianAge=${o.medianAgeDays === null ? "unknown" : o.medianAgeDays.toFixed(1) + "d"}`,
    );
    console.log(
      `  parts: demand=${o.parts.demand.toFixed(2)} headroom=${o.parts.headroom.toFixed(2)} openness=${o.parts.openness.toFixed(2)} freshness=${o.parts.freshness.toFixed(2)} money=${o.parts.money.toFixed(2)}`,
    );
    console.log(
      `  smallAccountShare=${(100 * o.smallAccountShare).toFixed(0)}%  sizeEvidence=${o.sizeEvidence.toFixed(2)}  winners=${o.distinctWinners}  topShare=${(100 * o.topShare).toFixed(0)}%`,
    );
    for (const r of o.reasons) {
      console.log(
        `   ${r.direction === "up" ? "+" : r.direction === "down" ? "-" : "·"} ${r.label}: ${r.value}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
