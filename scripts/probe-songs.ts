/**
 * Does the model path handle a SONG-LED account correctly?
 *
 * The mock path has musicDrafts() for singers; when a model is configured that
 * branch is skipped entirely and the SYSTEM prompt's "songs" rules have to do
 * the work. This prints what the model actually returns so a singer's idea can
 * be judged: does it name a song from the list, and the line to start on?
 *
 *   npx tsx --env-file=.env.local scripts/probe-songs.ts
 *
 * Costs no SocialCrawl credits; a few thousand DeepSeek tokens.
 */
import { adapt } from "../lib/adapt";
import { llmLabel, llmReady } from "../lib/llm";
import type { PatternCard, Profile } from "../lib/types";

const profile = {
  handle: "test_singer",
  niche: "telugu music covers",
  archetype: "singer",
  songs: ["Samajavaragamana", "Kesariya", "Tum Hi Ho"],
  pillars: ["telugu covers", "sad songs", "acoustic versions"],
  audience: "telugu speakers who grew up on 90s melodies",
  voice: "warm, unpolished, sings first then talks",
  bannedWords: ["guys", "link in bio"],
  constraints: ["films alone in a bedroom", "phone mic only"],
  ownWinners: ["Covered Samajavaragamana from the charanam, no intro"],
  commentQuestions: ["Which song next?"],
  formats: undefined,
} as unknown as Profile;

const patterns: PatternCard[] = [
  {
    signalId: "sig-a",
    hookText: "She starts the song before the beat drops and everybody stops talking",
    hookType: "reveal",
    format: "performance",
    topic: "acoustic cover of a 90s melody",
    tension: "covers usually open with a spoken intro that loses people",
    payoff: "the song is already playing by second one",
    cta: "comment the next song",
    durationSec: 34,
    whyItWorked: "A performance post that did 6x the account's usual views while the idea was still early.",
    skeleton: "performance → open mid-line → 3 beats of the song → single ask",
  },
  {
    signalId: "sig-b",
    hookText: "I sang this in one take with the fan noise left in",
    hookType: "confession",
    format: "performance",
    topic: "one-take cover with room noise",
    tension: "polished covers can feel lifeless",
    payoff: "proof that raw can win",
    cta: "save this",
    durationSec: 41,
    whyItWorked: "A performance post that did 4x the account's usual views while the idea was still new.",
    skeleton: "performance → unfinished take → 3 beats → one line of talk",
  },
];

async function main() {
  console.log(`model: ${llmLabel()}  ready=${llmReady()}`);
  const drafts = await adapt(profile, patterns, { perPattern: 1 });
  console.log(`\nideas: ${drafts.length}\n`);
  for (const d of drafts) {
    console.log("─".repeat(70));
    console.log(`title:  ${d.title}`);
    console.log(`format: ${d.format} / ${d.hookType} / effort ${d.effort}`);
    for (const [i, h] of d.hookVariants.entries()) console.log(`  hook${i + 1}: ${h}`);
    console.log(`  beats: ${(d.beats ?? []).slice(0, 3).join(" | ")}`);
    console.log(`  shots: ${(d.shotList ?? []).slice(0, 3).join(" | ")}`);
    console.log(`  why:   ${d.whyThis}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
