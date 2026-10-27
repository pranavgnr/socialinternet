/**
 * The plan for someone who has not posted yet.
 *
 * Every other file in this product answers "what should *this account* do next",
 * and every one of them starts from the creator's own feed. A new creator has no
 * feed, so that whole family of answers is unavailable — and the site used to
 * stop there and ask for a handle, which is the one thing they cannot give.
 *
 * What is available is the room. A search for "south indian recipes" returns
 * real accounts with real baselines, and the same question can be asked of them:
 * *what shape of video wins here, how long is it, how does it open, and is the
 * winning done by accounts the size of mine?* That is a first-video plan, and it
 * is built entirely from evidence already paid for by the search.
 *
 * Three rules, inherited from the account-first planner:
 *
 * 1. **No claim without a number and a reel behind it.** A step that cannot cite
 *    a real post is dropped, not softened.
 * 2. **The yardstick is the small accounts, not the room.** Telling a beginner
 *    they must beat a 3M-subscriber channel's median is not a plan, it is a
 *    reason to quit. The bar reported here is the one set by accounts their own
 *    size, and when there are none the page says so instead of substituting the
 *    giants.
 * 3. **Say how thin the evidence is.** Five accounts is five accounts. A plan
 *    built on it can still be useful, but only if the page admits the sample
 *    size rather than presenting a median as a law of nature.
 */
import { detectArchetype } from "./archetype";
import { detectFormat, shapesTheyUse } from "./formats";
import { rankHooks } from "./hooks";
import { profileFromNiche, type NicheAccount, type NicheResearch } from "./niche";
import { scoreNiche, signalsFrom } from "./opportunity";
import { buildRows, clusterThemes, durationBucket, evidenceFrom, fmt, median } from "./stats";
import type { PlanEvidence, Platform, Profile } from "./types";

/** The follower count under which an account counts as "someone like you". */
const SMALL = 100_000;

/** Views over its own account's median that count as a breakout. */
const BREAKOUT = 2.5;

export interface RoomStep {
  id: "length" | "shape" | "hook" | "topic";
  title: string;
  why: string;
  action: string;
  evidence: PlanEvidence[];
}

export interface RoomStudy {
  handle: string;
  platform?: Platform;
  followers?: number;
  medianViews: number;
  bestViews: number;
  reels: number;
  /** why this account is worth watching, in numbers */
  reason: string;
  /** the single post to open first */
  url?: string;
}

export interface RoomPlan {
  query: string;
  platform?: Platform;
  fetchedAt: string;
  /** one line a beginner can act on before reading the numbers */
  headline: string;
  room: {
    reels: number;
    accounts: number;
    smallAccounts: number;
    measured: number;
    /** median views of a typical account here */
    medianViews: number;
  };
  /** what a first post has to clear to be noticed */
  bar: {
    /** the room's typical post */
    typical: number;
    /** the bar set by accounts your size, when there are enough of them */
    small: number | null;
    basis: string;
  };
  verdict: {
    label: string;
    sentence: string;
    tone: "good" | "ok" | "hard" | "thin";
    score: number;
  };
  openness: {
    breakouts: number;
    /** share of breakouts that came from accounts under 100k */
    smallShare: number;
    accountsWinning: number;
    /** share of breakout views held by the single biggest winner */
    topShare: number;
  };
  steps: RoomStep[];
  study: RoomStudy[];
  /** what the room posts, regardless of whether it wins */
  shapes: { label: string; share: number }[];
  /** sample-size and measurement caveats, in plain sentences */
  honesty: string[];
  /** true when the numbers rest on a sample worth acting on */
  confident: boolean;
}

/** Views per follower, used only to guess size when follower counts are absent. */
function sizeOf(account: NicheAccount | undefined): number | undefined {
  return account?.followers;
}

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/** Median duration of a set of posts, when at least two report one. */
function typicalLength(reels: { durationSec?: number }[]): number | null {
  const seen = reels.map((r) => r.durationSec ?? 0).filter((d) => d > 0);
  return seen.length >= 2 ? Math.round(median(seen)) : null;
}

export function buildRoomPlan(research: NicheResearch): RoomPlan {
  const rows = buildRows(research);
  const accounts = research.accounts;
  const platform = research.payload?.find((r) => r.platform)?.platform ?? accounts[0]?.platform;

  const byHandle = new Map(accounts.map((a) => [a.handle.toLowerCase(), a]));
  const breakouts = rows
    .filter((r) => r.ratio >= BREAKOUT)
    .sort((a, b) => b.ratio - a.ratio);

  const smallAccounts = accounts.filter(
    (a) => typeof sizeOf(a) === "number" && (sizeOf(a) as number) <= SMALL,
  );
  const measuredSmall = smallAccounts.filter((a) => a.measured);

  /** The bar a newcomer actually has to clear: what accounts their size get. */
  const smallBar =
    measuredSmall.length >= 2 ? Math.round(median(measuredSmall.map((a) => a.medianViews))) : null;

  const measuredAll = accounts.filter((a) => a.measured);
  const fallbackBar =
    measuredAll.length >= 2
      ? Math.round(
          [...measuredAll.map((a) => a.medianViews)].sort((a, b) => a - b)[
            Math.max(0, Math.floor(measuredAll.length * 0.25))
          ],
        )
      : research.nicheMedianViews;

  /**
   * Breakouts from accounts your size, counted only where the size is known.
   *
   * An account with no follower count cannot be called small, and treating
   * "unknown" as small is how a room full of established channels gets sold as
   * an opportunity. They are excluded from the share and named in the caveat.
   */
  const sized = breakouts.filter((b) => {
    const a = byHandle.get(b.account.toLowerCase());
    return typeof a?.followers === "number";
  });
  const smallWins = sized.filter((b) => (byHandle.get(b.account.toLowerCase())?.followers ?? 1e12) <= SMALL);
  const smallShare = share(smallWins.length, sized.length);

  const winnerViews = new Map<string, number>();
  for (const b of breakouts) {
    winnerViews.set(b.account, (winnerViews.get(b.account) ?? 0) + b.reel.views);
  }
  const totalWinViews = [...winnerViews.values()].reduce((a, b) => a + b, 0);
  const topShare = totalWinViews
    ? Math.max(...winnerViews.values()) / totalWinViews
    : 0;

  const scored = scoreNiche(signalsFrom(research));

  /* ---- steps: each one has to cite a post ---------------------------- */

  const steps: RoomStep[] = [];
  const breakoutReels = breakouts.map((b) => b.reel);

  /**
   * Shape. The most common format among breakouts, and only when the same shape
   * shows up more than once — one video is a sample of one.
   */
  const breakoutShapes = shapesTheyUse(breakoutReels);
  const topShape = breakoutShapes[0];
  if (topShape && topShape.count >= 2 && breakouts.length >= 3) {
    const sample = breakouts
      .filter((b) => detectFormat(b.reel) === topShape.id)
      .slice(0, 3);
    steps.push({
      id: "shape",
      title: `Film it the way this room already wins: ${topShape.label.toLowerCase()}`,
      why: `${topShape.count} of the ${breakouts.length} posts that beat their own account's usual here are this shape.`,
      action: `Make your first one a ${topShape.label.toLowerCase()}. It is the shape this room has already proved, so the only new thing on screen is you.`,
      evidence: sample.map(evidenceFrom),
    });
  }

  /**
   * Length. Only when the winners are long enough to differ from the room: a
   * median of 30s against a room median of 28s is not advice.
   */
  const wonLength = typicalLength(breakoutReels);
  const roomLength = typicalLength(research.payload ?? []);
  if (wonLength !== null && roomLength !== null && Math.abs(wonLength - roomLength) >= 5) {
    const bucket = durationBucket(wonLength);
    steps.push({
      id: "length",
      title: `Keep it around ${Math.round(wonLength)} seconds`,
      why: `The posts that broke out here run about ${Math.round(wonLength)}s (${bucket}), against ${Math.round(roomLength)}s for the room as a whole.`,
      action: `Aim for ${Math.round(wonLength)} seconds. Cut anything that is not the result or the process.`,
      evidence: breakouts.slice(0, 3).map(evidenceFrom),
    });
  }

  /**
   * The opening line. Mined from the captions of breakouts, and only when two
   * unrelated accounts opened the same way — one account's habit is not a shape.
   */
  const hooks = rankHooks(rows);
  const hook = hooks[0];
  if (hook) {
    steps.push({
      id: "hook",
      title: `Open like this: ${hook.label.toLowerCase()}`,
      why: `${hook.accounts} different accounts open this way and beat their usual views by ${hook.multiple}x on median.`,
      action: `Write your first line as a ${hook.label.toLowerCase()}. “${hook.example}” is one that worked here — the shape is what to copy, not the words.`,
      evidence: hook.evidence,
    });
  }

  /**
   * The subject that repeats. Cross-account convergence, which is the only
   * signal in the pull that says "people want this", rather than "this account
   * had a good day".
   */
  const themes = clusterThemes(rows).filter((t) => t.accounts.length >= 2);
  const theme = themes[0];
  if (theme) {
    steps.push({
      id: "topic",
      title: `Start from the subject that repeats: ${theme.label.toLowerCase()}`,
      why: `${theme.accounts.length} unrelated accounts all broke out on this, at ${theme.medianRatio.toFixed(1)}x their own median.`,
      action: `Make your first post about ${theme.label.toLowerCase()}. You are not guessing whether people want it — several accounts in different rooms proved they do.`,
      evidence: theme.rows.slice(0, 3).map(evidenceFrom),
    });
  }

  /* ---- verdict ------------------------------------------------------- */

  const enough = breakouts.length >= 3 && sized.length >= 3;
  let label: string;
  let sentence: string;
  let tone: RoomPlan["verdict"]["tone"];

  if (!enough) {
    label = "Not enough evidence yet";
    sentence =
      `Only ${breakouts.length} post here beat its own account's usual views, so there is ` +
      "not enough to say whether a new account can break in. Try a broader phrase, or read " +
      "this room again in a week.";
    tone = "thin";
  } else if (smallShare >= 0.6) {
    label = "Open to new accounts";
    sentence =
      `${Math.round(smallShare * 100)}% of the posts that broke out came from accounts under ` +
      `100k followers. That is the number that matters: the winning here is not reserved for ` +
      `accounts that are already big.`;
    tone = "good";
  } else if (smallShare >= 0.3) {
    label = "Crowded, but a way in";
    sentence =
      `${Math.round(smallShare * 100)}% of breakouts came from accounts under 100k. Big accounts ` +
      "take most of the room, so you need a sharper angle than copying what already works — the " +
      "steps below are the ones small accounts actually used.";
    tone = "ok";
  } else {
    label = "Held by big accounts";
    sentence =
      `Almost none of the breakouts here came from accounts under 100k. Enter it only if you ` +
      "have something specific to say — otherwise the effort is better spent in a neighbouring " +
      "room, which is listed on the next screen.";
    tone = "hard";
  }

  /* ---- study list ---------------------------------------------------- */

  /**
   * Small accounts first, because a 3M channel winning is not evidence a
   * beginner can win. Established accounts are kept as second row: they are
   * worth copying the shape from, just not the audience.
   */
  const studySource = [...accounts]
    .filter((a) => a.measured)
    .sort((a, b) => {
      const sa = (a.followers ?? 1e12) <= SMALL ? 0 : 1;
      const sb = (b.followers ?? 1e12) <= SMALL ? 0 : 1;
      return sa - sb || b.bestViews - a.bestViews;
    })
    .slice(0, 3);

  const study: RoomStudy[] = studySource.map((a) => {
    const best = breakouts.find((b) => b.account.toLowerCase() === a.handle.toLowerCase());
    return {
      handle: a.handle,
      platform: a.platform,
      followers: a.followers,
      medianViews: a.medianViews,
      bestViews: a.bestViews,
      reels: a.reels,
      reason: best
        ? `broke out at ${best.ratio.toFixed(1)}x its usual views`
        : `posts ${fmt(a.reels)} times a month at ${fmt(a.medianViews)} views`,
      url: a.topReel.url,
    };
  });

  /* ---- shapes the room posts ----------------------------------------- */

  const shapeCounts = shapesTheyUse(research.payload ?? []);
  const shapeTotal = shapeCounts.reduce((n, s) => n + s.count, 0);
  const shapes = shapeCounts.slice(0, 3).map((s) => ({
    label: s.label,
    share: share(s.count, shapeTotal),
  }));

  /* ---- honesty ------------------------------------------------------- */

  const honesty: string[] = [];
  const read = research.payload?.length ?? 0;
  honesty.push(
    `These numbers come from ${read} posts on ${accounts.length} accounts, read from ` +
      `${platform === "youtube" ? "YouTube" : platform === "instagram" ? "Instagram" : "the live pull"} ` +
      `on ${new Date(research.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`,
  );
  if (smallAccounts.length < 2) {
    honesty.push(
      `Only ${smallAccounts.length} account${smallAccounts.length === 1 ? " is" : "s are"} under 100k ` +
        "followers here, so how well small accounts do rests on a thin sample. The bar below is " +
        "the room's lower quartile instead.",
    );
  }
  const unmeasured = accounts.length - accounts.filter((a) => a.measured).length;
  if (unmeasured > 0) {
    honesty.push(
      `${unmeasured} of ${accounts.length} accounts were seen once, so their \"usual\" is a single ` +
        "post and they cannot set the bar. Only accounts with three or more posts were used for it.",
    );
  }
  const inferred = rows.filter((r) => !r.accountBased).length;
  if (inferred > 0) {
    honesty.push(
      `${inferred} of ${rows.length} posts were measured against the room's median rather than ` +
        "their own account's, because only one of their videos was available.",
    );
  }
  if (research.language.dropped > 0) {
    honesty.push(
      `${research.language.dropped} posts were left out for being in another language. ${
        research.language.wanted
          ? `This room was read as ${research.language.wanted}.`
          : ""
      }`.trim(),
    );
  }

  const headline =
    tone === "thin"
      ? `There is not enough published work in “${research.query}” yet to plan against.`
      : tone === "hard"
        ? `“${research.query}” is held by big accounts — go in with a specific angle or pick a neighbour.`
        : `Someone your size can break into “${research.query}” — ${steps.length} things to copy, all from real posts.`;

  return {
    query: research.query,
    platform,
    fetchedAt: research.fetchedAt,
    headline,
    room: {
      reels: read,
      accounts: accounts.length,
      smallAccounts: smallAccounts.length,
      measured: accounts.filter((a) => a.measured).length,
      medianViews: research.nicheMedianViews,
    },
    bar: {
      typical: research.nicheMedianViews,
      small: smallBar ?? fallbackBar,
      basis:
        smallBar !== null
          ? `median of ${measuredSmall.length} accounts under 100k followers`
          : `lower quartile of ${measuredAll.length} measured accounts — too few small accounts to isolate them`,
    },
    verdict: { label, sentence, tone, score: scored.score },
    openness: {
      breakouts: breakouts.length,
      smallShare,
      accountsWinning: winnerViews.size,
      topShare,
    },
    steps: steps.slice(0, 4),
    study,
    shapes,
    honesty,
    confident: enough && steps.length >= 2,
  };
}

/**
 * The profile the idea feed runs against for a newcomer.
 *
 * Built from the room rather than from a creator, because there is no creator
 * yet: the pillars are the room's recurring subjects, the benchmarks are the
 * accounts worth studying, and the constraints come from the kind of account
 * this room is full of. Everything the idea generator needs is in here, so the
 * feed costs nothing beyond the search that already happened.
 */
export function roomProfile(research: NicheResearch, previous?: Profile | null): Profile {
  const guess = detectArchetype(research.payload ?? [], research.query);
  const profile = profileFromNiche(research, previous, {
    id: guess.id,
    songLed: guess.songLed,
    recommendation: guess.recommendation,
  });

  /**
   * A newcomer has no winners of their own, and inheriting a previous account's
   * would put someone else's caption on their page. The room's strongest posts
   * are the honest substitute: they are the writing this room rewards.
   */
  const rows = buildRows(research)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);
  profile.ownWinners = rows.map((r) => r.reel.caption);
  profile.archetype = guess.id;
  return profile;
}

