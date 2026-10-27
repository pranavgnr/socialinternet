/**
 * Does a live search row reach us with a playable video URL?
 *
 * The verify pass can only watch reels it has an MP4 for. This asks once
 * (1 credit) and prints, per row, whether the media URL survived `normalise`
 * — because a pass that quietly finds nothing to watch is worse than none.
 */
import { harvestInstagramSearch } from "../lib/harvest";
import { readLanguage } from "../lib/lang";

const query = process.argv[2] ?? "english music covers";

async function main() {
  const reels = await harvestInstagramSearch(query);
  console.log(`${reels.length} reels for "${query}"`);
  let withMedia = 0;
  for (const r of reels) {
    if (r.mediaUrl) withMedia += 1;
    const read = readLanguage(r);
    console.log(
      [
        (r.account ?? "?").padEnd(24),
        String(r.views ?? 0).padStart(9),
        r.mediaUrl ? "mp4" : "---",
        `${read.from ?? "-"}:${read.code ?? "-"}`.padEnd(16),
        (r.caption ?? "").replace(/\s+/g, " ").slice(0, 46),
      ].join(" | "),
    );
  }
  console.log(`with mediaUrl: ${withMedia}/${reels.length}`);
}

main().catch((e) => {
  console.error("FAILED", (e as Error).message);
  process.exit(1);
});
