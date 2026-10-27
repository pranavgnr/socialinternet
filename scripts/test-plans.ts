/**
 * Plan-level regression: does each KIND of account get the kind of advice its
 * owner asked for — a singer songs, a vlogger shapes of video, a teacher an
 * opening line — and does nobody get an empty page?
 *
 * Everything is synthetic and offline: a target account plus a small cohort of
 * peers, replayed through the real pipeline. No network, no credits, no cache.
 *
 *   npx tsc scripts/test-plans.ts --module commonjs --target es2022 \
 *     --moduleResolution node --outDir .tmp-build --skipLibCheck --esModuleInterop
 *   node .tmp-build/scripts/test-plans.js
 */
import { detectArchetype } from "../lib/archetype";
import { researchFromCache } from "../lib/niche";
import { buildPlan } from "../lib/plan";
import type { GrowthPlan, RawReel } from "../lib/types";

let seq = 0;
const reel = (account: string, caption: string, views: number, durationSec = 45): RawReel => ({
  id: `r${seq++}`,
  platform: "instagram",
  account,
  url: `https://instagram.com/p/${account}-${seq}`,
  caption,
  postedAt: new Date(Date.now() - (seq % 18) * 86400000).toISOString(),
  views,
  likes: Math.round(views / 25),
  comments: Math.round(views / 300),
  durationSec,
});

function planFor(target: RawReel[], cohort: RawReel[], query: string): GrowthPlan {
  const payload = [...target, ...cohort];
  const research = researchFromCache(query, payload, { fetchedAt: new Date().toISOString() });
  const handle = target[0].account;
  return buildPlan({
    handle,
    research,
    ownReels: target,
    archetype: detectArchetype(target, query),
  });
}

/* ---------------------------------------------------------------- singers */

const singerCohort = [
  reel("s1", 'Covering "Kesariya" tonight, acoustic only', 180000),
  reel("s1", 'My take on "Tum Hi Ho"', 60000),
  reel("s1", 'Singing "Channa Mereya" for you all', 40000),
  reel("s2", 'Unplugged "Kesariya" — one take', 220000),
  reel("s2", 'Tried "Raataan Lambiyan"', 70000),
  reel("s2", 'Arijit fan, "Tum Hi Ho" again', 45000),
  reel("s3", '"Kesariya" in my own style', 150000),
  reel("s3", '"Apna Bana Le" cover', 50000),
];
const singerTarget = [
  reel("singer", "Singing covers every week, new song soon", 12000),
  reel("singer", 'Singing "Raataan Lambiyan" at home', 9000),
  reel("singer", "My cover of an old Hindi classic", 7000),
  reel("singer", "Covers on covers, keep them coming", 5000),
];

/* ---------------------------------------------------------------- vloggers */

const vloggerCohort = [
  reel("v1", "POV: you move to a new city alone, day in my life vlog", 240000, 40),
  reel("v1", "I tried living on 500 rupees for a day, vlog", 90000, 55),
  reel("v1", "My honest morning routine vlog", 40000, 35),
  reel("v2", "POV: your first day at a new job, vlog", 310000, 45),
  reel("v2", "24 hours in Mumbai with no plan, vlog", 120000, 60),
  reel("v2", "Cook with me, vlog", 50000, 50),
  reel("v3", "POV: living alone for the first time, vlog", 180000, 38),
  reel("v3", "I quit my job, vlog", 260000, 42),
  reel("v3", "Night routine of a 23 year old, vlog", 70000, 33),
];
const vloggerTarget = [
  reel("vlogger", "Day in my life in Bangalore vlog", 21000, 95),
  reel("vlogger", "Come with me to the cafe then the gym, vlog", 18000, 70),
  reel("vlogger", "Weekly vlog: what I eat, work, evening walk", 9000, 110),
  reel("vlogger", "Morning routine vlog before work", 6000, 85),
];

/* ---------------------------------------------------------------- teachers */

const teacherCohort = [
  reel("t1", "Spoken English: stop saying 'I am agree'", 90000, 40),
  reel("t1", "Grammar rule nobody taught you", 40000, 35),
  reel("t2", "3 English words you are pronouncing wrong", 160000, 38),
  reel("t2", "How to answer 'tell me about yourself'", 70000, 50),
  reel("t3", "Spoken English tip for interviews", 120000, 42),
  reel("t3", "The grammar mistake in every resume", 55000, 45),
];
const teacherTarget = [
  reel("teacher", "Daily spoken English lesson, tips inside", 15000, 50),
  reel("teacher", "Grammar basics for beginners", 11000, 45),
  reel("teacher", "Learn English vocabulary with me", 8000, 40),
  reel("teacher", "English speaking practice session", 6000, 55),
];

/* ------------------------------------------- thin data: one post, no cohort */

const thinTarget = [reel("newbie", "Singing my first cover, hope you like it", 1200)];
const thinCohort = [
  reel("x1", 'Cover of "Adiga Adiga"', 300000),
  reel("x2", 'Cover of "Ello Jogappa"', 90000),
];

/* ------------------------------------------------------------------ checks */

interface Case {
  label: string;
  plan: GrowthPlan;
  wantFamily: string;
  /** a substring the lead move must contain, when the family is identifiable */
  wantLead?: RegExp;
}

const cases: Case[] = [
  { label: "singer → songs", plan: planFor(singerTarget, singerCohort, "hindi covers"), wantFamily: "songs", wantLead: /cover|sing|song/i },
  { label: "vlogger → shapes of video", plan: planFor(vloggerTarget, vloggerCohort, "day in my life vlogs"), wantFamily: "formats" },
  { label: "teacher → opening line", plan: planFor(teacherTarget, teacherCohort, "spoken english tips"), wantFamily: "hooks" },
  { label: "thin data (1 post) → still a move", plan: planFor(thinTarget, thinCohort, "kannada covers"), wantFamily: "songs" },
];

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

for (const c of cases) {
  const p = c.plan;
  console.log(`\n── ${c.label}  (@${p.handle}, ${p.moves.length} moves)`);
  console.log(`   family=${p.archetype.recommendation} lead=${p.moves[0]?.id ?? "NONE"}`);

  if (!p.moves.length) fail("no moves at all — the page would be blank");
  const lead = p.moves[0];
  if (lead) {
    console.log(`   title: ${lead.title}`);
    if (/stay there/i.test(lead.title)) fail("lead is a 'stay there' non-action");
    if (!lead.evidence.length) fail("lead cites no post");
    if (c.wantLead && !c.wantLead.test(`${lead.title} ${lead.action}`)) {
      fail(`lead does not read like the expected advice (${c.wantLead})`);
    }
    if (p.archetype.recommendation !== c.wantFamily) {
      fail(`expected family ${c.wantFamily}, got ${p.archetype.recommendation}`);
    }
  }

  // No move may ever be an unproven claim, and families must not bleed.
  for (const m of p.moves) if (!m.evidence.length) fail(`move "${m.id}" has no evidence`);
  if (c.wantFamily === "formats" && (p.songs ?? []).length) fail("vlogger was given songs");
  if (c.wantFamily === "songs" && (p.hooks ?? []).length) fail("singer was given hook advice");

  // A singer's plan must actually name a song when the cohort knows one.
  if (c.wantFamily === "songs" && p.songs?.length) {
    console.log(`   songs: ${p.songs.slice(0, 3).map((s) => `${s.title} (${s.multiple}x)`).join(", ")}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall plan checks passed");
process.exit(failures ? 1 : 0);
