/**
 * Offline check for the hook reader: one local MP4 in, one HookReading out.
 * Zero credits, no network — proves whisper + OCR + the mode verdict work.
 *
 *   npx tsx scripts/test-hook.ts .probe/v.mp4
 */
import { mediaReady, mediaTools, readHook } from "../lib/media";
import type { RawReel } from "../lib/types";

async function main() {
  const file = process.argv[2] ?? ".probe/v.mp4";
  const abs = file.startsWith("/") ? file : `${process.cwd()}/${file}`;
  console.log("tools:", mediaTools(), "ready:", mediaReady());

  const reel = {
    id: `hooktest_${Date.now()}`,
    platform: "instagram",
    account: "local",
    url: `file://${abs}`,
    caption: "probe reel",
    views: 0,
    likes: 0,
    comments: 0,
    postedAt: new Date().toISOString(),
    hashtags: [],
  } as unknown as RawReel;

  const reading = await readHook({ reel, mediaUrl: `file://${abs}` });
  console.log(JSON.stringify(reading, null, 2));
}

void main();
