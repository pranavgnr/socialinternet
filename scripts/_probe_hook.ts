/**
 * One reel, full hook reading, including the note on failure.
 *   npx tsx --env-file=.env.local scripts/_probe_hook.ts [reel-url-fragment]
 *
 * Picks a reel whose post payload is already cached (so no credits are spent)
 * and prints what the local video reader actually got.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { mediaTools, readHook } from "../lib/media";
import type { RawReel } from "../lib/types";

interface PostRow {
  mediaUrl?: string;
  caption?: string;
  views?: number;
}

async function main() {
  const frag = process.argv[2];
  const cache = JSON.parse(
    readFileSync(path.join(process.cwd(), "data", "_post_cache.json"), "utf8"),
  ) as Record<string, PostRow>;

  const url = Object.keys(cache).find((u) => (frag ? u.includes(frag) : true));
  if (!url) throw new Error("no cached post matches; run test-deep first");
  const post = cache[url];

  const reel = {
    id: `probe_${url.split("/").filter(Boolean).pop()}`,
    platform: "instagram",
    account: "probe",
    url,
    caption: post.caption ?? "",
    views: post.views ?? 0,
    likes: 0,
    comments: 0,
    postedAt: new Date().toISOString(),
    hashtags: [],
  } as unknown as RawReel;

  console.log(mediaTools());
  console.log("reel:", url);
  const reading = await readHook({ reel, mediaUrl: post.mediaUrl });
  console.log(JSON.stringify(reading, null, 2));
}

void main();
