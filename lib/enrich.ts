import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { creditLedger, checkBalance, fetchInstagramPost, type PostPayload } from "./harvest";
import { mediaReady, readHooks } from "./media";
import { availableProviders } from "./providers";
import type { HookReading, RawComment, RawReel } from "./types";

/**
 * The deep pass: six reels watched properly, instead of three hundred counted.
 *
 * Counting is cheap and says nothing about the first three seconds. This layer
 * buys the few posts that matter most to one specific question — "what do my
 * best posts have that my worst ones do not" — for six credits, then reads the
 * video locally for free. That order matters: the paid call returns the
 * comments and the MP4 in one credit, and everything after it costs nothing.
 */

const CACHE_PATH = path.join(process.cwd(), "data", "_post_cache.json");
const TTL_MS = Number(process.env.POST_CACHE_HOURS ?? 24 * 7) * 3_600_000;

/** Default spend for one plan. Six posts is the floor that can prove a pattern. */
const MAX_CREDITS = Number(process.env.ENRICH_MAX_CREDITS ?? 6);
/** Never spend the key down to nothing: five calls have to stay in reserve. */
const RESERVE = Number(process.env.ENRICH_CREDIT_RESERVE ?? 5);

interface CacheRow extends PostPayload {
  fetchedAt: string;
}

type Cache = Record<string, CacheRow>;

function readCache(): Cache {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf8");
  } catch {
    /* a failed cache write costs one credit later, not a broken plan */
  }
}

export interface EnrichReport {
  posts: number;
  watched: number;
  spent: number;
  errors: string[];
  /** why nothing was bought, when nothing was */
  skipped?: string;
}

export interface EnrichResult {
  /** the same reels, with comments, a fresher view count and a hook reading */
  reels: RawReel[];
  hooks: Map<string, HookReading>;
  report: EnrichReport;
}

/**
 * Which posts are worth six credits.
 *
 * The comparison has to be fair or the difference it finds is noise: two of the
 * creator's best and two of their worst, so the diff is within one account, then
 * the two biggest breakouts among peers, so the advice is not only about them.
 */
export function pickForEnrichment(
  own: RawReel[],
  peers: RawReel[],
  opts: { perSide?: number } = {},
): RawReel[] {
  const perSide = opts.perSide ?? 2;
  const withViews = (list: RawReel[]) => list.filter((r) => r.views > 0 && Boolean(r.url));
  const byViews = withViews(own).slice().sort((a, b) => b.views - a.views);

  const picked: RawReel[] = [];
  const seen = new Set<string>();
  const add = (r?: RawReel) => {
    if (!r || seen.has(r.url)) return;
    seen.add(r.url);
    picked.push(r);
  };

  /*
   * A beginner's "worst" post is often a post with no data at all, and comparing
   * against nothing invents a lesson. Bottom picks must have at least a third of
   * the account's own median, or the difference is production budget, not craft.
   */
  const median =
    byViews.length > 0
      ? byViews[Math.floor(byViews.length / 2)].views
      : 0;
  const floor = median * 0.33;

  byViews.slice(0, perSide).forEach(add);
  const losers = byViews
    .filter((r) => !seen.has(r.url) && r.views >= floor && r.views < median)
    .reverse()
    .slice(0, perSide);
  losers.forEach(add);

  withViews(peers)
    .slice()
    .sort((a, b) => b.views - a.views)
    .slice(0, perSide)
    .forEach(add);

  return picked;
}

/** Pull the payloads (cached, then paid) and read the videos locally. */
export async function enrich(
  reels: RawReel[],
  opts: { maxCredits?: number; watch?: number; force?: boolean } = {},
): Promise<EnrichResult> {
  const cache = readCache();
  const report: EnrichReport = { posts: 0, watched: 0, spent: 0, errors: [] };
  const budget = Math.min(opts.maxCredits ?? MAX_CREDITS, MAX_CREDITS);
  const out: RawReel[] = [];

  if (!availableProviders().length) {
    return { reels, hooks: new Map(), report: { ...report, skipped: "no data vendor configured" } };
  }

  // Balance first (0 credits): being cut off halfway leaves a half-read set of
  // posts, which is worse than reading none of them.
  const { balance } = await checkBalance();
  if (balance !== null && balance - RESERVE < 1) {
    return {
      reels,
      hooks: new Map(),
      report: { ...report, skipped: `only ${balance} credits left, keeping them in reserve` },
    };
  }

  let spent = 0;
  /** reels whose post payload was returned — the only ones worth watching */
  const fetched = new Set<string>();
  for (const reel of reels) {
    const hit = cache[reel.url];
    const fresh = hit && !opts.force && Date.now() - Date.parse(hit.fetchedAt) < TTL_MS;
    let post: PostPayload | null = null;

    if (fresh) {
      post = hit;
    } else if (spent < budget) {
      try {
        post = await fetchInstagramPost(reel.url);
        cache[reel.url] = { ...post, fetchedAt: new Date().toISOString() };
        spent += 1;
        report.posts += 1;
        // Written per post, so a crash on reel four keeps reels one to three.
        writeCache(cache);
      } catch (err) {
        report.errors.push(`${reel.account}: ${(err as Error).message}`);
      }
    }
    if (!post) {
      out.push(reel);
      continue;
    }
    fetched.add(reel.url);

    out.push({
      ...reel,
      // A fresher count than the profile page had, when the post has one.
      views: post.views || reel.views,
      likes: post.likes || reel.likes,
      comments: post.comments || reel.comments,
      shares: post.shares ?? reel.shares,
      saves: post.saves ?? reel.saves,
      durationSec: post.durationSec ?? reel.durationSec,
      audioName: post.audioName ?? reel.audioName,
      topComments: post.topComments as RawComment[],
    });
  }
  report.spent = spent;

  if (!mediaReady()) {
    return { reels: out, hooks: new Map(), report: { ...report, skipped: "local video tools missing" } };
  }

  const watch = out
    .filter((r) => fetched.has(r.url))
    .map((r) => ({ reel: r, mediaUrl: cache[r.url]?.mediaUrl }))
    .filter((i) => Boolean(i.mediaUrl));

  const hooks = await readHooks(watch, { max: opts.watch ?? 6 });
  report.watched = hooks.size;

  const withHooks = out.map((r) => (hooks.has(r.id) ? { ...r, hook: hooks.get(r.id)! } : r));
  return { reels: withHooks, hooks, report };
}

/** Credits the key has left, or null when unknown. Used by the status line. */
export async function creditsLeft(): Promise<number | null> {
  const led = creditLedger();
  if (led.remaining !== null) return led.remaining;
  const { balance } = await checkBalance();
  return balance;
}
