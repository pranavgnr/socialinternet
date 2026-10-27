/**
 * Proof that the ScrapeCreators adapter maps the vendor's real payloads onto
 * the unified row shape — without spending a credit.
 *
 * The vendor's docs publish a full 200 response for both endpoints, and both
 * use Instagram's own GraphQL field names (`edge_followed_by.count`,
 * `ig_play_count`) rather than the obvious ones. Reading the obvious keys
 * produces `undefined` silently, which is how a paid call ends in "we have no
 * follower count" with nothing in the log. So the numbers below are asserted,
 * not eyeballed.
 *
 * Run: npx tsx --env-file=.env.local scripts/check-scrapecreators.ts
 */
process.env.SCRAPECREATORS_API_KEY = process.env.SCRAPECREATORS_API_KEY || "fixture-key";

import { scrapecreators } from "../lib/providers/scrapecreators";

/** The profile sample from the vendor's own docs, trimmed to the fields used. */
const PROFILE = {
  success: true,
  credits_remaining: 1000000,
  credits_charged: 1,
  data: {
    user: {
      username: "adrianhorning",
      full_name: "Adrian Horning",
      biography: "Scraping the web",
      is_verified: false,
      is_private: false,
      external_url: "https://scrapecreators.com",
      category_name: "Software",
      edge_followed_by: { count: 25116 },
      edge_follow: { count: 101 },
      edge_owner_to_timeline_media: { count: 71, edges: [] },
    },
  },
};

/** The reels sample: both play-count keys present, caption null. */
const REELS = {
  success: true,
  credits_remaining: 1000000,
  credits_charged: 1,
  items: [
    {
      media: {
        code: "DEiyb48AeB9",
        taken_at: 1736294201,
        caption: null,
        media_type: 2,
        play_count: 3865,
        ig_play_count: 3865,
        like_count: 214,
        comment_count: 9,
        video_duration: 12.5,
        display_uri: "https://scontent.cdninstagram.com/thumb.jpg",
        video_versions: [{ url: "https://scontent.cdninstagram.com/v.mp4" }],
      },
    },
    {
      media: {
        code: "DXnoViews1",
        taken_at: 1736294300,
        media_type: 2,
        like_count: 3,
      },
    },
  ],
};

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
};

globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  const body = u.includes("/instagram/profile")
    ? PROFILE
    : u.includes("/instagram/user/reels")
      ? REELS
      : { success: true, credits_remaining: 10 };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const profile = await scrapecreators.profile("@adrianhorning");
const p = (profile.data.user ?? {}) as Record<string, unknown>;
check("followers from edge_followed_by.count", p.followers, 25116);
check("posts from edge_owner_to_timeline_media.count", p.posts, 71);
check("following from edge_follow.count", p.following, 101);
check("bio", p.biography, "Scraping the web");
check("category", p.category, "Software");
check("credit cost charged", profile.units, 1);

const reels = await scrapecreators.profileReels("adrianhorning");
const rows = (reels.data.items ?? []) as { post: Record<string, unknown> }[];
check("row count", rows.length, 2);
check("first row views", (rows[0].post.engagement as Record<string, number>).views, 3865);
check("first row url", rows[0].post.url, "https://www.instagram.com/reel/DEiyb48AeB9/");
check("second row views (absent, not invented)", (rows[1].post.engagement as Record<string, number>).views, 0);
check("video url carried", ((rows[0].post.content as Record<string, unknown>).media_urls as string[])[0], "https://scontent.cdninstagram.com/v.mp4");

/** Search must refuse rather than return zero-view rows. */
let refused = false;
try {
  await scrapecreators.searchReels("dog training");
} catch {
  refused = true;
}
check("search refuses instead of pricing on zeros", refused, true);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
