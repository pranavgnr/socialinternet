/**
 * Probe the song extractor against real captions from the cached niche pulls.
 * Prints every song it reads plus the captions it wrongly accepts, so the
 * rejection lists can be tuned against actual data instead of guesses.
 *
 *   npx tsx scripts/.songprobe.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { songFromCaption } from "../lib/songs";
import type { RawReel } from "../lib/types";

const CASES = [
  "The ending is hilaaaarious 🤣🤣🤣\nHow many of you remember this song?😎",
  "Dream to reality✨ here is our new cover\nhaadu “Bandhana Noda Chendulla Cheluva”",
  "Kabhi Kabhi Aditi ♥️ cover",
  "Ello Jogappa - kannada cover song",
  "falak tak (cover)",
  "Arz Kiya Hai – Sargam Part",
  "Kannada Cover 28/100 - ನೀನೆಂದರೆ ನನ್ನೊಳಗೆ",
  "Needs no introduction",
  "Hope I passed on the vibe",
];

async function main() {
  console.log("=== hand-written cases ===");
  for (const c of CASES) {
    const got = songFromCaption(c, "someone");
    console.log(`${got ? "SONG" : "rejected"}  ${JSON.stringify(got)}  <- ${c.split("\n")[0].slice(0, 55)}`);
  }

  const dir = path.join(process.cwd(), "data", "niches");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const seen = new Set<string>();
  console.log("\n=== every song read from cached pulls ===");
  for (const file of files) {
    const stored = JSON.parse(
      await fs.readFile(path.join(dir, file), "utf8"),
    ) as { payload: RawReel[] };
    for (const r of stored.payload ?? []) {
      const song = songFromCaption(r.caption ?? "", r.account);
      if (!song) continue;
      const key = song.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`${song.padEnd(38)} | @${r.account} | ${(r.caption ?? "").split("\n")[0].slice(0, 50)}`);
    }
  }
  console.log(`\n${seen.size} distinct titles`);
}

main();
