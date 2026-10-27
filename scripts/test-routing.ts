/**
 * Does the classifier route a kind of account to the right KIND of advice?
 *
 * Every case here is a made-up account whose captions are what that creator
 * would actually write. The point is not the numbers — it is that a singer
 * lands on "songs", a vlogger on "formats", a teacher on "hooks", and a cook on
 * "craft", so the plan leads with a lever that exists for that account.
 *
 *   npx tsc scripts/test-routing.ts --module commonjs --target es2022 \
 *     --moduleResolution node --outDir .tmp-build --skipLibCheck --esModuleInterop
 *   node .tmp-build/scripts/test-routing.js
 */
import { detectArchetype } from "../lib/archetype";
import type { RawReel } from "../lib/types";

const reel = (account: string, caption: string, views: number, tags: string[] = []): RawReel => ({
  id: `${account}-${views}-${caption.slice(0, 12)}`,
  platform: "instagram",
  account,
  url: `https://instagram.com/p/${account}${views}`,
  caption,
  postedAt: new Date(Date.now() - views * 86400000).toISOString(),
  views,
  likes: Math.round(views / 20),
  comments: Math.round(views / 200),
  hashtags: tags,
});

const CASES: { label: string; expect: string; reels: RawReel[] }[] = [
  {
    label: "singer (Hindi covers)",
    expect: "songs",
    reels: [
      reel("a", "Singing Tum Hi Ho, hope I did it justice #coversong", 42000, ["coversong", "hindisongs"]),
      reel("a", "Unplugged cover of Kesariya, acoustic guitar only", 88000, ["acoustic", "cover"]),
      reel("a", "My cover of Channa Mereya — full version on my page", 21000, ["cover"]),
    ],
  },
  {
    label: "vlogger (day in the life)",
    expect: "formats",
    reels: [
      reel("b", "Day in my life as a 22 year old in Bangalore vlog", 31000, ["vlog", "dayinmylife"]),
      reel("b", "Come with me to a coffee shop and then the gym, vlog", 47000, ["vlog"]),
      reel("b", "Weekly vlog: what I eat, work, evening walk", 18000, ["weeklyvlog"]),
    ],
  },
  {
    label: "teacher (spoken English)",
    expect: "hooks",
    reels: [
      reel("c", "Spoken English tip: stop saying 'I am agree'", 64000, ["spokenenglish", "english"]),
      reel("c", "Grammar lesson nobody taught you in school", 21000, ["grammar"]),
      reel("c", "Learn 3 vocabulary words in 30 seconds", 12000, ["vocabulary"]),
    ],
  },
  {
    label: "home cook",
    expect: "craft",
    reels: [
      reel("d", "Cooking my grandmother's dal recipe, full recipe below", 52000, ["recipe", "cooking"]),
      reel("d", "Baking a chocolate cake with 5 ingredients", 90000, ["baking", "cake"]),
      reel("d", "Street style pav bhaji at home, recipe in caption", 14000, ["recipe", "streetfood"]),
    ],
  },
  {
    label: "gym / fitness coach",
    expect: "craft",
    reels: [
      reel("e", "Workout for chest — 4 sets, proper form", 33000, ["workout", "fitness"]),
      reel("e", "Bodybuilding push day, form tips included", 12000, ["bodybuilding"]),
      reel("e", "Gym mistake everyone makes on squats", 58000, ["gym", "fitness"]),
    ],
  },
  {
    label: "beauty / makeup",
    expect: "craft",
    reels: [
      reel("f", "Makeup routine for oily skin, skincare first", 41000, ["makeup", "skincare"]),
      reel("f", "Everyday hair styling in 2 minutes", 17000, ["hair"]),
      reel("f", "GRWM makeup for a wedding", 63000, ["makeup", "grwm"]),
    ],
  },
  {
    label: "travel",
    expect: "formats",
    reels: [
      reel("g", "Travelling to Spiti — the whole trip in 40 seconds", 72000, ["travel", "spiti"]),
      reel("g", "Backpacking through Vietnam on a budget", 26000, ["backpacking", "travel"]),
      reel("g", "Hidden beach in Goa nobody visits", 13000, ["travel", "goa"]),
    ],
  },
  {
    label: "money / finance",
    expect: "hooks",
    reels: [
      reel("h", "How to invest your first 10000 rupees", 55000, ["investing", "finance"]),
      reel("h", "Stock market basics nobody explains simply", 19000, ["stockmarket"]),
      reel("h", "Why your savings account is losing money", 34000, ["money"]),
    ],
  },
  {
    label: "AI / tech creator",
    expect: "hooks",
    reels: [
      reel("i", "This AI tool writes your whole report, tutorial below", 81000, ["ai", "automation"]),
      reel("i", "I automated my job with python, here's the code", 30000, ["python", "coding"]),
      reel("i", "Claude vs GPT for coding — tested", 22000, ["ai"]),
    ],
  },
  {
    label: "unreadable account (no signal)",
    expect: "none",
    reels: [
      reel("j", "good morning all", 4000, []),
      reel("j", "thanks for the support", 3000, []),
      reel("j", "new post", 2500, []),
    ],
  },
];

let failures = 0;
for (const c of CASES) {
  const guess = detectArchetype(c.reels);
  const ok = guess.recommendation === c.expect;
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.label.padEnd(34)} → ${guess.id.padEnd(10)} family=${guess.recommendation.padEnd(
      8,
    )} conf=${guess.confidence.toFixed(2)}${ok ? "" : `  (expected ${c.expect})`}`,
  );
}

console.log(`\n${CASES.length - failures}/${CASES.length} routed to the expected family`);
process.exit(failures ? 1 : 0);
