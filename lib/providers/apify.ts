/**
 * Apify adapter — the one with a monthly free allowance that never expires.
 *
 * The Apify free plan includes **$5 of usage every month, recurring, no card**.
 * Unused credit expires at the end of the cycle, so the honest way to run this
 * product is to spend it every month rather than hoard it.
 *
 * Which actor matters more than which vendor, and by an order of magnitude. The
 * three real options, by advertised price per 1,000 results:
 *
 *   hpix/ig-reels-scraper            $0.20 / 1,000   (~25,000 free)
 *   apidojo/instagram-scraper-api    $0.50 / 1,000   (~10,000 free)
 *   apify/instagram-scraper          $2.30 / 1,000   ( ~2,170 free)
 *
 * The two cheap ones were tried live and both fail on **data**, not on price:
 *
 *   - hpix cannot do anything but named profiles, so it cannot price a niche
 *     for a creator with no handle yet — the whole `/start` flow.
 *   - apidojo returns **no view counts at all**, and views are the entire
 *     ranking. It also ignores `resultsLimit` and uses different field names
 *     (`likeCount`, not `likesCount`).
 *
 * This adapter therefore uses the canonical, most expensive-per-result actor,
 * because it is the only one of the three that returns `videoPlayCount` on a
 * reel and honours the limit it is given. $2.30/1,000 sounds like the worst
 * deal here and is in fact the cheapest *working* one: the others are free data
 * that cannot price anything.
 *
 * Billing is a flat **$0.0023 per result** (`PRICE_PER_DATASET_ITEM`, read from
 * the actor's own pricing table) with no per-query fee, so cost is linear. The
 * $5 monthly credit is **~2,170 results** — about 90 profile pulls of 24, or
 * roughly 20 complete plans a month, free.
 *
 * VERIFIED LIVE against a real token on 2026-10-27, not just against docs:
 *
 *   resultsType "posts"    -> likesCount, commentsCount, videoPlayCount,
 *                             displayUrl, shortCode, timestamp, videoDuration;
 *                             reels arrive as productType "clips"; `owner` is
 *                             EMPTY, so no follower count is present.
 *   resultsType "details"  -> followersCount 268,267,261 for @natgeo, plus
 *                             biography, verified, businessCategoryName.
 *   resultsLimit           -> honoured exactly (asked 8, got 8; asked 3, got 3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ProviderUnavailable,
  type DataProvider,
  type ProviderBalance,
  type PullResult,
} from "./types";

const BASE = "https://api.apify.com/v2";

/**
 * `apify/instagram-scraper` — the official, canonical Apify actor. `/` becomes `~`.
 *
 * Chosen after running the alternative live. The cheap third-party actor
 * (`apidojo/instagram-scraper-api`, $0.50/1,000) was tried first and rejected on
 * measured evidence, not on price:
 *
 *   - it returns **no view count of any kind**. There is no `videoPlayCount`,
 *     `videoViewCount` or `views` on a reel, so every reel scores 0 views and the
 *     entire outlier ranking — the product — collapses to noise;
 *   - its field names are `likeCount` / `commentCount` / `owner.followerCount`,
 *     none of which any other vendor uses, so a shared adapter would need a
 *     second parser for it alone;
 *   - it ignores `maxItems` (asked for 3 results, billed for 10).
 *
 * This actor returns `likesCount`, `commentsCount`, `videoPlayCount`,
 * `displayUrl`, `shortCode`, `timestamp` and `videoDuration` — the names the
 * code below was already written against — and it honours `resultsLimit`
 * exactly (asked 3, returned 3). It costs $2.30/1,000 rather than $0.50/1,000,
 * and it is still by far the cheapest option that can actually price a niche.
 *
 * VERIFIED LIVE against a real token on 2026-10-27. See the notes on `profile()`
 * for the one place its payload is thinner than expected.
 */
const ACTOR = "apify~instagram-scraper";

/**
 * `PRICE_PER_DATASET_ITEM`, read from the actor's own pricing table:
 * **$0.0023 per result**.
 *
 * Unlike the previous actor there is no per-query fee, so cost is linear in the
 * number of results and one constant is the honest model. $5 of monthly credit
 * therefore buys **~2,170 results**, i.e. about 90 profile pulls of 24 reels, or
 * roughly 20 complete plans a month for nothing.
 */
const ITEM_USD = Number(process.env.APIFY_ITEM_USD ?? 0.0023);

/** Query kinds. Only used to pick a default `resultsLimit`; there is no fee. */
type QueryKind = "user" | "search" | "post";

/** Free usage included with the account each month. Set 0 on a paid plan. */
const monthlyFree = (): number => Number(process.env.APIFY_MONTHLY_FREE_USD ?? 5);

/** How many posts one call should ask for. Drives cost, so it is tunable. */
const resultsLimit = (): number => Number(process.env.APIFY_RESULTS_LIMIT ?? 24);

const key = () => process.env.APIFY_TOKEN;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** First defined non-zero number among several candidate fields. */
const pick = (...vals: unknown[]): number => {
  for (const v of vals) {
    const n = num(v);
    if (n) return n;
  }
  return 0;
};

/* ------------------------------------------------------------------ *
 * Monthly free-allowance ledger
 * ------------------------------------------------------------------ */

/**
 * Spend so far this calendar month, persisted to disk.
 *
 * In-memory would reset on every `next start` and the router would keep
 * believing the $5 was unspent, cheerfully overspending the account. The month
 * key means the ledger self-clears on the 1st without a cron job.
 */
const LEDGER_PATH = path.join(process.cwd(), "data", "_apify_usage.json");

interface Ledger {
  month: string;
  usd: number;
  results: number;
}

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function readLedger(): Ledger {
  try {
    const raw = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger;
    if (raw?.month === monthKey()) return raw;
  } catch {
    /* first run of the month, or a corrupt file: start clean */
  }
  return { month: monthKey(), usd: 0, results: 0 };
}

function addSpend(usd: number, results: number): Ledger {
  const led = readLedger();
  const next = { month: led.month, usd: led.usd + usd, results: led.results + results };
  try {
    writeFileSync(LEDGER_PATH, JSON.stringify(next), "utf8");
  } catch {
    /* a failed write over-reports free credit next call, not a broken plan */
  }
  return next;
}

/** What this call costs on the actor's per-result price. */
function price(_kind: QueryKind, items: number): number {
  return items * ITEM_USD;
}

/**
 * What the next call actually costs: nothing while the free allowance lasts.
 *
 * This is the number the router sorts on. It is why Apify is used before a paid
 * vendor rather than after: until the monthly $5 is spent, the marginal price
 * of a pull is genuinely zero, which no paid vendor can match.
 */
function effectiveUsd(kind: QueryKind, items: number): number {
  const led = readLedger();
  if (led.usd >= monthlyFree()) return price(kind, items);
  return 0;
}

export function apifyUsage(): {
  month: string;
  usd: number;
  results: number;
  freeLeftUsd: number;
} {
  const led = readLedger();
  return {
    ...led,
    freeLeftUsd: Math.max(0, monthlyFree() - led.usd),
  };
}

/* ------------------------------------------------------------------ *
 * Translation: Apify actor item -> unified row
 * ------------------------------------------------------------------ */

/**
 * One actor item, in the unified shape `harvest.normalise()` already reads.
 *
 * Written defensively on purpose. This actor mirrors Instagram's own GraphQL
 * field names but has changed key spelling between versions (`videoPlayCount`
 * vs `videoViewCount`, `likesCount` vs `like_count`), and a silent miss here
 * renders a plan full of zeros while blaming the account. Every metric is
 * therefore read through a list of candidates rather than one key, and views
 * are taken from play count first because that is the closer analogue to what
 * the rest of the pipeline calls "views".
 */
function toUnifiedPost(
  item: Record<string, unknown>,
  fallbackAccount?: string,
): Record<string, unknown> {
  const owner = obj(item.owner ?? item.user ?? item.author);
  const music = obj(item.musicInfo ?? item.music_metadata ?? item.music);
  const commentsRaw = Array.isArray(item.latestComments)
    ? (item.latestComments as Record<string, unknown>[])
    : [];

  const hashtags = Array.isArray(item.hashtags)
    ? (item.hashtags as unknown[]).filter((h): h is string => typeof h === "string")
    : Array.isArray(item.caption_hashtags)
      ? (item.caption_hashtags as unknown[]).filter(
          (h): h is string => typeof h === "string",
        )
      : undefined;

  const code =
    str(item.shortCode) ?? str(item.code) ?? str(item.shortcode) ?? str(item.id);
  const views = pick(
    item.videoPlayCount,
    item.playCount,
    item.play_count,
    item.videoViewCount,
    item.viewCount,
    item.views,
  );

  const caption = str(item.caption) ?? str(item.text) ?? "";

  return {
    post: {
      id: code,
      url: str(item.url) ?? str(item.postUrl) ?? str(item.post_url),
      permalink: str(item.url) ?? str(item.postUrl),
      published_at: str(item.timestamp) ?? str(item.takenAt) ?? str(item.taken_at),
      caption,
      author: {
        username:
          str(item.ownerUsername) ??
          str(owner.username) ??
          str(item.username) ??
          fallbackAccount,
        /**
         * Follower counts are the single field the ranking cannot guess safely:
         * `headroom` depends on knowing whether the account breaking out was
         * small. Several candidate keys, because this is where an adapter that
         * "looks right" quietly destroys the ranking.
         */
        followers:
          pick(
            item.ownerFollowersCount,
            item.owner_followers_count,
            owner.followersCount,
            owner.follower_count,
            obj(owner.edge_followed_by).count,
            item.followers,
          ) || undefined,
      },
      content: {
        text: caption,
        duration_seconds:
          pick(item.videoDuration, item.video_duration, item.duration) || undefined,
        thumbnail_url:
          str(item.displayUrl) ?? str(item.thumbnail_url) ?? str(item.thumbnailUrl),
        media_urls: str(item.videoUrl)
          ? [str(item.videoUrl)]
          : str(item.video_url)
            ? [str(item.video_url)]
            : [],
      },
      engagement: {
        views,
        likes: pick(item.likesCount, item.like_count, item.likes),
        comments: pick(item.commentsCount, item.comment_count, item.comments),
      },
      ext: {
        hashtags,
        music: {
          track_title:
            str(music.song_name) ?? str(music.title) ?? str(item.musicName),
        },
        music_id: str(music.audio_id) ?? str(item.musicId) ?? str(item.audio_id),
        top_comments: commentsRaw.map((c) => ({
          text: str(c.text) ?? "",
          likes: pick(c.likesCount, c.like_count),
          author: str(obj(c.owner).username) ?? str(c.ownerUsername) ?? undefined,
          postedAt: str(c.timestamp),
        })),
      },
    },
  };
}

async function runActor(input: Record<string, unknown>): Promise<{
  items: Record<string, unknown>[];
}> {
  const token = key();
  if (!token) {
    throw new ProviderUnavailable("apify", "APIFY_TOKEN missing", true);
  }

  const res = await fetch(
    `${BASE}/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      /**
       * Sync runs hold the HTTP connection open for the whole scrape. A profile
       * with 24 posts takes 20-60s; past three minutes something is wrong and
       * failing beats hanging a creator's request forever.
       */
      signal: AbortSignal.timeout(180_000),
    },
  );

  if (res.status === 402) {
    throw new ProviderUnavailable("apify", "Apify monthly allowance exhausted", true);
  }
  if (res.status === 401) {
    throw new ProviderUnavailable("apify", "APIFY_TOKEN rejected", true);
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderUnavailable("apify", `Apify returned non-JSON (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const err = obj(json).error;
    throw new ProviderUnavailable(
      "apify",
      typeof err === "string" ? err : `HTTP ${res.status}`,
      res.status === 403,
    );
  }

  /**
   * `run-sync-get-dataset-items` returns the dataset items as a bare array. The
   * error envelope, when one arrives, is an object with `error`.
   */
  const items = Array.isArray(json)
    ? (json as Record<string, unknown>[])
    : Array.isArray(obj(json).items)
      ? (obj(json).items as Record<string, unknown>[])
      : [];

  /** Rows the actor marked as failed carry an `error` and no metrics. */
  return { items: items.filter((i) => !str(i.error)) };
}

async function pull(
  kind: QueryKind,
  input: Record<string, unknown>,
  fallbackAccount?: string,
): Promise<PullResult> {
  const { items } = await runActor(input);
  const real = price(kind, items.length);
  const charged = effectiveUsd(kind, items.length);
  addSpend(real, items.length);
  return {
    data: { items: items.map((i) => toUnifiedPost(i, fallbackAccount)) },
    usd: charged,
    units: items.length,
    remaining: null,
  };
}

/**
 * The actor's input for "read this account's recent posts".
 *
 * `directUrls` rather than `startUrls`, and `resultsLimit` rather than
 * `maxItems` — the previous adapter spoke the third-party actor's dialect. This
 * one has been checked against the live API: a profile URL with
 * `resultsType: "posts"` returns that account's own posts, reels included
 * (`productType: "clips"`), and `resultsLimit: 8` returned exactly 8.
 */
const postsInput = (url: string, limit: number): Record<string, unknown> => ({
  directUrls: [url],
  resultsType: "posts",
  resultsLimit: limit,
});

export const apify: DataProvider = {
  id: "apify",
  name: "Apify (Instagram Scraper)",
  /**
   * Representative cost of one pull, used by the router for ordering only.
   * Real money is recorded per call from the result count, not from this.
   */
  cost: {
    usdPerCall: price("user", resultsLimit()),
    label: `$2.30 / 1,000 results · ${monthlyFree().toFixed(0)} free each month`,
  },
  configured: () => Boolean(key()),

  /**
   * The account's recent posts.
   *
   * The plain profile URL, not `/reels/`. Instagram's reels tab is served by a
   * different internal query that this actor does not follow from a bare URL;
   * the profile's post grid does contain the reels (`productType: "clips"`)
   * alongside images, and images carry likes and comments but no view count.
   * The pipeline's outlier maths only counts rows with views, so the images are
   * harmless — they are simply not rankable — and asking for more results than
   * reels are needed is cheaper than a second call.
   */
  profileReels: (handle) =>
    pull(
      "user",
      postsInput(
        `https://www.instagram.com/${handle.replace(/^@/, "")}/`,
        resultsLimit(),
      ),
      handle.replace(/^@/, ""),
    ),

  /**
   * No keyword search — and that is a deliberate refusal, not an omission.
   *
   * This actor takes `search` + `searchType` (`user` | `hashtag` | `place`): it
   * can find *accounts* and *hashtags*, but not "reels matching this phrase".
   * The obvious substitute — pulling `explore/tags/<phrase>/` — was measured and
   * is junk: five posts for `#sourdough` came from accounts with 0, 2, 18 likes
   * and no play counts at all, because the hashtag page is ranked by recency for
   * an anonymous visitor, not by performance. Feeding that into the room would
   * replace "no data" with confidently wrong data.
   *
   * So discovery stays on the free YouTube reader, which the router already
   * prefers for `/search/` paths (`youtubeweb` returns -2 there, this returns
   * nothing), and which measures real view counts for nothing. Apify is the
   * *measurement* vendor: named accounts, real numbers.
   */
  searchReels: () => {
    throw new ProviderUnavailable(
      "apify",
      "apify/instagram-scraper has no keyword search; discovery runs on the free YouTube reader",
    );
  },

  /**
   * One post, in full.
   *
   * A post URL with `resultsType: "posts"` returns that one post, with
   * `latestComments` attached — which is the comment mining the enrichment step
   * wants, without a second paid call.
   */
  post: (url) =>
    pull("post", postsInput(url, 1)),

  /**
   * Who the account is — and the one place this actor needs a different call.
   *
   * A `resultsType: "posts"` pull returns posts whose `owner` object is
   * **empty** (verified live: `owner` was `{}` on all three items), so there is
   * no follower count anywhere in that payload. Reading it off a post — which is
   * what the old adapter did — silently produces `followers: 0`, and a zero here
   * is worse than a miss: the identity check treats an unreadable account as a
   * mismatch and the headroom maths divides by it.
   *
   * `resultsType: "details"` is the call that answers this. Live, for `@natgeo`,
   * it returned `followersCount: 268267261` — the real figure, against the 435
   * that a YouTube fallback once printed. Costs one result, i.e. $0.0023.
   */
  profile: async (handle) => {
    const clean = handle.replace(/^@/, "");
    const { items } = await runActor({
      directUrls: [`https://www.instagram.com/${clean}/`],
      resultsType: "details",
      resultsLimit: 1,
    });
    const real = price("user", items.length);
    const charged = effectiveUsd("user", items.length);
    addSpend(real, items.length);

    const p = items[0] ?? {};
    const followers = pick(
      p.followersCount,
      p.followerCount,
      obj(p.edge_followed_by).count,
      p.followers,
    );

    /**
     * No followers AND no bio means the actor could not read the account at all
     * — private, deleted, or a name that is not a handle. Returning a hollow
     * object here is how "435 followers" got printed for a 268M account, so this
     * reports the failure instead and lets the caller say it could not read it.
     */
    if (!followers && !str(p.biography)) {
      throw new ProviderUnavailable(
        "apify",
        `@${clean} could not be read (private, missing, or not a handle)`,
      );
    }

    return {
      data: {
        user: {
          username: str(p.username) ?? clean,
          followers,
          posts: pick(p.postsCount, p.mediaCount, p.postCount),
          biography: str(p.biography),
          category: str(p.businessCategoryName) ?? str(p.category),
          verified: Boolean(p.verified ?? p.isVerified),
          url: str(p.url) ?? `https://www.instagram.com/${clean}/`,
        },
      },
      usd: charged,
      units: items.length,
      remaining: null,
    };
  },

  /**
   * Remaining allowance, read from the monthly ledger rather than the API.
   *
   * Apify's limits endpoint reports usage in compute units across every actor,
   * not in Instagram results, so converting it would be a guess wearing a
   * number. The ledger is our own spend against the known free allowance, which
   * is the quantity the router actually cares about.
   */
  async balance(): Promise<ProviderBalance> {
    if (!key()) {
      return { remaining: null, unit: "USD", usdSpent: 0, ok: false, error: "no token" };
    }
    const led = apifyUsage();
    return {
      remaining: led.freeLeftUsd > 0 ? Math.floor(led.freeLeftUsd / ITEM_USD) : 0,
      unit: "results",
      usdSpent: led.usd,
      ok: true,
    };
  },
};
