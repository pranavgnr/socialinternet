/**
 * Which niche should a new creator walk into?
 *
 * "Pick a niche you love" is advice, not analysis. The question a new creator
 * actually has is: *where can someone with no audience realistically break out,
 * soon, without being crushed by accounts that are already huge?* That is a
 * question the pull data can answer, if it is measured honestly.
 *
 * Five signals, and they deliberately disagree with each other — that
 * disagreement is the point. A room can be enormous and completely closed
 * (celebrity dance trends), or tiny and wide open (a regional cooking niche with
 * no consistent poster). Only the combination is actionable.
 *
 *   Demand      how big the audience is (niche median views)
 *   Headroom    how often *small* accounts are the ones breaking out
 *   Openness    how many different accounts get to win at all
 *   Freshness   whether winners are recent, or a graveyard of old hits
 *   Money       what a view is worth in that space
 *
 * Headroom carries the most weight because it is the only one that directly
 * answers "can I do this too". A niche where every breakout belongs to a 2M-
 * follower account is not an opportunity, however large its median.
 */
import { ambiguousWords } from "./nicheSeeds";
import type { NicheResearch } from "./niche";
import { median } from "./score";
import type { Platform, RawReel } from "./types";

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

/**
 * The follower count at which an account stops counting as a newcomer: 100k.
 *
 * This is a midpoint, not a threshold — the curve below is continuous, and
 * `SMALL_ENOUGH` is where "small" is judged for the share reported to the user.
 */
const MIDPOINT_FOLLOWERS = 100_000;

/**
 * A logistic on followers, 1 = brand new, 0.5 = at the midpoint, 0 = established.
 *
 * The first version of this was `1 - log10(f)/log10(500k)`, which scored a
 * 3,000-follower account at 0.39 — so a room full of 3k accounts breaking out
 * read as "closed". Log scaling alone is far too generous at the top end.
 *
 * A logistic fixes that: 1k -> 0.96, 10k -> 0.83, 100k -> 0.50, 1M -> 0.15.
 * The implication is that breaking out from 3k followers is real evidence and
 * breaking out from 3M followers is none, which is the claim the ranking rests
 * on.
 */
const SMALL_ENOUGH = 0.55;

function smallness(followers: number | undefined, accountMedian: number): number {
  if (followers && followers > 0) {
    return clamp(1 / (1 + Math.pow(followers / MIDPOINT_FOLLOWERS, 0.7)));
  }
  /**
   * Unknown followers: infer from the account's own typical views. ~1k views
   * reads as small, ~1M as established. Crude, but it errs toward caution
   * rather than flattering an account whose size we cannot see.
   */
  const v = Math.max(accountMedian, 1);
  return clamp(1 / (1 + Math.pow(v / 50_000, 0.8)));
}

export interface NicheSignals {
  query: string;
  /** every reel the pull returned, for breakout analysis */
  reels: RawReel[];
  /** accounts surfaced by the pull */
  accounts: NicheResearch["accounts"];
  /** the room's own median: what a typical reel there gets */
  nicheMedianViews: number;
}

export function signalsFrom(research: NicheResearch): NicheSignals {
  return {
    query: research.query,
    reels: research.payload ?? [],
    accounts: research.accounts,
    nicheMedianViews: research.nicheMedianViews,
  };
}

export interface Reason {
  label: string;
  /** the number behind the claim, already formatted */
  value: string;
  /** which way it pushes the verdict: + helps a newcomer, - hurts */
  direction: "up" | "down" | "flat";
}

export interface NicheOpportunity {
  query: string;
  /** 0..100 — the single number to sort by */
  score: number;
  /** one of a small set of plain verdicts, so the page has a spine */
  verdict: string;
  /** 0..1 components, kept so the UI can show the working */
  parts: {
    demand: number;
    headroom: number;
    openness: number;
    freshness: number;
    money: number;
    fit?: number;
  };
  /** what a typical reel in this room gets */
  medianViews: number;
  /** share of breakouts that came from newcomer-sized accounts */
  smallAccountShare: number;
  /** 0..1 — how much of the size judgement came from real follower counts */
  sizeEvidence: number;
  /** how many distinct accounts produced a breakout */
  distinctWinners: number;
  /** the single biggest account's share of all breakout views, 0..1 */
  topShare: number;
  /** how fresh the winning posts are, in days */
  medianAgeDays: number | null;
  /** honest "why" list, strongest first */
  reasons: Reason[];
  /** what to actually do here, grounded in what is working */
  angle: string;
  /** accounts worth studying, biggest median first */
  study: {
    handle: string;
    /** which network to link to, so "study this account" opens the right one */
    platform?: Platform;
    followers?: number;
    medianViews: number;
  }[];
  /** hashtags that recur on the winning posts */
  tags: { tag: string; count: number }[];
}

/**
 * What a view is worth, by space.
 *
 * Not a guess at RPM — it is a blunt ordering of how readily a creator in that
 * space converts attention into income (ads, affiliates, clients, brand deals).
 * Finance and B2B sell to people with money; comedy sells to everyone and
 * monetises almost none of them.
 */
const MONEY: { re: RegExp; w: number; why: string }[] = [
  { re: /\b(finance|invest|stock|crypto|money|wealth|trading|tax|loan|insurance)\b/, w: 1, why: "high-value audience — finance pays best per view" },
  { re: /\b(business|entrepreneur|startup|saas|marketing|sales|agency|freelanc)\w*/, w: 0.92, why: "B2B buyers, so attention converts to clients" },
  { re: /\b(tech|software|coding|developer|ai|automation|data|cloud)\b/, w: 0.85, why: "tech audience monetises through courses and tools" },
  { re: /\b(realestate|property|interior|architect)\w*/, w: 0.82, why: "high-ticket space, one lead is worth a lot" },
  { re: /\b(fitness|gym|health|nutrition|diet|weightloss|yoga)\b/, w: 0.75, why: "supplement and coaching offers are standard" },
  { re: /\b(beauty|makeup|skincare|hair|fashion|style|outfit)\w*/, w: 0.72, why: "brand-deal heavy, and affiliate-friendly" },
  { re: /\b(law|legal|doctor|medical|nursing|pharma)\b/, w: 0.7, why: "professional authority carries into paid work" },
  { re: /\b(education|teacher|study|exam|neet|jee|english|spoken|language)\b/, w: 0.68, why: "courses and tutoring convert steadily" },
  { re: /\b(food|cooking|recipe|baking|chef)\b/, w: 0.6, why: "sponsorships and local business tie-ins" },
  { re: /\b(travel|property|hotel)\b/, w: 0.58, why: "tourism boards and hotels pay for reach" },
  { re: /\b(gaming|esports|stream)\w*/, w: 0.5, why: "monetises late, mostly at scale" },
  { re: /\b(diy|craft|handmade|gardening|pets|dog|cat)\b/, w: 0.45, why: "small but loyal buyers, weak ad rates" },
  { re: /\b(comedy|funny|meme|entertainment|dance|trend)\w*/, w: 0.3, why: "huge reach, but the hardest space to sell in" },
  { re: /\b(music|singer|song|cover|lyrics)\b/, w: 0.3, why: "reach is easy, revenue is not" },
  { re: /\b(quote|motivation|mindset|spiritual|astrology)\b/, w: 0.35, why: "cheap attention, thin offers" },
];

function moneyOf(query: string): { w: number; why: string } {
  for (const m of MONEY) if (m.re.test(query.toLowerCase())) return m;
  return { w: 0.5, why: "an average-paying space" };
}

/** One breakout post, measured the same way everywhere. */
interface Breakout {
  reel: RawReel;
  /** how far past its account's own normal it went */
  ratio: number;
  /** 0..1 — how much this counts, by how big the breakout was */
  weight: number;
  small: number;
  /**
   * Whether `small` came from a real follower count or from a view-count guess.
   *
   * This is the difference between evidence and inference, and the ranking used
   * to score both as if they were the same. An Instagram search often returns no
   * follower count at all, so "74% of breakouts came from small accounts" could
   * be backed by zero actual follower numbers. Carrying the flag lets the score
   * say how much it knows instead of sounding equally certain either way.
   */
  sizeKnown: boolean;
}

/**
 * The reels worth learning from: those that beat their account's own median.
 *
 * Ratio, not raw views, is the gate. Otherwise the only "winners" in any room
 * are the accounts that were already large, and every niche looks closed to a
 * beginner — which is the exact failure this whole module exists to avoid.
 */
function breakouts(reels: RawReel[], nicheMedian: number): Breakout[] {
  const byAccount = new Map<string, number[]>();
  for (const r of reels) {
    if (!r.views) continue;
    const list = byAccount.get(r.account) ?? [];
    list.push(r.views);
    byAccount.set(r.account, list);
  }
  const baseline = new Map<string, number>();
  /** accounts with enough posts for their own median to mean something */
  const measured = new Set<string>();
  for (const [account, views] of byAccount) {
    if (views.length >= 3) measured.add(account);
    baseline.set(
      account,
      views.length >= 3
        ? median(views)
        : // Too few posts to judge the account on its own: fall back to the
          // room's median so a one-post account is not automatically an outlier.
          nicheMedian || median(views),
    );
  }

  /**
   * Is a "breakout" here actually a breakout?
   *
   * A ratio is evidence only when the thing it is compared against is the same
   * account's ordinary work. For an account with three or more posts that is
   * true. For an account we saw once, the comparison is against the *room*, and
   * a room comparison on a search page is circular: the video is in the sample
   * because the platform ranked it high, so it beats the room's median by
   * construction. Counting those made the biggest search hits look like organic
   * breakouts and dragged every headroom score toward whichever account YouTube
   * happened to rank first.
   *
   * So once at least three accounts have a real baseline, only measured
   * accounts can produce a breakout. Below that there is not enough information
   * to be strict, and being strict would score every room at zero — so the
   * looser reading is kept, and the caller is told the sample was thin.
   */
  const strict = measured.size >= 3;

  return reels
    .map((reel) => {
      const base = baseline.get(reel.account) || nicheMedian || 1;
      const providerRatio =
        reel.providerRatio && reel.providerRatio > 0 ? reel.providerRatio : null;
      const ratio = providerRatio ?? reel.views / Math.max(base, 1);
      return {
        reel,
        ratio,
        weight: clamp(Math.log10(Math.max(ratio, 1)) / Math.log10(20)),
        small: smallness(reel.followers, baseline.get(reel.account) ?? 0),
        sizeKnown: Boolean(reel.followers && reel.followers > 0),
        /** compared against its own history, not against the room */
        ownBaseline: Boolean(providerRatio) || measured.has(reel.account),
      };
    })
    .filter((b) => b.ratio >= 2 && b.reel.views >= 1_000)
    .filter((b) => (strict ? b.ownBaseline : true))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 40);
}

export interface ScoreOpts {
  /** words the creator said about themselves, if they gave any */
  interests?: string[];
}

export function scoreNiche(s: NicheSignals, opts: ScoreOpts = {}): NicheOpportunity {
  const reels = s.reels;
  const nicheMedian = s.nicheMedianViews || median(reels.map((r) => r.views)) || 0;

  /* ---- demand: how big is the room ---- */
  const demand = clamp((Math.log10(Math.max(nicheMedian, 1)) - 3) / 3);

  /* ---- breakouts, and who is having them ---- */
  /**
   * Who is breaking out is measured on rows the search did *not* pre-select.
   *
   * The room sample is deliberately two shelves merged: a recent one (who is
   * posting now) and a relevance one (how big the room is). Breakouts must not
   * be counted over both. A relevance page is ranked *by* performance, so its
   * rows beat their own channel's median by construction — including them made
   * 40 breakouts with a median age of 348 days, and every live room scored
   * "this room may have cooled". The recent shelf is unselected, so it is the
   * honest witness; channel history added by the cohort top-up is unselected
   * too, and stays in.
   *
   * Falls back to the full set only when the unbiased sample is too thin to
   * say anything, rather than silently reporting zero winners.
   */
  const unbiased = reels.filter((r) => r.sourceWindow !== "established");
  const bsUnbiased = breakouts(unbiased, nicheMedian);
  const bs = bsUnbiased.length >= 3 ? bsUnbiased : breakouts(reels, nicheMedian);
  const totalWeight = bs.reduce((a, b) => a + b.weight, 0) || 1;
  const rawHeadroom = bs.length
    ? bs.reduce((a, b) => a + b.weight * b.small, 0) / totalWeight
    : 0;

  /**
   * How much of the headroom figure rests on real follower counts, 0..1,
   * weighted by breakout size so a 20x outlier counts more than a 2x one.
   *
   * Measured, not assumed: Instagram search rows frequently carry no follower
   * count, in which case `smallness()` falls back to inferring size from the
   * account's view count. That inference is reasonable but it is not the same
   * claim, and a ranking that shouts "open to newcomers" on the strength of a
   * guess is worse than one that says it is not sure.
   */
  const sizeEvidence = bs.length
    ? bs.reduce((a, b) => a + b.weight * (b.sizeKnown ? 1 : 0), 0) / totalWeight
    : 0;

  /**
   * Headroom, shrunk toward the neutral 0.5 in proportion to what is missing.
   *
   * Full evidence leaves the number untouched. No evidence compresses it into
   * roughly 0.35–0.65, so the verdict can still favour a room whose winners look
   * small, but it cannot reach the extremes on inference alone. This is why the
   * YouTube path scores more confidently than the Instagram path on the same
   * room: it returns a subscriber count on every row, so it actually knows.
   */
  const headroom = 0.5 + (rawHeadroom - 0.5) * (0.3 + 0.7 * sizeEvidence);

  /* ---- openness: how many accounts get to win ---- */
  const winners = new Map<string, number>();
  for (const b of bs) {
    winners.set(b.reel.account, (winners.get(b.reel.account) ?? 0) + b.weight);
  }
  const distinctWinners = winners.size;
  const topShare = distinctWinners
    ? Math.max(...winners.values()) / totalWeight
    : 1;
  /**
   * Two effects, both real: a room where only one account ever breaks out is a
   * monopoly (topShare -> 1), and a room with two winners in total is too thin
   * to learn from. Saturing count at 8 keeps a 40-winner room from scoring the
   * same as an 8-winner one — past that, breadth stops telling you anything.
   */
  const breadth = clamp(distinctWinners / 8);
  const openness = clamp(0.6 * (1 - topShare) + 0.4 * breadth);

  /* ---- freshness ---- */
  const now = Date.now();
  const ages = bs
    .map((b) => (now - Date.parse(b.reel.postedAt)) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  /**
   * A median age is only reported when enough of the breakouts are actually
   * dated. One dated post out of thirty is not a trend, and reporting
   * "2d median age" off that single row is the same overclaim as inventing the
   * dates outright. Requiring a third of the sample (and at least three posts)
   * keeps the number meaningful; below that the signal is honestly unknown.
   */
  const datedShare = bs.length ? ages.length / bs.length : 0;
  const enoughDates =
    ages.length >= 3 && datedShare >= 0.34;
  const medianAgeDays = enoughDates ? median(ages) : null;
  const freshness =
    medianAgeDays === null ? 0.4 : Math.exp(-medianAgeDays / 45);

  /* ---- money ---- */
  const money = moneyOf(s.query);

  /* ---- fit: does this match what they said about themselves ---- */
  let fit: number | undefined;
  if (opts.interests?.length) {
    /**
     * Words shared between two spaces are dropped before the overlap is counted.
     *
     * Fit is a multiplier on the final score, so a false match does not just add
     * a point — it distorts the ranking. "home" is in both the fitness and the
     * interiors vocabulary; left in, a creator who wrote "home cooking" scored a
     * perfect fit for "home workout", and the room they named lost to a gym.
     */
    const ambiguous = ambiguousWords();
    const said = new Set(
      (opts.interests.join(" ").toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
        (w) => !ambiguous.has(w),
      ),
    );
    const room = new Set(
      `${s.query} ${reels
        .flatMap((r) => [r.caption, ...(r.hashtags ?? [])])
        .join(" ")
        .toLowerCase()}`
        .match(/[a-z]{3,}/g) ?? [],
    );
    let hits = 0;
    for (const w of said) if (room.has(w)) hits += 1;
    /**
     * Two overlapping words is a real match, not one sixth of one. The interest
     * vocabulary is a list of *synonyms* ("money", "finance", "invest",
     * "salary"), and a room only ever uses one or two of them — dividing by the
     * whole list made every genuine match score as a third of a fit.
     */
    /**
     * Zero overlap is reported as *unknown*, not as zero.
     *
     * The rooms are often derived from the same sentence the words came from —
     * "home cooking for busy people" produced "meal prep for work". No caption
     * in that room contains the word "busy", so a lexical overlap of zero says
     * nothing about whether the room suits the person; it says the two used
     * different words for the same idea. Scoring that as 0 applied a blanket
     * 30% penalty to every paraphrase and, because it hit every candidate
     * equally, decided nothing while looking like a considered judgement.
     * Neutral is the honest reading, and it lets headroom and openness — the
     * signals that actually separate the rooms — do the ranking.
     */
    fit = said.size ? (hits > 0 ? clamp(hits / 2) : undefined) : 0;
  }

  /**
   * Weights. Headroom leads because "small accounts win here" is the only
   * claim that transfers to a creator with no audience. Fit, when the creator
   * gave us words, is not an additive term but a multiplier just below — a
   * space that pays nothing and fits you is still worth less than one that
   * pays and fits.
   */
  const base =
    0.30 * headroom +
    0.28 * demand +
    0.16 * openness +
    0.10 * freshness +
    0.16 * money.w;

  /**
   * Fit runs both ways: a poor fit costs up to 30%, a perfect one earns 15%.
   *
   * It used to run one way only — `0.7 + 0.3 * fit` reaches 1.0 at a perfect
   * fit, so the best possible match scored exactly the same as no information
   * at all. The effect was that someone who said "I'm a chartered accountant"
   * could be shown a gym: the finance room matched every word they wrote and got
   * no credit for it, then lost on headroom to a room about nothing they knew.
   * `scripts/check-opportunity.ts` caught it as "interests shift the score when
   * they fit — 65 > 77".
   *
   * The band is deliberate. A single shared word is a real match here, not a
   * fraction of one: the interest vocabulary is a list of *synonyms*
   * ("money", "finance", "invest", "salary") and a room only ever uses one or
   * two of them, so "personal finance" scoring 0.5 fit off the word "finance"
   * was being treated as *worse than saying nothing* — the exact inversion that
   * kept a finance room below a gym for a finance creator.
   *
   * So a match earns 5-20%, an unknown fit stays neutral, and the room's own
   * economics still lead. Fit settles rooms that are close; it does not beat a
   * room that pays.
   */
  const withFit = fit === undefined ? base : base * (0.9 + 0.3 * fit);
  const score = Math.round(clamp(withFit) * 100);

  /* ---- the honest why ---- */
  const smallAccountShare = bs.length
    ? bs.filter((b) => b.small >= SMALL_ENOUGH).length / bs.length
    : 0;

  const reasons: Reason[] = [];

  if (bs.length) {
    reasons.push({
      label:
        smallAccountShare >= 0.5
          ? "small accounts are the ones breaking out"
          : "breakouts come mostly from established accounts",
      value: `${Math.round(smallAccountShare * 100)}% of ${bs.length} breakouts`,
      direction: smallAccountShare >= 0.5 ? "up" : "down",
    });

    /**
     * State the basis of the size claim, not just the claim. Below half, the
     * number is mostly inference and the reader deserves to know before they
     * plan their next month around it.
     */
    if (sizeEvidence < 0.5) {
      reasons.push({
        label:
          sizeEvidence < 0.15
            ? "account sizes are estimated from view counts — no follower data came back"
            : "account sizes are only partly measured",
        value: `${Math.round(sizeEvidence * 100)}% of breakouts sized from follower counts`,
        direction: "flat",
      });
    }
  } else {
    reasons.push({
      label: "no clear breakouts in this pull — nothing to imitate yet",
      value: "0 winners",
      direction: "down",
    });
  }

  if (distinctWinners) {
    reasons.push({
      label:
        distinctWinners >= 5
          ? "several different accounts get to win"
          : "the same account wins repeatedly",
      value: `${distinctWinners} distinct · top holds ${Math.round(topShare * 100)}%`,
      direction: distinctWinners >= 5 && topShare < 0.5 ? "up" : "down",
    });
  }

  reasons.push({
    label: "a typical reel here gets",
    value: `${Math.round(nicheMedian).toLocaleString()} views`,
    direction: demand >= 0.5 ? "up" : "down",
  });

  if (medianAgeDays !== null) {
    reasons.push({
      label:
        medianAgeDays <= 30
          ? "the winning posts are recent"
          : "the winning posts are old — this room may have cooled",
      value: `${Math.round(medianAgeDays)}d median age`,
      direction: medianAgeDays <= 30 ? "up" : "down",
    });
  } else if (bs.length) {
    /**
     * Say the gap out loud. The old behaviour either invented a date or dropped
     * the row, and both hid the fact that this room's recency is unproven —
     * which is exactly the thing a creator would want to know before trusting
     * the rest of the page.
     */
    reasons.push({
      label:
        datedShare > 0
          ? "too few winning posts carry a date to judge recency"
          : "this source publishes no post dates — recency is not measured here",
      value: `${ages.length} of ${bs.length} breakouts dated`,
      direction: "flat",
    });
  }

  reasons.push({
    label: money.why,
    value: `monetisation ${Math.round(money.w * 100)}/100`,
    direction: money.w >= 0.6 ? "up" : money.w <= 0.4 ? "down" : "flat",
  });

  if (fit !== undefined) {
    reasons.push({
      label:
        fit >= 0.5
          ? "matches what you said you know"
          : "weak overlap with what you said you know",
      value: `${Math.round(fit * 100)}% word overlap`,
      direction: fit >= 0.5 ? "up" : "down",
    });
  }

  /* ---- the angle: what to actually post, from what won ---- */
  const angle = entryAngle(bs, s.query);

  /* ---- who to study, and what tags to use ---- */
  const study = [...s.accounts]
    .sort((a, b) => b.medianViews - a.medianViews)
    .slice(0, 5)
    .map((a) => ({
      handle: a.handle,
      platform: a.platform,
      followers: a.followers,
      medianViews: a.medianViews,
    }));

  const tagCount = new Map<string, number>();
  for (const b of bs) {
    for (const t of b.reel.hashtags ?? []) {
      const tag = t.replace(/^#+/, "").toLowerCase();
      if (tag.length > 2) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
  }
  const tags = [...tagCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    query: s.query,
    score,
    verdict: verdictFor({ headroom, demand, openness, winners: bs.length }),
    parts: {
      demand,
      headroom,
      openness,
      freshness,
      money: money.w,
      ...(fit === undefined ? {} : { fit }),
    },
    medianViews: Math.round(nicheMedian),
    smallAccountShare,
    sizeEvidence,
    distinctWinners,
    topShare,
    medianAgeDays,
    reasons,
    angle,
    study,
    tags,
  };
}

/**
 * The short verdict. Deliberately not a percentage restated: a creator needs to
 * know *which kind* of room this is, because "72" tells them nothing about
 * whether to run or to specialise.
 */
function verdictFor(p: {
  headroom: number;
  demand: number;
  openness: number;
  winners: number;
}): string {
  /**
   * No winners at all is its own verdict, and it must come first: the openness
   * maths divides by a winner count, so an empty room otherwise reads as a
   * one-account monopoly — a completely different (and wrong) diagnosis.
   */
  if (p.winners === 0) return "Too quiet — no winning posts to learn from";
  if (p.headroom >= 0.55 && p.demand >= 0.45) return "Open and worth entering";
  if (p.headroom >= 0.55) return "Small room, easy to lead";
  if (p.demand >= 0.6 && p.headroom < 0.3) return "Big but closed — needs a narrow angle";
  if (p.openness < 0.3) return "Monopolised — hard to break in";
  if (p.demand < 0.3) return "Thin audience — cheap to test, small ceiling";
  return "Middling — winnable with a clear angle";
}

/**
 * What to post, inferred from the breakouts rather than from a template.
 *
 * A 9-second sound-led reel is a different job from a 60-second explainer, and
 * the room decides which one it rewards. Reading that off the winners is the
 * difference between advice and a horoscope.
 */
function entryAngle(bs: Breakout[], query: string): string {
  if (!bs.length) {
    return `Nothing is reliably breaking out in ${query}, so there is no pattern to copy. Either post into it and become the pattern, or pick a room with visible winners.`;
  }
  const durations = bs
    .map((b) => b.reel.durationSec)
    .filter((d): d is number => Boolean(d) && d! > 0);
  const mid = durations.length ? median(durations) : null;
  const withSound = bs.filter((b) => b.reel.audioName).length / bs.length;
  const top = bs[0];

  const length =
    mid === null
      ? "length is not measurable from this pull"
      : mid <= 15
        ? `short (median ${Math.round(mid)}s) — the payoff has to land almost immediately`
        : mid <= 40
          ? `mid-length (median ${Math.round(mid)}s) — one idea, set up and paid off inside the clip`
          : `long (median ${Math.round(mid)}s) — this room rewards a story or a full explanation`;

  const sound =
    withSound >= 0.6
      ? "most winners ride an existing sound, so the audio is part of the format"
      : "winners mostly run original audio, so the words carry the post";

  return `The clip that broke out most got ${top.reel.views.toLocaleString()} views (${top.ratio.toFixed(1)}x its account's normal). Winning posts here are ${length}; ${sound}. Start from that shape rather than inventing a new one.`;
}

/** Sort by score, best first. */
export function rankNiches(list: NicheOpportunity[]): NicheOpportunity[] {
  return [...list].sort((a, b) => b.score - a.score);
}
