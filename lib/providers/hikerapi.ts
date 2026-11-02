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
 * STATUS (verified against live responses, 3 Nov 2026 — fixtures in
 * `lib/providers/__fixtures__/hikerapi/`):
 *   - `/v2/user/by/username` answers `{status, user}` with `pk` (number),
 *     `id` (string) and `follower_count`. A missing handle is HTTP 404 with
 *     `{detail, exc_type}`.
 *   - `/v2/user/clips` answers `{next_page_id, response: {items: [{media}],
 *     paging_info}}` — items are wrapped in `media`, and each media carries
 *     play_count, ig_play_count, like_count, comment_count, reshare_count,
 *     video_duration, taken_at, code, `video_versions[].url`,
 *     `image_versions2.candidates[].url` and `clips_metadata`.
 *   - `/v2/search/reels` answers
 *     `{reels_serp_modules: [{module_type: "clips", clips: [{media}]}], …}`.
 *     The query is sent exactly as typed (native script works).
 *   - `/v2/media/comments?id=<media id>` is the working comments call.
 *     The old `/v1/media/comments/chunk?media_id=` was a 422: it requires
 *     `id`, and the value must be the media's `id` (`<pk>_<owner>`), not the
 *     shortcode. Comments are read on every `post()` by default (one extra
 *     call, +$0.02 at the Start rate); `HIKERAPI_COMMENTS=0` disables them.
 *   - A 500 "Instagram did not respond" (`exc_type: InstagramServerError`) is
 *     transient; `getWithRetry` tries once more after 800 ms. 4xx is never
 *     retried.
 *
 * Still worth re-running `scripts/probe-vendor.ts --live` against a paid key
 * before trusting a large pull: `/sys/balance` and `/v2/media/info/by/code`
 * are the two paths without a recorded fixture here.
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

const hasKeys = (v: Record<string, unknown>): boolean => Object.keys(v).length > 0;

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

/**
 * Ids arrive as strings on some paths and as big numbers on others (`user.pk`
 * is a number, `user.id` its string form). Losing one to `str()` would make the
 * next call go out without an id at all.
 */
const idStr = (v: unknown): string | undefined =>
  str(v) ?? (typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);

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

/**
 * A failed HTTP call, with the two details the retry policy needs.
 *
 * `status` distinguishes a transient 5xx from a permanent 4xx, and `excType`
 * is HikerAPI's own reason (`InstagramServerError` means Instagram refused the
 * scrape, not that the account is empty). Both would be lost if this threw a
 * bare `ProviderUnavailable`.
 */
class HikerHttpError extends ProviderUnavailable {
  constructor(
    message: string,
    exhausted: boolean,
    readonly status: number,
    readonly excType?: string,
    billedUsd?: number,
  ) {
    super("hikerapi", message, exhausted, false, billedUsd);
    this.name = "ProviderUnavailable";
  }
}

/**
 * Does HikerAPI charge for this response?
 *
 * Per its docs, responses with HTTP 200, 400, 403 and 404 are billable; 5xx are
 * not, and 422 is a validation error answered before Instagram is called. A
 * 200 can still be a soft failure (`status: false`), which is why this is keyed
 * on the status the vendor answered rather than on our own success test.
 */
function billedFor(status: number): number | undefined {
  return status === 200 || status === 400 || status === 403 || status === 404
    ? usdPerCall()
    : undefined;
}

/** One HTTP request. No retry — `getWithRetry` owns that decision. */
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
    throw new HikerHttpError(
      message,
      exhausted,
      res.status,
      str(json.exc_type),
      billedFor(res.status),
    );
  }

  return { data: unwrap(json), usd: usdPerCall() };
}

/**
 * One retry for a transient failure, never for a 4xx.
 *
 * A 500 "Instagram did not respond" is usually the scrape being throttled and
 * the same read succeeds a second later. A 404/422 will answer the same way
 * forever, and a 402/403 means the balance is gone — retrying either only
 * spends more of the founder's money.
 */
const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The pause is a seam, not a constant, so tests can prove the retry happens
 * without spending 800 ms of wall clock per failure. Production always uses
 * the real timer below; `setRetrySleepForTests(undefined)` restores it.
 */
let retrySleep: (ms: number) => Promise<void> = realSleep;

export function setRetrySleepForTests(
  sleep?: (ms: number) => Promise<void>,
): void {
  retrySleep = sleep ?? realSleep;
}

async function getWithRetry(
  path: string,
  params: Record<string, string> = {},
): Promise<{ data: Record<string, unknown>; usd: number }> {
  try {
    return await get(path, params);
  } catch (err) {
    if (!(err instanceof HikerHttpError)) throw err;
    const transient =
      err.status >= 500 ||
      (err.excType === "InstagramServerError" && err.status < 400);
    if (!transient) throw err;
    await retrySleep(800);
    return get(path, params);
  }
}

/**
 * Name the handle on a 404. "Not found" alone leaves the creator wondering
 * whether the app broke or the handle is wrong; the review focus asks for a
 * clear error and no invented rows.
 */
function withHandle(err: unknown, handle: string): Error {
  if (err instanceof HikerHttpError && err.status === 404) {
    return new ProviderUnavailable(
      "hikerapi",
      `@${handle} not found on Instagram`,
      false,
      false,
      err.billedUsd,
    );
  }
  return err as Error;
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

/** Instagram reels only: the product's rows are clips, not feed photos. */
function isClip(media: Record<string, unknown>): boolean {
  return str(media.product_type) === "clips";
}

/**
 * A media object, whether the endpoint wrapped it as `{ media: {...} }`
 * (`/v2/user/clips`) or returned it directly.
 */
function asMedia(item: Record<string, unknown>): Record<string, unknown> {
  const inner = obj(item.media);
  return hasKeys(inner) ? inner : item;
}

/** Media list from whichever envelope the endpoint returned. */
function mediaList(data: Record<string, unknown>): Record<string, unknown>[] {
  return arr(data.items ?? data.medias ?? data.media ?? data).map(asMedia);
}

/**
 * The search shelf is triple-nested:
 * `reels_serp_modules[].clips[].media`. Flattening here keeps the caller from
 * depending on the module type or the page shape.
 */
function searchMedia(data: Record<string, unknown>): Record<string, unknown>[] {
  const modules = arr(data.reels_serp_modules);
  if (!modules.length) return mediaList(data);
  return modules.flatMap((module) => arr(obj(module).clips).map(asMedia));
}

/** One Instagram media object -> the unified row `fromUnified()` reads. */
function toUnified(
  media: Record<string, unknown>,
  authorHint?: { username?: string; followers?: number },
): Record<string, unknown> | null {
  const user = obj(media.user ?? media.owner ?? media.author);
  const code =
    str(media.code) ??
    str(media.shortcode) ??
    idStr(media.pk) ??
    idStr(media.id);
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
  /**
   * `play_count` is the number the live reel endpoint reports (and equals
   * `ig_play_count`). It is deliberately the only field read here: a reel whose
   * play_count is missing must read as "no views known" (0), not silently take
   * a different, possibly unrepresentative counter such as view_count.
   */
  const playCount = num(media.play_count);
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

  /**
   * Audio: on a reel the useful data lives in
   * `clips_metadata.original_sound_info` and `clips_metadata.music_info`;
   * `music_metadata` is null on the live clips response. `music_canonical_id`
   * is top-level and works as the stable audio id.
   */
  const clipsMeta = obj(media.clips_metadata);
  const originalSound = obj(clipsMeta.original_sound_info);
  const music = obj(media.music_metadata ?? media.music ?? media.audio);
  const musicInfo = obj(clipsMeta.music_info ?? music.music_info);
  const musicId =
    idStr(media.music_canonical_id) ??
    idStr(clipsMeta.music_canonical_id) ??
    idStr(media.audio_id) ??
    idStr(originalSound.audio_asset_id) ??
    idStr(music.audio_asset_id) ??
    idStr(music.id);
  const track =
    str(musicInfo.title) ??
    str(originalSound.original_audio_title) ??
    str(music.title) ??
    str(media.audio_title);

  const hashtags = Array.isArray(media.hashtags)
    ? (media.hashtags as unknown[]).filter((h): h is string => typeof h === "string")
    : undefined;

  return {
    /**
     * Stamped here as well as in the harvester: this adapter only ever speaks
     * Instagram, and the plan's rule is that no row can drift to another
     * platform. `harvest.fromUnified()` ignores the extra key.
     */
    platform: "instagram",
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
        followers: num(user.follower_count) || authorHint?.followers,
      },
      engagement: {
        views: playCount,
        likes: likeCount,
        comments: commentCount,
        shares: num(media.reshare_count) || num(media.share_count) || undefined,
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
   * First for every Instagram path — the plan's primary vendor.
   *
   * Explicit rather than price-led: Apify's next call can be free inside its
   * monthly allowance while HikerAPI charges $0.02, and "cheapest next call"
   * would then send Instagram search to a vendor that has no keyword search at
   * all. The preference states the product decision instead of hoping the price
   * table agrees with it.
   */
  preference: (p: string) => (/instagram/i.test(p) ? -3 : 0),

  /**
   * Reels for an account: resolve the username to a pk, then read a page of
   * clips. Two calls ($0.04 at the Start rate) and the profile call also yields
   * a real follower count, which the old pipeline could only guess from reel
   * payloads.
   *
   * If the clips tab is empty (a creator with no reels, or a private account)
   * the media tab is read once and filtered to clips, so a reel that Instagram
   * did not put on the tab is not lost. It costs a third call only in that
   * empty case.
   */
  async profileReels(handle: string): Promise<PullResult> {
    const clean = handle.replace(/^@/, "");
    const prof = await getWithRetry("/v2/user/by/username", { username: clean }).catch(
      (err) => {
        throw withHandle(err, clean);
      },
    );
    const user = obj(prof.data.user ?? prof.data);
    const pk = idStr(user.pk) ?? idStr(user.id) ?? idStr(user.user_id);
    if (!pk) {
      throw new ProviderUnavailable("hikerapi", `no pk for @${clean}`, false);
    }
    const followers = num(user.follower_count) || undefined;

    const clips = await getWithRetry("/v2/user/clips", { user_id: pk });
    let media = mediaList(clips.data).filter(isClip);
    let usd = prof.usd + clips.usd;
    let units = 2;

    if (!media.length) {
      const fallback = await getWithRetry("/v2/user/medias", { user_id: pk });
      media = mediaList(fallback.data).filter(isClip);
      usd += fallback.usd;
      units += 1;
    }

    const rows = media
      .map((m) => toUnified(m, { username: clean, followers }))
      .filter((r): r is Record<string, unknown> => Boolean(r));

    return { data: { items: rows }, usd, units, remaining: null };
  },

  /**
   * Keyword search through Instagram's own reel search.
   *
   * The phrase is sent exactly as typed — "kannada songs" and "कन्नड़ गाने"
   * are both valid queries, and translating them to a hashtag first was both
   * wrong and lossy. Only when the search returns zero rows does the old tag
   * logic run (top media, then recent), because a dead phrase is more often a
   * different spelling than a dead niche.
   */
  async searchReels(query: string): Promise<PullResult> {
    const search = await getWithRetry("/v2/search/reels", { query });
    let rows = searchMedia(search.data)
      .filter(isClip)
      .map((m) => toUnified(m))
      .filter((r): r is Record<string, unknown> => Boolean(r));
    let usd = search.usd;
    let units = 1;

    if (!rows.length) {
      const tag = query.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (tag) {
        const top = await getWithRetry("/v2/hashtag/medias/top", { name: tag });
        rows = mediaList(top.data)
          .filter(isClip)
          .map((m) => toUnified(m))
          .filter((r): r is Record<string, unknown> => Boolean(r));
        usd += top.usd;
        units += 1;

        // A tag that yields nothing is usually a different spelling, not a dead
        // niche; try recent before declaring the room empty.
        if (!rows.length) {
          const recent = await getWithRetry("/v2/hashtag/medias/recent", { name: tag });
          rows = mediaList(recent.data)
            .filter(isClip)
            .map((m) => toUnified(m))
            .filter((r): r is Record<string, unknown> => Boolean(r));
          usd += recent.usd;
          units += 1;
        }
      }
    }

    return { data: { items: rows }, usd, units, remaining: null };
  },

  async post(url: string): Promise<PullResult> {
    const code = codeFromUrl(url);
    if (!code) {
      throw new ProviderUnavailable("hikerapi", `no media code in ${url}`, false);
    }
    const { data, usd } = await getWithRetry("/v2/media/info/by/code", { code });
    const media = obj(data.media ?? data);
    const row = toUnified(media);
    if (!row) {
      throw new ProviderUnavailable("hikerapi", "post payload unreadable", false);
    }

    /**
     * Comments are core to the plan ("what people asked for"), so the post
     * read fetches them by default: this is the second call of a post pull and
     * adds one call (+$0.02 at the Start rate). `HIKERAPI_COMMENTS=0` turns it
     * off for a caller that only wants the post itself.
     *
     * Live verification (2026-11-03): `/v2/media/comments?id=<media id>` works
     * and returns `response.comments`. The parameter is `id`; `media_id` is a
     * 422, and the value is the media's `id` (`<pk>_<owner>`), not the code.
     * There is deliberately no fallback to `pk` or the shortcode: neither is
     * accepted by the endpoint, and a wrong id would buy a 422 instead of
     * comments. No id means no comments, quietly.
     */
    const commentsMediaId = idStr(media.id);
    if (process.env.HIKERAPI_COMMENTS !== "0" && commentsMediaId) {
      try {
        const c = await get("/v2/media/comments", { id: commentsMediaId });
        const list = arr(c.data.comments ?? c.data.items ?? c.data);
        const post = obj(row.post);
        /**
         * `post.ext.top_comments`, not `post.top_comments`.
         *
         * `fetchInstagramPost` reads the vendor-neutral envelope
         * (`post.ext.top_comments`) that every other adapter writes and that
         * SocialCrawl's own payload uses. Writing one level higher meant the
         * comments were bought, parsed and then silently dropped: the plan's
         * "what people asked for" section was empty on a pull that had them.
         */
        const ext = obj(post.ext);
        post.ext = {
          ...ext,
          top_comments: list.slice(0, 20).map((x) => ({
            text: str(x.text) ?? "",
            likes: num(x.comment_like_count ?? x.like_count ?? x.likes),
            author: str(obj(x.user).username) ?? str(x.username),
            published_at: x.created_at ?? x.taken_at,
          })),
        };
        return { data: row, usd: usd + c.usd, units: 2, remaining: null };
      } catch {
        /* comments are optional: the post itself already succeeded */
      }
    }

    return { data: row, usd, units: 1, remaining: null };
  },

  async profile(handle: string): Promise<PullResult> {
    const clean = handle.replace(/^@/, "");
    const { data, usd } = await getWithRetry("/v2/user/by/username", {
      username: clean,
    }).catch((err) => {
      throw withHandle(err, clean);
    });
    const user = obj(data.user ?? data);
    if (!user.username && user.follower_count == null) {
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
