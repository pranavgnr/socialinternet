/**
 * The SocialCrawl shelf, without spending anything.
 *
 *   npx tsx scripts/sc-tools.ts            # balance + the endpoints this app can use
 *   npx tsx scripts/sc-tools.ts comments   # what anything matching "comments" costs
 *
 * Both calls are /v1/utility/* and /v1/credits/balance: 0 credits each. Use this
 * before adding a source, instead of guessing a path and paying for a 404.
 */
import { creditBalance, searchEndpoints } from "../lib/harvest";

/** What the app uses today, and what it deliberately does not. */
const IN_USE = [
  ["instagram/search/reels", "discover benchmark accounts for a niche", 1],
  ["instagram/profile/reels", "one benchmark account's reels", 1],
  ["instagram/post", "comments + MP4 URL for the deep pass", 1],
  ["instagram/profile", "creator's real follower count and bio", 1],
  ["instagram/post/comments", "more comments when the free ones are thin", 5],
  ["instagram/media/transcript", "hook transcript when no local whisper", 10],
] as const;

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  const balance = await creditBalance();
  console.log(`balance: ${balance ?? "unknown"} credits\n`);

  if (query) {
    const hits = await searchEndpoints(query);
    console.log(`${hits.length} endpoints matching "${query}"`);
    for (const h of hits.slice(0, 25)) {
      console.log(`  ${String(h.credits).padStart(2)}c  ${h.id.padEnd(38)} ${h.summary.slice(0, 70)}`);
    }
    return;
  }

  console.log("in use:");
  for (const [id, why, cost] of IN_USE) {
    console.log(`  ${String(cost).padStart(2)}c  ${id.padEnd(34)} ${why}`);
  }
  console.log(
    "\nnot used on purpose:\n" +
      "  10c  instagram/media/screen-text   — macOS Vision reads burned-in text for free\n" +
      "   5c  instagram/reels/trending      — views are null, so no outlier claim is possible\n" +
      "   5c  instagram/post/stats          — shares/follower growth, only worth it for own account\n" +
      "   5c  instagram/followers|following — audience of a stranger is not a content signal\n",
  );
}

void main();
