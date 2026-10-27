/**
 * Proves the opportunity engine ranks rooms the way its docblock claims.
 *
 * Synthetic rooms with known answers, because the point of a scoring function
 * is that it can be checked without spending a credit. If these assertions
 * fail, the ranking is wrong no matter how good the live data is.
 *
 * Run: npx tsx scripts/check-opportunity.ts
 */
import { rankNiches, scoreNiche, type NicheSignals } from "../lib/opportunity";
import type { RawReel } from "../lib/types";

let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    console.log(`  ok   ${name} — ${detail}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name} — ${detail}`);
  }
}

function reel(
  account: string,
  views: number,
  opts: { followers?: number; days?: number; duration?: number; tags?: string[] } = {},
): RawReel {
  return {
    id: `${account}_${views}`,
    platform: "instagram",
    account,
    followers: opts.followers,
    url: `https://instagram.com/reel/${account}${views}`,
    caption: `${account} post`,
    postedAt: new Date(Date.now() - (opts.days ?? 10) * 86_400_000).toISOString(),
    views,
    likes: Math.round(views * 0.05),
    comments: Math.round(views * 0.004),
    durationSec: opts.duration,
    hashtags: opts.tags,
  };
}

/** A room of small accounts each beating their own normal by a wide margin. */
function openRoom(): NicheSignals {
  const reels: RawReel[] = [];
  for (let i = 0; i < 6; i += 1) {
    const who = `small${i}`;
    // own normal ~2k, one breakout ~40k -> 20x
    reels.push(reel(who, 2_000, { followers: 3_000, days: 40, duration: 12 }));
    reels.push(reel(who, 2_100, { followers: 3_000, days: 35, duration: 13 }));
    reels.push(reel(who, 1_900, { followers: 3_000, days: 30, duration: 11 }));
    reels.push(reel(who, 40_000, { followers: 3_000, days: 6, duration: 12, tags: ["howto"] }));
  }
  return {
    query: "home workout",
    reels,
    accounts: [],
    nicheMedianViews: 3_000,
  };
}

/** A room where one enormous account takes everything. */
function closedRoom(): NicheSignals {
  const reels: RawReel[] = [];
  // the giant: own normal 500k, breakout 4M
  for (let i = 0; i < 4; i += 1) {
    reels.push(reel("giant", 500_000, { followers: 3_000_000, days: 5, duration: 9 }));
  }
  reels.push(reel("giant", 4_000_000, { followers: 3_000_000, days: 3, duration: 9 }));
  // everyone else posts and goes nowhere
  for (let i = 0; i < 8; i += 1) {
    reels.push(reel(`nobody${i}`, 1_200, { followers: 2_000, days: 20, duration: 10 }));
  }
  return {
    query: "celebrity dance",
    reels,
    accounts: [],
    nicheMedianViews: 300_000,
  };
}

/** A dead room: nothing breaks out at all. */
function deadRoom(): NicheSignals {
  const reels = Array.from({ length: 12 }, (_, i) =>
    reel(`quiet${i}`, 300 + i, { followers: 800, days: 90, duration: 20 }),
  );
  return { query: "niche hobby", reels, accounts: [], nicheMedianViews: 300 };
}

/** A big room that small accounts still win in. */
function bigOpenRoom(): NicheSignals {
  const reels: RawReel[] = [];
  for (let i = 0; i < 7; i += 1) {
    const who = `mid${i}`;
    const followers = 8_000 + i * 2_000;
    reels.push(reel(who, 15_000, { followers, days: 25, duration: 25 }));
    reels.push(reel(who, 16_000, { followers, days: 20, duration: 25 }));
    reels.push(reel(who, 14_000, { followers, days: 18, duration: 25 }));
    reels.push(reel(who, 250_000, { followers, days: 4, duration: 25 }));
  }
  return {
    query: "personal finance",
    reels,
    accounts: [],
    nicheMedianViews: 30_000,
  };
}

console.log("\nOpportunity engine\n");

const open = scoreNiche(openRoom());
const closed = scoreNiche(closedRoom());
const dead = scoreNiche(deadRoom());
const bigOpen = scoreNiche(bigOpenRoom());

check(
  "open room has high headroom",
  open.parts.headroom > 0.8,
  `headroom ${open.parts.headroom.toFixed(2)}`,
);
check(
  "open room scores well",
  open.score >= 55,
  `score ${open.score} (${open.verdict})`,
);
check(
  "open room verdict invites entry",
  /Open|easy to lead/.test(open.verdict),
  open.verdict,
);

check(
  "closed room has low headroom",
  closed.parts.headroom < 0.25,
  `headroom ${closed.parts.headroom.toFixed(2)}`,
);
check(
  "closed room is not recommended",
  closed.score < open.score,
  `${closed.score} < ${open.score}`,
);
check(
  "closed room verdict warns",
  /closed|Monopolised/.test(closed.verdict),
  closed.verdict,
);

check(
  "dead room scores low",
  dead.score < 40,
  `score ${dead.score} (${dead.verdict})`,
);
check(
  "dead room says there is nothing to copy",
  /no pattern to copy|post into it/.test(dead.angle),
  dead.angle.slice(0, 60),
);

check(
  "big open room beats closed room",
  bigOpen.score > closed.score,
  `${bigOpen.score} > ${closed.score}`,
);
check(
  "big open room has strong demand",
  bigOpen.parts.demand > open.parts.demand,
  `demand ${bigOpen.parts.demand.toFixed(2)} vs ${open.parts.demand.toFixed(2)}`,
);

/**
 * The whole reason this module exists: a large audience must not beat a room a
 * newcomer can actually win in, when the newcomer is the one being advised.
 */
check(
  "open-and-small outranks big-but-closed",
  rankNiches([closed, open])[0].query === "home workout",
  `${rankNiches([closed, open])[0].query} first`,
);

check(
  "money weighting separates finance from comedy",
  scoreNiche(bigOpenRoom()).parts.money >
    scoreNiche(closedRoom()).parts.money,
  `finance ${scoreNiche(bigOpenRoom()).parts.money} > dance ${scoreNiche(closedRoom()).parts.money}`,
);

check(
  "interests shift the score when they fit",
  scoreNiche(bigOpenRoom(), { interests: ["money", "finance", "invest"] }).score >
    scoreNiche(bigOpenRoom(), { interests: ["gym", "training", "muscle"] }).score,
  `${scoreNiche(bigOpenRoom(), { interests: ["money", "finance", "invest"] }).score} > ${scoreNiche(bigOpenRoom(), { interests: ["gym", "training", "muscle"] }).score}`,
);

check(
  "a breakout carries a ratio and a reason",
  open.reasons.some((r) => /break(out|ing out)/i.test(r.label)),
  open.reasons.map((r) => r.value).join(" | "),
);

console.log(
  `\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
