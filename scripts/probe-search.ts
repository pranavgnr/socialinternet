/**
 * What does a search row actually carry?
 *
 * The language verify pass only runs on reels whose video it can download, so
 * whether /instagram/search/reels returns a media URL decides whether that pass
 * ever does anything in production. This asks the provider once (1 credit),
 * prints the field names it got back and whether any of them is a playable URL.
 *
 *   npx tsx --env-file=.env.local scripts/probe-search.ts "english music covers"
 */
const BASE = "https://www.socialcrawl.dev/v1";

const query = process.argv[2] ?? "english music covers";

async function main() {
  const key = process.env.SOCIALCRAWL_API_KEY;
  if (!key) throw new Error("SOCIALCRAWL_API_KEY missing");
  const url = `${BASE}/instagram/search/reels?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "x-api-key": key } });
  console.log("status", res.status);
  const json = (await res.json()) as Record<string, unknown>;
  console.log("credits_used", json.credits_used, "remaining", json.credits_remaining);
  const data = (json.data ?? {}) as Record<string, unknown>;
  console.log("data keys", Object.keys(data));
  const items = (data.items ?? []) as Record<string, unknown>[];
  console.log("rows", items.length);
  const row = items[0] ?? {};
  const post = (row.post ?? row) as Record<string, unknown>;
  console.log("post keys", Object.keys(post));
  const content = (post.content ?? {}) as Record<string, unknown>;
  console.log("content keys", Object.keys(content));
  console.log("ext keys", Object.keys((post.ext ?? {}) as Record<string, unknown>));
  console.log("computed keys", Object.keys((row.computed ?? {}) as Record<string, unknown>));
  console.log("computed", JSON.stringify(row.computed ?? {}).slice(0, 600));
  console.log("content sample", JSON.stringify(content).slice(0, 1200));

  // does any row mention a video/media URL at all?
  const blob = JSON.stringify(items);
  for (const field of ["media_urls", "video_url", "videoUrl", "play_url", "mp4", "download"]) {
    const n = blob.split(field).length - 1;
    if (n) console.log(`field "${field}" appears ${n}x`);
  }
}

main().catch((e) => {
  console.error("FAILED", (e as Error).message);
  process.exit(1);
});
