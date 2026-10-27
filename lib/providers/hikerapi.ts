/**
 * HikerAPI adapter — the cheap one.
 *
 * $1.00 / 1,000 calls on Standard ($0.60 at volume), against SocialCrawl's
 * ~$7.60 / 1,000. One cost model change cuts the per-plan bill by roughly 7x,
 * which matters because the free 100-credit tier was only ever 12-25 real plans.
 *
 * HikerAPI speaks Instagram's private-app JSON, so the adapter's job is to
 * translate that into the unified row shape `harvest.normalise()` already
 * reads. Doing the translation here — rather than teaching the harvester a
 * second dialect — keeps the ranking maths vendor-neutral.
 *
 * STATUS (checked 27 Oct 2026): every path below was verified against
 * `https://api.hikerapi.com/openapi.json` (167 paths). Six were wrong when this
 * file first landed and all would have failed on a real account:
 *   - `/v1/user/medias/chunk` is marked "Deprecated: may return 404 for existing
 *     accounts" — the main media pull, i.e. the whole adapter. Now `/g2/user/medias`.
 *   - `/v1/hashtag/medias/top` says "use /v2/hashtag/medias/top instead".
 *   - `/v1/media/by/code` is superseded by `/v2/media/info/by/code`.
 *   - `/v1/sys/balance` does not exist; balance lives at `/sys/balance`.
 *   - `/v1/user/by/username` → `/v2/user/by/username`.
 * Stills and MP4s also arrive nested (`image_versions2.candidates`,
 * `video_versions`), not as flat keys, so every reel came back with no media URL
 * and the deep pass silently watched nothing.
 *
 * Still NOT exercised against a live key. `scripts/probe-vendor.ts` is the
 * integration test — run it against the 100 free signup requests before
 * trusting a paid pull.
 */
import {
  ProviderUnavailable,
  type DataProvider,
  type PullResult,
  type ProviderBalance,
} from "./types";

const BASE = "https://api.hikerapi.com";

/**
 * Real money per request — which is *not* the headline price.
 *
 * HikerAPI's $1.00/1,000 applies only after the balance has reached $100 once.
 * Below that the account pays the Start rate of $0.02 per request — twenty times
 * more. Sending every call there because "$0.001 is the cheapest rate on the
 * pricing page" would have made each niche cost about $0.30 instead of $0.07 on
 * SocialCrawl, i.e. choosing the "cheap" vendor would have quadrupled the bill.
 *
 * So the default is the rate a new account actually pays, and
 * `HIKERAPI_USD_PER_CALL=0.001` is set only once the balance has unlocked
 * Standard. The router sorts on this number, so the cheaper vendor really is the
 * one that gets used.
 */
const usdPerCall = (): number =>
  Number(process.env.HIKERAPI_USD_PER_CALL ?? 0.02);

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

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

const key = () => process.env.HIKERAPI_KEY;

/** Instagram media code from any post/reel URL. */
function codeFromUrl(url: string): string | null {
  const m = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/.exec(url);
  return m?.[1] ?? (/^[A-Za-z0-9_-]{5,}$/.test(url) ? url : null);
}

/**
 * HikerAPI wraps everything in `{ status, response }` in some versions and
 * returns the payload bare in others. Unwrap whichever arrived.
 */
function unwrap(json: Record<string, unknown>): Record<string, unknown> {
  const inner = json.response ?? json.data;
  return inner && typeof inner === "object" ? obj(inner) : json;
}

async function get(
  path: string,
  params: Record<string, string> = {},
): Promise<{ data: Record<string, unknown>; usd: number }> {
  const apiKey = key();
  if (!apiKey) {
    throw new ProviderUnavailable("hikerapi", "HIKERAPI_KEY missing", true);
  }

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { "x-access-key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok || json.status === false || json.success === false) {
    const message = String(
      (json.detail as string) ??
        (json.message as string) ??
        (json.error as string) ??
        `HTTP ${res.status}`,
    );
    const exhausted =
      res.status === 402 ||
      res.status === 403 ||
      /credit|balance|quota|limit/i.test(message);
    throw new ProviderUnavailable("hikerapi", message, exhausted);
  }

  return { data: unwrap(json), usd: usdPerCall() };
}

/**
 * First usable URL out of any of Instagram's still/video envelopes.
 *
 * A reel in the private-app payload does not carry a single `thumbnail_url`:
 * the stills arrive as `image_versions2.candidates[].url` and the MP4 as
 * `video_versions[].url`. Reading only the flat keys left every reel with no
 * media URL at all, which silently disabled the deep pass — `enrich()` filters
 * on `Boolean(mediaUrl)`, so it had nothing to download and reported "watched 0"
 * without an error.
 */
function firstUrl(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const direct = str(c);
    if (direct) return direct;
    if (Array.isArray(c)) {
      for (const item of c) {
        const u = str(obj(item).url) ?? str(obj(item).src);
        if (u) return u;
      }
    }
  }
  return undefined;
}

/** One Instagram media object -> the unified row `fromUnified()` reads. */
function toUnified(
  media: Record<string, unknown>,
  authorHint?: { username?: string; followers?: number },
): Record<string, unknown> | null {
  const user = obj(media.user ?? media.owner ?? media.author);
  const code =
    str(media.code) ?? str(media.shortcode) ?? str(media.pk) ?? str(media.id);
  if (!code) return null;

  const caption = obj(media.caption);
  const text =
    str(caption.text) ?? str(media.caption_text) ?? str(media.title) ?? "";
  const likeCount = num(
    media.like_count ?? media.likes ?? obj(media.edge_liked_by).count,
  );
  const commentCount = num(
    media.comment_count ?? media.comments_count ?? obj(media.edge_media_to_comment).count,
  );
  const playCount = num(
    media.play_count ??
      media.view_count ??
      media.video_view_count ??
      media.video_play_count ??
      media.ig_play_count,
  );
  const takenAt =
    media.taken_at ??
    media.taken_at_timestamp ??
    media.device_timestamp ??
    media.created_at;

  const stills = obj(media.image_versions2).candidates;
  const thumb =
    str(media.thumbnail_url) ??
    firstUrl(stills) ??
    str(media.display_uri);
  const video =
    str(media.video_url) ??
    firstUrl(media.video_versions) ??
    firstUrl(stills);

  /** Audio: HikerAPI exposes it as `music_metadata` on newer endpoints. */
  const music = obj(media.music_metadata ?? media.music ?? media.audio);
  const musicId =
    str(media.music_canonical_id) ??
    str(media.audio_id) ??
    str(obj(music.audio_asset_id).id) ??
    str(music.id);
  const track =
    str(obj(music.music_info).title) ??
    str(music.title) ??
    str(obj(music.original_audio_title).title) ??
    str(media.audio_title);

  const hashtags = Array.isArray(media.hashtags)
    ? (media.hashtags as unknown[]).filter((h): h is string => typeof h === "string")
    : undefined;

  return {
    post: {
      id: code,
      url: `https://www.instagram.com/reel/${code}/`,
      published_at: takenAt,
      content: {
        text,
        media_urls: video ? [video] : thumb ? [thumb] : [],
        thumbnail_url: thumb,
        duration_seconds: num(media.video_duration ?? media.duration),
      },
      author: {
        username: str(user.username) ?? authorHint?.username,
        followers: num(user.follower_count ?? obj(media.user).follower_count) ||
          authorHint?.followers,
      },
      engagement: {
        views: playCount,
        likes: likeCount,
        comments: commentCount,
        shares: num(media.share_count) || undefined,
        saves: num(media.save_count) || undefined,
      },
      ext: {
        hashtags,
        music_id: musicId,
        music: { track_title: track },
        published_at_epoch: typeof takenAt === "number" ? takenAt : undefined,
      },
    },
  };
}

/** Media list from whichever envelope the endpoint returned. */
function mediaRows(data: Record<string, unknown>): Record<string, unknown>[] {
  return arr(
    data.items ?? data.medias ?? data.media ?? data.response ?? data.data,
  );
}

export const hikerapi: DataProvider = {
  id: "hikerapi",
  name: "HikerAPI",
  /**
   * A getter, not a frozen value: the rate depends on the account's tier, and a
   * value captured at import time would keep charging Start prices after the
   * balance unlocked Standard.
   */
  get cost() {
    const usd = usdPerCall();
    return {
      usdPerCall: usd,
      label:
        usd <= 0.0012
          ? "$1.00 / 1,000 calls (Standard unlocked)"
          : `$${(usd * 1000).toFixed(0)} / 1,000 calls (Start — reach a $100 balance to lock $1/1,000)`,
    };
  },
  configured: () => Boolean(key()),

  /**
   * Reels for an account: resolve the username to a pk, then read a page of
   * media. Two calls ($0.002) against SocialCrawl's one credit ($0.0076) — and
   * the profile call also yields a real follower count, which the old pipeline
   * could only guess from reel payloads.
   */
  async profileReels(handle: string): Promise<PullResult> {
    const clean = handle.replace(/^@/, "");
    const prof = await get("/v2/user/by/username", { username: clean });
    const user = obj(prof.data.user ?? prof.data);
    const pk = str(user.pk) ?? str(user.id) ?? str(user.user_id);
    if (!pk) {
      throw new ProviderUnavailable("hikerapi", `no pk for @${clean}`, false);
    }
    const followers = num(user.follower_count) || undefined;

    const media = await get("/g2/user/medias", { user_id: pk });
    const rows = mediaRows(media.data)
      .map((m) => toUnified(m, { username: clean, followers }))
      .filter((r): r is Record<string, unknown> => Boolean(r));

    return {
      data: { items: rows },
      usd: prof.usd + media.usd,
      units: 2,
      remaining: null,
    };
  },

  /**
   * Keyword search has no direct equivalent: Instagram exposes no public
   * keyword->reels endpoint. Translating the phrase into a hashtag is the
   * closest honest mapping (spaces removed, which is how the tag would be
   * written), then reading the tag's top media for real view counts.
   *
   * Two calls. A multi-word phrase becomes one tag, so the room is narrower
   * than SocialCrawl's relevance search — the router treats a thin result as
   * "this vendor found little" rather than "this niche is empty".
   */
  async searchReels(query: string): Promise<PullResult> {
    const tag = query.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!tag) {
      throw new ProviderUnavailable("hikerapi", "no searchable tag in phrase", false);
    }
    const first = await get("/v2/hashtag/medias/top", { name: tag });
    let rows = mediaRows(first.data)
      .map((m) => toUnified(m))
      .filter((r): r is Record<string, unknown> => Boolean(r));
    let usd = first.usd;
    let units = 1;

    // A tag that yields nothing is usually a different spelling, not a dead
    // niche; try recent before declaring the room empty.
    if (!rows.length) {
      const recent = await get("/v2/hashtag/medias/recent", { name: tag });
      rows = mediaRows(recent.data)
        .map((m) => toUnified(m))
        .filter((r): r is Record<string, unknown> => Boolean(r));
      usd += recent.usd;
      units += 1;
    }

    return { data: { items: rows }, usd, units, remaining: null };
  },

  async post(url: string): Promise<PullResult> {
    const code = codeFromUrl(url);
    if (!code) {
      throw new ProviderUnavailable("hikerapi", `no media code in ${url}`, false);
    }
    const { data, usd } = await get("/v2/media/info/by/code", { code });
    const media = obj(data.media ?? data);
    const row = toUnified(media);
    if (!row) {
      throw new ProviderUnavailable("hikerapi", "post payload unreadable", false);
    }

    /**
     * Comments arrive on a separate endpoint. They are valuable (what the
     * audience asks) but not worth a second call per post for the core plan,
     * so the same endpoint is read only when `HIKERAPI_COMMENTS=1`.
     */
    if (process.env.HIKERAPI_COMMENTS === "1") {
      try {
        const c = await get("/v1/media/comments/chunk", { media_id: code });
        const list = arr(c.data.items ?? c.data.comments ?? c.data);
        const post = obj(row.post);
        post.top_comments = list.slice(0, 20).map((x) => ({
          text: str(x.text) ?? "",
          likes: num(x.like_count ?? x.likes),
          username: str(obj(x.user).username) ?? str(x.username),
          published_at: x.created_at ?? x.taken_at,
        }));
        return { data: row, usd: usd + c.usd, units: 2, remaining: null };
      } catch {
        /* comments are optional: the post itself already succeeded */
      }
    }

    return { data: row, usd, units: 1, remaining: null };
  },

  async profile(handle: string): Promise<PullResult> {
    const clean = handle.replace(/^@/, "");
    const { data, usd } = await get("/v1/user/by/username", { username: clean });
    const user = obj(data.user ?? data);
    if (!user.username && !user.follower_count) {
      throw new ProviderUnavailable("hikerapi", `@${clean} not found`, false);
    }
    return {
      data: {
        user: {
          username: str(user.username) ?? clean,
          follower_count: num(user.follower_count),
          media_count: num(user.media_count),
          biography: str(user.biography),
          category: str(user.category) ?? str(user.business_category),
          is_verified: Boolean(user.is_verified),
          profile_url: `https://www.instagram.com/${clean}/`,
        },
      },
      usd,
      units: 1,
      remaining: null,
    };
  },

  async balance(): Promise<ProviderBalance> {
    const apiKey = key();
    if (!apiKey) {
      return { remaining: null, unit: "requests", usdSpent: 0, ok: false, error: "no key" };
    }
    try {
      const { data } = await get("/sys/balance");
      const remaining = num(
        data.balance ?? data.amount ?? data.requests ?? data.credits,
      );
      return { remaining, unit: "requests", usdSpent: 0, ok: true };
    } catch (err) {
      return {
        remaining: null,
        unit: "requests",
        usdSpent: 0,
        ok: false,
        error: (err as Error).message,
      };
    }
  },
};
