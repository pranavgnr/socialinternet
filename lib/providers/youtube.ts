/**
 * YouTube adapter — the only vendor that is genuinely free.
 *
 * The official Data API v3 gives **10,000 quota units per day, every day, with
 * no card and no trial**. Against the calls this pipeline makes that is roughly
 * 99 keyword searches a day, or a few thousand channel pulls. No other vendor
 * in the router has a free tier that renews.
 *
 * Why it is worth carrying even though the product is Instagram-first:
 *
 *  1. **It makes the site work with no money at all.** A creator with no handle
 *     — the `/start` flow — is asking "which room should I enter". That question
 *     is answered from a keyword search and the accounts that show up in it.
 *     YouTube answers both, for free.
 *  2. **It closes the ranking's biggest blind spot.** Instagram scraping APIs
 *     often do not return a follower count on search rows, so `headroom` has to
 *     infer account size from view counts — a guess that flatters big accounts.
 *     YouTube returns `subscriberCount` on every row. Same maths, real input.
 *  3. Shorts are the same format. A 40-second vertical video that broke out on
 *     YouTube is evidence about a format, even when the creator posts on Reels.
 *
 * Quota is counted locally per Pacific-time day because that is when Google
 * resets it. `search.list` costs 100 units — by far the most expensive call in
 * the whole router — so searches are the thing to ration, not channel pulls.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ProviderUnavailable,
  type DataProvider,
  type ProviderBalance,
  type PullResult,
} from "./types";

const BASE = "https://www.googleapis.com/youtube/v3";

/** Google's daily allowance, in quota units. */
const DAILY_QUOTA = 10_000;

/** Published cost of each call type, in quota units. */
const COST = {
  channels: 1,
  playlistItems: 1,
  videos: 1,
  search: 100,
} as const;

const key = () => process.env.YOUTUBE_API_KEY;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
};

/* ------------------------------------------------------------------ *
 * Daily quota ledger
 * ------------------------------------------------------------------ */

const LEDGER_PATH = path.join(process.cwd(), "data", "_youtube_usage.json");

interface Ledger {
  /** Pacific calendar day — Google resets quota at midnight PT */
  day: string;
  units: number;
  searches: number;
}

/** The quota day in Google's own timezone, so the reset matches theirs. */
function quotaDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function readLedger(): Ledger {
  try {
    const raw = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger;
    if (raw?.day === quotaDay()) return raw;
  } catch {
    /* first run of the day, or a corrupt file: start clean */
  }
  return { day: quotaDay(), units: 0, searches: 0 };
}

function addSpend(units: number, search: boolean): Ledger {
  const led = readLedger();
  const next = {
    day: led.day,
    units: led.units + units,
    searches: led.searches + (search ? 1 : 0),
  };
  try {
    writeFileSync(LEDGER_PATH, JSON.stringify(next), "utf8");
  } catch {
    /* a failed write over-reports free quota next call, not a broken plan */
  }
  return next;
}

export function youtubeUsage(): { day: string; units: number; searches: number; left: number } {
  const led = readLedger();
  return { ...led, left: Math.max(0, DAILY_QUOTA - led.units) };
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

async function api(
  endpoint: string,
  params: Record<string, string>,
  units: number,
): Promise<Record<string, unknown>> {
  const token = key();
  if (!token) throw new ProviderUnavailable("youtube", "YOUTUBE_API_KEY missing", true);

  const led = readLedger();
  if (led.units + units > DAILY_QUOTA) {
    throw new ProviderUnavailable(
      "youtube",
      `daily quota spent (${led.units}/${DAILY_QUOTA} units)`,
      true,
    );
  }

  const qs = new URLSearchParams({ ...params, key: token });
  const res = await fetch(`${BASE}/${endpoint}?${qs}`, {
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderUnavailable("youtube", `non-JSON reply (HTTP ${res.status})`);
  }

  addSpend(units, endpoint === "search");

  if (!res.ok) {
    const err = obj(obj(json).error);
    const message = str(err.message) ?? `HTTP ${res.status}`;
    /**
     * A quotaExceeded error means the day is done — bench the vendor rather
     * than letting every remaining call in the plan fail one at a time.
     */
    const exhausted = /quota/i.test(message);
    throw new ProviderUnavailable("youtube", message, exhausted);
  }

  return obj(json);
}

/* ------------------------------------------------------------------ *
 * Translation: YouTube video -> unified row
 * ------------------------------------------------------------------ */

/** `PT1M4S` -> 64. YouTube's ISO-8601 durations are otherwise unusable. */
function isoSeconds(iso: unknown): number | undefined {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
    typeof iso === "string" ? iso : "",
  );
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  const total = num(d) * 86_400 + num(h) * 3_600 + num(min) * 60 + num(s);
  return total > 0 ? Math.round(total) : undefined;
}

/** Hashtags out of a title/description, the way creators actually write them. */
function tagsOf(text: string): string[] {
  return [...text.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)]
    .map((m) => m[1])
    .slice(0, 30);
}

/**
 * A video plus its channel, in the unified row shape.
 *
 * `channel` carries the subscriber count, which is the whole reason this
 * adapter is worth carrying: it is the one provider that always knows how big
 * the account was. Passed through as `followers` so `opportunity.smallness()`
 * reads one number regardless of platform.
 */
function toUnified(
  video: Record<string, unknown>,
  channel: Record<string, unknown>,
): Record<string, unknown> {
  const snippet = obj(video.snippet);
  const stats = obj(video.statistics);
  const details = obj(video.contentDetails);
  const channelTitle = str(snippet.channelTitle) ?? "unknown";
  const videoId = str(video.id) ?? "";
  const caption = [str(snippet.title) ?? "", str(snippet.description) ?? ""]
    .filter(Boolean)
    .join("\n");

  return {
    post: {
      id: videoId,
      url: `https://www.youtube.com/shorts/${videoId}`,
      permalink: `https://www.youtube.com/watch?v=${videoId}`,
      published_at: str(snippet.publishedAt),
      caption: caption.slice(0, 800),
      author: {
        /** the account key the ranking groups on — one per channel */
        username: channelTitle,
        followers: num(obj(channel.statistics).subscriberCount) || undefined,
      },
      content: {
        text: caption.slice(0, 800),
        duration_seconds: isoSeconds(details.duration),
        thumbnail_url:
          str(obj(snippet.thumbnails).medium)
            ? str(obj(obj(snippet.thumbnails).medium).url)
            : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        media_urls: [],
      },
      engagement: {
        /** Shorts surface their view count here, like an IG play count */
        views: num(stats.viewCount),
        likes: num(stats.likeCount),
        comments: num(stats.commentCount),
      },
      ext: {
        hashtags: tagsOf(caption),
        platform: "youtube",
      },
    },
  };
}

/** Fetch statistics for up to 50 ids in one 1-unit call. */
async function hydrate(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  const json = await api(
    "videos",
    {
      part: "snippet,statistics,contentDetails",
      id: ids.slice(0, 50).join(","),
      maxResults: "50",
    },
    COST.videos,
  );
  const out = new Map<string, Record<string, unknown>>();
  for (const v of arr(json.items)) {
    const id = str(v.id);
    if (id) out.set(id, v);
  }
  return out;
}

/** Subscriber counts for the channels behind a set of videos. */
async function channels(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(ids)].filter(Boolean).slice(0, 50);
  if (!unique.length) return new Map();
  const json = await api(
    "channels",
    { part: "statistics,snippet", id: unique.join(","), maxResults: "50" },
    COST.channels,
  );
  const out = new Map<string, Record<string, unknown>>();
  for (const c of arr(json.items)) {
    const id = str(c.id);
    if (id) out.set(id, c);
  }
  return out;
}

/** Resolve "@handle" or a channel id to a channel record. */
async function channelByHandle(handle: string): Promise<Record<string, unknown> | null> {
  const clean = handle.replace(/^@/, "");
  /**
   * `forHandle` is the exact match and costs the same as a search. It only
   * exists on channels that have claimed a handle, which is most of them; the
   * fallback covers older channels and channel URLs pasted as ids.
   */
  const forms: Record<string, string>[] = [
    { forHandle: `@${clean}`, part: "statistics,snippet,contentDetails" },
    { forUsername: clean, part: "statistics,snippet,contentDetails" },
    { id: clean, part: "statistics,snippet,contentDetails" },
  ];
  for (const params of forms) {
    try {
      const json = await api("channels", { ...params, maxResults: "1" }, COST.channels);
      const hit = arr(json.items)[0];
      if (hit) return hit;
    } catch (err) {
      if (err instanceof ProviderUnavailable && err.exhausted) throw err;
      /* a 400 on a speculative lookup is not a failure — try the next form */
    }
  }
  return null;
}

export const youtube: DataProvider = {
  id: "youtube",
  name: "YouTube (official API)",
  /** A profile pull is ~3 units of a 10,000/day allowance, so effectively free. */
  cost: {
    usdPerCall: 0,
    label: "free · 10,000 quota units / day",
  },
  configured: () => Boolean(key()),

  /**
   * Free and excellent at keyword discovery; a bad first guess for an Instagram
   * handle. Search goes here first because it costs nothing and the alternative
   * is $0.015. Profile pulls go last so a benchmark handle is not sent to
   * YouTube on the chance that the creator also posts Shorts.
   */
  preference: (path) => (/search/.test(path) ? -1 : 10),

  /**
   * A channel's recent uploads.
   *
   * Three calls: resolve the channel, read its uploads playlist, hydrate the
   * videos. ~3 units, so a plan that benchmarks five accounts costs 15 of the
   * 10,000 daily units.
   */
  async profileReels(handle) {
    const ch = await channelByHandle(handle);
    if (!ch) {
      throw new ProviderUnavailable("youtube", `no channel for ${handle}`);
    }
    const uploads = str(obj(obj(ch.contentDetails).relatedPlaylists).uploads);
    if (!uploads) return { data: { items: [] }, usd: 0, units: 0, remaining: null };

    const pl = await api(
      "playlistItems",
      { part: "contentDetails", maxResults: "24", playlistId: uploads },
      COST.playlistItems,
    );
    const ids = arr(pl.items)
      .map((i) => str(obj(i.contentDetails).videoId))
      .filter((v): v is string => Boolean(v))
      .slice(0, 24);

    const vids = await hydrate(ids);
    const rows = [...vids.values()].map((v) => toUnified(v, ch));
    return { data: { items: rows }, usd: 0, units: 0, remaining: null };
  },

  /**
   * Keyword search over Shorts.
   *
   * `videoDuration=short` plus `order=viewCount` is the closest thing the
   * official API offers to "the reels that are winning in this room". 100 units
   * per call, so this is the one call the engine is careful never to repeat for
   * the same phrase — `researchNiche` caches on disk for that reason.
   */
  async searchReels(query) {
    const json = await api(
      "search",
      {
        part: "snippet",
        q: query,
        type: "video",
        videoDuration: "short",
        order: "viewCount",
        maxResults: "25",
      },
      COST.search,
    );

    const ids = arr(json.items)
      .map((i) => str(obj(i.id).videoId))
      .filter((v): v is string => Boolean(v));

    const vids = await hydrate(ids);
    const chIds = [...vids.values()].map((v) => str(obj(v.snippet).channelId) ?? "");
    const chans = await channels(chIds);

    const rows = [...vids.values()].map((v) => {
      const chId = str(obj(v.snippet).channelId) ?? "";
      return toUnified(v, chans.get(chId) ?? {});
    });
    return { data: { items: rows }, usd: 0, units: 0, remaining: null };
  },

  async post(url) {
    const id =
      /(?:shorts\/|watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(url)?.[1] ?? "";
    if (!id) throw new ProviderUnavailable("youtube", `not a YouTube link: ${url}`);

    const vids = await hydrate([id]);
    const video = vids.get(id);
    if (!video) throw new ProviderUnavailable("youtube", `no video ${id}`);

    const chId = str(obj(video.snippet).channelId) ?? "";
    const chans = await channels([chId]);
    const row = toUnified(video, chans.get(chId) ?? {});
    return { data: { items: [row] }, usd: 0, units: 0, remaining: null };
  },

  async profile(handle) {
    const ch = await channelByHandle(handle);
    if (!ch) throw new ProviderUnavailable("youtube", `no channel for ${handle}`);
    const stats = obj(ch.statistics);
    const snippet = obj(ch.snippet);
    return {
      data: {
        user: {
          username: str(snippet.title) ?? handle.replace(/^@/, ""),
          /** subscribers — the same quantity as followers, same maths */
          followers: num(stats.subscriberCount),
          posts: num(stats.videoCount),
          biography: str(snippet.description),
          category: "youtube",
          verified: false,
          url: `https://www.youtube.com/@${handle.replace(/^@/, "")}`,
        },
      },
      usd: 0,
      units: 0,
      remaining: null,
    };
  },

  async balance(): Promise<ProviderBalance> {
    if (!key()) {
      return { remaining: null, unit: "units", usdSpent: 0, ok: false, error: "no key" };
    }
    const led = youtubeUsage();
    return { remaining: led.left, unit: "quota units", usdSpent: 0, ok: true };
  },
};
