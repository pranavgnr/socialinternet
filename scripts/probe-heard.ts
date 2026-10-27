/**
 * What does the audio actually say the language is?
 *
 * Reads a saved pull (data/_probe_live.json), watches the reels it points at,
 * and prints the language whisper heard plus the words it decoded — so the
 * threshold that decides whether a hearing counts can be set from evidence
 * rather than guessed. Costs nothing: local whisper, CDN downloads.
 *
 *   npx tsx scripts/probe-heard.ts [howMany]
 */
import { readFileSync } from "node:fs";

import { readLanguage } from "../lib/lang";
import { readHook } from "../lib/media";
import type { RawReel } from "../lib/types";

const n = Number(process.argv[2] ?? 8);
const saved = JSON.parse(readFileSync("data/_probe_live.json", "utf8")) as {
  query: string;
  reels: RawReel[];
};

async function main() {
console.log(`\n"${saved.query}" · watching ${n} of ${saved.reels.length}`);
for (const reel of saved.reels.slice(0, n)) {
  const t0 = Date.now();
  const reading = await readHook({ reel, mediaUrl: reel.mediaUrl });
  const spoken = (reading.spoken ?? "").slice(0, 90).replace(/\s+/g, " ");
  const onScreen = (reading.onScreen ?? []).join(" · ").slice(0, 60);
  const heard = `${reading.heardLang ?? "—"}${reading.heardLangProb !== undefined ? ` p=${reading.heardLangProb.toFixed(2)}` : ""}`;
  const caption = readLanguage({ caption: reel.caption, hashtags: reel.hashtags, audioName: reel.audioName });
  const video = readLanguage({
    onScreenText: onScreen,
    spoken,
    heardLang: reading.heardLang,
    heardLangProb: reading.heardLangProb,
  });
  console.log(
    `\n@${reel.account}  ${((Date.now() - t0) / 1000).toFixed(0)}s` +
      `\n  provider ${reel.language ?? "—"} · caption ${caption.code ?? "—"}/${caption.from ?? "—"} · heard ${heard} · video ${video.code ?? "—"}/${video.from ?? "—"}` +
      `\n  cap  "${(reel.caption ?? "").replace(/\s+/g, " ").slice(0, 70)}"` +
      (spoken ? `\n  said "${spoken}"` : "") +
      (onScreen ? `\n  read "${onScreen}"` : ""),
  );
}
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
