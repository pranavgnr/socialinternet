import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  accountProfile,
  inLanguage,
  languageName,
  normaliseLang,
  roomLanguage,
} from "./lang";
import type { AccountLangProfile } from "./lang";
import type {
  Platform,
  Profile,
  RawComment,
  RawReel,
  ReelRelevance,
  SoundStats,
} from "./types";
import {
  availableProviders,
  checkBalance as providerBalance,
  creditLedger,
  paidReady,
  request,
  resetCreditLedger,
  type CreditLedger,
  type LogicalCall,
  type ProviderId,
} from "./providers";

const SOCIALCRAWL = "https://www.socialcrawl.dev/v1";

/**
 * Spend accounting moved to the provider router (lib/providers), which counts
 * real money as well as vendor units, enforces the budget, and records which
 * vendor served each call. Re-exported so every existing importer keeps working
 * against the same names.
 */
export { creditLedger, resetCreditLedger } from "./providers";
export type { CreditLedger } from "./providers";

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(n)) return 0;
    return /k/i.test(v) ? n * 1_000 : /m/i.test(v) ? n * 1_000_000 : n;
  }
  return 0;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** `media_urls` arrives as one URL, or as a list of them, per provider. */
const firstUrl = (v: unknown): string | undefined => {
  if (typeof v === "string") return /^https?:\/\//.test(v) ? v : undefined;
  if (Array.isArray(v)) {
    for (const u of v) {
      if (typeof u === "string" && /^https?:\/\//.test(u)) return u;
    }
  }
  return undefined;
};

/** ISO date from an ISO string or a unix-seconds number/string. */
/**
 * A vendor timestamp -> ISO, or **empty string when there is no usable date**.
 *
 * The empty case used to return `new Date().toISOString()`, which was the most
 * damaging line in the pipeline: a vendor that omitted `published_at` (YouTube
 * Shorts never publish one) had every one of its rows stamped with the harvest
 * time. Downstream that became "posted 2 seconds ago", which maximised the
 * freshness multiplier, divided views by one hour to fake an enormous velocity,
 * and made those rows the top breakouts in every room. The ranking was reading
 * the clock, not the content.
 *
 * An absent date is information: it means freshness cannot be claimed for that
 * row. Keeping it absent is what lets the scoring layer say "not measurable"
 * instead of quietly inventing the most flattering answer.
 */
function toIso(v: unknown): string {
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  if (typeof v === "string" && v) {
    if (/^\d+$/.test(v)) return new Date(Number(v) * 1000).toISOString();
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return "";
}

/**
 * A row's relevance judgement, or undefined when it has not been scored yet.
 *
 * Kept strictly to what the vendor reported: a missing score is left missing,
 * because "no judgement" and "judged irrelevant" are opposite pieces of
 * evidence and collapsing them is how a gate starts inventing.
 */
function relevanceOf(v: unknown): ReelRelevance | undefined {
  const r = obj(v);
  if (!Object.keys(r).length) return undefined;
  const p = r.p;
  if (typeof p !== "number" || !Number.isFinite(p)) return undefined;
  return {
    p,
    sense: str(r.sense) ?? undefined,
    depth: typeof r.depth === "number" ? r.depth : undefined,
    spam: typeof r.spam === "number" ? r.spam : undefined,
  };
}

/**
 * SocialCrawl's unified schema: { post: { id, url, content, author, engagement,
 * published_at, ext }, computed: {...} }. Profile calls also carry a
 * creator baseline, which we pass down because it is the control group for
 * every outlier ratio on that account.
 */
function fromUnified(
  row: Record<string, unknown>,
  platform: Platform,
  fallbackAccount?: string,
  baselineMedianViews?: number,
): RawReel | null {
  const post = obj(row.post);
  const content = obj(post.content);
  const author = obj(post.author);
  const eng = obj(post.engagement);
  const ext = obj(post.ext);
  const computed = obj(row.computed);
  const music = obj(ext.music);
  const vsCreator = obj(computed.vs_creator);

  const code = str(post.id) ?? str(post.url);
  if (!code) return null;

  const rawRatio = vsCreator.ratio;
  const caption =
    str(content.text) ?? str(post.caption) ?? str(post.title) ?? "";

  return {
    id: `${platform}_${code}`,
    platform,
    account: (str(author.username) ?? str(post.account) ?? fallbackAccount ?? "unknown")
      .replace(/^@/, ""),
    followers: num(author.followers ?? author.follower_count) || undefined,
    url: str(post.url) ?? str(post.permalink) ?? "",
    caption: caption.slice(0, 800),
    postedAt: toIso(post.published_at ?? ext.published_at_epoch ?? post.taken_at),
    views: num(eng.views ?? ext.instagram_views ?? post.views),
    likes: num(eng.likes ?? post.likes),
    comments: num(eng.comments ?? post.comments),
    shares: num(eng.shares) || undefined,
    saves: num(eng.saves) || undefined,
    audioId: str(ext.music_id) ?? undefined,
    audioName: str(music.track_title) ?? undefined,
    /**
     * The MP4 link, free on every search row. Without it a reel can only be
     * judged on its caption and tags — and the caption is exactly what lies on
     * a Telugu song with an English title. With it the reel can be watched.
     */
    mediaUrl: firstUrl(content.media_urls),
    thumbnail: str(content.thumbnail_url) ?? undefined,
    durationSec: num(content.duration_seconds) || undefined,
    hashtags: Array.isArray(ext.hashtags)
      ? (ext.hashtags as unknown[]).filter((h): h is string => typeof h === "string")
      : undefined,
    nicheLabel: str(obj(computed.labels).niche ? obj(obj(computed.labels).niche).label : undefined),
    /** the provider saw the audio, so its language tag is the best evidence */
    language: normaliseLang(computed.language) ?? normaliseLang(content.language) ?? undefined,
    /**
     * The vendor's free relevance judgement, kept rather than recomputed.
     *
     * `computed.relevance` is scored against the query we sent, which is
     * exactly the question the subject gate asks, and it is a different reader
     * from ours — it has read the reel's audio and the whole caption, and it
     * answers "is the thing this query names present here", which no bag of
     * words can.
     *
     * Search is asked for `relevance=score` so every row arrives judged. A row
     * the vendor still could not judge is sent as null and is left null here:
     * "no judgement" and "judged irrelevant" are opposite pieces of evidence,
     * and the gate treats them as such.
     */
    relevance: relevanceOf(computed.relevance),
    providerRatio: typeof rawRatio === "number" && rawRatio > 0 ? rawRatio : undefined,
    /** which search shelf produced this row, when the vendor says (YouTube does) */
    sourceWindow:
      str(ext.window) === "established"
        ? "established"
        : str(ext.window) === "recent"
          ? "recent"
          : str(ext.window) === "shorts"
            ? "shorts"
            : undefined,
    baselineMedianViews,
  };
}

/** Older flat shapes, kept so cached payloads and other providers still parse. */
function fromLegacy(
  row: Record<string, unknown>,
  platform: Platform,
  fallbackAccount?: string,
): RawReel | null {
  const node = obj(row.node ?? row);
  const user = obj(node.owner ?? node.user ?? node.author);
  const audio = obj(node.audio ?? node.music ?? node.track);
  const stats = obj(node.statistics ?? node.stats ?? node);
  const code = str(node.code) ?? str(node.shortcode) ?? str(node.id);
  const url = str(node.url) ?? str(node.permalink);
  if (!url && !code) return null;
  return {
    id: `${platform}_${code ?? url}`,
    platform,
    account: (str(user.username) ?? str(node.username) ?? fallbackAccount ?? "unknown").replace(/^@/, ""),
    followers: num(user.follower_count ?? user.followers) || undefined,
    url: url ?? (platform === "instagram" ? `https://instagram.com/reel/${code}` : code!),
    caption: (str(node.caption) ?? str(node.text) ?? str(node.title) ?? "").slice(0, 800),
    postedAt: toIso(node.taken_at ?? node.timestamp ?? node.published_at ?? node.created_at),
    views: num(stats.view_count ?? stats.views ?? stats.play_count),
    likes: num(stats.like_count ?? stats.likes),
    comments: num(stats.comment_count ?? stats.comments),
    shares: num(stats.share_count ?? stats.shares) || undefined,
    audioId: str(audio.id) ?? undefined,
    audioName: str(audio.title ?? audio.name) ?? undefined,
    thumbnail: str(node.thumbnail ?? node.display_url) ?? undefined,
    language: normaliseLang(node.language) ?? undefined,
  };
}

function normalise(
  row: Record<string, unknown>,
  platform: Platform,
  fallbackAccount?: string,
  baselineMedianViews?: number,
): RawReel | null {
  return row.post
    ? fromUnified(row, platform, fallbackAccount, baselineMedianViews)
    : fromLegacy(row, platform, fallbackAccount);
}

interface CallResult {
  data: Record<string, unknown>;
  creditsUsed: number;
  creditsRemaining: number | null;
  /** which vendor answered — decides the platform stamped on every row */
  provider?: ProviderId;
}

/**
 * The platform a vendor's rows describe.
 *
 * Only YouTube differs today, but the point is general: rows carry a `platform`
 * and an account key, and labelling YouTube results "instagram" would merge two
 * different creators called "@cooking" into one account and corrupt the outlier
 * baseline. The mapping lives here, once, rather than at each call site.
 */
function platformFor(provider: ProviderId | undefined): "instagram" | "youtube" {
  return provider === "youtube" || provider === "youtubeweb" ? "youtube" : "instagram";
}

/**
 * One logical call, served by whichever vendor the router picks.
 *
 * The name survives because every caller below only cares *what* it asked for.
 * Which vendor answers is now an implementation detail of lib/providers, so
 * switching from SocialCrawl to a cheaper vendor is an env change rather than a
 * refactor of this file — and a vendor that runs out of credits fails over mid-
 * plan instead of killing it.
 */
async function socialcrawl(
  path: string,
  params: Record<string, string> = {},
  expectedCost = 1,
): Promise<CallResult> {
  const result = await request(
    { path, ...params } as unknown as LogicalCall,
    expectedCost,
  );
  return {
    data: result.data,
    creditsUsed: result.units,
    creditsRemaining: result.remaining,
    provider: result.provider,
  };
}

function items(data: Record<string, unknown>): Record<string, unknown>[] {
  const list = data.items ?? data.results ?? data.reels;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

/**
 * Reels from one benchmark account — 1 credit for a page of ~12.
 *
 * Deliberately the standard endpoint, not /profile/reels/full: the composite
 * costs 5 credits per page to add a per-reel share count that is null on most
 * rows anyway. Shares are not part of the outlier maths, views are.
 */
/**
 * One account's recent posts, read from the platform that account lives on.
 *
 * The niche search returns accounts from whichever vendor served it, so the
 * top-up that follows must ask for the *same* platform. Asking an Instagram
 * vendor for a YouTube channel either fails or, worse, silently returns a
 * different creator's history and installs it as the room's baseline.
 */
export async function harvestAccountReels(
  handle: string,
  platform: "instagram" | "youtube",
): Promise<RawReel[]> {
  if (platform === "youtube") {
    /**
     * The official API is tried first when a key exists (it is free inside the
     * 10k unit/day quota and returns a clean uploads list); the scraped channel
     * page is the no-key fallback and always available.
     */
    if (process.env.YOUTUBE_API_KEY) {
      try {
        const viaApi = await harvestYouTubeChannel(handle);
        if (viaApi.length) return viaApi;
      } catch {
        // fall through to the web reader
      }
    }
    /**
     * The free channel reader before the paid one.
     *
     * A YouTube channel costs nothing to read, and this branch used to call the
     * paid vendor regardless — so at a zero balance a YouTube handle could not
     * be read at all, even though the free reader was configured and working
     * next to it. That is what made the fallback in `readOwnAccount` fail
     * silently: it detected the right channel, then died buying its posts.
     *
     * Same response shape (`items` + `creator_baseline`), so the rows below are
     * normalised identically whichever vendor answered.
     */
    const free = availableProviders("youtube").find((p) => p.cost.usdPerCall === 0);
    if (free) {
      try {
        const { data } = await free.profileReels(handle);
        const baseline =
          num(obj(obj(data.creator_baseline).baseline).median_views) || undefined;
        const rows = items(data)
          .map((row) => normalise(row, "youtube", handle, baseline))
          .filter((r): r is RawReel => Boolean(r));
        if (rows.length) return rows;
      } catch {
        // fall through to the paid vendor
      }
    }
    const { data, provider } = await socialcrawl(
      "/account/reels",
      { handle, platform: "youtube" },
      1,
    );
    const baseline =
      num(obj(obj(data.creator_baseline).baseline).median_views) || undefined;
    return items(data)
      .map((row) => normalise(row, platformFor(provider), handle, baseline))
      .filter((r): r is RawReel => Boolean(r));
  }
  return harvestInstagramAccount(handle);
}

export async function harvestInstagramAccount(handle: string): Promise<RawReel[]> {
  const { data, provider } = await socialcrawl("/instagram/profile/reels", { handle }, 1);
  const baseline = num(obj(obj(data.creator_baseline).baseline).median_views) || undefined;
  return items(data)
    .map((row) => normalise(row, platformFor(provider), handle, baseline))
    .filter((r): r is RawReel => Boolean(r));
}

/**
 * Reels for a keyword — 1 credit. This is the cheap way to discover which
 * accounts are worth benchmarking, and it returns real view counts.
 */
export async function harvestInstagramSearch(query: string): Promise<RawReel[]> {
  const { reels } = await searchReelsWithMeta(query);
  return reels;
}

/** What the vendor's own judge did with a page, when it reports it. */
export interface RelevanceCoverage {
  /** "complete" | "partial" | "skipped" */
  status: string;
  rows: number;
  /** rows carrying a verdict this time */
  scored: number;
  /** rows still being judged — they carry null, and are judged next call */
  pending: number;
  /** rows the vendor's filter dropped, only in `filter` mode */
  dropped: number;
}

export function relevanceCoverage(data: Record<string, unknown>): RelevanceCoverage | null {
  const r = obj(data.relevance);
  if (!Object.keys(r).length) return null;
  return {
    status: str(r.status) ?? "unknown",
    rows: num(r.rows),
    scored: num(r.scored),
    pending: num(r.pending),
    dropped: Array.isArray(r.dropped_ids) ? r.dropped_ids.length : num(r.dropped),
  };
}

/**
 * The search response with the provider's own counts still attached.
 *
 * `harvestInstagramSearch` throws the envelope away, which is right for the
 * pipeline and wrong for a probe: the difference between "the provider found
 * eight reels" and "the provider found thirty and its own relevance filter
 * dropped twenty-two" is the difference between a thin room and a strict one.
 *
 * The call asks for `relevance=score`, which is free and makes the vendor
 * finish judging every row before the page is sent. The default judges in the
 * background and sends the unjudged rows with `computed.relevance: null` —
 * 12 of 30 on a fresh page in the sample pull — and those are exactly the rows
 * the subject gate would then have to decide with a word bag.
 */
export async function searchReelsWithMeta(
  query: string,
): Promise<{ data: Record<string, unknown>; reels: RawReel[]; judged: RelevanceCoverage | null }> {
  const { data, provider } = await socialcrawl(
    "/instagram/search/reels",
    { query, relevance: "score" },
    1,
  );
  const reels = items(data)
    .map((row) => normalise(row, platformFor(provider)))
    .filter((r): r is RawReel => Boolean(r));
  return { data, reels, judged: relevanceCoverage(data) };
}

export interface PostPayload {
  url: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  saves?: number;
  durationSec?: number;
  audioName?: string;
  followers?: number;
  postedAt: string;
  /** signed CDN link to the reel itself; short-lived, read it the same day */
  mediaUrl?: string;
  /** the comments Instagram shows under the post, ~10-20 of them */
  topComments: RawComment[];
}

/**
 * One post in full — 1 credit, and the only paid call in the enrichment path.
 *
 * Chosen over /instagram/post/comments (5 credits a page) because the same
 * credit also returns ext.top_comments and the MP4 URL: comments to mine, and
 * a video that can be transcribed locally for nothing. The comments endpoint is
 * kept for depth later; this is the bang-for-buck one.
 */
export async function fetchInstagramPost(url: string): Promise<PostPayload> {
  const { data } = await socialcrawl("/instagram/post", { url }, 1);
  /**
   * The post, from whichever envelope the vendor used.
   *
   * Two shapes arrive here for the same logical call. SocialCrawl answers
   * `{ post: {...} }`. Every other vendor answers the router's unified
   * `{ items: [ { post: {...} } ] }` — the *same inner object*, one level
   * further down.
   *
   * Reading only `data.post` therefore found nothing whenever Apify served the
   * call, and an empty object parses as a valid but blank post: caption "",
   * views 0, `topComments` []. That silent empty is why the comment section
   * disappeared from the plan and why no reel ever carried an audio name to
   * compare against other accounts — the paid data had arrived and was thrown
   * away by one missing level of unwrapping. Verified live on 2026-10-28:
   * `items[0].post.ext.top_comments` held 14 comments and the track title.
   */
  const row = items(data)[0];
  const post = obj(data.post ?? (row ? (obj(row).post ?? row) : data));
  const content = obj(post.content);
  const author = obj(post.author);
  const eng = obj(post.engagement);
  const ext = obj(post.ext);
  const music = obj(ext.music);

  const media = content.media_urls;
  const mediaUrl =
    typeof media === "string"
      ? media
      : Array.isArray(media)
        ? (media.map((m) => (typeof m === "string" ? m : str(obj(m).url))).find(Boolean) as string | undefined)
        : undefined;

  const rawComments = Array.isArray(ext.top_comments) ? (ext.top_comments as Record<string, unknown>[]) : [];
  const topComments: RawComment[] = rawComments
    .map((c) => ({
      text: String(c.text ?? "").trim(),
      likes: num(c.likes),
      /** `author` is an object on SocialCrawl and a bare handle on Apify. */
      username: str(obj(c.author).username) ?? str(c.author) ?? str(c.username),
      /** `published_at` on SocialCrawl, `postedAt` on the unified shape. */
      publishedAt: c.published_at
        ? toIso(c.published_at)
        : c.postedAt
          ? toIso(c.postedAt)
          : undefined,
    }))
    .filter((c) => c.text.length > 0);

  /**
   * A blank post is not a post, and must never be returned as one.
   *
   * When the vendor answers with an empty `items` list — rate-limited, private,
   * deleted, or a 200 carrying nothing — every field below reads `undefined`
   * and this function used to hand back a perfectly valid-looking post with
   * caption "", views 0 and `topComments` []. `enrich` then cached that empty
   * object for a week, so the account's comment section vanished and stayed
   * vanished on every re-run: measured on @natgeotravel, fourteen cached rows
   * held nothing, and the same posts re-read by hand carried 15 comments and
   * 1.04M views. Throwing here keeps the hole out of the cache — the caller
   * records the miss and the next run tries again.
   */
  const payload = {
    url: str(post.url) ?? url,
    caption: String(content.text ?? post.caption ?? "").slice(0, 800),
    views: num(eng.views ?? ext.instagram_views ?? ext.video_view_count),
    likes: num(eng.likes),
    comments: num(eng.comments),
    shares: num(eng.shares) || undefined,
    saves: num(eng.saves) || undefined,
    durationSec: num(content.duration_seconds) || undefined,
    audioName: str(obj(ext.music).track_title) ?? str(music.title),
    followers: num(author.followers) || undefined,
    postedAt: toIso(post.published_at ?? ext.published_at_epoch),
    mediaUrl,
    topComments,
  };

  /**
   * The three things any real post has at least one of. A payload with none of
   * them is the vendor's empty envelope, not a quiet post.
   */
  const empty =
    !payload.caption.trim() &&
    !payload.views &&
    !payload.likes &&
    !payload.comments &&
    !payload.topComments.length &&
    !payload.mediaUrl &&
    !payload.postedAt;
  if (empty) {
    throw new Error("vendor returned an empty post (nothing to read, and not cached)");
  }

  return payload;
}

/* --------------------- the rest of the SocialCrawl shelf --------------------- */

/**
 * Balance, for free. Every plan already reads `credits_remaining` off its own
 * calls, but a page that shows the balance before it spends anything needs a
 * call that costs nothing.
 */
export async function creditBalance(): Promise<number | null> {
  const { balance } = await providerBalance();
  return balance;
}

export interface EndpointInfo {
  id: string;
  credits: number;
  summary: string;
}

/**
 * The catalogue, for free. 676 endpoints is too many to hardcode and too easy
 * to guess wrong, so the price of any endpoint is one free call away — which is
 * how a new source gets added without burning credits on 404s.
 */
export async function searchEndpoints(query: string, platform?: string): Promise<EndpointInfo[]> {
  const key = process.env.SOCIALCRAWL_API_KEY;
  if (!key) return [];
  const qs = new URLSearchParams({ search: query, ...(platform ? { platform } : {}) });
  try {
    const res = await fetch(`${SOCIALCRAWL}/utility/endpoints?${qs}`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { data?: { endpoints?: Record<string, unknown>[] } };
    return (json.data?.endpoints ?? []).map((e) => ({
      id: String(e.id ?? e.endpoint ?? ""),
      credits: num(e.credits) || 0,
      summary: String(e.summary ?? e.description ?? ""),
    }));
  } catch {
    return [];
  }
}

export interface AccountProfile {
  handle: string;
  followers?: number;
  posts?: number;
  bio?: string;
  category?: string;
  verified?: boolean;
  url?: string;
  /**
   * The network this profile was actually read from.
   *
   * Needed because the profile call and the reels call can be answered by
   * different vendors: with the paid Instagram source out of credits the reels
   * come back from a YouTube fallback and get stamped youtube, while the
   * follower count here is genuinely Instagram's. Without this the page ends up
   * printing "268M followers · read from youtube", which is two networks in one
   * sentence.
   */
  platform?: "instagram" | "youtube" | "tiktok";
  /**
   * Instagram's own list of similar accounts, when the vendor returns one.
   *
   * Only Apify's `details` call does, and it arrives free with the follower
   * count we were already buying. Handles only — the payload carries no follower
   * count per related account, so a peer builder that needs a size band still
   * has to read those profiles.
   */
  related?: string[];
}

/**
 * Who the creator actually is — 1 credit, once per handle.
 *
 * The plan could always compare a creator to accounts their size, but for a
 * creator who is *already in the field* it was guessing the size from reel
 * payloads. This is the number itself, plus the bio, which says more about
 * positioning than any caption does.
 */
export async function fetchInstagramProfile(handle: string): Promise<AccountProfile | null> {
  /**
   * Through the router, not straight to SocialCrawl.
   *
   * This call used to be pinned to one vendor, so a spent balance here failed
   * the identity read while the *reels* call right beside it failed over
   * happily — and the plan then fell back to a stranger's follower count. Asking
   * the router for `platform: "instagram"` means every configured Instagram
   * vendor gets a turn and none of them can be the single point of failure.
   */
  const { data } = await request({
    path: "/instagram/profile",
    handle: handle.replace(/^@/, ""),
    platform: "instagram",
  });
  const user = obj(data.user ?? data.author ?? data);
  const followers = num(user.followers ?? user.follower_count) || undefined;
  if (!followers && !str(user.biography)) return null;
  return {
    handle: str(user.username) ?? handle.replace(/^@/, ""),
    followers,
    posts: num(user.posts ?? user.media_count) || undefined,
    bio: str(user.biography ?? user.bio) ?? undefined,
    category: str(user.category ?? user.business_category) ?? undefined,
    verified: Boolean(user.is_verified ?? user.verified),
    url: str(user.url ?? user.profile_url) ?? undefined,
    platform: "instagram",
    related: Array.isArray(user.related)
      ? (user.related as unknown[]).filter((h): h is string => typeof h === "string")
      : undefined,
  };
}

/**
 * Instagram accounts that match a phrase, with their follower counts.
 *
 * Deliberately separate from `harvestInstagramSearch`: that returns *reels*
 * (which is how a niche is priced), this returns *accounts* (which is how a
 * comparison cohort is built). They are different questions and only one of
 * them can be asked of Instagram — see the note on `searchAccounts` in
 * `providers/types.ts`.
 *
 * Goes through the router, so a vendor that cannot answer is skipped instead of
 * being the single point of failure.
 */
export async function searchInstagramAccounts(
  query: string,
): Promise<{ handle: string; followers?: number; verified?: boolean; private?: boolean }[]> {
  const { data } = await request({ path: "/instagram/search/accounts", query });
  const rows = Array.isArray(data.users) ? (data.users as unknown[]) : [];
  return rows
    .map((r) => {
      const u = obj(r);
      const handle = str(u.username);
      if (!handle) return null;
      return {
        handle,
        followers: num(u.followers) || undefined,
        verified: Boolean(u.verified),
        private: Boolean(u.private),
      };
    })
    .filter((u): u is NonNullable<typeof u> => Boolean(u));
}

/**
 * More comments than the post payload carries — 5 credits a page.
 *
 * Only worth it when the free ~15 under a post were too thin to answer "what is
 * my audience actually asking". Capped at two pages by the caller, because this
 * is the most expensive per-useful-fact call on the shelf.
 */
export async function fetchPostComments(url: string, pages = 1): Promise<RawComment[]> {
  const out: RawComment[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < Math.min(2, Math.max(1, pages)); page += 1) {
    const { data } = await socialcrawl(
      "/instagram/post/comments",
      cursor ? { url, cursor } : { url },
      5,
    );
    const rows = items(data);
    for (const c of rows) {
      const text = String(c.text ?? "").trim();
      if (!text) continue;
      out.push({
        text,
        likes: num(c.likes),
        username: str(obj(c.author).username) ?? str(c.username),
        publishedAt: c.published_at ? toIso(c.published_at) : undefined,
      });
    }
    const pg = obj(data.pagination);
    if (!pg.has_more || typeof pg.next_cursor !== "string") break;
    cursor = pg.next_cursor;
  }
  return out;
}

/**
 * SocialCrawl's own transcript — 10 credits a reel.
 *
 * Kept as a deliberate fallback, never the default: the local whisper path in
 * media.ts reads the same MP4 for nothing. This exists for the deployment that
 * has no ffmpeg and no model file, where the choice is 10 credits or no hook
 * reading at all. Never call it in a loop.
 */
export async function fetchTranscript(url: string): Promise<string | null> {
  const { data } = await socialcrawl("/instagram/media/transcript", { url }, 10);
  const text = str(data.transcript ?? data.text ?? obj(data.caption).text);
  return text ? text.slice(0, 4_000) : null;
}

/**
 * NOT USED: /instagram/reels/trending costs 5 credits and returns
 * engagement.views = null on every item, so it can never support an outlier
 * claim. Search covers the same job for 1 credit with play counts attached.
 */

/**
 * YouTube via the official API — free within the 10k unit/day quota.
 * channels -> uploads playlist -> videos.list keeps it to ~3 units per channel
 * instead of the 100 units a search.list call would cost.
 */
export async function harvestYouTubeChannel(handle: string): Promise<RawReel[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY missing");
  const h = handle.startsWith("@") ? handle : `@${handle}`;

  const chRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(h)}&key=${key}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!chRes.ok) throw new Error(`YouTube channels ${chRes.status}`);
  const ch = (await chRes.json()) as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  };
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  const plRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=20&playlistId=${uploads}&key=${key}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  const pl = (await plRes.json()) as {
    items?: { contentDetails?: { videoId?: string } }[];
  };
  const ids = (pl.items ?? [])
    .map((i) => i.contentDetails?.videoId)
    .filter(Boolean)
    .slice(0, 20) as string[];
  if (!ids.length) return [];

  const vRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(",")}&key=${key}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  const vids = (await vRes.json()) as {
    items?: {
      id: string;
      snippet?: { title?: string; publishedAt?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }[];
  };

  return (vids.items ?? []).map((v) => ({
    id: `youtube_${v.id}`,
    platform: "youtube" as const,
    account: h.replace(/^@/, ""),
    url: `https://youtube.com/watch?v=${v.id}`,
    caption: v.snippet?.title ?? "",
    postedAt: v.snippet?.publishedAt ?? "",
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
    thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
  }));
}

/**
 * Reddit is free and is the best place to find the exact words people use for
 * their problems. Used for the question bank, not for outlier maths.
 */
export async function harvestRedditQuestions(keywords: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const kw of keywords.slice(0, 3)) {
    try {
      const res = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(kw)}&sort=top&t=month&limit=25`,
        {
          headers: { "user-agent": "reel-engine/0.1 (creator research)" },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: { children?: { data?: { title?: string } }[] };
      };
      for (const c of json.data?.children ?? []) {
        const title = c.data?.title;
        if (title && /\?|how|why|what|should|worth|better|help/i.test(title)) {
          out.push(title.slice(0, 160));
        }
      }
    } catch {
      /* one dead source must not stop the run */
    }
  }
  return [...new Set(out)].slice(0, 25);
}

/** Sample-based trend placement from whatever reels we pulled. */
export function deriveSoundStats(reels: RawReel[]): Record<string, SoundStats> {
  const now = Date.now();
  const byAudio = new Map<string, RawReel[]>();
  for (const r of reels) {
    if (!r.audioId) continue;
    const list = byAudio.get(r.audioId) ?? [];
    list.push(r);
    byAudio.set(r.audioId, list);
  }

  const out: Record<string, SoundStats> = {};
  for (const [audioId, list] of byAudio) {
    /**
     * Unknown dates must not be counted as "today": `days()` returns NaN for a
     * missing timestamp, every comparison against NaN is false, so a reel with
     * no date simply contributes to no window. That is the honest reading —
     * we cannot say a sound trended this week if we cannot date the posts.
     */
    const days = (r: RawReel) => (now - new Date(r.postedAt).getTime()) / 86_400_000;
    const last7 = list.filter((r) => days(r) <= 7).length;
    const prev7 = list.filter((r) => days(r) > 7 && days(r) <= 14).length;
    const authors = new Set(list.map((r) => r.account));
    const big = list.filter((r) => (r.followers ?? 0) >= 500_000).length;
    const knownAges = list.map(days).filter((d) => Number.isFinite(d));
    out[audioId] = {
      audioId,
      reelsLast7d: last7,
      reelsPrev7d: prev7,
      uniqueAuthors: authors.size,
      largeAuthorShare: big / Math.max(list.length, 1),
      brandShare: 0,
      firstSeenDaysAgo: knownAges.length ? Math.round(Math.max(...knownAges)) : 0,
    };
  }
  return out;
}

export interface HarvestResult {
  reels: RawReel[];
  questions: string[];
  errors: string[];
  credits: CreditLedger;
  /** true when the pull was served from disk, costing nothing */
  cached?: boolean;
  fetchedAt?: string;
}

/**
 * Raw pulls are cached to disk. Credits are the scarce resource here (100 on the
 * free tier), and tuning the scoring/clustering layers means re-running the
 * pipeline many times. With a warm cache a re-run costs 0 credits and the data
 * is identical, so only the code changes.
 */
const CACHE_PATH = path.join(process.cwd(), "data", "_raw_cache.json");
const CACHE_TTL_HOURS = Number(process.env.HARVEST_CACHE_HOURS ?? 12);

interface CacheFile {
  fetchedAt: string;
  key: string;
  reels: RawReel[];
  questions: string[];
  errors: string[];
}

function profileKey(profile: Profile, live: string): string {
  return JSON.stringify({
    live,
    benchmarks: profile.benchmarks.map((b) => `${b.platform}:${b.handle}`),
    keywords: profile.keywords.slice(0, 3),
  });
}

function readCache(key: string): CacheFile | null {
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
    if (raw.key !== key) return null;
    const ageH = (Date.now() - +new Date(raw.fetchedAt)) / 3_600_000;
    if (!(ageH >= 0 && ageH <= CACHE_TTL_HOURS)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(file: CacheFile): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(file), "utf8");
  } catch {
    /* a cache miss is not a run failure */
  }
}

export interface BalanceInfo {
  /** credits left on the key, or null when unknown */
  balance: number | null;
  spentLast24h: number | null;
  error?: string;
}

/**
 * Live balance from /v1/credits/balance, which SocialCrawl documents as
 * costing 0 credits. Called before any paid pull so a run can be refused
 * instead of failing halfway with a 402 after spending part of the budget.
 */
export async function checkBalance(): Promise<BalanceInfo> {
  /**
   * Now asks every configured vendor and reports the one that would serve the
   * next call. `spentLast24h` was a SocialCrawl-only figure and is no longer
   * available across vendors, so it stays null rather than being faked.
   */
  const { balance, byProvider } = await providerBalance();
  if (balance === null) {
    const failed = byProvider.find((p) => p.error);
    return {
      balance: null,
      spentLast24h: null,
      error: failed?.error ?? "no data vendor configured",
    };
  }
  return { balance, spentLast24h: null };
}

export interface CostLine {
  what: string;
  calls: number;
  credits: number;
}

export interface CostEstimate {
  calls: number;
  credits: number;
  lines: CostLine[];
}

/**
 * What one fresh pull costs. Every Instagram call is 1 credit a page; YouTube
 * rides the free API quota and Reddit costs nothing, so they are listed at 0
 * to make the shape of the bill obvious rather than hidden.
 */
export function estimateFreshPull(profile: Profile): CostEstimate {
  const ig = profile.benchmarks.filter((b) => b.platform === "instagram");
  const yt = profile.benchmarks.filter((b) => b.platform !== "instagram");
  const kw = profile.keywords.slice(0, 3);

  const lines: CostLine[] = [
    {
      what: "Instagram benchmark accounts (1 credit a page, ~12 reels)",
      calls: ig.length,
      credits: ig.length,
    },
    {
      what: "Keyword searches (1 credit each, ~30 reels)",
      calls: kw.length,
      credits: kw.length,
    },
  ];
  if (yt.length) {
    lines.push({
      what: "YouTube channels (official API, free quota)",
      calls: yt.length,
      credits: 0,
    });
  }
  lines.push({ what: "Reddit question bank (public JSON)", calls: 1, credits: 0 });

  return {
    calls: lines.reduce((n, l) => n + l.calls, 0),
    credits: lines.reduce((n, l) => n + l.credits, 0),
    lines,
  };
}

export interface CacheStatus {
  /** true when a re-run would be served from disk and cost nothing */
  warm: boolean;
  /** true when the cached pull was made for this exact profile */
  keyMatches: boolean;
  ageHours: number | null;
  ttlHours: number;
  fetchedAt: string | null;
  reels: number | null;
}

export function cacheStatus(profile: Profile): CacheStatus {
  const key = profileKey(profile, process.env.SOCIALCRAWL_API_KEY ? "live" : "demo");
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
    const ageH = (Date.now() - +new Date(raw.fetchedAt)) / 3_600_000;
    const keyMatches = raw.key === key;
    return {
      warm: keyMatches && ageH >= 0 && ageH <= CACHE_TTL_HOURS,
      keyMatches,
      ageHours: Math.round(ageH * 100) / 100,
      ttlHours: CACHE_TTL_HOURS,
      fetchedAt: raw.fetchedAt,
      reels: raw.reels.length,
    };
  } catch {
    return {
      warm: false,
      keyMatches: false,
      ageHours: null,
      ttlHours: CACHE_TTL_HOURS,
      fetchedAt: null,
      reels: null,
    };
  }
}

/**
 * The full pull, ordered cheapest-value-first so a budget stop still leaves a
 * usable sample: benchmark accounts first (one credit each, with baselines),
 * then keyword searches, then the free Reddit question bank.
 */
export async function harvestAll(
  profile: Profile,
  opts: { force?: boolean } = {},
): Promise<HarvestResult> {
  const key = profileKey(profile, process.env.SOCIALCRAWL_API_KEY ? "live" : "demo");

  if (!opts.force) {
    const hit = readCache(key);
    if (hit) {
      return {
        reels: hit.reels,
        questions: hit.questions,
        errors: hit.errors,
        credits: creditLedger(),
        cached: true,
        fetchedAt: hit.fetchedAt,
      };
    }
  }

  const reels: RawReel[] = [];
  const errors: string[] = [];

  /**
   * Pre-flight balance check (0 credits). Refusing here is much better than
   * being cut off at the sixth of eight calls: that leaves a half-pulled
   * sample that still has to be paid for on the next attempt.
   */
  /**
   * Can the paid vendors serve this pull, or are we down to the free one?
   *
   * This used to be a hard throw: "not enough credits: 0 left, a fresh pull
   * costs 8". Correct for a CLI, wrong for a product — it meant that the moment
   * the free tier ran out, *every* page that needed a pull answered "we are at
   * capacity", including the niche search that needs no handle at all. A creator
   * with no wallet could not even look around.
   *
   * So a short balance now degrades the pull instead of cancelling it: the
   * benchmark handles are skipped (they are Instagram-only and cost money) and
   * the room is read from a keyword search, which the free vendor serves. The
   * sample is different — it is YouTube's view of the space rather than those
   * exact Instagram accounts — but it is real data, and `platform` is stamped
   * per row so nothing downstream pretends otherwise.
   */
  const estimate = estimateFreshPull(profile);
  const freeOnly = !(await paidReady(estimate.credits));
  if (freeOnly) {
    errors.push(
      "reading this space from the free source: no paid credits available, so benchmark accounts were skipped",
    );
  }

  if (!freeOnly) {
    for (const b of profile.benchmarks) {
      try {
        if (b.platform === "instagram") reels.push(...(await harvestInstagramAccount(b.handle)));
        else if (b.platform === "youtube") reels.push(...(await harvestYouTubeChannel(b.handle)));
      } catch (err) {
        errors.push(`${b.platform}/${b.handle}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Keyword results are the polluted half of a pull: Instagram answers
   * "english music covers" with Telugu film songs and Mexican corridos too.
   * Benchmark accounts are exempt — those handles were chosen on purpose.
   */
  /**
   * In free mode the niche phrase itself becomes a query.
   *
   * With the benchmark handles skipped, the profile's own description of the
   * room is the only honest description of it left. Without this, a free pull
   * searched three technical keywords and never the space the creator actually
   * named — so a baking profile could be priced on AI automation reels.
   */
  const queries = freeOnly ? [profile.niche, ...profile.keywords] : profile.keywords;
  const found: RawReel[] = [];
  for (const kw of queries.slice(0, freeOnly ? 4 : 3)) {
    try {
      found.push(...(await harvestInstagramSearch(kw)));
    } catch (err) {
      errors.push(`search "${kw}": ${(err as Error).message}`);
    }
  }
  if (found.length) {
    /**
     * The benchmark handles were chosen on purpose, so they are the cleanest
     * sample of what this room is; the keyword results are only consulted when
     * those accounts said nothing about their language.
     */
    const room = roomLanguage(profile.niche, { own: reels, pull: found });
    const wanted = room.code;
    const before = found.length;
    let dropped = 0;
    const perAccount = new Map<string, RawReel[]>();
    for (const r of found) {
      const list = perAccount.get(r.account) ?? [];
      list.push(r);
      perAccount.set(r.account, list);
    }
    const langByAccount = new Map<string, AccountLangProfile | null>();
    for (const [handle, peers] of perAccount) {
      const profile = accountProfile(peers, wanted);
      langByAccount.set(handle, profile.mixed ? null : profile);
    }
    for (const r of found) {
      const own = langByAccount.get(r.account) ?? null;
      if (inLanguage(r, wanted, own).keep) reels.push(r);
      else dropped += 1;
    }
    if (dropped && wanted) {
      errors.push(
        `left out ${dropped} of ${before} search reels that were not ${languageName(wanted)}`,
      );
    }
  }

  const questions = await harvestRedditQuestions(profile.keywords);

  const fetchedAt = new Date().toISOString();
  if (reels.length) {
    writeCache({ fetchedAt, key, reels, questions, errors });
  }

  return { reels, questions, errors, credits: creditLedger(), fetchedAt };
}
