/**
 * YouTube web adapter — real data with **no API key and no credits**.
 *
 * Every other vendor in the router is either paid or needs a signup, which is
 * how the whole site came to a halt when the 100 free SocialCrawl credits ran
 * out: with a balance of zero, *every* uncached niche search answered "we are at
 * capacity". A product whose discovery step can be switched off by an empty
 * wallet is not a product.
 *
 * YouTube's public search and channel pages carry everything the analysis
 * actually needs, in the page's own `ytInitialData` JSON:
 *
 *   - search results: video id, title, **view count**, channel name and id
 *   - channel pages: **subscriber count**, video list, per-video views, ages
 *
 * That is the full input for the opportunity maths — room demand, account size,
 * per-account baselines, breakout ratios, freshness. No key, no quota, no card.
 *
 * Deliberate limits, because this is scraping and should behave like a guest:
 *
 *   - one page per call, never a crawl; a search is one request plus at most a
 *     handful of cached subscriber lookups
 *   - subscriber counts are cached for 24h on disk, so repeated niche searches
 *     for the same space cost nothing after the first
 *   - results are labelled `platform: "youtube"` all the way through. A YouTube
 *     channel called "@cooking" is a *different* account from an Instagram one,
 *     and merging them would corrupt every baseline in the room.
 *
 * What it cannot do: view a private Instagram handle, or read Instagram
 * comments. Those still need a paid vendor. This adapter exists so that the
 * discovery half of the product — "what is happening in this space, and can a
 * newcomer get in" — never depends on one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ProviderUnavailable,
  type DataProvider,
  type ProviderBalance,
  type PullResult,
} from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Where subscriber lookups are cached between runs. */
const CACHE_FILE = path.join(process.cwd(), "data", "_yt_subs.json");

/** How long a subscriber count is trusted. Follower counts move slowly. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SubCacheEntry {
  subs: number | null;
  title?: string;
  bio?: string;
  at: number;
}

let cache: Record<string, SubCacheEntry> | null = null;

function loadCache(): Record<string, SubCacheEntry> {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, SubCacheEntry>;
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache(): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache ?? {}), "utf8");
  } catch {
    // A read-only data dir must not fail a pull; the cache is an optimisation.
  }
}

/* ------------------------------------------------------------------ parsing */

/** "8.1K" -> 8100, "1.2M" -> 1200000, "1,234 views" -> 1234, "163K subscribers" -> 163000 */
export function parseCount(input: unknown): number {
  if (typeof input === "number") return input;
  const text = String(input ?? "").replace(/,/g, "").toLowerCase();
  const m = text.match(/([\d.]+)\s*(k|m|b|thousand|million|billion)?/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  /**
   * Shorts spell the magnitude out ("19 thousand views") while every other
   * surface abbreviates it ("19k"), so both have to be read. Miss the words and
   * every Short's view count parses as 19, which reads as a dead room.
   */
  const unit = m[2] ?? "";
  const scale =
    unit === "k" || unit === "thousand"
      ? 1e3
      : unit === "m" || unit === "million"
        ? 1e6
        : unit === "b" || unit === "billion"
          ? 1e9
          : 1;
  return Math.round(n * scale);
}

/**
 * YouTube's own unit abbreviations -> milliseconds.
 *
 * YouTube does not write "8 months ago" on a channel page; it writes "8mo ago",
 * and "7y ago", "10d ago", "3h ago". The first version of this parser only knew
 * the spelled-out words, so every abbreviated age failed to match and fell
 * through to "now". Measured on a live pull, that stamped all 297 reels in a
 * room with the *same* timestamp: every video looked seconds old, freshness was
 * pinned at 1.0 for every niche, and views-per-hour was computed over one hour
 * for the entire sample. Breakout detection read that inflated velocity as
 * evidence, so the rooms that "won" the ranking were whichever ones happened to
 * come back without usable dates.
 *
 * Order matters: the regex is an ordered alternation, so longer and more
 * specific units must come before the single letters they start with ("month"
 * before "mo" before "m"), or "mo" is parsed as minutes.
 */
const UNIT_MS: Record<string, number> = {
  s: 1e3, sec: 1e3, second: 1e3,
  m: 60e3, min: 60e3, minute: 60e3,
  h: 3600e3, hr: 3600e3, hour: 3600e3,
  d: 86400e3, day: 86400e3,
  w: 604800e3, week: 604800e3,
  mo: 2592000e3, month: 2592000e3,
  y: 31536000e3, yr: 31536000e3, year: 31536000e3,
};

const AGE_RE =
  /(\d+)\s*(second|sec|minute|min|month|mo|hour|hr|year|yr|day|week|s|m|h|d|w|y)s?\s*ago/;

/**
 * "10d ago" / "8mo ago" / "3 weeks ago" / "Streamed 2 years ago" -> ISO date.
 *
 * Returns **empty string** when the text carries no age, and that is the
 * important half. The old version returned the current time on a miss, which
 * turned "we do not know when this was posted" into the much stronger and
 * completely false claim "this was posted just now". Unknown has to stay
 * unknown all the way down to the scoring layer, or the freshness and velocity
 * signals are measuring the harvest clock instead of the videos.
 */
export function parseAge(input: unknown, now = Date.now()): string {
  const text = String(input ?? "")
    .toLowerCase()
    .replace(/^(streamed|premiered|premiere)\s+/, "");
  const m = text.match(AGE_RE);
  if (!m) return "";
  const n = Number(m[1]);
  const unit = UNIT_MS[m[2]];
  if (!unit) return "";
  return new Date(now - n * unit).toISOString();
}

function initialData(html: string): Record<string, unknown> | null {
  // `[\s\S]` rather than the `s` flag: the project targets pre-ES2018.
  const m =
    html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ??
    html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Depth-first collect of every object satisfying `hit`. */
function collect(
  root: unknown,
  hit: (o: Record<string, unknown>) => Record<string, unknown> | null,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const obj = node as Record<string, unknown>;
    const found = hit(obj);
    if (found) out.push(found);
    for (const key in obj) walk(obj[key]);
  };
  walk(root);
  return out;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/* ----------------------------------------------------------------- fetching */

async function get(url: string, timeoutMs = 15_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      // 429 is the one status worth remembering for the rest of the run.
      throw new ProviderUnavailable(
        "youtubeweb",
        `youtube web returned ${res.status}`,
        res.status === 429,
      );
    }
    return await res.text();
  } catch (err) {
    if (err instanceof ProviderUnavailable) throw err;
    const e = err as Error;
    throw new ProviderUnavailable(
      "youtubeweb",
      e.name === "AbortError" ? "youtube web timed out" : e.message,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** @handle or UC... channel id -> the /videos URL for that channel. */
function channelUrl(handle: string): string {
  const clean = handle.trim().replace(/^@/, "");
  if (/^UC[\w-]{20,}$/.test(clean)) return `https://www.youtube.com/channel/${clean}/videos`;
  return `https://www.youtube.com/@${encodeURIComponent(clean)}/videos`;
}

interface ChannelInfo {
  subs: number | null;
  title?: string;
  bio?: string;
}

async function channelInfo(handle: string): Promise<ChannelInfo> {
  const key = handle.trim().replace(/^@/, "").toLowerCase();
  const store = loadCache();
  const hit = store[key];
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { subs: hit.subs, title: hit.title, bio: hit.bio };
  }

  const html = await get(channelUrl(handle));

  /**
   * Subscriber counts are no longer a tidy JSON field — they sit in the rendered
   * header as text ("163K subscribers"). Reading the visible string is more
   * stable across YouTube's frequent schema churn than chasing the view-model
   * path, which has changed twice this year.
   */
  const subsMatch = html.match(/([\d.,]+\s*[KMB]?)\s+subscribers/i);
  const subs = subsMatch ? parseCount(subsMatch[1]) : null;
  const title =
    html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ??
    html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*-\s*YouTube$/, "");
  const bio = html.match(/<meta property="og:description" content="([^"]*)"/)?.[1];

  store[key] = { subs, title, bio, at: Date.now() };
  saveCache();
  return { subs, title, bio };
}

interface WebVideo {
  id: string;
  title: string;
  views: number;
  publishedAt: string;
  /** channel display name, from search rows — NOT an identity */
  channel?: string;
  /**
   * The channel's own handle (`@name`) or its UC… id.
   *
   * This is the field everything downstream must key on. The display name is a
   * free-text label: it contains spaces, changes independently of the account,
   * and is not a URL. Using it as the account name meant every benchmark pull
   * asked YouTube for `/@"Ashkan Sadeghi"` and got a 404, so no account ever got
   * a baseline and the room median was computed over viral search hits instead
   * of over real channel history.
   */
  channelHandle?: string;
  channelId?: string;
  durationSec?: number;
}

/** Videos listed on a channel's /videos page (the current lockup shape). */
function channelVideos(data: Record<string, unknown>): WebVideo[] {
  const now = Date.now();
  return collect(data, (o) => {
    const lockup = o.lockupViewModel;
    if (!lockup || typeof lockup !== "object") return null;
    const l = lockup as Record<string, unknown>;
    const id = str(l.contentId);
    if (!id) return null;
    const meta = (l.metadata ?? {}) as Record<string, unknown>;
    const md = (meta.lockupMetadataViewModel ?? {}) as Record<string, unknown>;
    const title = str((md.title as Record<string, unknown> | undefined)?.content);
    const rows = ((
      (md.metadata as Record<string, unknown> | undefined)?.contentMetadataViewModel as
        | Record<string, unknown>
        | undefined
    )?.metadataRows ?? []) as Record<string, unknown>[];
    const parts = rows.flatMap(
      (r) =>
        (((r.metadataParts ?? []) as Record<string, unknown>[]).map((p) =>
          str((p.text as Record<string, unknown> | undefined)?.content),
        ) as (string | undefined)[]) ?? [],
    );
    /**
     * The view count is rendered as a bare "8.1K" beside "10d ago" — it does
     * *not* include the word "views". Matching on /view/ found nothing, every
     * video scored 0 views, and the whole channel was filtered out as having
     * "no public videos". So: the age is the part ending in "ago", and the view
     * count is the remaining part that contains a digit.
     */
    const ageText = parts.find((p) => p && /ago/i.test(p));
    const viewsText = parts.find((p) => p && !/ago/i.test(p) && /\d/.test(p));
    return {
      id,
      title: title ?? "",
      views: viewsText ? parseCount(viewsText) : 0,
      publishedAt: parseAge(ageText, now),
    } as unknown as Record<string, unknown>;
  }) as unknown as WebVideo[];
}

/** Videos in a search result page (videoRenderer, the stable shape). */
function searchVideos(data: Record<string, unknown>): WebVideo[] {
  const now = Date.now();
  return collect(data, (o) => {
    const v = o.videoRenderer;
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    const id = str(r.videoId);
    if (!id) return null;
    const title = str(
      ((r.title as Record<string, unknown> | undefined)?.runs as
        | Record<string, unknown>[]
        | undefined)?.[0]?.text as string,
    );
    const viewText =
      str((r.viewCountText as Record<string, unknown> | undefined)?.simpleText) ??
      str(
        (((r.viewCountText as Record<string, unknown> | undefined)?.runs as
          | Record<string, unknown>[]
          | undefined) ?? []).map((x) => x.text).join(""),
      );
    const owner = ((r.ownerText as Record<string, unknown> | undefined)?.runs as
      | Record<string, unknown>[]
      | undefined)?.[0];
    const nav = (owner?.navigationEndpoint ?? {}) as Record<string, unknown>;
    const browse = (nav.browseEndpoint ?? {}) as Record<string, unknown>;
    const channelId = str(browse.browseId);
    /**
     * `canonicalBaseUrl` is "/@handle" — the one field on a search row that is
     * an actual account address rather than a label.
     */
    const channelHandle = str(browse.canonicalBaseUrl)?.replace(/^\//, "");
    const length = str((r.lengthText as Record<string, unknown> | undefined)?.simpleText);
    const durationSec = length
      ? length.split(":").reduce((acc, part) => acc * 60 + Number(part), 0)
      : undefined;
    return {
      id,
      title: title ?? "",
      views: viewText ? parseCount(viewText) : 0,
      publishedAt: parseAge(
        str((r.publishedTimeText as Record<string, unknown> | undefined)?.simpleText),
        now,
      ),
      channel: str(owner?.text as string),
      channelId,
      channelHandle,
      durationSec,
    } as unknown as Record<string, unknown>;
  }) as unknown as WebVideo[];
}

/**
 * Shorts from a `/shorts` page or a search shelf.
 *
 * Kept separate from `searchVideos` (rather than merged) on purpose: a Short's
 * page carries **no publish date**, and freshness is part of the opportunity
 * score. Mixing undated Shorts into the main set would quietly mark live rooms
 * as "graveyards of old hits". So Shorts are only used when there is nothing
 * else — and when they are used, the missing date stays missing instead of
 * being invented as "now".
 */
function shortsFrom(data: Record<string, unknown>, now = Date.now()): WebVideo[] {
  return collect(data, (o) => {
    const s = o.shortsLockupViewModel;
    if (!s || typeof s !== "object") return null;
    const r = s as Record<string, unknown>;
    const cmd = ((r.onTap ?? {}) as Record<string, unknown>).innertubeCommand as
      | Record<string, unknown>
      | undefined;
    const reel = (cmd?.reelWatchEndpoint ?? {}) as Record<string, unknown>;
    const id =
      str(reel.videoId) ?? str(r.entityId)?.replace(/^shorts-shelf-item-/, "");
    if (!id) return null;

    const overlay = (r.overlayMetadata ?? {}) as Record<string, unknown>;
    const title =
      str((overlay.primaryText as Record<string, unknown> | undefined)?.content) ??
      str(r.accessibilityText)?.split(",")[0];
    const viewsText = str((overlay.secondaryText as Record<string, unknown> | undefined)?.content);

    return {
      id,
      title: title ?? "",
      views: viewsText
        ? parseCount(viewsText)
        : parseCount(str(r.accessibilityText)?.match(/([\d.,]+\s*(?:k|m|b|thousand|million))/i)?.[1]),
      /** unknown, deliberately: a Short page does not say when it was posted */
      publishedAt: "",
    } as unknown as Record<string, unknown>;
  }) as unknown as WebVideo[];
}

/* ------------------------------------------------------------ row assembly */

function median(values: number[]): number {
  const clean = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : Math.round((clean[mid - 1] + clean[mid]) / 2);
}

/**
 * One video in the unified `{ post: {...} }` row shape.
 *
 * `ratio` is views against *that channel's own* median, not the room's — the
 * distinction the whole outlier method rests on. A 500k-view video from a
 * channel that always does 500k is not a breakout, and calling it one is how a
 * feed fills with advice to "just be bigger".
 */
/**
 * The account a video belongs to, in the only form that can be looked up again.
 *
 * Handle first (`@name` — what a human would type and what the channel page
 * accepts), then the UC… id, and only then the display name, which is a last
 * resort that will 404 on any channel whose name is not handle-shaped.
 */
function accountOf(v: WebVideo): string {
  const handle = v.channelHandle?.replace(/^@/, "");
  if (handle) return handle;
  if (v.channelId) return v.channelId;
  return v.channel ?? "unknown";
}

function row(
  video: WebVideo,
  account: string,
  subs: number | null,
  baseline: number,
  sourceWindow?: "recent" | "established" | "shorts",
): Record<string, unknown> {
  return {
    post: {
      id: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      published_at: video.publishedAt,
      author: {
        username: account,
        followers: subs ?? undefined,
      },
      engagement: {
        views: video.views,
        likes: 0,
        comments: 0,
      },
      content: {
        text: video.title,
        duration_seconds: video.durationSec,
      },
      ext: {
        platform: "youtube",
        /** which shelf this came from — see RawReel.sourceWindow */
        window: sourceWindow,
      },
    },
    computed: {
      vs_creator: {
        ratio: baseline > 0 ? video.views / baseline : undefined,
      },
    },
  };
}

/**
 * Enrich channels with subscriber counts, bounded and best-effort.
 *
 * Headroom is the highest-weighted signal in the opportunity score and it is
 * computed from account size, so a search that returns no sizes quietly turns
 * the ranking into "which room is biggest". Subscriber lookups are free but
 * cost a request each, so this runs with a small pool and keeps going when one
 * channel fails (a deleted channel must not fail the whole search).
 */
async function enrichSubs(
  videos: WebVideo[],
  limit = 10,
): Promise<Map<string, number | null>> {
  /**
   * Look each channel up by its **channel id** (UC…), not its display name.
   * "@Natashas Kitchen" is not a valid handle — handles cannot contain spaces —
   * so every lookup built from a display name 404'd and only the rare channel
   * whose name happened to be handle-shaped came back with a subscriber count.
   * That silently removed the highest-weighted signal from the ranking.
   */
  const targets: { name: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const v of videos) {
    const name = accountOf(v);
    if (!name || name === "unknown" || seen.has(name)) continue;
    seen.add(name);
    targets.push({ name, id: v.channelId ?? name });
    if (targets.length >= limit) break;
  }

  const out = new Map<string, number | null>();

  const pool = 3;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const { name, id } = targets[cursor++];
      try {
        const info = await channelInfo(id);
        out.set(name, info.subs);
      } catch {
        out.set(name, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(pool, targets.length) }, worker));
  return out;
}

/* ---------------------------------------------------------------- adapter */

export const youtubeweb: DataProvider = {
  id: "youtubeweb",
  name: "YouTube (no key)",
  cost: { usdPerCall: 0, label: "free — no key, no credits, no quota" },
  configured: () => process.env.YOUTUBE_WEB !== "0",

  /**
   * How early this vendor is tried. Free first for *discovery*, last for
   * anything that promises an Instagram account — a YouTube channel is not that
   * account, and serving one would merge two different creators into a single
   * baseline.
   */
  preference: (p: string) => {
    if (/search/i.test(p)) return -2;
    if (/instagram/i.test(p)) return 50;
    return 0;
  },

  async searchReels(query: string): Promise<PullResult> {
    if (!query.trim()) {
      throw new ProviderUnavailable("youtubeweb", "empty query");
    }

    /**
     * Ask for *recent* short-form first, and only widen the window if the shelf
     * is too thin.
     *
     * This is the difference between a real measurement and a meaningless one.
     * An unfiltered `results?search_query=` page is ranked by relevance, which
     * on YouTube means evergreen hits: measured on "sourdough baking", the plain
     * page returned videos aged 1y, 2y, 4y, 5y, 6y. Every consequence followed
     * from that:
     *
     *   - freshness computed to exp(-365/45) ≈ 0.0003, so *every* room scored as
     *     a graveyard of old hits, and the signal carried no information at all;
     *   - a relevance page is mostly channels that are already famous, so the
     *     share of breakouts from small accounts measured 0% in every room —
     *     the one input that answers "could a newcomer do this too" was a
     *     constant zero.
     *
     * The `sp` values are YouTube's own search filters (base64 protobuf), not
     * guesses: `EgYIAxABGAE` = upload date *this week*, type video, duration
     * *short*. Verified against the live page — 20 of 20 rows dated 1–7 days old,
     * where the unfiltered page gave none newer than five months.
     *
     * "Short" is < 4 minutes rather than < 60 seconds because YouTube exposes no
     * finer filter and, critically, this is the only recent shelf that still
     * carries a publish date. A true Shorts shelf omits the date entirely, and
     * inventing one is worse than the compromise: freshness would look measured
     * while resting on nothing.
     */
    const WINDOWS = [
      { sp: "EgYIAxABGAE", label: "this week · short" },
      { sp: "EgQIBBAB", label: "this month" },
      { sp: "", label: "most relevant" },
    ];
    /** Below this, the shelf is too thin to be a room — widen the window. */
    const MIN_ROWS = 8;

    let videos: WebVideo[] = [];
    let windowLabel = "";
    let sawData = false;

    for (const w of WINDOWS) {
      let data: Record<string, unknown> | null = null;
      try {
        const url =
          `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` +
          (w.sp ? `&sp=${w.sp}` : "");
        data = initialData(await get(url));
      } catch {
        // One dead window must not cost the whole search; try the next.
        continue;
      }
      if (!data) continue;
      sawData = true;

      const found = searchVideos(data).filter((v) => v.views > 0);
      /**
       * Keep the best set seen so far, then stop as soon as a window is wide
       * enough. `>=` rather than `>` so a narrow window is never chosen over a
       * broader one that returned the same count.
       */
      if (found.length >= videos.length) {
        videos = found;
        windowLabel = w.label;
      }
      if (videos.length >= MIN_ROWS) break;
    }

    if (!sawData) {
      throw new ProviderUnavailable("youtubeweb", "search page had no ytInitialData");
    }

    /**
     * Shorts are the fallback, not the first try: their pages carry no publish
     * date, so using them by default would quietly mark every room as undated.
     */
    if (!videos.length) {
      videos = shortsFrom(initialData(await get(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      )) ?? {}).filter((v) => v.views > 0);
      windowLabel = "shorts";
    }
    if (!videos.length) {
      throw new ProviderUnavailable("youtubeweb", `no results for "${query}"`);
    }

    /**
     * A second sample from the unfiltered relevance page, merged in.
     *
     * The recent window alone measures the room only at the bottom. On
     * "sourdough baking" it returned 12 accounts, every one under 100k
     * followers, medians in the low hundreds — a true statement about this
     * week's uploads and a false one about the space, which also contains
     * channels doing 1.4M on the same subject. Scoring demand off the recent
     * shelf alone rated *every* room "small": the same failure as the original
     * unfiltered pull in the opposite direction.
     *
     * So the two samples answer two different questions, and the scorer needs
     * both. Recent rows: is this room alive, and who is breaking out now.
     * Relevance rows: how big is this room really. Merged, the account-size
     * range is honest and the cohort top-up can stratify across it instead of
     * sampling one end of it.
     */
    /** ids that came off the relevance shelf, so `row()` can tag them */
    const established = new Set<string>();

    if (windowLabel !== "most relevant") {
      try {
        const wider = initialData(
          await get(
            `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
          ),
        );
        if (wider) {
          const seen = new Set(videos.map((v) => v.id));
          for (const v of searchVideos(wider).filter((v) => v.views > 0)) {
            if (seen.has(v.id)) continue;
            seen.add(v.id);
            videos.push(v);
            established.add(v.id);
          }
          windowLabel = `${windowLabel} + relevance`;
        }
      } catch {
        // The recent sample is still a usable room; never fail the search for it.
      }
    }

    /**
     * Sixteen accounts rather than ten: the merged sample has roughly twice the
     * distinct accounts, and a size range is only useful if both ends get sized.
     * Each lookup is one page, cached for a day.
     */
    const subs = await enrichSubs(videos, 16);

    /**
     * No baseline is attached to a search row, deliberately.
     *
     * The first version used the median of the same channel's videos *within
     * this result set*. That is circular: the page is a handful of that
     * creator's best-performing videos, chosen for relevance, so every row
     * divides a video by a page that already contains it and lands near 1.0.
     * Measured on a real pull, 40 reels produced a best ratio of 1.96 and zero
     * outliers — a mathematically guaranteed empty plan.
     *
     * The control group has to be the creator's own history, which is a separate
     * read (the channel page, still free). Until that happens the scorer falls
     * back to the room median and labels the ratio `niche`, which is the weaker
     * claim — and now it is honest about being weaker.
     */
    const items = videos.map((v) => {
      const account = accountOf(v);
      const shelf = windowLabel === "shorts"
        ? "shorts"
        : established.has(v.id)
          ? "established"
          : "recent";
      return row(v, account, subs.get(account) ?? null, 0, shelf);
    });

    return {
      /**
       * `window` is carried out so the audit line and the log can say *which*
       * freshness window answered. Without it, "median 8d old" is unattributable
       * and the next person cannot tell a genuinely live room from a search that
       * silently fell back to relevance.
       */
      data: { items, query, source: "youtube-web", window: windowLabel },
      usd: 0,
      units: 0,
      remaining: null,
    };
  },

  async profileReels(handle: string): Promise<PullResult> {
    /**
     * `/videos` first: it is the only listing with both views and ages, and the
     * per-account baseline is meaningless without views. `/shorts` is the
     * fallback for a channel that posts nothing else — exactly the short-form
     * creators this product is for.
     */
    let videos: WebVideo[] = [];
    let data = initialData(await get(channelUrl(handle)));
    if (data) videos = channelVideos(data).filter((v) => v.views > 0);

    if (!videos.length) {
      const shortsHtml = await get(channelUrl(handle).replace(/\/videos$/, "/shorts"));
      data = initialData(shortsHtml);
      if (data) videos = shortsFrom(data).filter((v) => v.views > 0);
    }

    if (!videos.length) {
      throw new ProviderUnavailable(
        "youtubeweb",
        `channel @${handle} has no public videos`,
      );
    }

    const info = await channelInfo(handle).catch(() => ({ subs: null }) as ChannelInfo);

    /**
     * Leave-one-out baseline: each video is judged against the channel's median
     * *excluding itself*.
     *
     * Including the video in its own control group quietly shrinks every ratio
     * on small channels — a 12-video channel with one breakout has that breakout
     * driving a sixth of its own baseline. The difference is small on a large
     * channel and decisive on a new one, which is exactly the creator this
     * product is for. Cost: one median per row, no extra requests.
     */
    const views = videos.map((v) => v.views);
    const items = videos.map((v, i) => {
      const others = views.filter((_, j) => j !== i);
      const baseline = others.length >= 3 ? median(others) : median(views);
      return row(v, handle.replace(/^@/, ""), info.subs, baseline);
    });

    return {
      data: {
        items,
        creator_baseline: { baseline: { median_views: median(views) } },
      },
      usd: 0,
      units: 0,
      remaining: null,
    };
  },

  async profile(handle: string): Promise<PullResult> {
    const info = await channelInfo(handle);
    return {
      data: {
        profile: {
          username: handle.replace(/^@/, ""),
          full_name: info.title,
          biography: info.bio,
          followers: info.subs,
        },
      },
      usd: 0,
      units: 0,
      remaining: null,
    };
  },

  async post(url: string): Promise<PullResult> {
    const html = await get(url);
    const viewsMatch = html.match(/([\d,]+)\s+views/i);
    const title =
      html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? "";
    const id = url.match(/[?&]v=([\w-]{6,})/)?.[1] ?? url.match(/\/([\w-]{11})$/)?.[1] ?? url;
    /**
     * A watch page *does* carry a real upload date in its microformat block, so
     * there is no reason to invent one. If neither field is present the date is
     * left empty — an unknown date is honest, "posted just now" is not.
     */
    const uploaded =
      html.match(/"publishDate"\s*:\s*"([^"]+)"/)?.[1] ??
      html.match(/"uploadDate"\s*:\s*"([^"]+)"/)?.[1] ??
      "";
    return {
      data: {
        post: {
          id,
          url,
          published_at: uploaded,
          author: {},
          engagement: { views: viewsMatch ? parseCount(viewsMatch[1]) : 0, likes: 0, comments: 0 },
          content: { text: title },
        },
      },
      usd: 0,
      units: 0,
      remaining: null,
    };
  },

  async balance(): Promise<ProviderBalance> {
    return { remaining: null, unit: "requests", usdSpent: 0, ok: true };
  },
};
