/**
 * ScrapeCreators — the second Instagram vendor, and the account reader.
 *
 * Why this one: it is $1.88 / 1,000 requests ($47 / 25,000), against
 * SocialCrawl's $7.60 / 1,000 — about four times cheaper — and it is a
 * genuinely independent source, so a SocialCrawl outage or an empty balance no
 * longer decides whether the site can read an Instagram account at all. That
 * single-vendor dependency is what produced the worst bug in this product: with
 * one balance at zero, the identity read failed, the plan fell back to a
 * YouTube channel that happened to share the handle, and the page printed a
 * stranger's follower count as the creator's own.
 *
 * Shape notes, both verified against the published responses:
 *
 *  - Profile carries Instagram's own GraphQL field names, so followers are at
 *    `data.user.edge_followed_by.count`, not `follower_count`. Reading the wrong
 *    key here would silently produce `undefined` and put us straight back to
 *    "we have no follower count" on a call we had already paid for.
 *  - Account reels carry BOTH `play_count` and `ig_play_count`, which is the
 *    number the outlier maths needs. Keyword search does NOT: its rows arrive
 *    with likes and comments but no view count at all.
 *
 * That last point is why `searchReels` deliberately refuses instead of
 * answering. A room priced from rows with `views: 0` is worse than a room we
 * admit we cannot price: every such row looks like a flop and drags the median
 * down, which is exactly the failure `harvest.ts` already documents for
 * `/instagram/reels/trending`. Discovery stays with the free YouTube reader and
 * with SocialCrawl; this vendor does what it is best at — reading one named
 * account accurately and cheaply.
 */
import {
  ProviderUnavailable,
  type DataProvider,
  type PullResult,
  type ProviderBalance,
} from "./types";

const BASE = "https://api.scrapecreators.com";

/** $47 / 25,000 requests = $1.88 per 1,000. The $497 tier reaches $0.99. */
const USD_PER_CALL = Number(process.env.SCRAPECREATORS_USD_PER_CALL ?? 0.00188);

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
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const key = () => process.env.SCRAPECREATORS_API_KEY;

interface Payload {
  success?: boolean;
  credits_remaining?: number;
  credits_charged?: number;
  error?: unknown;
  data?: unknown;
  [k: string]: unknown;
}

async function call(
  path: string,
  params: Record<string, string> = {},
): Promise<PullResult> {
  const apiKey = key();
  if (!apiKey) {
    throw new ProviderUnavailable("scrapecreators", "SCRAPECREATORS_API_KEY missing", true);
  }

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(45_000),
  });
  const json = (await res.json().catch(() => ({}))) as Payload;
  const units = num(json.credits_charged) || 1;
  const remaining =
    typeof json.credits_remaining === "number" ? json.credits_remaining : null;

  if (!res.ok || json.success === false) {
    const raw = json.error ?? obj(json.error).message ?? `HTTP ${res.status}`;
    const message = String(raw);
    /**
     * Only a spent account or a rejected key benches this vendor for the run.
     * A 404 is "no such public profile", which is a real answer about the
     * handle and must not be mistaken for the vendor being unavailable —
     * benching on it would take the whole vendor offline for one typo.
     */
    const spent =
      res.status === 402 ||
      /insufficient|credit|quota|limit reached/i.test(message) ||
      (typeof json.credits_remaining === "number" && json.credits_remaining < 1);
    throw new ProviderUnavailable("scrapecreators", message, spent);
  }

  return { data: obj(json.data ?? json), usd: units * USD_PER_CALL, units, remaining };
}

/**
 * One reel, translated into the unified row that `harvest.normalise()` reads.
 *
 * Duplicated on purpose rather than shared with the vendor's own field names:
 * the adapter's whole job is to absorb this vendor's dialect so nothing
 * downstream has to know which vendor answered.
 */
function reelRow(media: Record<string, unknown>, handle?: string) {
  const code = str(media.code) ?? str(media.shortcode) ?? str(media.id);
  if (!code) return null;

  const caption = str(media.caption) ?? "";
  const views = num(media.play_count) || num(media.ig_play_count);
  const versions = Array.isArray(media.video_versions)
    ? (media.video_versions as Record<string, unknown>[])
    : [];
  const owner = obj(media.user ?? media.owner ?? media.owner_username);

  return {
    post: {
      id: code,
      url: str(media.url) ?? `https://www.instagram.com/reel/${code}/`,
      caption,
      published_at: media.taken_at,
      taken_at: media.taken_at,
      author: {
        username: str(owner.username) ?? str(media.username) ?? handle,
        followers: num(owner.follower_count ?? owner.followers) || undefined,
      },
      engagement: {
        views,
        likes: num(media.like_count),
        comments: num(media.comment_count),
      },
      content: {
        text: caption,
        media_urls: versions.length ? [str(versions[0].url)].filter(Boolean) : [],
        thumbnail_url: str(media.display_uri) ?? str(media.thumbnail_src),
        duration_seconds: num(media.video_duration) || undefined,
      },
      ext: {
        published_at_epoch: media.taken_at,
        instagram_views: views,
      },
    },
  };
}

export const scrapecreators: DataProvider = {
  id: "scrapecreators",
  name: "ScrapeCreators",
  cost: { usdPerCall: USD_PER_CALL, label: "$1.88 / 1,000 requests" },
  configured: () => Boolean(key()),

  /**
   * The account reader. Cheapest vendor that returns real play counts, so it
   * goes first for a named account and last for anything else.
   */
  preference: (p: string) => {
    if (/search/i.test(p)) return 40;
    return -5;
  },

  async profile(handle: string): Promise<PullResult> {
    const res = await call("/v1/instagram/profile", {
      handle: handle.replace(/^@/, ""),
    });
    const user = obj(obj(res.data).user ?? res.data);
    return {
      ...res,
      /**
       * Flattened into the keys `fetchInstagramProfile` reads. The vendor's
       * GraphQL names (`edge_followed_by`, `edge_owner_to_timeline_media`) are
       * translated here and nowhere else.
       */
      data: {
        user: {
          username: str(user.username) ?? handle.replace(/^@/, ""),
          followers: num(obj(user.edge_followed_by).count),
          following: num(obj(user.edge_follow).count),
          posts: num(obj(user.edge_owner_to_timeline_media).count),
          biography: str(user.biography),
          full_name: str(user.full_name),
          category:
            str(user.category_name) ??
            str(user.business_category_name) ??
            str(user.overall_category_name),
          verified: Boolean(user.is_verified),
          private: Boolean(user.is_private),
          url: str(user.external_url),
        },
      },
    };
  },

  async profileReels(handle: string): Promise<PullResult> {
    const res = await call("/v1/instagram/user/reels", {
      handle: handle.replace(/^@/, ""),
    });
    const list = Array.isArray(res.data.items) ? (res.data.items as unknown[]) : [];
    const rows = list
      .map((it) => reelRow(obj(obj(it).media ?? it), handle.replace(/^@/, "")))
      .filter(Boolean);
    return { ...res, data: { items: rows } };
  },

  /**
   * Refused, not faked. See the header: search rows here carry no view count,
   * so a room priced from them would be arithmetic on zeros.
   */
  async searchReels(query: string): Promise<PullResult> {
    throw new ProviderUnavailable(
      "scrapecreators",
      `no view counts on keyword search — ${query.trim() ? "use a vendor that reports play counts" : "empty query"}`,
      false,
    );
  },

  async post(url: string): Promise<PullResult> {
    const res = await call("/v1/instagram/post", { url });
    const media = obj(obj(res.data).media ?? res.data);
    const row = reelRow(media);
    return { ...res, data: row ?? res.data };
  },

  async balance(): Promise<ProviderBalance> {
    const apiKey = key();
    if (!apiKey) {
      return { remaining: null, unit: "credits", usdSpent: 0, ok: false, error: "no key" };
    }
    try {
      const res = await fetch(`${BASE}/v1/account/credit-balance`, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const data = obj(json.data ?? json);
      const remaining = num(
        json.credits_remaining ??
          data.credits_remaining ??
          data.credits ??
          data.balance ??
          json.credits,
      );
      return { remaining, unit: "credits", usdSpent: 0, ok: res.ok };
    } catch (err) {
      return {
        remaining: null,
        unit: "credits",
        usdSpent: 0,
        ok: false,
        error: (err as Error).message,
      };
    }
  },
};
