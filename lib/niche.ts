import { promises as fs } from "node:fs";
import path from "node:path";

import {
  checkBalance,
  creditLedger,
  harvestAccountReels,
  harvestInstagramAccount,
  harvestInstagramSearch,
  resetCreditLedger,
} from "./harvest";
import {
  accountProfile,
  commentsLanguage,
  explicitLanguage,
  inLanguage,
  isSuspect,
  roomLanguage,
} from "./lang";
import { platformOn } from "./platform";
import { availableProviders, readiness } from "./providers";
import { keepOnSubject } from "./subject";
import { isStopword } from "./text";
import { watchToVerify, type WatchStats } from "./verifyLang";
import type { AccountLangProfile } from "./lang";
import type { Platform, Profile, RawReel, Recommendation } from "./types";

/**
 * What a niche pull buys:
 *   1 credit — /instagram/search/reels for the query (~30 reels, many accounts)
 *   1 credit per cohort account — /instagram/profile/reels, for its baseline
 *
 * The search on its own is not enough, and the reason is structural: it returns
 * ONE reel per account. One reel is its own median, so every ratio is exactly
 * 1.0, nothing counts as an outlier, and a singer is handed a plan with no song
 * in it — the one question she actually has. The same pull also returns no
 * follower counts, so size-matching never engages and every creator is compared
 * against accounts ten times bigger.
 *
 * So a handful of the strongest accounts in the niche are topped up with their
 * own profile feed. That single credit is the densest buy in the product: twelve
 * reels, a real baseline, a follower count, and — because two accounts now have
 * twelve songs each instead of one — songs that can actually be counted across
 * accounts. Everything downstream is still computed locally.
 */
const ENRICH_MAX = Number(process.env.ENRICH_ACCOUNTS ?? 6);
/**
 * How many accounts to read when the vendor is free.
 *
 * A free channel read costs money in wall-clock time, not credits, so the cap
 * that matters is patience rather than budget. Six was set by the paid era and
 * left the room described by too few accounts to say anything about small ones;
 * twelve, read three at a time, covers the size range in about the time six
 * took in series.
 */
const FREE_ENRICH_MAX = Number(process.env.FREE_ENRICH_ACCOUNTS ?? 12);
/**
 * How many reels may be downloaded and watched to settle a language the caption
 * could not. Costs nothing but seconds, and every one of them is cached, so a
 * rebuild never watches the same reel twice. Eight covers the biggest reels in a
 * page — the ones that move the median — without turning a page load into a
 * transcoding job.
 */
const VERIFY_MAX = Number(process.env.LANG_VERIFY_MAX ?? 8);
/**
 * How many posts may be bought for their comment section when the caption,
 * the tags and the video all stayed silent. One credit each, and the list is
 * kept on the reel, so a rebuild never pays for the same comments twice.
 *
 * Four is deliberate: it covers the biggest undecided reels — the ones that
 * move the median — without turning a 7-credit pull into a 20-credit one. Set
 * LANG_COMMENT_MAX=0 to switch the paid step off entirely.
 */
const COMMENT_MAX = Number(process.env.LANG_COMMENT_MAX ?? 4);
/** Hard ceiling on the credits that step may spend, whatever COMMENT_MAX says. */
const COMMENT_CREDITS = Number(process.env.LANG_COMMENT_CREDITS ?? 4);
const MAX_CREDITS_PER_SEARCH = 1 + ENRICH_MAX + COMMENT_CREDITS;
const CACHE_TTL_HOURS = 12;
const NICHE_DIR = path.join(process.cwd(), "data", "niches");

/**
 * Verdicts that rest on evidence about the reel itself rather than on the
 * absence of it. "ok:english" is deliberately missing: an English caption over
 * a Telugu song is the exact case this whole gate exists to catch.
 */
const HARD_EVIDENCE =
  /^(comments:|ok:(script|tag|claim|audio|romanised|sung|heard|spoken|video)$)/;

export interface NicheAccount {
  handle: string;
  /**
   * Which network this row was measured on. A search may be answered by more
   * than one vendor, so this is kept per account rather than per search.
   */
  platform?: Platform;
  followers?: number;
  reels: number;
  /** median views across the reels we saw — the honest "how big is this account" number */
  medianViews: number;
  bestViews: number;
  /** how many of this account's reels beat the niche median */
  outliers: number;
  /**
   * True when we read enough of this account to describe it (three or more
   * posts). A `false` row is a *sighting*: one video that happened to rank, and
   * its "median" is just that video. Both are listed, because a sighting is
   * still evidence that the account is alive — but only a measured account can
   * carry a breakout ratio or set the room baseline.
   */
  measured: boolean;
  topReel: { url: string; caption: string; views: number };
}

export interface OwnSnapshot {
  handle: string;
  followers?: number;
  reels: number;
  medianViews: number;
  winners: {
    url: string;
    caption: string;
    views: number;
    ratio: number;
  }[];
}

export interface NicheResearch {
  query: string;
  handle?: string;
  fetchedAt: string;
  /** true when this came off disk and cost nothing */
  cached: boolean;
  credits: { spent: number; calls: number; remaining: number | null };
  /** every account the search surfaced, biggest median views first */
  accounts: NicheAccount[];
  /** median views of all reels found — the niche's own baseline */
  nicheMedianViews: number;
  reels: number;
  totalReels: number;
  own: OwnSnapshot | null;
  hashtags: { tag: string; count: number }[];
  errors: string[];
  /** kept so a cached niche can rebuild ideas without paying again */
  payload?: RawReel[];
  /**
   * Language gate: the room the search was asked for, and how many reels it
   * threw out as belonging to another one. Shown so a thin-looking result is
   * explained rather than mysterious.
   */
  language: {
    wanted: string | null;
    /**
     * How the room's language was decided: named in the phrase, read off the
     * creator's own account, inferred from a pull that was clearly one language,
     * or not decided at all because the evidence was a plurality and not a
     * majority. The page says which, because "inferred" and "named" are not the
     * same claim.
     */
    basis: "query" | "own" | "pull" | "none";
    /** the phrase's own word for it, e.g. "english" */
    word?: string;
    /** reels in the deciding sample that carried explicit language evidence */
    labelled?: number;
    /** share of those that agreed */
    share?: number;
    dropped: number;
    by: Record<string, number>;
    /**
     * How well the surviving reels are attested: `hard` were confirmed by the
     * provider, the script, a tag, a romanised title, the lyrics or the
     * comments; `soft` only had a caption that did not argue.
     */
    evidence?: { hard: number; soft: number; share: number };
    /** reels the video or the comments had to settle */
    watched?: WatchStats;
  };
  /**
   * The other half of accuracy: language-clean reels that are not about the
   * search at all — a cover artist's fit check, a transition, a meme. Dropped
   * from the medians and the ideas, and reported, because a page that silently
   * shrinks its own sample is no more honest than one that inflates it.
   */
  subject?: {
    applied: boolean;
    vocab: string[];
    dropped: number;
    /**
     * How many of the language-clean reels the vendor's own judge scored.
     *
     * The number exists to keep the gate honest about itself: when it stands
     * down, or when it drops nothing, the reader deserves to know whether that
     * was a decision or a shortage of judgements. Zero of thirty and thirty of
     * thirty produce the same page otherwise.
     */
    judged?: { scored: number; of: number };
    reason?: string;
  };
}

interface StoredNiche {
  fetchedAt: string;
  /**
   * Schema version of the pull that wrote this file.
   *
   * Bumped when the *meaning* of a stored field changes, so a cache written by
   * older code is ignored instead of half-trusted. Version 2 exists because
   * pulls made before the YouTube age parser was fixed carry a `postedAt` of
   * roughly `fetchedAt` on every row — 7 of 22 rooms on disk were in that state.
   * Those dates are not stale, they are *invented*, and a stale-by-hours cache
   * that re-pulls is fine while an invented-date cache that is trusted is how
   * "freshness" got pinned to 1.0 for exactly the rooms that returned no usable
   * dates.
   */
  v?: number;
  /**
   * The phrase as it was typed. The file is named from a slug, and a slug cannot
   * be read back into a phrase ("kannada songs singing covers" is indistinguishable
   * from "kannada-songs singing covers"), so the phrase is kept here. Absent on
   * pulls made before this field existed, which fall back to the slug.
   */
  query?: string;
  handle?: string;
  payload: RawReel[];
  errors: string[];
}

/** Bumped only when a stored field changes meaning. See `StoredNiche.v`. */
const CACHE_SCHEMA = 2;

/**
 * Do the dates in this payload describe the videos, or the harvest clock?
 *
 * A search page holds results published across months. When more than four
 * fifths of them share a timestamp within an hour of the pull, the parser did
 * not read the ages and something filled the gaps with "now". Cheap to check,
 * and it is the difference between a ranking built on real freshness and one
 * built on the clock.
 */
function datesLookReal(payload: RawReel[], fetchedAt: string): boolean {
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return false;
  let dated = 0;
  let nearFetch = 0;
  for (const r of payload) {
    const at = r?.postedAt;
    if (!at) continue;
    const ms = new Date(at).getTime();
    if (!Number.isFinite(ms)) continue;
    dated++;
    if (Math.abs(ms - t) < 3600e3) nearFetch++;
  }
  /**
   * Too few dated rows to judge a *share*, so judge the absolute claim instead.
   * A search page holding months of uploads never has every single row posted
   * within an hour of the pull; when eight or more do, the dates came from the
   * clock rather than the page. Below that the sample is genuinely too small and
   * the scorer decides — it already refuses to report an age off fewer than
   * three dated posts.
   */
  if (dated < 8) return true;
  if (nearFetch === dated) return false;
  return nearFetch / dated < 0.8;
}

/**
 * Pillars are the themes a niche keeps coming back to, so they are mined as
 * n-grams that recur across *different* reels. Slicing a phrase out of one
 * caption produced fragments like "50 cvs automatically" — the tail of a
 * single CTA — which then echoed through every fallback idea.
 */
function derivePillars(reels: RawReel[], limit: number): string[] {
  const docs = reels.slice(0, 200).map((r) => {
    const words = r.caption
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[#@][\w.]+/g, " ")
      .replace(/[\u2018\u2019\u02BC]/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !isStopword(w));
    // every 2- and 3-gram that occurs in this caption
    const grams = new Set<string>();
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(" "));
    }
    return { grams, views: r.views };
  });

  const stats = new Map<string, { docs: number; views: number }>();
  for (const d of docs) {
    for (const g of d.grams) {
      const cur = stats.get(g) ?? { docs: 0, views: 0 };
      cur.docs += 1;
      cur.views += d.views;
      stats.set(g, cur);
    }
  }

  const usable = [...stats.entries()].filter(([phrase, s]) => {
    if (s.docs < 2) return false; // seen once = one caption's wording
    const words = phrase.split(" ");
    if (words.some((w) => PILLAR_NOISE.has(w) || /\d/.test(w) || /ly$/.test(w)))
      return false;
    // "build own" is a verb phrase with its object missing — a pillar names a
    // subject, so an n-gram that opens with a verb is not one.
    if (VERB_LEAD.has(words[0])) return false;
    return true;
  });

  usable.sort(
    (a, b) =>
      b[1].docs - a[1].docs ||
      b[1].views / b[1].docs - a[1].views / a[1].docs ||
      b[0].length - a[0].length,
  );

  const picked: string[] = [];
  for (const [phrase] of usable) {
    if (picked.length >= limit) break;
    // Don't restate the query, and don't pick a theme that is a slice of one
    // already chosen ("whatsapp automation" vs "whatsapp automation day").
    if (picked.some((p) => p.includes(phrase) || phrase.includes(p))) continue;
    picked.push(phrase);
  }
  return picked;
}

/** Verbs that open a phrase without naming a subject ("build own", "get started"). */
const VERB_LEAD = new Set(
  (
    "build make get use create learn start stop turn post find add set put " +
    "run try take give need want show tell watch send keep let"
  ).split(/\s+/),
);

/** Words that mark a phrase as CTA furniture rather than a topic. */
const PILLAR_NOISE = new Set(
  (
    "comment dm link guide course details free save follow share bio skill " +
    "join register limited seats github repo prompt prompts template tutorial " +
    "check send obtain copy paste"
  ).split(/\s+/),
);

function slugify(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "niche";
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,_\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 10514926 → "10.5M", 606836 → "607k". A note that reads "10515k" is a bug. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function cleanHandle(h: string): string {
  return h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
}

async function readStored(slug: string): Promise<StoredNiche | null> {
  try {
    const raw = await fs.readFile(path.join(NICHE_DIR, `${slug}.json`), "utf8");
    const parsed = JSON.parse(raw) as StoredNiche;
    /**
     * Two ways a cache entry is rejected, both silent to the caller because the
     * caller's only correct response is identical: pull it again.
     *
     * A free vendor makes re-pulling a poisoned room cost a second, so there is
     * no reason to keep serving numbers we know to be wrong.
     */
    if (parsed.v !== CACHE_SCHEMA) return null;
    if (!datesLookReal(parsed.payload ?? [], parsed.fetchedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeStored(slug: string, value: StoredNiche): Promise<void> {
  await fs.mkdir(NICHE_DIR, { recursive: true });
  const target = path.join(NICHE_DIR, `${slug}.json`);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), "utf8");
  await fs.rename(tmp, target);
}

/** Public, free: what a search would cost and whether it is already on disk. */
export async function nicheCacheStatus(query: string, handle?: string) {
  const slug = slugify(query);
  const stored = await readStored(slug);
  const h = handle ? cleanHandle(handle) : undefined;
  const matches = Boolean(stored) && (stored?.handle ?? undefined) === h;
  const ageHours = stored
    ? (Date.now() - new Date(stored.fetchedAt).getTime()) / 36e5
    : null;
  return {
    slug,
    cached: Boolean(stored) && matches && (ageHours ?? 1e9) < CACHE_TTL_HOURS,
    ageHours,
    ttlHours: CACHE_TTL_HOURS,
    // The search plus however many accounts are topped up for a baseline. The
    // real number comes back on the ledger; this is the planning figure.
    credits: 1 + ENRICH_MAX,
    maxCredits: MAX_CREDITS_PER_SEARCH,
  };
}

/**
 * Turn a flat pile of reels into "who in this niche is actually doing well".
 * Median rather than mean, because one 4M-view fluke would otherwise make a
 * mid-size account look like a benchmark.
 */
function summariseAccounts(reels: RawReel[]): {
  accounts: NicheAccount[];
  nicheMedianViews: number;
} {
  const byAccount = new Map<string, RawReel[]>();
  for (const r of reels) {
    if (!r.account || r.account === "unknown") continue;
    if (!r.views) continue;
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }

  /**
   * The room baseline is what a *typical account* gets on a *typical video* —
   * not the median of every row we happened to collect.
   *
   * Those are different numbers whenever the sample is lopsided, and search
   * results are always lopsided: YouTube answers "cooking" with the videos it
   * thinks are best, which are the 25M-view ones. Averaging rows then said the
   * median reel in the cooking room had 3.1M views, so every real creator
   * looked like a failure by a factor of a hundred, and every "can you win
   * here" score was computed against a room that does not exist.
   *
   * Fix: measure each account first (its own median), then take the median
   * across accounts. One viral hit on one account can no longer set the room,
   * because it is one account's best, not the room's middle. Accounts seen only
   * once cannot join: a single video is not a typical video, and including it
   * just puts search-rank bias back into the number.
   */
  const described = [...byAccount.entries()]
    .map(([handle, list]) => ({ handle, list, own: median(list.map((r) => r.views)) }))
    .filter((a) => a.list.length >= 3);

  const nicheMedianViews =
    described.length >= 3
      ? median(described.map((a) => a.own))
      : median(reels.filter((r) => r.views > 0).map((r) => r.views));

  const accounts: NicheAccount[] = [...byAccount.entries()].map(([handle, list]) => {
    const views = list.map((r) => r.views);
    const best = [...list].sort((a, b) => b.views - a.views)[0];
    return {
      handle,
      /** the network this account's posts actually came from */
      platform: best.platform,
      followers: list.find((r) => r.followers)?.followers,
      reels: list.length,
      medianViews: median(views),
      bestViews: best.views,
      outliers: list.filter((r) => r.views > nicheMedianViews * 2).length,
      measured: list.length >= 3,
      topReel: {
        url: best.url,
        caption: best.caption.slice(0, 140),
        views: best.views,
      },
    };
  });

  /**
   * Measured accounts first, then by size.
   *
   * Sorting purely by medianViews put a one-video sighting with 25M views above
   * an account we had actually read thirty posts from — the list then read as
   * "the biggest accounts in this room" when it was mostly one lucky hit each.
   * Within each group, biggest first, because that is the useful order when
   * someone is choosing who to study.
   */
  accounts.sort(
    (a, b) => Number(b.measured) - Number(a.measured) || b.medianViews - a.medianViews,
  );
  return { accounts, nicheMedianViews };
}

function summariseOwn(reels: RawReel[], handle: string): OwnSnapshot {
  const views = reels.map((r) => r.views).filter((v) => v > 0);
  const base = reels.find((r) => r.baselineMedianViews)?.baselineMedianViews ?? median(views);
  const winners = [...reels]
    .filter((r) => r.views > 0 && base > 0)
    .map((r) => ({
      url: r.url,
      caption: r.caption.slice(0, 140),
      views: r.views,
      ratio: Number((r.views / base).toFixed(1)),
    }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);

  return {
    handle,
    followers: reels.find((r) => r.followers)?.followers,
    reels: reels.length,
    medianViews: base,
    winners,
  };
}

function topHashtags(reels: RawReel[], limit = 4): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of reels) {
    for (const raw of r.hashtags ?? []) {
      const tag = raw.replace(/^#/, "").trim().toLowerCase();
      if (!tag || tag.length < 3) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Top up the strongest cohort accounts with their own profile feeds.
 *
 * Only accounts we have nothing to measure against are pulled — one that came
 * back with a provider baseline, or with more than one reel, is already usable
 * and would be a wasted credit. The strongest are chosen first because those are
 * the accounts whose breakouts the plan will cite: an evidence line needs its own
 * baseline far more than the tenth account down does.
 */
async function enrichCohort(
  payload: RawReel[],
  opts: {
    exclude?: string;
    max: number;
    errors: string[];
    /** true when only free vendors can be used — YouTube channels, no spend */
    freeOnly?: boolean;
  },
): Promise<RawReel[]> {
  if (opts.max <= 0) return [];

  const byAccount = new Map<string, RawReel[]>();
  for (const r of payload) {
    if (!r.account || r.account === "unknown") continue;
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }

  /**
   * Who needs a history pulled, and can we afford it?
   *
   * A ratio is only evidence if the control group is *the account's other
   * posts*. Search results cannot supply that: they are a handful of that
   * creator's best-performing videos, chosen by the platform for relevance.
   * Dividing a video by the median of the very page that surfaced it produces a
   * number near 1.0 by construction — which is how a pull of 40 real reels
   * scored zero outliers and produced an empty plan.
   *
   * So the bar here is history, not presence: fewer than three posts means no
   * measurable median, and those accounts get their channel read. Free vendors
   * are always affordable; paid ones only when the balance covers them.
   */
  const pool = [...byAccount.entries()]
    .filter(([handle]) => handle.toLowerCase() !== opts.exclude?.toLowerCase())
    .filter(([, reels]) => reels.length < 3)
    .map(([handle, reels]) => ({
      handle,
      /**
       * Only two platforms are readable today; anything else (a TikTok row from
       * a future vendor) is treated as Instagram so it fails loudly on a paid
       * vendor rather than being silently priced as a YouTube channel.
       */
      platform: (reels[0]?.platform === "youtube" ? "youtube" : "instagram") as
        | "instagram"
        | "youtube",
      best: Math.max(0, ...reels.map((r) => r.views)),
    }))
    .filter((c) => !opts.freeOnly || c.platform === "youtube")
    .sort((a, b) => b.best - a.best);

  /**
   * Take a sample *spread across the size range*, not the top of it.
   *
   * The previous rule pulled the biggest accounts first, which quietly rebuilt
   * the bias it was meant to remove: the room got measured only where accounts
   * are already huge, so "small accounts are breaking out" could never be
   * observed. The question this product asks is specifically about the bottom of
   * the room, so the sample has to include it — biggest, middle and smallest
   * here, in that order, so a truncated pull still has the best evidence first.
   */
  const candidates = stratify(pool, opts.max);

  if (!candidates.length) return [];

  const added: RawReel[] = [];
  /**
   * Three at a time. Each channel read is one HTTP page and they are independent,
   * so serialising them made a free pull cost one second per account — the
   * reason the free path felt slow enough to look broken. Three keeps the
   * request rate guest-like while cutting the wall clock by two thirds.
   */
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < candidates.length) {
      const { handle, platform } = candidates[cursor++];
      try {
        const reels = await harvestAccountReels(handle, platform);
        if (reels.length) added.push(...reels);
      } catch (err) {
        // A budget stop or one dead account must not cost the whole pull: the
        // search results are still worth a plan, just a thinner one.
        opts.errors.push(`@${handle}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
  return added;
}

/**
 * Pick `max` accounts from a size-sorted list, covering its whole range.
 *
 * Largest first (so a short pull keeps the strongest accounts), then evenly
 * spaced through the rest — which is how the small ones get read at all.
 */
function stratify<T>(sorted: T[], max: number): T[] {
  if (max <= 0 || !sorted.length) return [];
  if (sorted.length <= max) return sorted;
  const picked: T[] = [sorted[0]];
  const rest = sorted.slice(1);
  const want = max - 1;
  if (want > 0 && rest.length) {
    const step = rest.length / want;
    for (let i = 0; i < want; i++) {
      picked.push(rest[Math.min(rest.length - 1, Math.round(i * step))]);
    }
  }
  // A rounding collision can repeat an account; identity matters more than count.
  const seen = new Set<T>();
  return picked.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

/**
 * Research one niche. Serves from disk when the same query (and same own
 * handle) was searched within the TTL, which costs 0 credits.
 */
export async function researchNiche(opts: {
  query: string;
  handle?: string;
  /** the creator's own handle, so enrichment does not pay for it twice */
  exclude?: string;
  force?: boolean;
  /**
   * How many accounts to top up for baselines. The full 6 makes a room's
   * outlier ratios trustworthy; a niche *comparison* needs breadth instead, so
   * the recommend route asks for 2 and spends the saved credits on more rooms.
   */
  enrichMax?: number;
}): Promise<NicheResearch> {
  const query = opts.query.trim();
  if (query.length < 2) throw new Error("Type a niche to search for");
  const handle = opts.handle ? cleanHandle(opts.handle) : undefined;
  const slug = slugify(query);

  if (!opts.force) {
    const stored = await readStored(slug);
    const ageHours = stored
      ? (Date.now() - new Date(stored.fetchedAt).getTime()) / 36e5
      : Infinity;
    const sameHandle = (stored?.handle ?? undefined) === handle;
    if (stored && sameHandle && ageHours < CACHE_TTL_HOURS) {
      return shape(query, handle, stored.payload, stored.errors, {
        cached: true,
        fetchedAt: stored.fetchedAt,
        spent: 0,
        calls: 0,
        remaining: (await checkBalance()).balance,
      });
    }
  }

  // Any configured vendor will do — the router picks the cheapest one.
  if (!availableProviders().length) {
    throw new Error(
      "No data vendor is configured — set HIKERAPI_KEY or SOCIALCRAWL_API_KEY in .env.local. Niche search needs live data.",
    );
  }

  /**
   * Pre-flight: can anyone serve this search, and can anyone *pay* for the
   * extras?
   *
   * The old gate read `checkBalance()`, which reports the active vendor's
   * credit count. That made "the paid key is empty" look like "the search is
   * impossible", and the page answered "we are at capacity" for a call the free
   * vendor would have served for nothing. Price the extras instead of the
   * search: free-only runs skip cohort top-ups and comment reads, which are the
   * only things that actually cost money.
   */
  const cost = handle ? 2 : 1;
  const ready = await readiness("/instagram/search/reels", cost);
  if (!ready.any) {
    throw new Error(
      "Not enough credits: no vendor can serve this search right now.",
    );
  }
  const freeOnly = !ready.paid;
  const { balance } = await checkBalance();

  resetCreditLedger();
  const payload: RawReel[] = [];
  const errors: string[] = [];

  try {
    payload.push(...(await harvestInstagramSearch(query)));
  } catch (err) {
    errors.push(`search "${query}": ${(err as Error).message}`);
  }

  if (handle) {
    try {
      payload.push(...(await harvestInstagramAccount(handle)));
    } catch (err) {
      errors.push(`@${handle}: ${(err as Error).message}`);
    }
  }

  /**
   * Baselines. Without them every ratio is 1.0 and the plan has nothing to say,
   * so a few accounts are topped up — but never more than the balance can pay
   * for, and never at the cost of the search that already succeeded.
   */
  if (payload.length) {
    const cap = Math.max(0, Math.min(opts.enrichMax ?? ENRICH_MAX, ENRICH_MAX));
    /**
     * Free-only runs get a wider cohort, not a narrower one.
     *
     * Paid top-ups are rationed by credits; a channel read costs nothing, and
     * the free source's search page returns one video per account. Without
     * several of those accounts read in full there is no room median worth the
     * name, so the ceiling here is about time, not money.
     */
    const freeCap = Math.max(cap, FREE_ENRICH_MAX);
    const headroom =
      freeOnly || balance === null ? freeCap : Math.max(0, balance - cost);
    const enrich = Math.min(freeOnly ? freeCap : cap, headroom);
    if (enrich > 0) {
      const added = await enrichCohort(payload, {
        exclude: handle ?? opts.exclude,
        max: enrich,
        errors,
        freeOnly,
      });
      // Same reel from the search and the profile pull must not be counted twice.
      const seen = new Set(payload.map((r) => r.id));
      for (const r of added) if (!seen.has(r.id)) payload.push(r);
    }
  }

  if (!payload.length) {
    throw new Error(
      errors.length
        ? errors.join(" · ")
        : `No reels came back for "${query}". Try a broader phrase.`,
    );
  }

  /**
   * Settle the reels the text could not.
   *
   * Captions lie on covers — a Hindi film song posted with an English title,
   * no tags, on an account that also covers English songs. This asks the two
   * witnesses left, cheapest first: the video (free, local) and then the
   * comments under the few biggest reels the video could not settle (1 credit
   * each, capped). Both readings are stored on the reel, so a rebuild from
   * cache decides the same way without paying or downloading again.
   */
  const ledgerBefore = creditLedger();
  /**
   * Free-only runs buy no comments. The local video read still runs — it is the
   * better witness anyway and costs nothing — so a zero-balance search is
   * verified, just not paid-verified.
   */
  const headroomForComments = freeOnly
    ? 0
    : balance === null
      ? COMMENT_CREDITS
      : Math.max(0, balance - ledgerBefore.spent - 1);
  const watched = await watchToVerify(
    payload,
    roomLanguage(query, {
      own: handle ? payload.filter((r) => r.account.toLowerCase() === handle.toLowerCase()) : [],
      pull: payload,
    }).code,
    {
      max: VERIFY_MAX,
      maxBought: Math.min(COMMENT_MAX, headroomForComments),
      creditBudget: Math.min(COMMENT_CREDITS, headroomForComments),
    },
  );

  /**
   * Say what the pass did, including when it could do nothing. A verification
   * step that quietly finds nothing to check is worse than none: the numbers
   * look settled while half the room is still a guess.
   */
  const vs = watched.stats;
  if (vs.candidates) {
    const bits: string[] = [];
    if (vs.watched) {
      bits.push(
        `watched ${vs.watched} of ${vs.candidates} reels whose caption and tags did not settle it`,
      );
    }
    if (vs.bought) bits.push(`read the comments under ${vs.bought} more (${vs.credits} credits)`);
    if (bits.length) {
      errors.push(
        `${bits.join(", ")}: ${vs.dropped} were another language, ${vs.confirmed} confirmed` +
          (vs.leftover ? `, ${vs.leftover} still unconfirmed` : ""),
      );
    } else if (vs.skipped) {
      errors.push(`language could not be checked on the video or the comments: ${vs.skipped}`);
    } else if (vs.bought === 0) {
      errors.push(
        `${vs.candidates} reels stayed unconfirmed: no video link to watch and no comment budget left`,
      );
    }
  }

  const fetchedAt = new Date().toISOString();
  await writeStored(slug, { v: CACHE_SCHEMA, fetchedAt, query, handle, payload, errors });

  const ledger = creditLedger();
  return shape(query, handle, payload, errors, {
    cached: false,
    fetchedAt,
    spent: ledger.spent,
    calls: ledger.calls,
    remaining: ledger.remaining,
    verified: watched.stats,
  });
}

/**
 * Rebuild a niche view from reels already on disk. Used to regenerate a plan or
 * a feed without paying for the same pull twice.
 */
export function researchFromCache(
  query: string,
  payload: RawReel[],
  opts: { handle?: string; fetchedAt?: string; errors?: string[] } = {},
): NicheResearch {
  return shape(query, opts.handle, payload, opts.errors ?? [], {
    cached: true,
    fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
    spent: 0,
    calls: 0,
    remaining: null,
  });
}

function shape(
  query: string,
  handle: string | undefined,
  payload: RawReel[],
  errors: string[],
  meta: {
    cached: boolean;
    fetchedAt: string;
    spent: number;
    calls: number;
    remaining: number | null;
    verified?: WatchStats;
  },
): NicheResearch {
  const ownReels = handle
    ? payload.filter((r) => r.account.toLowerCase() === handle.toLowerCase())
    : [];
  // The niche view is about everyone else: your own reels would otherwise sit
  // in your own benchmark list and inflate the picture.
  const others = handle
    ? payload.filter((r) => r.account.toLowerCase() !== handle.toLowerCase())
    : payload;

  /**
   * Drop reels from another language before any maths touches them.
   *
   * The searched language comes from the phrase when it names one ("english
   * music covers"); when it does not, from the creator's own posts, because
   * their account is the one sample that is definitely the right room. Without
   * this a Telugu account in an English-covers search drags its views into the
   * group median and its songs into the recommendations.
   */
  const room = roomLanguage(query, { own: ownReels, pull: others });
  const wanted = room.code;
  /**
   * What each account is, from its own labelled posts. The search returns one
   * reel per account, so this is rebuilt per pull rather than trusted from a
   * single caption.
   */
  const byAccount = new Map<string, RawReel[]>();
  for (const r of others) {
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }
  const accountLang = new Map<string, AccountLangProfile | null>();
  for (const [handle, list] of byAccount) {
    /**
     * A genuinely bilingual account is judged post by post; one language with a
     * stray tag from the other is not. This is what keeps a Japanese tag-spam
     * page from entering an English room on the strength of one hashtag.
     */
    const profile = accountProfile(list, wanted);
    accountLang.set(handle, profile.mixed ? null : profile);
  }

  const kept: RawReel[] = [];
  const by: Record<string, number> = {};
  let hard = 0;
  let soft = 0;
  for (const r of others) {
    const verdict = inLanguage(r, wanted, accountLang.get(r.account) ?? null);
    /**
     * A suspect verdict counts as dropped here, and only here.
     *
     * By the time `shape()` runs, the second-witness pass has already been
     * asked (`watchToVerify` runs before it), so a reel that is *still* suspect
     * is one whose video and comments could not settle it either. Nothing in
     * the reel contradicts the room; the account does; and when there is no
     * other witness, that is the only evidence there is.
     */
    if (verdict.keep && !isSuspect(verdict.why)) {
      kept.push(r);
      /**
       * How much of the room was actually confirmed. A reel kept on a provider
       * tag, the script it is written in, a language hashtag, a romanised song
       * title, its lyrics or its comment section rests on something; a reel
       * kept because its caption was in English and nothing contradicted it
       * rests on nothing but the caption. The difference decides whether the
       * numbers below are a reading or a guess, so it is counted, not assumed.
       */
      /**
       * With no language constraint there is no verdict to score, but the room
       * still has to be graded: a reel whose language was actually read is
       * attested, one that stayed silent is a guess that happened not to matter.
       */
      const attested = wanted
        ? HARD_EVIDENCE.test(verdict.why)
        : Boolean(
            explicitLanguage(r) || commentsLanguage(r.comments, r.topComments),
          );
      if (attested) hard += 1;
      else soft += 1;
    } else by[verdict.why] = (by[verdict.why] ?? 0) + 1;
  }
  const dropped = others.length - kept.length;
  const evidence = {
    hard,
    soft,
    share: hard + soft ? hard / (hard + soft) : 1,
  };

  /**
   * The second half of "random reels": everything left is in the right
   * language, but not all of it is about the search. A cover artist's fit check
   * is English and comes from a cover account, and one of those had 904k views
   * — four times the room's median, so it set the median it sat in.
   *
   * Applied to the room, not to the accounts: the accounts list stays whole,
   * because an account is judged on all its work, while the medians, the
   * hashtags and the ideas are about the subject and nothing else.
   */
  const subject = keepOnSubject(kept, query, { minKept: 8 });
  const onSubject = subject.applied ? subject.kept : kept;

  const { accounts, nicheMedianViews } = summariseAccounts(onSubject);

  return {
    query,
    handle,
    fetchedAt: meta.fetchedAt,
    cached: meta.cached,
    credits: { spent: meta.spent, calls: meta.calls, remaining: meta.remaining },
    accounts,
    nicheMedianViews,
    reels: onSubject.length,
    totalReels: payload.length,
    own: handle && ownReels.length ? summariseOwn(ownReels, handle) : null,
    hashtags: topHashtags(onSubject),
    subject: {
      applied: subject.applied,
      vocab: subject.vocab.slice(0, 8),
      dropped: subject.dropped.length,
      /**
       * Counted here rather than threaded from the search call, so it is true
       * for a rebuild off disk as well: a cached pull holds the same
       * judgements it was bought with, and a pull made before this field
       * existed simply reports zero rather than pretending.
       */
      judged: { scored: kept.filter((r) => r.relevance).length, of: kept.length },
      reason: subject.reason,
    },
    errors,
    /**
     * Only the reels that passed the language gate. Everything downstream reads
     * this, so no stage can quietly re-admit a Telugu reel into an English
     * room — the median, the rankings, the cohort and the ideas all see one
     * consistent set.
     */
    payload: onSubject,
    language: {
      wanted,
      basis: room.basis,
      word: room.word,
      labelled: room.labelled,
      share: room.share,
      dropped,
      by,
      evidence,
      watched: meta.verified,
    },
  };
}

/**
 * Build the profile the pipeline runs against. Pillars come from the hashtags
 * that actually appear on the niche's reels, not from a guess: that keeps the
 * "stay inside your pillars" rule grounded in what the niche talks about.
 */
/**
 * How each kind of account talks, and the shape of video it can actually make.
 * Kept next to each other because they are the same fact: a vlog is filmed
 * wherever the day goes, so the setup constraint has to say so.
 */
const VOICE: Record<Recommendation, string> = {
  songs:
    "warm, unhurried, a performer talking to people who already like the songs. No hype, no guru energy.",
  formats:
    "first person, unhurried, like a friend catching you up. Say what actually happened, including the boring part. No hype.",
  craft:
    "direct and visual — describe what is on screen, not how you feel about it. No hype.",
  hooks: "plain, specific, no hype. Say the number, skip the guru energy.",
  none: "plain, specific, no hype. Say the number, skip the guru energy.",
};

const CONSTRAINTS: Record<Recommendation, Profile["constraints"]> = {
  // A cover is a performance, not a 30-second explainer: a verse plus a chorus
  // does not fit in half a minute.
  songs: { solo: true, maxSeconds: 75, setting: "one room, one take, phone at chest height" },
  formats: { solo: true, maxSeconds: 60, setting: "wherever the day goes — handheld, one phone" },
  craft: { solo: true, maxSeconds: 45, setting: "one place, one light, phone propped up" },
  hooks: { solo: true, maxSeconds: 30, setting: "desk, screen recording" },
  none: { solo: true, maxSeconds: 45, setting: "wherever you already film" },
};

/**
 * Which network most of a search's evidence came from.
 *
 * Counted by reels, not by accounts, because the question the caller is really
 * asking is "what did I mostly read?" — and one vendor returning a big channel
 * should not outvote twenty small ones. Undefined when there is no evidence at
 * all, which keeps "we don't know" distinguishable from "it was Instagram".
 */
function majorityPlatform(research: NicheResearch): Platform | undefined {
  const payload = research.payload ?? [];
  if (!payload.length) return research.accounts[0]?.platform;
  const tally = new Map<Platform, number>();
  for (const r of payload) {
    if (!r.platform) continue;
    tally.set(r.platform, (tally.get(r.platform) ?? 0) + 1);
  }
  let best: Platform | undefined;
  let bestN = -1;
  for (const [p, n] of tally) {
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best ?? research.accounts[0]?.platform;
}

export function profileFromNiche(
  research: NicheResearch,
  previous?: Profile | null,
  shape?: { id: string; songLed: boolean; recommendation?: Recommendation },
): Profile {
  const topAccounts = research.accounts.slice(0, 5);

  /**
   * Pillars are recurring themes mined from the niche's own captions, not
   * hashtags: "#aiautomation" dropped into a hook template reads as "Stop
   * optimising aiautomation", which is not an idea.
   */
  const query = research.query.toLowerCase();
  const pillars = [
    research.query,
    ...derivePillars(research.payload ?? [], 4).filter(
      (p) => p.toLowerCase() !== query,
    ),
  ].slice(0, 5);

  const songLed = shape?.songLed ?? false;
  const family: Recommendation = shape?.recommendation ?? (songLed ? "songs" : "hooks");
  // Voice and constraints belong to the KIND of account, not to the visitor. A
  // vlogger inheriting "desk, screen recording" (or a coach inheriting "one room,
  // one take") is how a plan ends up describing someone else's videos.
  const sameShape = Boolean(previous?.archetype && previous.archetype === shape?.id);

  /**
   * The network every claim below was measured on.
   *
   * Taken from the accounts rather than assumed, because the free vendor answers
   * with YouTube and the paid ones with Instagram. If two networks somehow made
   * it into one search, the one carrying more reels wins: it is the majority of
   * the evidence, and a mixed-source plan is not a thing worth pretending to
   * report precisely.
   */
  const platform = majorityPlatform(research);

  return {
    niche: research.query,
    audience: `people searching "${research.query}" ${platformOn(platform)}`,
    offer: previous?.offer ?? "",
    platform,
    archetype: shape?.id ?? previous?.archetype,
    songs: previous?.songs,
    formats: previous?.formats,
    pillars,
    voice: (sameShape ? previous?.voice : undefined) ?? VOICE[family],
    bannedWords: previous?.bannedWords ?? [],
    constraints: (sameShape ? previous?.constraints : undefined) ?? CONSTRAINTS[family],
    benchmarks: topAccounts.map((a) => ({
      handle: a.handle,
      platform: a.platform ?? platform ?? "instagram",
      note: `${compact(a.medianViews)} median views across ${a.reels} reel${
        a.reels === 1 ? "" : "s"
      }`,
    })),
    keywords: [research.query],
    ownWinners: research.own?.winners.map((w) => w.caption) ?? previous?.ownWinners ?? [],
    commentQuestions: previous?.commentQuestions ?? [],
  };
}

/**
 * What the browser is allowed to see of a niche pull. Deliberately not the raw
 * payload: that is every caption of every reel, hundreds of kilobytes the page
 * has no use for. The numbers and the handful of accounts are the whole point.
 */
export interface NicheView {
  query: string;
  fetchedAt: string;
  /** true when nothing was spent to produce this */
  cached: boolean;
  ageHours: number;
  credits: { spent: number; calls: number; remaining: number | null };
  reels: number;
  accountCount: number;
  /** the niche's own baseline: what a typical reel here gets */
  nicheMedianViews: number;
  top: NicheAccount[];
  hashtags: { tag: string; count: number }[];
  errors: string[];
}

export function nicheView(research: NicheResearch, limit = 8): NicheView {
  return {
    query: research.query,
    fetchedAt: research.fetchedAt,
    cached: research.cached,
    ageHours:
      Math.round(
        ((Date.now() - new Date(research.fetchedAt).getTime()) / 36e5) * 10,
      ) / 10,
    credits: research.credits,
    reels: research.totalReels,
    accountCount: research.accounts.length,
    nicheMedianViews: research.nicheMedianViews,
    top: research.accounts.slice(0, limit),
    hashtags: research.hashtags,
    errors: research.errors,
  };
}

export interface CachedNiche {
  slug: string;
  query: string;
  fetchedAt: string;
  ageHours: number;
  reels: number;
  accounts: number;
  /** older than the TTL, so opening it would re-pull and spend a credit */
  stale: boolean;
}

/**
 * The niches already on disk. Free to list and free to reopen inside the TTL,
 * which is what makes the discover page usable without spending anything: the
 * work was already paid for once.
 */
export async function cachedNiches(): Promise<CachedNiche[]> {
  let files: string[];
  try {
    files = await fs.readdir(NICHE_DIR);
  } catch {
    return [];
  }

  const out: CachedNiche[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const slug = file.replace(/\.json$/, "");
    const stored = await readStored(slug);
    if (!stored?.payload?.length) continue;
    const ageHours = (Date.now() - new Date(stored.fetchedAt).getTime()) / 36e5;
    out.push({
      slug,
      query: stored.query ?? slug.replace(/-/g, " "),
      fetchedAt: stored.fetchedAt,
      ageHours: Math.round(ageHours * 10) / 10,
      reels: stored.payload.length,
      accounts: new Set(stored.payload.map((r) => r.account.toLowerCase())).size,
      stale: ageHours >= CACHE_TTL_HOURS,
    });
  }

  return out.sort((a, b) => b.reels - a.reels);
}
