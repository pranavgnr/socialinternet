import { promises as fs } from "node:fs";
import path from "node:path";

import {
  alignNicheLanguage,
  detectArchetype,
  searchSubject,
  type ArchetypeGuess,
} from "./archetype";
import { buildAudit, hookVerdict } from "./audit";
import { times } from "./fmt";
import { cachedCommentsByUrl, mineComments, normaliseUrl } from "./comments";
import { enrich, pickForEnrichment, type EnrichReport } from "./enrich";
import { buildNextMove } from "./nextMove";
import {
  harvestAccountReels,
  harvestInstagramAccount,
  fetchInstagramProfile,
  type AccountProfile,
} from "./harvest";
import { jsonCall, llmReady } from "./llm";
import { researchNiche, researchFromCache, type NicheResearch } from "./niche";
import { availableProviders } from "./providers";
import { cohortFitness, pruneCohort } from "./cohort";
import { instagramPeers } from "./peers";
import { languageName, readLanguage } from "./lang";
import { coherentLabel, labelFromCaptions, nicheQuality, normaliseNiche } from "./nicheLabel";
import { buildPlay, topSongTitle } from "./playbook";
import { buildRows, fmt, median, medianGapDays, peersMedian, titleCase } from "./stats";
import { contentWords } from "./text";
import type {
  CohortFit,
  GrowthPlan,
  PlanFormat,
  PlanHook,
  PlanGap,
  PlanSong,
  Platform,
  Profile,
  RawReel,
} from "./types";

/**
 * Handle-first analysis: one handle in, one growth plan out.
 *
 * Two rules hold this file together, and both were learned the hard way:
 *
 * 1. A plan line without a number AND a handle behind it is deleted, not
 *    softened. Advice is a comparison, and one profile cannot produce one.
 * 2. The kind of account decides the advice. A singer is told which song to
 *    cover; a teacher is told how to open. Giving both the same five lines is
 *    what makes a plan read like a template, so the shape of the account is
 *    detected first (lib/archetype.ts) and the moves come from its playbook
 *    (lib/playbook.ts).
 */

const HANDLE_DIR = path.join(process.cwd(), "data", "handles");
const HANDLE_TTL_HOURS = 12;
const MAX_COHORT_ACCOUNTS = 40;

/**
 * The fewest accounts a cohort may hold and still be quoted as "accounts your
 * size".
 *
 * It was two, and two is not a cohort — it is two posts. @natgeotravel cleared
 * the band with `natgeohistory` and `nasa`, so the plan printed a size-matched
 * yardstick built from two accounts, the move engine had almost no peer rows,
 * dropped every move without receipts, and shipped a single suggestion about
 * the creator's own best post. Below this floor the plan compares against the
 * whole room instead: a weaker yardstick, but one that can still name the
 * accounts a creator should look at.
 *
 * Three, not five, because five is unreachable by construction.
 *
 * `peers.ts` buys at most six accounts, and one or two of those routinely
 * return no posts of their own — so a five-account size-matched cohort could
 * not exist even when every account bought was inside the band. The floor and
 * the purchase cap were written independently and then contradicted each
 * other: on @natgeotravel four accounts sat inside the band, the five-account
 * test failed, the plan fell back to "everyone in this space" — which was two
 * accounts — and the week shipped a single move about the creator's own best
 * post. A band of four that is used, with its count printed, beats a fallback
 * of two. Three is the smallest set a median means anything over.
 */
const COHORT_MIN = Number(process.env.PEER_MIN_COHORT ?? 3);

/** Tags that say nothing about what an account is about. */
const GENERIC_TAGS = new Set(
  (
    "reels reel reelsinstagram reelitstitch reelsvideo reelsfyp fyp fypシ fyppage " +
    "fypage fypviral foryou foryoupage viral viralreels trending trend explore " +
    "explorepage instagram instagramreels ig love follow like share subscribe " +
    "short shorts youtube ytshorts instadaily"
  ).split(/\s+/),
);

export function cleanHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/.*$/, "")
    .trim();
}

function slug(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "account";
}

/* ------------------------------------------------------------------ *
 * Own-account pull (cached per handle, so re-analysis costs nothing)
 * ------------------------------------------------------------------ */

interface StoredHandle {
  fetchedAt: string;
  handle: string;
  reels: RawReel[];
  niche?: string;
  /**
   * Where `niche` came from, and when. Without this a hashtag guess made when
   * no model was configured became permanent: "comedy funny dance telugu" was
   * written once and every later run inherited it, along with the cohort it
   * found.
   */
  nicheSource?: NicheGuess["source"];
  nicheAt?: string;
  /**
   * The account's own profile (followers, bio, category), kept with the feed.
   *
   * This was re-bought on every build: the comment claimed it was cached with
   * the feed, but nothing stored it, so a second plan for the same account paid
   * for the same follower count again. Followers move slowly, so a week is
   * generous and expiring costs nothing.
   */
  profile?: AccountProfile;
  profileAt?: string;
  /**
   * Which network this feed was read from.
   *
   * The same handle can be two different creators — @natgeo exists on both
   * Instagram and YouTube — so the two reads are kept apart on disk as well as
   * in the plan. Records written before this field existed are Instagram by
   * definition: it was the only platform the reader could reach.
   */
  platform?: Platform;
}

/**
 * Instagram keeps the bare handle so existing cache entries still hit; YouTube
 * gets its own key, because one handle on two networks is two different feeds
 * and merging them would install a stranger's videos as your baseline.
 */
function handleKey(handle: string, platform: Platform): string {
  return platform === "youtube" ? `${slug(handle)}--yt` : slug(handle);
}

async function readHandle(
  handle: string,
  platform: Platform = "instagram",
): Promise<StoredHandle | null> {
  try {
    const raw = await fs.readFile(
      path.join(HANDLE_DIR, `${handleKey(handle, platform)}.json`),
      "utf8",
    );
    const parsed = JSON.parse(raw) as StoredHandle;
    /**
     * Reject a record filed under one network whose reels came from another.
     *
     * The pre-platform code fell back to the free YouTube reader and wrote those
     * reels into the bare-handle Instagram slot. Trusting that file is what
     * printed a 435-subscriber squatter's numbers as @natgeotravel's — and once
     * the numbers are refused it becomes worse, not better: the handle answers
     * "could not read" forever, because the poisoned cache keeps satisfying the
     * TTL and no read is ever attempted. A network mismatch is a cache miss.
     */
    const filed = parsed.platform ?? "instagram";
    const reels = parsed.reels ?? [];
    if (filed !== platform) return null;
    if (reels.some((r) => r.platform && r.platform !== platform)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeHandle(value: StoredHandle): Promise<void> {
  await fs.mkdir(HANDLE_DIR, { recursive: true });
  const target = path.join(
    HANDLE_DIR,
    `${handleKey(value.handle, value.platform ?? "instagram")}.json`,
  );
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), "utf8");
  await fs.rename(tmp, target);
}

/** Followers and bio move slowly; a week old is still a true answer. */
const PROFILE_TTL_HOURS = 24 * 7;

/**
 * The account's own numbers, bought once a week instead of once a build.
 *
 * Failure is non-fatal by design: a stale profile beats no plan, and the caller
 * already falls back to the numbers in the feed.
 */
/**
 * Who the channel is, from the free reader.
 *
 * YouTube needs no key, so this is the one identity read that keeps working at
 * zero credits — and it is the only correct answer for a YouTube handle. Asking
 * an Instagram vendor for it used to return a different creator entirely.
 */
async function fetchYouTubeProfile(handle: string): Promise<AccountProfile | null> {
  const provider = availableProviders().find((p) => p.id === "youtubeweb");
  if (!provider?.profile) return null;
  try {
    const { data } = await provider.profile(handle);
    const p = (data.profile ?? {}) as Record<string, unknown>;
    const followers = typeof p.followers === "number" ? p.followers : undefined;
    if (!followers) return null;
    return {
      handle: String(p.username ?? handle),
      followers,
      bio: typeof p.biography === "string" ? p.biography : undefined,
      platform: "youtube",
    };
  } catch {
    return null;
  }
}

async function cachedProfile(
  handle: string,
  force = false,
  platform: Platform = "instagram",
): Promise<AccountProfile | null> {
  const stored = await readHandle(handle, platform);
  const ageHours = stored?.profileAt
    ? (Date.now() - Date.parse(stored.profileAt)) / 36e5
    : Infinity;

  /* A missing or unparseable timestamp reads as Infinity and refetches, which
     is the safe direction: one credit, never a wrong follower count forever. */
  if (!force && stored?.profile && Number.isFinite(ageHours) && ageHours < PROFILE_TTL_HOURS) {
    return stored.profile;
  }

  try {
    const fresh =
      platform === "youtube"
        ? await fetchYouTubeProfile(handle)
        : await fetchInstagramProfile(handle);
    if (!fresh) return stored?.profile ?? null;
    /* Only write back onto a handle file that already exists — writing one here
       would create an empty-reel record that pullOwn would later trust. */
    if (stored) {
      await writeHandle({ ...stored, profile: fresh, profileAt: new Date().toISOString() });
    }
    return fresh;
  } catch {
    return stored?.profile ?? null;
  }
}

export interface OwnPull {
  handle: string;
  /** The network this feed was actually read from. */
  platform: Platform;
  /**
   * Set when the caller named no platform and Instagram could not be read, so
   * the channel of the same name was used instead. The plan says so out loud:
   * a creator who typed an Instagram handle must never be shown YouTube numbers
   * as their own without being told which network was measured.
   */
  fellBackFrom?: Platform;
  reels: RawReel[];
  cached: boolean;
  niche?: string;
  nicheSource?: NicheGuess["source"];
  nicheAt?: string;
}

export async function pullOwn(
  handle: string,
  force = false,
  platform: Platform = "instagram",
): Promise<OwnPull> {
  const clean = cleanHandle(handle);
  if (!clean) throw new Error("handle is required");

  const stored = await readHandle(clean, platform);
  const ageHours = stored
    ? (Date.now() - new Date(stored.fetchedAt).getTime()) / 36e5
    : Infinity;

  if (!force && stored && ageHours < HANDLE_TTL_HOURS) {
    return {
      handle: clean,
      platform,
      reels: stored.reels,
      cached: true,
      niche: stored.niche,
      nicheSource: stored.nicheSource,
      nicheAt: stored.nicheAt,
    };
  }

  /**
   * The free YouTube reader always exists, so only the Instagram path can be
   * missing a vendor — and saying which one is the difference between a creator
   * who can fix it and one who is told to check their spelling.
   */
  if (platform !== "youtube" && !availableProviders().length) {
    throw new Error(
      "No Instagram data source is configured — add HIKERAPI_KEY, APIFY_TOKEN or SOCIALCRAWL_API_KEY.",
    );
  }

  /**
   * Read the network the handle actually lives on.
   *
   * This used to call the Instagram reader unconditionally, so a YouTube handle
   * was answered with an Instagram error while the free YouTube reader sat
   * unused beside it. `harvestAccountReels` also goes through the provider
   * router, so a spent paid balance now falls through to the free reader
   * instead of killing the build.
   */
  const reels =
    platform === "youtube"
      ? await harvestAccountReels(clean, "youtube")
      : await harvestInstagramAccount(clean);

  if (!reels.length) {
    throw new Error(
      platform === "youtube"
        ? `YouTube returned nothing for @${clean}. Check the handle is spelled right and the channel is public.`
        : `Instagram returned nothing for @${clean}. Check the handle is spelled right and the account is public.`,
    );
  }
  await writeHandle({
    fetchedAt: new Date().toISOString(),
    handle: clean,
    platform,
    reels,
    niche: stored?.niche,
    nicheSource: stored?.nicheSource,
    nicheAt: stored?.nicheAt,
    profile: stored?.profile,
    profileAt: stored?.profileAt,
  });
  return { handle: clean, platform, reels, cached: false };
}

/* ------------------------------------------------------------------ *
 * Niche inference
 * ------------------------------------------------------------------ */

export interface NicheGuess {
  query: string;
  audience: string;
  /**
   * Where the phrase came from. The plan treats a model phrase as settled; a
   * hashtag guess is provisional and is re-derived when a model is available,
   * because a stale guess is not cosmetic — it picks the cohort.
   */
  source: "model" | "hashtags" | "captions" | "shape" | "user";
  /**
   * The phrase to use next time. Set only when the cohort check proved the
   * current phrase points at the wrong room — the corrected one is remembered
   * instead of the pull being repeated for a second spend.
   */
  next?: string;
}

/**
 * Read what the account is about instead of asking the user to describe it.
 *
 * Three inputs, in order of trust:
 *   1. the shape of the account (lib/archetype.ts) — decided from its own
 *      captions, and the most reliable thing we have;
 *   2. a model, shown the shape, the tags that recur and the posts that
 *      actually travelled, so it can name the space rather than restate tags;
 *   3. one readable tag plus the account's language — a phrase by
 *      construction, because a handful of tags glued together is not one.
 */
export async function inferNiche(
  reels: RawReel[],
  opts: { subject?: string; language?: string } = {},
): Promise<NicheGuess> {
  const stats = tagStats(reels);
  const ranked = stats.map((s) => s.tag);
  const account = reels.find((r) => r.account)?.account;

  if (llmReady()) {
    try {
      const byViews = [...reels].sort((a, b) => b.views - a.views);
      const line = (r: RawReel) =>
        `- ${compactViews(r.views)} · ${r.caption.replace(/\s+/g, " ").slice(0, 160)}`;
      const sample = [
        ...byViews.slice(0, 6).map(line),
        ...(byViews.length > 9 ? byViews.slice(-3).map(line) : []),
      ].join("\n");
      const shapeNote =
        opts.subject && opts.subject !== "general"
          ? `Our own analysis of these posts says: ${opts.subject}` +
            (opts.language ? `, in ${opts.language}.` : ".")
          : "No clear account type was detected from the posts.";

      const out = await jsonCall<{ niche?: string; audience?: string }>(
        "You name the space an Instagram account competes in. " +
          'Answer only with JSON: {"niche": "<2-5 word search phrase a viewer would type to find accounts like this>", ' +
          '"audience": "<who this account is for, one clause>"}. ' +
          "The phrase must be a thing people search for, not a list of tags: " +
          '"telugu comedy" is right, "comedy funny dance telugu" is not. ' +
          "Never include the account's own name, a brand, or reach words like trending, viral, fyp, reels. " +
          "Include a language or region word only when the posts are clearly in that language.",
        `${shapeNote}\n\nTags that recur: ${ranked.slice(0, 12).join(", ") || "(none)"}\n\n` +
          `Posts, best and worst by views:\n${sample}`,
        { temperature: 0.2, maxTokens: 300 },
      );
      /**
       * Validated against the *raw* answer, returned as the normalised one.
       *
       * `nicheQuality` rejects "pets_animals" as a category label; the version
       * this replaced normalised the underscore to a space inside its own copy,
       * accepted "pets animals", and then the caller returned the untouched
       * model string — so the underscore was validated against, and the raw
       * answer was what reached the page.
       */
      const answered = (out.niche ?? "").trim();
      const quality = nicheQuality(answered);
      const query = normaliseNiche(answered);
      if (quality.ok && query.length >= 3) {
        return {
          query,
          audience: (out.audience ?? "").trim() || "people who follow accounts like this",
          source: "model",
        };
      }
    } catch {
      /* a model outage must not block the plan — fall through to the tags */
    }
  }

  /**
   * The shape plus the language: "telugu comedy", "kannada singer". Two words,
   * both derived from the account's own captions, and a phrase someone might
   * genuinely type. Weak shapes ("general") are not allowed to become a label.
   */
  const subject = (opts.subject ?? "").toLowerCase().trim();
  if (subject && subject !== "general" && subject !== "unknown") {
    const language = (opts.language ?? "").toLowerCase().trim();
    const phrase = language && !subject.includes(language) ? `${language} ${subject}` : subject;
    const quality = nicheQuality(phrase);
    if (quality.ok) {
      return {
        query: phrase,
        audience: `people who follow ${phrase} accounts`,
        source: "shape",
      };
    }
  }

  const label = coherentLabel(stats, account);
  const tagCount = ranked.filter((t) => !t.includes("_")).length;
  if (label && tagCount >= 2 && nicheQuality(label).ok) {
    return {
      query: label,
      audience: `people following ${label} creators`,
      source: "hashtags",
    };
  }

  /**
   * No hashtags to read: take the phrase the account keeps repeating in its own
   * titles. This is the path every YouTube-sourced room falls to, and the one
   * that stops the single-keyword fallback below from naming a room "episode".
   */
  const captionLabel = labelFromCaptions(reels, account);
  if (captionLabel) {
    return {
      query: captionLabel,
      audience: `people following ${captionLabel} creators`,
      source: "captions",
    };
  }

  const provider = reels.find((r) => r.nicheLabel)?.nicheLabel;
  const words = new Map<string, number>();
  for (const r of reels) {
    for (const w of contentWords(r.caption)) words.set(w, (words.get(w) ?? 0) + 1);
  }
  const keyword =
    provider ?? [...words.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  if (!keyword) throw new Error("Could not tell what this account is about from its posts.");
  return {
    query: keyword.toLowerCase(),
    audience: `people who follow ${keyword} accounts`,
    source: "hashtags",
  };
}

/**
 * Is a stored phrase good enough to reuse?
 *
 * A model's answer or one the visitor typed is settled. A shape label is
 * trusted until a model can do better. A hashtag guess is provisional by
 * definition — it is what the account tagged itself, not what it is — so it is
 * upgraded the first time a model is available. Records from before provenance
 * existed have no source at all and count as provisional.
 */
function isTrustedLabel(source?: NicheGuess["source"]): boolean {
  if (!source) return false;
  if (source === "user" || source === "model" || source === "shape") return true;
  return !llmReady();
}

/**
 * A `shape` phrase is the archetype's search subject, so it expires with the
 * archetype that produced it.
 *
 * `source: "shape"` means the phrase was literally `searchSubject(archetype)`.
 * The shape detector is the part of this file that changes most, and when it
 * improves, the phrase written months ago does not. That is how a nature
 * channel came to be benchmarked against family vloggers: natgeo read as
 * `family` when "family vlog" was written, reads as `documentary` now, and the
 * stored phrase was trusted because of *how* it was made rather than whether it
 * was still true. Every number in that plan was then measured against strangers.
 *
 * So provenance is re-checked against the shape we have now: a phrase the
 * current shape would no longer produce is treated as absent and re-derived
 * from the posts, which costs a few hundred tokens and no credits.
 *
 * Deliberately narrow. Only `shape` phrases are challenged here, because only
 * they are a direct restatement of the archetype. A `model` phrase can be
 * legitimately sharper than the archetype ("morning routine" for a vlogger),
 * and a wrong one is caught by evidence instead — `cohortFitness` judges the
 * room the phrase actually bought, and a wrong verdict triggers a re-search.
 */
function shapeMovedOn(guess: NicheGuess, archetype: ArchetypeGuess): boolean {
  if (guess.source !== "shape") return false;
  const subject = searchSubject(archetype.id).trim().toLowerCase();
  /** An unknown shape has no opinion, so it cannot invalidate anything. */
  if (!subject) return false;

  const query = guess.query.trim().toLowerCase();
  const language = (archetype.language ?? "").trim().toLowerCase();
  const expected =
    language && !subject.includes(language) ? `${language} ${subject}` : subject;
  if (query === expected) return false;

  /**
   * A shared word means it is still the same subject, just phrased with more or
   * less detail ("wildlife" against "wildlife photography"). Only a phrase with
   * nothing in common is treated as stale.
   */
  const words = new Set(subject.split(/\s+/).filter(Boolean));
  return !query.split(/\s+/).some((w) => words.has(w));
}

/**
 * Replace a stale phrase on disk with the re-derived one.
 *
 * Without this the improved shape reading is worked out again on every build,
 * and — worse — the stale phrase stays on disk to be trusted by the next run.
 */
async function rememberNiche(handle: string, guess: NicheGuess): Promise<void> {
  try {
    const stored = await readHandle(handle);
    if (!stored) return;
    await writeHandle({
      ...stored,
      niche: guess.query,
      nicheSource: guess.source,
      nicheAt: new Date().toISOString(),
    });
  } catch {
    /* a cache write must never fail a plan */
  }
}

/** Views, tiny: "1.2M", "84k". Used only to order the sample shown to a model. */
function compactViews(n: number): string {
  if (!n) return "new";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * Hashtags counted, with the views behind them and with reach tags dropped.
 * Views matter because the label should describe the posts that worked, not the
 * ones that flopped.
 */
function tagStats(reels: RawReel[]): { tag: string; count: number; views: number }[] {
  const acc = new Map<string, { count: number; views: number }>();
  for (const r of reels) {
    const seen = new Set<string>();
    for (const raw of r.hashtags ?? []) {
      const tag = raw.replace(/^#/, "").trim().toLowerCase();
      if (tag.length < 4 || tag.length > 24) continue;
      if (GENERIC_TAGS.has(tag) || /^\d+$/.test(tag)) continue;
      if (/(.)\1{3,}/.test(tag)) continue;
      if (seen.has(tag)) continue; // one reel, one vote
      seen.add(tag);
      const cur = acc.get(tag) ?? { count: 0, views: 0 };
      cur.count += 1;
      cur.views += r.views ?? 0;
      acc.set(tag, cur);
    }
  }
  return [...acc.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.count - a.count || b.views - a.views);
}

/* ------------------------------------------------------------------ *
 * Plan assembly
 * ------------------------------------------------------------------ */

export interface PlanInput {
  handle: string;
  research: NicheResearch;
  ownReels: RawReel[];
  profile?: Profile | null;
  /** the creator's own account as the platform describes it, 1 credit */
  account?: AccountProfile | null;
  /** reuse an archetype already detected, instead of detecting it twice */
  archetype?: ArchetypeGuess;
  /** where the search phrase came from */
  nicheSource?: NicheGuess["source"];
  /** whether the cohort compares like with like, checked before any number */
  nicheFit?: CohortFit;
  /**
   * The network the handle was read from. Known by the caller even when the
   * profile call fails, and the only way a YouTube channel stays labelled
   * YouTube instead of inheriting Instagram from a default.
   */
  platform?: Platform;
  /**
   * What happened when the cohort was rebuilt on the creator's own network.
   *
   * Present only when the room had to be replaced. It carries the sentence the
   * page is allowed to print about the comparison, decided next to the evidence
   * rather than reconstructed from a headcount later — "3 accounts" reads the
   * same whether they are the right size or not, and that difference is the
   * whole claim.
   */
  peerRoom?: { basis: string; sizeMatched: boolean; accounts: number; band?: { low: number; high: number } };
}

/**
 * Did we actually read this account, or only find posts carrying its name?
 *
 * One definition on purpose. Two call sites depend on this answer and they must
 * never disagree: the page uses it to decide whether to print a follower count,
 * and the cohort check uses it to decide whether it has anything to compare a
 * room against. A page that admits "we could not read you" above a cohort that
 * was judged as if we had read you is the same lie in two halves.
 */
function accountWasRead(account?: { handle?: string; followers?: number; bio?: string } | null): boolean {
  /**
   * A handle in hand is proof of a successful read, on its own.
   *
   * Without it, a brand-new account with 0 followers and an empty bio looked
   * exactly like a failed call, and the page told a real creator "we could not
   * read you" while holding their profile. Absence of a number is not absence
   * of an account.
   */
  return Boolean(account?.handle || account?.followers || account?.bio);
}

export function buildPlan({
  handle,
  research,
  ownReels,
  archetype,
  account,
  nicheSource,
  nicheFit,
  platform,
  peerRoom,
}: PlanInput): GrowthPlan {
  const clean = cleanHandle(handle);

  /**
   * Three separate questions, answered separately.
   *
   *  1. Who is this creator?          → `accountRead`
   *  2. Do we have their own posts?   → `postsRead`
   *  3. Are those posts on the same network as the identity?
   *
   * They used to be one question, and that is how @natgeo came out as
   * "268M followers · your usual post 349k": the follower count was genuinely
   * Instagram's, while the posts printed beside it belonged to a YouTube
   * channel of the same name. Both numbers were real. The sentence joining them
   * was not, and no amount of care further down the page can fix a wrong join.
   */
  const sameHandle = ownReels.filter(
    (r) => r.account?.replace(/^@/, "").toLowerCase() === clean.toLowerCase(),
  );

  /**
   * The network the creator is on.
   *
   * A submitted handle is an Instagram handle, and the only profile reader here
   * reads Instagram, so a profile in hand means Instagram — including cached
   * copies written before profiles carried a platform stamp.
   */
  const identityPlatform: Platform | undefined =
    account?.platform ?? (account ? "instagram" : undefined);

  /**
   * Did we actually read this account, or only find posts carrying its name?
   *
   * Answered before anything is attributed to the creator, because every later
   * decision depends on it: which posts count as theirs, whether a follower
   * count exists, and whether a cohort may be size-matched at all.
   */
  const accountRead = accountWasRead(account);

  /**
   * The network their posts are on.
   *
   * When the identity is known, the posts must match it. A same-named channel
   * on another network is a different creator, and is not allowed to stand in —
   * not even as a fallback, because that fallback is precisely what produced
   * "@natgeotravel · 435 followers".
   *
   * So when the identity read failed, there is no network to match against and
   * no posts of theirs to measure. The namesake's rows stay in `ownReels` only
   * to be named as somebody else in `unreadReason`; they are never adopted.
   * The previous version fell back to the namesake's platform here, which left
   * 435 followers flowing into peer matching while the page above it said the
   * account had not been read — the same lie in two halves.
   */
  const postsPlatform: Platform | undefined =
    identityPlatform ??
    (accountRead ? sameHandle.find((r) => r.platform)?.platform : undefined) ??
    /**
     * The caller read this handle on `platform`, so the posts it harvested are
     * that network's — true even when the profile call failed. Without this a
     * YouTube channel whose follower count was unreadable fell back to the
     * cohort's platform and printed YouTube views under an Instagram label.
     */
    platform;
  const mineReels =
    postsPlatform ? sameHandle.filter((r) => r.platform === postsPlatform) : [];

  const ownViews = mineReels.map((r) => r.views).filter((v) => v > 0);
  const reportedBaseline = mineReels.find((r) => r.baselineMedianViews)?.baselineMedianViews;
  const ownMedian = reportedBaseline || median(ownViews);
  const ownBest = Math.max(0, ...ownViews);

  /**
   * Followers belong to the identity, never to a row from another network.
   *
   * `mineReels` is already filtered to the identity's network, so its follower
   * field is this account's by construction. `account` still wins: a profile
   * call is the number itself rather than one post's snapshot of it.
   *
   * Gated on `accountRead` because a follower count is the single number most
   * likely to be believed at a glance. A namesake's 435 printed next to a real
   * handle is worse than printing nothing at all.
   */
  const followers = accountRead
    ? (account?.followers ?? mineReels.find((r) => r.followers)?.followers)
    : undefined;

  const postsRead = mineReels.length > 0;
  const elsewhere = ownReels.filter((r) => r.platform !== postsPlatform);
  const unreadReason = accountRead
    ? postsRead
      ? undefined
      : `we know who @${clean} is, but could not read their recent ${identityPlatform ?? "instagram"} posts`
    : elsewhere.length
      ? `we could not read @${clean} on ${platform ?? "instagram"}; the ${elsewhere[0]?.platform ?? "other"} posts under that name belong to a different creator and were not used as yours`
      : `we could not read @${clean} on ${platform ?? "instagram"}`;

  const shape = archetype ?? detectArchetype(mineReels, research.query);

  const others = research.accounts.filter(
    (a) => a.handle.toLowerCase() !== clean.toLowerCase(),
  );

  // The cohort is the whole product. Comparing a 2k account against 500k
  // accounts produces confident nonsense, so peers are size-matched first.
  let peers = others;
  let basis = "everyone in this space — not enough accounts your size yet";
  let sizeMatched = false;

  /**
   * How many posts we actually hold per account.
   *
   * A cohort is only as useful as the posts behind it: the move that says "make
   * what @someone made" can only be written if we hold that account's reels.
   * Accounts chosen purely on follower count were sometimes names we had no
   * posts for, so the cohort move found nothing to quote and the plan fell back
   * to telling the creator about their own best post — 13 of 163 recorded weeks
   * came out that way, with a cohort of 2 to 31 accounts behind them.
   *
   * Sorting by what we hold, before the slice, keeps every account in the same
   * band and simply prefers the ones we can put a number and a link next to.
   */
  const rows = buildRows(research, clean);
  const held = new Map<string, number>();
  for (const r of rows) {
    const key = r.account.toLowerCase();
    held.set(key, (held.get(key) ?? 0) + 1);
  }

  /**
   * When the room was rebuilt on the creator's own network, the peers module's
   * size verdict wins, and it wins with the band it actually applied.
   *
   * Two authorities were disagreeing. The module banded candidate accounts at
   * 0.3–3.5x, read each follower count, and called the cohort size-matched on
   * two — while the rule below re-derived the answer at 0.35–2.5x and demanded
   * three, so it dissented. @natgeotravel (44.5M) then printed "not enough
   * accounts your size yet on Instagram" over numbers taken from two accounts
   * that were inside the band all along (16.5M and 104M). Three is impossible
   * when only PEER_MAX accounts are bought and one returns no posts of its own,
   * so the floor here is the module's own two.
   */
  if (peerRoom?.sizeMatched && followers) {
    const low = peerRoom.band?.low ?? followers * 0.3;
    const high = peerRoom.band?.high ?? followers * 3.5;
    const banded = others.filter(
      (a) => a.followers && a.followers >= low && a.followers <= high,
    );
    if (banded.length >= COHORT_MIN) {
      peers = banded;
      basis = `accounts about your size (${fmt(followers)} followers) on Instagram — ${banded.length} of them`;
      sizeMatched = true;
    }
  }
  if (!sizeMatched && followers) {
    const banded = others.filter(
      (a) => a.followers && a.followers >= followers * 0.35 && a.followers <= followers * 2.5,
    );
    if (banded.length >= COHORT_MIN) {
      peers = banded;
      basis = `accounts about your size (${fmt(followers)} followers) — ${banded.length} of them`;
      sizeMatched = true;
    }
  }
  if (!sizeMatched && ownMedian > 0) {
    const banded = others.filter(
      (a) => a.medianViews >= ownMedian * 0.3 && a.medianViews <= ownMedian * 3,
    );
    if (banded.length >= COHORT_MIN) {
      peers = banded;
      basis = `accounts pulling within 3x your usual views — ${banded.length} of them`;
      sizeMatched = true;
    }
  }
  /**
   * When the room was rebuilt on Instagram, the sentence has to come from the
   * rebuild.
   *
   * The size match below is computed from whatever accounts arrived. Those can
   * now be Instagram accounts at the *wrong* size, and "accounts about your
   * size" would be a claim the evidence does not support — the peers module
   * already decided which of the two sentences is true, so it wins here.
   */
  if (peerRoom) {
    basis = peerRoom.sizeMatched ? basis : peerRoom.basis;
  }
  peers = [...peers]
    .sort((a, b) => (held.get(b.handle.toLowerCase()) ?? 0) - (held.get(a.handle.toLowerCase()) ?? 0))
    .slice(0, MAX_COHORT_ACCOUNTS);
  /**
   * The fallback sentence carries its own count.
   *
   * "Not enough accounts your size yet" was true and unhelpful: it never said
   * how many accounts were actually behind the numbers underneath it, so a
   * cohort of two and a cohort of forty read the same.
   */
  if (!sizeMatched) {
    basis = `everyone in this space (${peers.length} accounts) — not enough close to your size to call a cohort`;
  }

  const peerHandles = new Set(peers.map((p) => p.handle.toLowerCase()));
  const peerRows = rows.filter((r) => peerHandles.has(r.account.toLowerCase()));
  const workingRows = peerRows.length >= 6 ? peerRows : rows;

  const nicheMedian = research.nicheMedianViews || median(others.map((a) => a.medianViews));
  const peersMed = peersMedian(peers);

  /**
   * The yardstick, decided once, before any number that quotes it.
   *
   * `vsNiche` used to divide by the whole room's median while the diagnosis,
   * the gap table and the percentile all divided by the size-matched cohort.
   * @natgeotravel read "1.8x the niche (212k)" on one page and "accounts your
   * size get about 2.0M" on another — 1.8x ahead and 0.2x behind in the same
   * plan. Two yardsticks is not a rounding difference; it is two different
   * answers to the only question the page asks.
   */
  const reference = sizeMatched ? peers : others;
  const referenceMedian = sizeMatched ? peersMed : nicheMedian;
  const vsNiche = referenceMedian > 0 ? ownMedian / referenceMedian : 0;

  /**
   * Which network the comparison group actually came from.
   *
   * Taken as the most common platform among the accounts that were measured,
   * not from the first one, so a single stray account cannot mislabel the whole
   * cohort. Undefined when the research carried no platform stamps at all —
   * better to say nothing than to guess.
   */
  const counted = new Map<Platform, number>();
  for (const a of research.accounts) {
    if (a.platform) counted.set(a.platform, (counted.get(a.platform) ?? 0) + 1);
  }
  const cohortPlatform = [...counted.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  /**
   * One reference group for every sentence on the page. The standing used to be
   * measured against everyone in the space while the comparison row used the
   * size-matched accounts, so the same plan said "accounts your size get 66k"
   * above a chart that said 32k. Whatever the plan compares you with has to be
   * the same set it quotes.
   */
  const beat = reference.filter((a) => ownMedian > 0 && a.medianViews < ownMedian).length;
  const percentile = reference.length ? beat / reference.length : 0;

  const ownGap = medianGapDays(mineReels);
  const peerGaps = peers
    .map((p) =>
      medianGapDays(workingRows.filter((r) => r.account === p.handle).map((r) => r.reel)),
    )
    .filter((g): g is number => g !== null);
  const peerGapMedian = peerGaps.length
    ? median(peerGaps.map((g) => Math.round(g * 10))) / 10
    : null;

  const play = buildPlay({
    handle: clean,
    archetype: shape,
    rows: workingRows,
    own: mineReels,
    ownMedian,
    ownBest,
    nicheMedian,
    peers,
    ownGapDays: ownGap,
    peerGapDays: peerGapMedian,
    // The move wording reads this: it may only say "accounts your size" when
    // the cohort was actually banded by follower count.
    sizeMatched,
  });

  /**
   * A gap needs two sides. Every row below is "you" against the cohort, and
   * "you" here would be the same-named stranger, so an unread account gets no
   * gap table rather than a table of someone else's numbers.
   */
  const gaps: PlanGap[] = [];
  if (postsRead && referenceMedian > 0 && ownMedian > 0) {
    gaps.push({
      label: "your usual post",
      you: fmt(ownMedian),
      cohort: fmt(referenceMedian),
    });
  }
  const ownSpread = ownMedian > 0 ? ownBest / ownMedian : 0;
  const peerSpreads = peers
    .map((p) => (p.medianViews > 0 ? p.bestViews / p.medianViews : 0))
    .filter((x) => x > 0);
  if (postsRead && ownSpread > 0 && peerSpreads.length) {
    gaps.push({
      label: "your best vs your usual",
      you: times(ownSpread),
      cohort: times(median(peerSpreads)),
    });
  }
  if (postsRead && ownGap !== null && peerGapMedian !== null) {
    gaps.push({
      label: "days between posts",
      you: ownGap.toFixed(1),
      cohort: peerGapMedian.toFixed(1),
    });
  }

  /**
   * Songs the plan can name, strongest first: what the cohort proved, then what
   * the creator's own audience already proved. A niche search often surfaces one
   * reel per account, so a song rarely appears twice — without the second group
   * the section would be empty exactly when it is most needed.
   */
  const songs: PlanSong[] = [];
  for (const s of play.songs) {
    if (songs.length >= 3) break;
    songs.push({
      title: s.title,
      accounts: s.accounts.length,
      multiple: Number(s.medianRatio.toFixed(1)),
      why:
        s.strength === "proven"
          ? `${s.accounts.length} accounts your size posted it and beat their usual views`
          : `One account your size did ${s.medianRatio.toFixed(1)}x its usual views with it`,
      evidence: s.evidence.slice(0, 3).map((e) => ({
        handle: `@${e.account}`,
        // Which denominator the multiple is against: the account's own usual
        // views, or the typical post in this space. Claiming the first when the
        // second was measured is a false number on the page.
        metric: `${e.ratio.toFixed(1)}x ${
          e.accountBased ? "its usual views" : "the typical post here"
        } · ${fmt(e.views)} views`,
        url: e.url,
        caption: e.caption,
      })),
    });
  }
  for (const s of play.ownSongs) {
    if (songs.length >= 4) break;
    if (songs.some((x) => x.title.toLowerCase() === s.title.toLowerCase())) continue;
    if (s.medianRatio < 1.2) continue;
    songs.push({
      title: s.title,
      accounts: 1,
      multiple: Number(s.medianRatio.toFixed(1)),
      fromYou: true,
      // With one post to go on there is no "your usual" — the comparison was
      // against the space, and the sentence has to say so.
      why:
        s.basis === "niche"
          ? `Your own post beat the typical post in your space, so it is worth a second angle`
          : `Your own audience already responded to this one`,
      evidence: s.evidence.slice(0, 2).map((e) => ({
        handle: `@${e.account}`,
        metric: `${e.ratio.toFixed(1)}x ${
          e.accountBased ? "your usual views" : "the typical post in your space"
        } · ${fmt(e.views)} views`,
        url: e.url,
        caption: e.caption,
      })),
    });
  }

  /**
   * The shapes worth making more of, for accounts whose lever is the video
   * itself. Kept parallel to songs: the section on the page is the same idea —
   * here is the thing that is working, here is the post that proves it.
   */
  const formats: PlanFormat[] = play.formats.slice(0, 3).map((f) => ({
    id: f.id,
    label: f.label,
    what: f.what,
    accounts: f.accounts,
    posts: f.posts,
    multiple: f.multiple,
    evidence: f.evidence.slice(0, 3),
  }));

  /**
   * The opening lines worth reusing, for the kinds of account whose next post is
   * decided by the first three seconds. Same shape as songs and formats: what
   * broke out, how often, and the post that proves it.
   */
  const hooks: PlanHook[] = play.hooks.slice(0, 3).map((h) => ({
    id: h.id,
    label: h.label,
    what: h.what,
    accounts: h.accounts,
    posts: h.posts,
    multiple: h.multiple,
    example: h.example,
    evidence: h.evidence.slice(0, 3),
  }));

  /* ---------------------------- diagnosis ---------------------------- */

  /**
   * The first sentence is the one a reader believes, so it may only claim what
   * was measured.
   *
   * When the account was never read, every figure in the old opener —
   * "you usually get", "accounts your size", "ahead of 67% of them" — was
   * describing a stranger who shares the handle. The fix above stopped the page
   * printing that stranger's follower count; leaving the same claim here would
   * have restated it in prose, which is worse, because prose is what gets read.
   */
  const roomLine = `a post that does well in “${research.query}” is getting around ${fmt(
    nicheMedian,
  )} views`;

  const diagnosis: string[] = [
    postsRead
      ? `You usually get around ${fmt(ownMedian)} views a post. Accounts your size get about ${fmt(
          referenceMedian,
        )}. That puts you ahead of ${Math.round(percentile * 100)}% of them.`
      : accountRead
        ? /**
           * Identified, but the feed is unreadable. Saying "you usually get" here
           * would be quoting whatever rows happened to be lying around — for
           * @natgeo that was a different creator's YouTube channel.
           */
          `We know @${clean} — ${fmt(followers ?? 0)} followers — but we could not read their recent posts, so there is nothing here that says how those posts perform. What we can say is that ${roomLine}.`
        : `We could not read @${clean}, so nothing here describes your account. What we can say is that ${roomLine}.`,
  ];

  /* ---------------- the account read against itself ---------------- */

  const audit = buildAudit({
    reels: mineReels,
    peerMedian: sizeMatched ? peersMed : undefined,
    nicheMedian,
  });
  const hookRead = hookVerdict(mineReels);
  /**
   * Every comment we hold, not only the ones this run bought.
   *
   * The reader below is fed the reels plus, for any reel without comments
   * attached, whatever the post cache kept from an earlier paid call — so the
   * section survives a cache-only run instead of disappearing from the page.
   */
  const cachedComments = cachedCommentsByUrl();
  const comments = mineComments(
    [...mineReels, ...(research.payload ?? [])].map((r) => ({
      url: r.url,
      comments: r.topComments?.length ? r.topComments : cachedComments.get(normaliseUrl(r.url)),
    })),
  );

  const bestSong = topSongTitle(play.songs);
  if (shape.songLed && bestSong) {
    const found = play.songs.find((s) => s.title === bestSong);
    diagnosis.push(
      `Right now the song choice is doing the most work — “${bestSong}” broke out for ${
        found?.accounts.length ?? 2
      } accounts your size. It is also the cheapest thing to copy exactly.`,
    );
  } else if (shape.songLed && play.ownSongs.length) {
    diagnosis.push(
      `Your own best song was “${
        play.ownSongs[0].title
      }”, at ${times(play.ownSongs[0].medianRatio)} your usual.`,
    );
  } else if (formats[0]) {
    const f = formats[0];
    diagnosis.push(
      `Your videos live or die on their shape, not on a spoken opening. “${f.label}” is the shape breaking out for accounts your size — ${f.accounts} of them, averaging ${times(
        f.multiple,
      )} their usual views.`,
    );
  } else if (ownSpread > 1.5) {
    diagnosis.push(
      `Your best post did ${times(
        ownSpread,
      )} your usual, so the ceiling is clearly there. It just has not happened twice.`,
    );
  }

  /**
   * Say how much the comparison is worth, and say it before the numbers rather
   * than after them. The cohort check already dropped the accounts that were
   * plainly in another room, but when the whole room was wrong the numbers are
   * still shown — and a number that is provisional has to look provisional, or
   * the page is confidently wrong.
   */
  if (nicheFit && nicheFit.verdict !== "matches") {
    diagnosis.push(
      nicheFit.verdict === "wrong"
        ? `The group we compared you with was not your room (we searched “${nicheFit.searched}”), so read the numbers below as provisional.`
        : nicheFit.verdict === "unknown"
          ? // Silence, said out loud. Anything more confident here would be
            // describing a check that never ran.
            `We could not check this room against your own posts, so the numbers below describe “${nicheFit.searched}” rather than how you compare with it.`
          : `Some accounts that were not your kind of account were left out of the numbers.`,
    );
  }

  diagnosis.push(
    postsRead
      ? `Everything below comes from ${mineReels.length} of your posts and ${workingRows.length} posts from accounts your size.`
      : `Everything below comes from ${workingRows.length} posts by other accounts in this room. None of your own posts are in it.`,
  );

  /**
   * How solid is the room itself? Dropping the wrong reels fixes the medians;
   * it does not say how much of what survived is actually confirmed. A room
   * built mostly on captions that did not argue is a guess dressed as a number,
   * and the page has to say so before the numbers, not after.
   */
  const evidence = research.language.evidence;
  /**
   * Only a room that claimed a language can be under-attested. When the phrase
   * named none and nothing was filtered, "0% confirmed by something harder than
   * a caption" is true and useless: the room never made a language claim to
   * confirm. The mixed-pull note below says the real thing instead.
   */
  const caveat =
    evidence && research.language.wanted && research.reels >= 8 && evidence.share < 0.6
      ? `Only ${Math.round(evidence.share * 100)}% of the ${research.reels} reels in this room were confirmed by something harder than a caption (provider language, script, tags, lyrics or comments). Read the medians as indicative rather than settled.`
      : undefined;
  if (caveat) diagnosis.push(caveat);

  /**
   * Say which room was searched, not just how big it is. A phrase that names a
   * language asks a question; a phrase that does not is answered by whatever the
   * search felt like returning, and the difference has to be visible — otherwise
   * a user comparing their Tamil reels with an inferred Telugu room blames the
   * numbers instead of the phrase.
   */
  const languages = new Set(
    (research.payload ?? []).map((r) => readLanguage(r).code ?? "unknown"),
  );
  const roomNote =
    research.language.basis === "pull" && research.language.wanted
      ? `“${research.query}” names no language, so we matched the one most of the search came back in (${languageName(research.language.wanted)}). Add a language to the phrase to search a different room.`
      : research.language.basis === "none" && languages.size > 1
        ? `“${research.query}” names no language, so nothing was filtered by language — these ${research.reels} reels come from ${languages.size} languages. Add one to the phrase if you want a single room.`
        : undefined;
  if (roomNote) diagnosis.push(roomNote);

  return {
    language:
      research.language.dropped || evidence
        ? {
            wanted: research.language.wanted,
            basis: research.language.basis,
            word: research.language.word,
            labelled: research.language.labelled,
            share: research.language.share,
            kept: research.reels,
            seen: research.totalReels,
            dropped: research.language.dropped,
            evidence,
            caveat,
          }
        : undefined,
    handle: clean,
    niche: research.query,
    /**
     * The creator's own posts decide the platform, because they decide the
     * profile link at the top of the page. The research payload is only a
     * fallback for the case where the account's own feed was cached without a
     * platform stamp.
     */
    platform: postsPlatform ?? research.accounts[0]?.platform,
    /* Where the account lives, which is not always where its posts were read
       from once a fallback vendor answers the reels call. */
    /* The reader only reads Instagram, so a cached profile without a stamp is
       still an Instagram profile. Left unset, the mixed-network warning on the
       page never fires even when the two do not match. */
    accountPlatform: account ? (account.platform ?? "instagram") : undefined,
    nicheSource,
    nicheFit,
    generatedAt: new Date().toISOString(),
    archetype: {
      id: shape.id,
      label: shape.label,
      language: shape.language,
      blurb: shape.blurb,
      songLed: shape.songLed,
      recommendation: shape.recommendation,
    },
    songs: shape.songLed ? songs : undefined,
    formats: formats.length ? formats : undefined,
    hooks: hooks.length ? hooks : undefined,
    cohort: {
      accounts: peers.length,
      basis,
      nicheMedianViews: referenceMedian,
      sizeMatched,
      platform: cohortPlatform,
    },
    account: account
      ? {
          followers: account.followers,
          posts: account.posts,
          bio: account.bio,
          category: account.category,
          verified: account.verified,
          measured: Boolean(account.followers),
        }
      : undefined,
    standing: {
      followers,
      medianViews: ownMedian,
      bestViews: ownBest,
      reelsRead: mineReels.length,
      vsNiche: Number(vsNiche.toFixed(2)),
      percentile: Number(percentile.toFixed(2)),
      /** true only when this account itself was read, not a same-named stranger */
      accountRead,
      /** true only when we hold their own posts, on the same network as them */
      postsRead,
      unreadReason,
      /**
       * Which network the posts we measured actually came from.
       *
       * Defaulting to "instagram" was wrong in the one case that matters: when
       * the account could not be read and the only rows we hold are a namesake's
       * on another network. The page then told the creator to "connect an
       * Instagram source" while sitting on YouTube rows it had just refused to
       * use — true that the account was unread, but silent about the fact that
       * we were looking at somebody else. `elsewhere` is exactly those rows, so
       * naming its network is the honest answer, and `undefined` when there were
       * none at all (nothing was measured, so there is nothing to attribute).
       */
      readFrom: (postsPlatform ?? elsewhere[0]?.platform) as
        | "instagram"
        | "youtube"
        | undefined,
    },
    diagnosis: diagnosis.join(" "),
    gaps,
    moves: play.moves,
    questions: [],
    audit: audit ?? undefined,
    nextMove: buildNextMove({
      plan: { handle: clean, moves: play.moves, standing: {
        followers, medianViews: ownMedian, bestViews: ownBest,
        reelsRead: mineReels.length, vsNiche: Number(vsNiche.toFixed(2)),
        percentile: Number(percentile.toFixed(2)), accountRead, postsRead, unreadReason,
      } },
      audit: audit ?? undefined,
      comments,
      peerMedian: sizeMatched ? peersMed : nicheMedian,
    }),
    comments: comments.read ? comments : undefined,
    hookRead,
  };
}

/* ------------------------------------------------------------------ *
 * Orchestration: handle → niche → cohort → plan
 * ------------------------------------------------------------------ */

export interface AnalyseResult {
  plan: GrowthPlan;
  niche: NicheGuess;
  /** did the cohort the phrase bought compare like with like */
  nicheFit: CohortFit;
  research: NicheResearch;
  own: OwnPull;
  archetype: ArchetypeGuess;
  /** what the deep pass bought and watched, when one ran */
  deep?: EnrichReport;
  /** raw niche reels, so the caller can build ideas without paying twice */
  seedReels: RawReel[];
}

/**
 * The creator's own best posts, as captions.
 *
 * Read from the feed the analysis already pulled, rather than from the room or
 * from a previous record, because both of those inherit other people's posts —
 * that is how a benchmark creator's caption came to be listed as this account's
 * winning post. A claim about whose post it was should come from the post.
 */
export function ownWinnerCaptions(reels: RawReel[], limit = 3): string[] {
  return [...reels]
    .filter((r) => r.views > 0 && Boolean(r.caption))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit)
    .map((r) => r.caption.slice(0, 140));
}

/**
 * How good a cohort verdict is, when deciding whether a re-search upgrades it.
 *
 * Ordered rather than compared as strings because "less wrong" is not "right":
 * only a real improvement is allowed to replace evidence already paid for.
 */
const VERDICT_RANK: Record<CohortFit["verdict"], number> = {
  // No evidence at all, so any real check is an improvement on it.
  unknown: -1,
  wrong: 0,
  mixed: 1,
  matches: 2,
};

/**
 * Read the account from the network it lives on, and say so when that turned
 * out to be a different one than the caller assumed.
 *
 * The rule when no platform was named: try Instagram first, because that is the
 * product's primary source and the only network where a typed handle is
 * unambiguous to most creators. Fall back to YouTube *only* when Instagram
 * genuinely could not be read and a channel of that name exists — then the
 * whole plan is built from the channel, and `fellBackFrom` makes the plan say it
 * out loud instead of quietly printing YouTube numbers under an Instagram name.
 */
async function readOwnAccount(
  handle: string,
  force: boolean,
  platform?: Platform,
): Promise<OwnPull> {
  if (platform) return pullOwn(handle, force, platform);

  let instagramError: unknown = null;
  try {
    return await pullOwn(handle, force, "instagram");
  } catch (err) {
    instagramError = err;
  }

  /**
   * A channel of the same name is only worth trusting as *this* creator when it
   * has an audience. Without a floor, any handle with no Instagram account fell
   * through to a 435-subscriber squatter and printed their numbers as yours.
   */
  const channel = await fetchYouTubeProfile(handle).catch(() => null);
  if (!channel?.followers || channel.followers < 1000) throw instagramError;

  const own = await pullOwn(handle, force, "youtube");
  own.fellBackFrom = "instagram";
  return own;
}

export async function analyseHandle(
  handle: string,
  opts: { force?: boolean; niche?: string; deep?: boolean; platform?: Platform } = {},
): Promise<AnalyseResult> {
  const own = await readOwnAccount(handle, Boolean(opts.force), opts.platform);

  /**
   * What kind of account this is, decided from its own captions before anything
   * else — including the niche. It is the most reliable reading we have of an
   * account, and the label is built on top of it, so it can no longer inherit
   * whatever hashtag soup happened to be written to disk last week.
   */
  const firstPass = detectArchetype(own.reels);

  /**
   * A stored phrase is only trusted when we know how it was made. Records
   * written before provenance existed carry a hashtag guess with no way to tell
   * it from a model's answer, so they are re-derived once (a few hundred
   * tokens, no credits) and written back with their source.
   */
  const storedGuess: NicheGuess | null =
    own.niche && isTrustedLabel(own.nicheSource)
      ? { query: own.niche, audience: "", source: own.nicheSource! }
      : null;

  /** A phrase derived from the shape is only as good as the shape reading. */
  const stale = storedGuess ? shapeMovedOn(storedGuess, firstPass) : false;

  const guess: NicheGuess = opts.niche?.trim()
    ? { query: opts.niche.trim().toLowerCase(), audience: "", source: "user" }
    : storedGuess && !stale
      ? storedGuess
      : await inferNiche(own.reels, {
          subject: searchSubject(firstPass.id) || firstPass.label,
          language: firstPass.language,
        });

  /** Keep the corrected phrase, so the improved reading is not recomputed. */
  if (stale) await rememberNiche(own.handle, guess);

  /**
   * Last gate before the phrase is allowed to pick a cohort: it has to be a
   * search someone would type. If it is not, the account's own shape wins,
   * because the shape was read from the posts rather than from the tags.
   */
  if (!opts.niche?.trim() && !nicheQuality(guess.query).ok) {
    const fallback = [firstPass.language, searchSubject(firstPass.id)]
      .filter((w): w is string => Boolean(w) && w !== "general")
      .join(" ")
      .trim();
    if (fallback) {
      guess.query = fallback.toLowerCase();
      guess.source = "shape";
    }
  }

  /**
   * The niche the account is searched by has to be in the language it actually
   * posts in. A stored or inferred phrase can be stale or plain wrong (one
   * Telugu tag on a Kannada singer's feed was enough to file her under Telugu),
   * and the damage is not cosmetic: the cohort, the songs and the moves all
   * follow the search phrase, so she gets recommended songs she cannot sing.
   *
   * A niche the visitor typed themselves is left alone — they may know
   * something the posts do not show.
   */
  if (!opts.niche?.trim() && firstPass.language) {
    guess.query = alignNicheLanguage(guess.query, firstPass.language);
  }

  /**
   * Who they are, straight from the platform — one credit, cached with the feed.
   *
   * A creator already working in this field has a real follower count and a bio
   * that states their positioning. Both were being guessed from reel payloads,
   * which sometimes carried no followers at all; that guess then set the peer
   * band, so a mis-sized cohort produced confident nonsense. Failure here is
   * non-fatal: the plan falls back to the numbers in the feed.
   */
  const account = await cachedProfile(own.handle, opts.force, own.platform);

  // `exclude` stops cohort enrichment from buying this creator's own feed a
  // second time — it was already pulled above, with its own baseline.
  let research = await researchNiche({
    query: guess.query,
    exclude: own.handle,
    force: opts.force,
  });

  /**
   * Ask what the search actually returned before trusting it.
   *
   * A phrase can read perfectly and still point at the wrong room — one stray
   * language tag filed a Kannada singer under Telugu comedy, and because every
   * number in the plan is a comparison against this cohort, the numbers were
   * confident and wrong. Nothing here costs a credit: the reels are already on
   * disk, and the check only reads them.
   */
  const ownKey = own.handle.toLowerCase();
  let cohortReels = (research.payload ?? []).filter(
    (r) => (r.account ?? "").toLowerCase() !== ownKey,
  );

  /**
   * The creator's own posts, on the creator's own network — the same rule
   * `buildPlan` applies, so the room is never judged against posts that belong
   * to someone else.
   *
   * Without this, @natgeo was identified on Instagram and then had its YouTube
   * namesake's feed used as "its posts" for the room check: the room came back
   * "matches" against a channel that was not the account.
   */
  const identityPlatform: Platform | undefined =
    account?.platform ?? (account ? "instagram" : undefined);
  const creatorPosts = own.reels.filter(
    (r) =>
      (r.account ?? "").toLowerCase() === ownKey &&
      (identityPlatform ? r.platform === identityPlatform : true),
  );

  /**
   * The comparison cohort has to be on the creator's network.
   *
   * Keyword search is served by the free YouTube reader, so an Instagram
   * creator's room arrived as YouTube channels — @natgeotravel, 44.5M followers
   * on Instagram, was benchmarked against two YouTube channels with one of them
   * being a Baltimore news station. The page admitted the mismatch and shipped
   * it anyway, because no amount of labelling turns YouTube views into a
   * yardstick for an Instagram account.
   *
   * So when the creator is known to be on Instagram and the room came back from
   * somewhere else, the cohort is rebuilt on Instagram: Instagram's own similar
   * accounts, plus accounts matching the niche phrase, size-banded, with three
   * of them read in full. Roughly $0.21 a plan out of the free monthly
   * allowance.
   *
   * Only fires on a genuine platform conflict. A room that is already Instagram
   * is left exactly as it was — this repairs a wrong cohort, it does not replace
   * a correct one.
   */
  const cohortOn = (payload: RawReel[]): Platform | undefined => {
    const tally = new Map<Platform, number>();
    for (const r of payload) {
      const p = r.platform ?? "instagram";
      tally.set(p, (tally.get(p) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  /** set only by the rebuild below; carried into the plan so the page can say it */
  let peerRoom: PlanInput["peerRoom"];

  /**
   * Rebuild the room on Instagram for one search phrase, or give up quietly.
   *
   * A function rather than a block because the phrase can change *after* the
   * first rebuild. When the room is judged wrong, the corrected phrase is
   * searched — and that search is served by the free YouTube reader, so it put
   * the YouTube cohort straight back and undid the repair. Measured on
   * @natgeotravel on 2026-10-28: three Instagram accounts were bought, the page
   * said "Instagram accounts in your space…", and the cohort underneath it was
   * still stamped `youtube`, because the retry arrived after the rebuild.
   *
   * Returns null when no Instagram reels came back, leaving the caller's room
   * untouched — a labelled mismatch beats replacing a real cohort with nothing.
   */
  const rebuildRoom = async (
    query: string,
    base: NicheResearch,
  ): Promise<NicheResearch | null> => {
    try {
      const peers = await instagramPeers({
        handle: own.handle,
        followers: account?.followers,
        related: account?.related,
        query,
      });
      if (!peers.reels.length) {
        dbg("rebuild FAILED (no reels)", query, peers.errors.slice(0, 2));
        if (peers.errors.length) {
          peerRoom = { basis: peers.basis, sizeMatched: false, accounts: 0 };
        }
        return null;
      }
      /**
       * The creator's own posts ride along so the language gate and the "what is
       * this account" reading have the same anchor they had before. `shape()`
       * keeps them out of the cohort list itself.
       */
      const rebuilt = researchFromCache(query, [...creatorPosts, ...peers.reels], {
        handle: own.handle,
        fetchedAt: base.fetchedAt,
        errors: [...base.errors, ...peers.errors],
      });
      /**
       * Peer discovery is real money, so it is added to the run's own spend
       * counter. Leaving it out would print a plan cost that is lower than the
       * invoice, which is the one number in the product a reader can check.
       */
      rebuilt.credits = {
        spent: base.credits.spent + peers.cost.results,
        calls: base.credits.calls + peers.accounts.length + 1,
        remaining: peers.cost.results ? null : base.credits.remaining,
      };
      peerRoom = {
        basis: peers.basis,
        sizeMatched: peers.sizeMatched,
        accounts: peers.accounts.length,
        band: peers.band,
      };
      dbg("rebuild OK", query, "peerReels", peers.reels.length, "accounts", peers.accounts.map((a) => a.handle).join(","), "shaped", rebuilt.payload?.length);
      return rebuilt;
    } catch (err) {
      /**
       * Non-fatal by design: a cohort from the wrong network is still a cohort,
       * and the page already labels it as such. Failing the whole plan because
       * the better room could not be bought would be worse than the mismatch.
       */
      peerRoom = {
        basis: `Instagram peers could not be read: ${(err as Error).message}`,
        sizeMatched: false,
        accounts: 0,
      };
      return null;
    }
  };

  /** temporary trace, stripped before commit */
  const dbg = (...a: unknown[]) => {
    if (process.env.DEBUG_PEERS) console.error("[peers]", ...a);
  };

  const adoptRoom = (rebuilt: NicheResearch) => {
    research = rebuilt;
    cohortReels = (rebuilt.payload ?? []).filter(
      (r) => (r.account ?? "").toLowerCase() !== ownKey,
    );
  };

  const needsInstagramRoom =
    identityPlatform === "instagram" && cohortReels.length > 0 && cohortOn(cohortReels) !== "instagram";

  if (needsInstagramRoom) {
    dbg("needs rebuild; room is", cohortOn(cohortReels), cohortReels.length);
    const rebuilt = await rebuildRoom(guess.query, research);
    if (rebuilt) adoptRoom(rebuilt);
    dbg("after first rebuild: room is", cohortOn(cohortReels), cohortReels.length);
  }

  const checked = cohortFitness({
    query: guess.query,
    creator: creatorPosts,
    cohort: cohortReels,
    shape: firstPass,
    /**
     * Only compare against the creator when the creator's own posts are in
     * hand. Judging a room against a stranger marked all 15 wildlife accounts
     * as "nothing in common" — then pruned a correct cohort to nothing.
     */
    creatorUnread: creatorPosts.length === 0,
  });
  let nicheFit: CohortFit = checked;

  /**
   * Rebuild the benchmark without the accounts that are plainly elsewhere, and
   * keep their reels out of the medians. Dropping them is the difference between
   * "singers your size get 90k" and "a comedy page with 14M followers gets 90k".
   */
  if (checked.off.length && research.payload?.length) {
    const pruned = pruneCohort(research.payload, checked.off, own.handle);
    if (pruned.length && pruned.length < research.payload.length) {
      research = researchFromCache(guess.query, pruned, {
        handle: own.handle,
        fetchedAt: research.fetchedAt,
        errors: research.errors,
      });
    }
  }

  /**
   * When the cohort is wrong, the phrase was wrong. A corrected phrase is
   * remembered so the next run searches the right room — but the pull already
   * paid for is not repeated here, because that is a second spend and the
   * visitor did not ask for it. A phrase the visitor typed is left alone.
   */
  let nicheNext: string | undefined;
  if (nicheFit.verdict === "wrong" && !opts.niche?.trim()) {
    const fallback = [firstPass.language, searchSubject(firstPass.id)]
      .filter((w): w is string => Boolean(w) && w !== "general")
      .join(" ")
      .trim()
      .toLowerCase();

    if (fallback && nicheQuality(fallback).ok && fallback !== guess.query) {
      /**
       * Search the corrected room now, rather than promising it "next run".
       *
       * Deferring this was the difference between an accurate plan and a
       * plausible one. Telling someone "the next run will search wildlife
       * instead" admits that the page in front of them measures them against
       * the wrong people, and nobody can act on a promise about a future run.
       * The retry is one search, and it costs nothing whenever the free YouTube
       * reader can serve it.
       */
      const retry = await researchNiche({ query: fallback, exclude: own.handle }).catch(
        () => null,
      );

      const retryReels = (retry?.payload ?? []).filter(
        (r) => (r.account ?? "").toLowerCase() !== ownKey,
      );

      const recheck =
        retry && retryReels.length
          ? cohortFitness({
              query: fallback,
              creator: own.reels,
              cohort: retryReels,
              shape: firstPass,
            })
          : null;

      /**
       * Adopt only on a strictly better verdict. A room that is merely less bad
       * does not beat the evidence already paid for, and swapping it in would
       * trade one wrong cohort for another with the same confidence.
       */
      if (
        retry &&
        recheck &&
        VERDICT_RANK[recheck.verdict] > VERDICT_RANK[nicheFit.verdict]
      ) {
        research = retry;
        if (recheck.off.length) {
          const pruned = pruneCohort(retry.payload ?? [], recheck.off, own.handle);
          if (pruned.length && pruned.length < (retry.payload ?? []).length) {
            research = researchFromCache(fallback, pruned, {
              handle: own.handle,
              fetchedAt: retry.fetchedAt,
              errors: retry.errors,
            });
          }
        }
        /**
         * The corrected phrase came back from the free YouTube reader, so an
         * Instagram creator would get its repaired cohort swapped back for a
         * YouTube one right here — the repair has to be repeated for the new
         * phrase, or adopting the better phrase is what breaks the comparison.
         */
        if (identityPlatform === "instagram") {
          const rebuiltRoom = await rebuildRoom(fallback, research);
          if (rebuiltRoom) adoptRoom(rebuiltRoom);
          dbg("after retry rebuild: room is", cohortOn(cohortReels), cohortReels.length, "rebuilt:", Boolean(rebuiltRoom));
        }
        guess.query = fallback;
        guess.source = "shape";
        nicheFit = recheck;
        await rememberNiche(own.handle, guess);
      } else {
        nicheNext = fallback;
        guess.next = fallback;
        nicheFit.reasons.push(
          `The next run will search "${fallback}" instead — the phrase "${guess.query}" was the problem, not the posts.`,
        );
      }
    }
  }

  /**
   * The deep pass: watch the few posts that decide the question.
   *
   * Counting 300 reels says what travelled. It cannot say whether the first
   * second that held people was a sentence, a caption on screen, or a picture
   * of something happening — and that is the one thing that changes what the
   * creator films tomorrow. Six posts, one credit each, read locally after
   * that; cached for a week, so a second plan for the same account is free.
   */
  let deep: EnrichReport | undefined;
  let ownReels = own.reels;
  let payload = research.payload;
  dbg("final research room:", cohortOn(payload ?? []), "rows", payload?.length, "cohortReels", cohortReels.length, cohortOn(cohortReels));
  if (opts.deep && own.reels.length) {
    try {
      const picks = pickForEnrichment(own.reels, research.payload ?? []);
      const result = await enrich(picks, { maxCredits: 6, watch: 6 });
      deep = result.report;
      const byUrl = new Map(result.reels.map((r) => [r.url, r]));
      ownReels = own.reels.map((r) => byUrl.get(r.url) ?? r);
      payload = payload?.map((r) => byUrl.get(r.url) ?? r);
      if (result.report.skipped) deep.errors.push(result.report.skipped);
    } catch (err) {
      deep = {
        posts: 0,
        watched: 0,
        spent: 0,
        errors: [(err as Error).message],
      };
    }
  }

  /* Only their own posts may name the account's shape; a same-named channel on
     another network was producing a confident "wildlife documentary" from
     someone else's feed. Falls back to the niche when there are no own posts. */
  const archetype = detectArchetype(
    ownReels.filter((r) => r.account?.replace(/^@/, "").toLowerCase() === own.handle.toLowerCase()),
    guess.query,
  );

  /**
   * Remember the inferred niche so a re-run needs no inference step — with its
   * source, so a later run can tell a decided label from a provisional one. When
   * the cohort check found the phrase was wrong, the corrected phrase is what
   * gets remembered, so the next run searches the right room instead of paying
   * twice for the same answer.
   */
  const storedNiche = guess.next ?? guess.query;
  const storedSource: NicheGuess["source"] = guess.next ? "shape" : guess.source;
  if (own.niche !== storedNiche || own.nicheSource !== storedSource) {
    await writeHandle({
      fetchedAt: new Date().toISOString(),
      handle: own.handle,
      reels: own.reels,
      niche: storedNiche,
      nicheSource: storedSource,
      nicheAt: new Date().toISOString(),
      /* carry the profile across, or saving a niche silently wipes the cache */
      profile: account ?? undefined,
      profileAt: account ? new Date().toISOString() : undefined,
    });
  }

  const plan = buildPlan({
    handle: own.handle,
    research: payload ? { ...research, payload } : research,
    ownReels,
    archetype,
    account,
    nicheSource: guess.source,
    nicheFit,
    platform: own.platform,
    peerRoom,
  });

  return {
    plan,
    niche: guess,
    nicheFit,
    research,
    own: { ...own, reels: ownReels },
    archetype,
    seedReels: [...(payload ?? []), ...ownReels],
    deep,
  };
}

/** Used by the page header: "Singer · Telugu · 2.1k followers". */
export function archetypeLine(plan: GrowthPlan): string {
  const bits = [titleCase(plan.archetype.label)];
  if (plan.archetype.language) bits.push(titleCase(plan.archetype.language));
  // Only when we actually read the account — see `standing.accountRead`.
  if (plan.standing.accountRead !== false && plan.standing.followers) {
    bits.push(`${fmt(plan.standing.followers)} followers`);
  }
  return bits.join(" · ");
}
