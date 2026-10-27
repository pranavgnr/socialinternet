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
import { mineComments } from "./comments";
import { enrich, pickForEnrichment, type EnrichReport } from "./enrich";
import { buildNextMove } from "./nextMove";
import { harvestInstagramAccount, fetchInstagramProfile, type AccountProfile } from "./harvest";
import { jsonCall, llmReady } from "./llm";
import { researchNiche, researchFromCache, type NicheResearch } from "./niche";
import { availableProviders } from "./providers";
import { cohortFitness, pruneCohort } from "./cohort";
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
}

async function readHandle(handle: string): Promise<StoredHandle | null> {
  try {
    const raw = await fs.readFile(path.join(HANDLE_DIR, `${slug(handle)}.json`), "utf8");
    return JSON.parse(raw) as StoredHandle;
  } catch {
    return null;
  }
}

async function writeHandle(value: StoredHandle): Promise<void> {
  await fs.mkdir(HANDLE_DIR, { recursive: true });
  const target = path.join(HANDLE_DIR, `${slug(value.handle)}.json`);
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
async function cachedProfile(
  handle: string,
  force = false,
): Promise<AccountProfile | null> {
  const stored = await readHandle(handle);
  const ageHours = stored?.profileAt
    ? (Date.now() - Date.parse(stored.profileAt)) / 36e5
    : Infinity;

  /* A missing or unparseable timestamp reads as Infinity and refetches, which
     is the safe direction: one credit, never a wrong follower count forever. */
  if (!force && stored?.profile && Number.isFinite(ageHours) && ageHours < PROFILE_TTL_HOURS) {
    return stored.profile;
  }

  try {
    const fresh = await fetchInstagramProfile(handle);
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
  reels: RawReel[];
  cached: boolean;
  niche?: string;
  nicheSource?: NicheGuess["source"];
  nicheAt?: string;
}

export async function pullOwn(handle: string, force = false): Promise<OwnPull> {
  const clean = cleanHandle(handle);
  if (!clean) throw new Error("Enter an Instagram handle");

  const stored = await readHandle(clean);
  const ageHours = stored
    ? (Date.now() - new Date(stored.fetchedAt).getTime()) / 36e5
    : Infinity;

  if (!force && stored && ageHours < HANDLE_TTL_HOURS) {
    return {
      handle: clean,
      reels: stored.reels,
      cached: true,
      niche: stored.niche,
      nicheSource: stored.nicheSource,
      nicheAt: stored.nicheAt,
    };
  }

  if (!availableProviders().length) {
    throw new Error(
      "No Instagram data source is configured — add HIKERAPI_KEY or SOCIALCRAWL_API_KEY.",
    );
  }

  const reels = await harvestInstagramAccount(clean);
  if (!reels.length) {
    throw new Error(
      `Instagram returned nothing for @${clean}. Check the handle is spelled right and the account is public.`,
    );
  }
  await writeHandle({
    fetchedAt: new Date().toISOString(),
    handle: clean,
    reels,
    niche: stored?.niche,
    nicheSource: stored?.nicheSource,
    nicheAt: stored?.nicheAt,
    profile: stored?.profile,
    profileAt: stored?.profileAt,
  });
  return { handle: clean, reels, cached: false };
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
}

export function buildPlan({
  handle,
  research,
  ownReels,
  archetype,
  account,
  nicheSource,
  nicheFit,
}: PlanInput): GrowthPlan {
  const clean = cleanHandle(handle);
  const ownViews = ownReels.map((r) => r.views).filter((v) => v > 0);
  const reportedBaseline = ownReels.find((r) => r.baselineMedianViews)?.baselineMedianViews;
  const ownMedian = reportedBaseline || median(ownViews);
  const ownBest = Math.max(0, ...ownViews);
  // A profile call beats a reel payload: the payload only carries followers when
  // the platform happened to include them, so the cohort was sometimes banded on
  // a number from one lucky post.
  const followers = account?.followers ?? ownReels.find((r) => r.followers)?.followers;

  const shape = archetype ?? detectArchetype(ownReels, research.query);

  const others = research.accounts.filter(
    (a) => a.handle.toLowerCase() !== clean.toLowerCase(),
  );

  // The cohort is the whole product. Comparing a 2k account against 500k
  // accounts produces confident nonsense, so peers are size-matched first.
  let peers = others;
  let basis = "everyone in this space — not enough accounts your size yet";
  let sizeMatched = false;
  if (followers) {
    const banded = others.filter(
      (a) => a.followers && a.followers >= followers * 0.35 && a.followers <= followers * 2.5,
    );
    if (banded.length >= 3) {
      peers = banded;
      basis = `accounts about your size (${fmt(followers)} followers)`;
      sizeMatched = true;
    }
  }
  if (!sizeMatched && ownMedian > 0) {
    const banded = others.filter(
      (a) => a.medianViews >= ownMedian * 0.3 && a.medianViews <= ownMedian * 3,
    );
    if (banded.length >= 3) {
      peers = banded;
      basis = "accounts pulling within 3x your usual views";
      sizeMatched = true;
    }
  }
  peers = peers.slice(0, MAX_COHORT_ACCOUNTS);

  const rows = buildRows(research, clean);
  const peerHandles = new Set(peers.map((p) => p.handle.toLowerCase()));
  const peerRows = rows.filter((r) => peerHandles.has(r.account.toLowerCase()));
  const workingRows = peerRows.length >= 6 ? peerRows : rows;

  const nicheMedian = research.nicheMedianViews || median(others.map((a) => a.medianViews));
  const vsNiche = nicheMedian > 0 ? ownMedian / nicheMedian : 0;
  const peersMed = peersMedian(peers);

  /**
   * One reference group for every sentence on the page. The standing used to be
   * measured against everyone in the space while the comparison row used the
   * size-matched accounts, so the same plan said "accounts your size get 66k"
   * above a chart that said 32k. Whatever the plan compares you with has to be
   * the same set it quotes.
   */
  const reference = sizeMatched ? peers : others;
  const referenceMedian = sizeMatched ? peersMed : nicheMedian;
  const beat = reference.filter((a) => ownMedian > 0 && a.medianViews < ownMedian).length;
  const percentile = reference.length ? beat / reference.length : 0;

  const ownGap = medianGapDays(ownReels);
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
    own: ownReels,
    ownMedian,
    ownBest,
    nicheMedian,
    peers,
    ownGapDays: ownGap,
    peerGapDays: peerGapMedian,
  });

  const gaps: PlanGap[] = [];
  if (referenceMedian > 0 && ownMedian > 0) {
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
  if (ownSpread > 0 && peerSpreads.length) {
    gaps.push({
      label: "your best vs your usual",
      you: times(ownSpread),
      cohort: times(median(peerSpreads)),
    });
  }
  if (ownGap !== null && peerGapMedian !== null) {
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

  const diagnosis: string[] = [
    `You usually get around ${fmt(ownMedian)} views a post. Accounts your size get about ${fmt(
      referenceMedian,
    )}. That puts you ahead of ${Math.round(percentile * 100)}% of them.`,
  ];

  /* ---------------- the account read against itself ---------------- */

  const audit = buildAudit({
    reels: ownReels,
    peerMedian: sizeMatched ? peersMed : undefined,
    nicheMedian,
  });
  const hookRead = hookVerdict(ownReels);
  const comments = mineComments(
    [...ownReels, ...(research.payload ?? [])].map((r) => ({
      url: r.url,
      comments: r.topComments,
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
        : `Some accounts that were not your kind of account were left out of the numbers.`,
    );
  }

  diagnosis.push(
    `Everything below comes from ${ownReels.length} of your posts and ${workingRows.length} posts from accounts your size.`,
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
    platform: ownReels.find((r) => r.platform)?.platform ?? research.accounts[0]?.platform,
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
      nicheMedianViews: nicheMedian,
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
      reelsRead: ownReels.length,
      vsNiche: Number(vsNiche.toFixed(2)),
      percentile: Number(percentile.toFixed(2)),
    },
    diagnosis: diagnosis.join(" "),
    gaps,
    moves: play.moves,
    questions: [],
    audit: audit ?? undefined,
    nextMove: buildNextMove({
      plan: { handle: clean, moves: play.moves, standing: {
        followers, medianViews: ownMedian, bestViews: ownBest,
        reelsRead: ownReels.length, vsNiche: Number(vsNiche.toFixed(2)),
        percentile: Number(percentile.toFixed(2)),
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
  wrong: 0,
  mixed: 1,
  matches: 2,
};

export async function analyseHandle(
  handle: string,
  opts: { force?: boolean; niche?: string; deep?: boolean } = {},
): Promise<AnalyseResult> {
  const own = await pullOwn(handle, opts.force);

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
  const account = await cachedProfile(own.handle, opts.force);

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
  const cohortReels = (research.payload ?? []).filter(
    (r) => (r.account ?? "").toLowerCase() !== ownKey,
  );
  const checked = cohortFitness({
    query: guess.query,
    creator: own.reels,
    cohort: cohortReels,
    shape: firstPass,
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

  const archetype = detectArchetype(ownReels, guess.query);

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
  if (plan.standing.followers) bits.push(`${fmt(plan.standing.followers)} followers`);
  return bits.join(" · ");
}
