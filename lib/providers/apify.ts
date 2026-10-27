/**
 * Apify adapter — the one with a monthly free allowance that never expires.
 *
 * The Apify free plan includes **$5 of usage every month, recurring, no card**.
 * Unused credit expires at the end of the cycle, so the honest way to run this
 * product is to spend it every month rather than hoard it.
 *
 * Which actor matters more than which vendor, and by an order of magnitude:
 *
 *   apify/instagram-scraper          $1.50–2.70 / 1,000 results   (~1,850 free)
 *   hpix/ig-reels-scraper            $0.20 / 1,000 results        (~25,000 free)
 *   apidojo/instagram-scraper-api    $0.50 / 1,000 + free posts   (~10,000 free)
 *
 * This adapter uses **apidojo**, which is not the absolute cheapest per result
 * but is the cheapest one that can answer every call the pipeline makes. The
 * hpix actor cannot do keyword search at all — only named profiles — so it
 * cannot price a niche for a creator who has no handle yet, which is the whole
 * `/start` flow. Paying $0.50 instead of $0.20 buys the product's front door.
 *
 * Apify also bills **per event, per query type**, not a flat per-result rate,
 * and each query type bundles free posts before per-item charges start:
 *
 *   user query     $0.005  + 10 free posts, then $0.0005 each
 *   search query   $0.015  + 20 free posts, then $0.0005 each
 *   single post    $0.005  flat
 *
 * So one full plan is 5 user queries (~12 posts each) + 3 searches (~20 posts
 * each) ≈ $0.075. The $5 monthly credit is therefore **about 66 plans every
 * month, free** — against SocialCrawl's 100 credits, once, ever.
 *
 * VERIFIED AGAINST: the actor's published input schema (`startUrls`, `keywords`,
 * `maxItems`, `getReels`, `until`) and its documented event pricing. NOT yet
 * exercised against a live token: run `npx tsx --env-file=.env.local
 * scripts/probe-vendor.ts --live` once APIFY_TOKEN is set. The free monthly
 * credit is exactly what that probe should be spent on.
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

/** `apidojo/instagram-scraper-api`. `/` must become `~` in the path. */
const ACTOR = "apidojo~instagram-scraper-api";

/**
 * Event prices, USD, from the actor's published table.
 *
 * Kept as named constants rather than a single "per result" number because the
 * query fee dominates at small sizes: a 12-post user pull is mostly the $0.005
 * query fee, while a 200-post pull is mostly items. One blended rate would
 * misprice both ends.
 */
const QUERY_USD = {
  user: 0.005,
  search: 0.015,
  post: 0.005,
} as const;

/** Free posts bundled with each query type before per-item charges apply. */
const FREE_ITEMS = {
  user: 10,
  search: 20,
  post: 0,
} as const;

/** Charged for each post beyond the bundled free allowance. */
const ITEM_USD = 0.0005;

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

/** What this call would cost on a paid plan, from the actor's own event table. */
function price(kind: keyof typeof QUERY_USD, items: number): number {
  const extra = Math.max(0, items - FREE_ITEMS[kind]);
  return QUERY_USD[kind] + extra * ITEM_USD;
}

/**
 * What the next call actually costs: nothing while the free allowance lasts.
 *
 * This is the number the router sorts on. It is why Apify is used before a paid
 * vendor rather than after: until the monthly $5 is spent, the marginal price
 * of a pull is genuinely zero, which no paid vendor can match.
 */
function effectiveUsd(kind: keyof typeof QUERY_USD, items: number): number {
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
  kind: keyof typeof QUERY_USD,
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

export const apify: DataProvider = {
  id: "apify",
  name: "Apify (Instagram Scraper API)",
  /**
   * Representative cost of one pull, used by the router for ordering only.
   * Real money is recorded per call from the result count, not from this.
   */
  cost: {
    usdPerCall: price("user", resultsLimit()),
    label: `$0.50 / 1,000 results · $${monthlyFree().toFixed(0)} free each month`,
  },
  configured: () => Boolean(key()),

  profileReels: (handle) =>
    pull(
      "user",
      {
        startUrls: [`https://www.instagram.com/${handle.replace(/^@/, "")}/reels/`],
        maxItems: resultsLimit(),
      },
      handle.replace(/^@/, ""),
    ),

  /**
   * Keyword discovery — a real keyword search, not a hashtag lookup.
   *
   * The old adapter reduced a phrase to its longest word and searched `#that`,
   * which is why "kannada song covers" became "#kannadasongcovers" and found
   * nothing. Instagram's keyword search understands the phrase as typed, and
   * the phrase is exactly what a niche is, so it is passed through intact.
   */
  searchReels: (query) =>
    pull("search", {
      keywords: [query],
      maxItems: resultsLimit(),
    }),

  post: (url) =>
    pull("post", {
      startUrls: [url],
      maxItems: 1,
    }),

  profile: async (handle) => {
    const clean = handle.replace(/^@/, "");
    /**
     * Two items rather than one: this actor returns posts, not a profile
     * object, so the follower count has to be read off a post's owner. Two
     * makes the mapping survive an account whose newest post is pinned or
     * otherwise skipped.
     */
    const { items } = await runActor({
      startUrls: [`https://www.instagram.com/${clean}/`],
      maxItems: 2,
    });
    const real = price("user", items.length);
    const charged = effectiveUsd("user", items.length);
    addSpend(real, items.length);

    const first = items[0] ?? {};
    const owner = obj(first.owner ?? first.user ?? first.author);
    const followers = pick(
      first.ownerFollowersCount,
      owner.followersCount,
      owner.follower_count,
      obj(owner.edge_followed_by).count,
      first.followers,
    );

    return {
      data: {
        user: {
          username: str(first.ownerUsername) ?? str(owner.username) ?? clean,
          followers,
          posts: pick(owner.postsCount, owner.media_count),
          biography: str(owner.biography) ?? str(first.biography),
          category: str(owner.category) ?? str(first.category),
          verified: Boolean(owner.is_verified ?? first.verified),
          url: `https://www.instagram.com/${clean}/`,
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
