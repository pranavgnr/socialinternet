/**
 * Instagram-native peer discovery, v2.
 *
 * The bug this exists to fix, stated plainly: every number in a plan is a
 * comparison against a cohort, and for an Instagram creator that cohort was
 * built from a **YouTube** keyword search. So @natgeotravel — 44.5M followers on
 * Instagram — was measured against two YouTube channels, one of them a Baltimore
 * news station. The page even said so ("the creators we compared you with are on
 * YouTube"), which is honest and still useless: a labelled wrong answer is a
 * wrong answer.
 *
 * The fix is not "find more accounts"; it is "find the right ones and say why".
 * Four sources feed one pure selector:
 *
 *   1. Instagram's own similar accounts (`/instagram/related/profiles`);
 *   2. accounts matching the niche phrase (`/instagram/search/accounts`);
 *   3. the owners of the niche's top reels — already paid for by the search, so
 *      they cost nothing to reuse;
 *   4. hashtag owners, when a vendor reports them (the source weight exists so
 *      a future gatherer can join without changing the rule).
 *
 * `rankPeers` is the product decision and is deliberately pure: privacy,
 * staleness, the 0.3x–3x size band (widened only when it has to be, and labelled
 * when it is), the language conflict, duplicate merging, the source score, the
 * cap and the stable tie-break are all unit-tested without a vendor in sight.
 *
 * What this does NOT do is pretend. If Instagram has no account in the
 * creator's size band, the honest output is a cohort of the right network at the
 * wrong size, labelled as such — never a size-matched cohort from another
 * network. If one source is down, the others still build the cohort; the failure
 * is reported, not hidden.
 */
import { harvestInstagramAccount, searchInstagramAccounts } from "./harvest";
import { explicitLanguage, languageInQuery } from "./lang";
import { normaliseOwnerHandle, resolveOwnerFollowers } from "./ownerProfiles";
import { creditLedger, request } from "./providers";
import type { RawReel } from "./types";

/** How many peers to read in full. Six is the default, not a ceiling. */
const PEER_MAX = Number(process.env.PEER_MAX ?? 6);

/**
 * How many accounts a size-matched cohort needs before it is allowed to exist.
 *
 * Three, because a median over two accounts is a different number every time
 * one of them posts, and the page's "accounts your size" claim should not rest
 * on a pair.
 */
const PEER_MIN_COHORT = Number(process.env.PEER_MIN_COHORT ?? 3);

/**
 * How many candidate profiles may be read just to learn a follower count.
 *
 * Search results and similar accounts arrive without a size, so the band cannot
 * be applied until they are read — one cached or paid read each. Six is the
 * point where sorting costs more than reading the peers themselves.
 */
const LOOKUP_MAX = Number(process.env.PEER_LOOKUP_MAX ?? 6);

/** The plan's band, applied to candidate accounts. */
const BAND_LOW = 0.3;
const BAND_HIGH = 3;

/** An account that has not posted in this long is not a competitor. */
const INACTIVE_DAYS = 30;

/**
 * Below this many accounts, the phrase search is judged thin and the basis says
 * so. It does not trigger extra searches any more: the per-plan discovery cap
 * is one similar-accounts call plus one phrase search, and word-by-word retries
 * were quietly spending three.
 */
const THIN_SEARCH = 5;

/** How many top-reel owners are worth carrying into selection (free rows). */
const OWNER_CANDIDATES = 12;

export type PeerSource = "similar" | "search" | "hashtag" | "owner-of-top-reel";

export interface PeerCandidate {
  handle: string;
  followers?: number;
  private?: boolean;
  /**
   * Epoch ms of the newest post the source knows about.
   *
   * Only set when the source really reports the *latest* activity. A top reel's
   * `postedAt` is the date of that reel, not the account's last post, so it is
   * deliberately not used for staleness — treating an old winner as an inactive
   * account would drop a live competitor.
   */
  lastActiveAt?: number;
  /**
   * Explicit language codes read from the account's own reels, when we have
   * them. Empty means "no evidence", which never drops an account.
   */
  languages?: string[];
  sources: PeerSource[];
  /** the phrase a search found this account with, for its reason */
  query?: string;
  /** the hashtag it was found under, when the source is `hashtag` */
  hashtag?: string;
}

export interface PeerCreator {
  handle?: string;
  followers?: number;
  /** the room's language, when the phrase names one */
  language?: string | null;
  /** the phrase used in a search reason */
  query?: string;
}

export interface RankedPeer extends PeerCandidate {
  reasons: string[];
  source: PeerSource;
  inBand: boolean;
  score: number;
}

export interface PeerRanking {
  peers: RankedPeer[];
  dropped: { handle: string; why: string }[];
  band?: { low: number; high: number };
  /** true when the band was opened because too few accounts sat inside it */
  widened: boolean;
  sizeMatched: boolean;
  basis: string;
}

const SOURCE_WEIGHT: Record<PeerSource, number> = {
  similar: 3,
  search: 2,
  hashtag: 2,
  "owner-of-top-reel": 1,
};

const SOURCE_ORDER: PeerSource[] = ["similar", "search", "hashtag", "owner-of-top-reel"];

const clean = (h: string) => h.replace(/^@/, "").trim().toLowerCase();

/** Letters, digits and underscore only: the same rule the old peer code used. */
const handleKey = (h: string) => clean(h).replace(/[^a-z0-9_]/g, "");

function sameHandle(a: string | undefined, b: string): boolean {
  return Boolean(a) && handleKey(a!) === handleKey(b);
}

const isKnownSize = (c: { followers?: number }): boolean =>
  typeof c.followers === "number" && Number.isFinite(c.followers) && c.followers > 0;

function median(xs: number[]): number {
  const list = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function compact(n: number | undefined): string {
  if (!n) return "?";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/**
 * One row per account, however many sources named it.
 *
 * Duplicates are normal: a real competitor appears in Instagram's similar list
 * *and* matches the phrase. Merging is what lets the score add a point for the
 * second source and lets the reasons say both things.
 */
function mergeCandidates(candidates: PeerCandidate[]): PeerCandidate[] {
  const out = new Map<string, PeerCandidate>();
  for (const raw of candidates) {
    const key = handleKey(raw.handle);
    if (!key) continue;
    const prev = out.get(key);
    const sources = [...new Set(raw.sources)];
    if (!prev) {
      out.set(key, {
        ...raw,
        handle: clean(raw.handle),
        sources,
        languages: raw.languages ? [...new Set(raw.languages)] : undefined,
      });
      continue;
    }
    if (!isKnownSize(prev) && isKnownSize(raw)) prev.followers = raw.followers;
    prev.private = Boolean(prev.private || raw.private);
    if (typeof raw.lastActiveAt === "number") {
      prev.lastActiveAt = Math.max(prev.lastActiveAt ?? 0, raw.lastActiveAt);
    }
    prev.sources = [...new Set([...prev.sources, ...sources])];
    if (raw.languages?.length) {
      prev.languages = [...new Set([...(prev.languages ?? []), ...raw.languages])];
    }
    if (!prev.query && raw.query) prev.query = raw.query;
    if (!prev.hashtag && raw.hashtag) prev.hashtag = raw.hashtag;
  }
  return [...out.values()];
}

function primarySource(sources: PeerSource[]): PeerSource {
  return (
    [...sources].sort(
      (a, b) =>
        SOURCE_WEIGHT[b] - SOURCE_WEIGHT[a] || SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
    )[0] ?? "search"
  );
}

/**
 * Why this account is here, in words a creator can check.
 *
 * Every reason is generated from the data that selected the account: the source
 * that named it, a language both sides explicitly declare, or the band its own
 * follower count falls into. No model writes these, and no reason claims a fact
 * the gatherer did not have.
 */
function reasonsFor(
  candidate: PeerCandidate,
  creator: PeerCreator,
  band: { low: number; high: number } | undefined,
  sameLanguage: boolean,
  inBand: boolean,
): string[] {
  const reasons: string[] = [];
  for (const source of SOURCE_ORDER) {
    if (!candidate.sources.includes(source)) continue;
    if (source === "similar") reasons.push("appears in Instagram's similar accounts");
    if (source === "search") {
      const phrase = candidate.query ?? creator.query;
      reasons.push(
        phrase ? `posts reels about '${phrase}'` : "posts reels in this space",
      );
    }
    if (source === "hashtag") {
      reasons.push(
        candidate.hashtag
          ? `posts reels with #${candidate.hashtag.replace(/^#/, "")}`
          : "posts reels under this niche's hashtag",
      );
    }
    if (source === "owner-of-top-reel") {
      reasons.push("owns one of the top reels in this niche");
    }
  }
  if (sameLanguage) reasons.push("same language");
  if (inBand && band) {
    reasons.push(`about your size (${compact(band.low)}-${compact(band.high)} followers)`);
  }
  if (!reasons.length) reasons.push("found on Instagram");
  return [...new Set(reasons)];
}

function basisFor(opts: {
  followers?: number;
  band?: { low: number; high: number };
  widened: boolean;
  inBand: number;
  minCohort: number;
  accounts: number;
}): string {
  if (opts.accounts === 0) return "no Instagram accounts came back for this space";
  if (!opts.band) {
    return "Instagram accounts in your space — your size is unknown, so this is not size-matched";
  }
  if (opts.widened) {
    return `Instagram accounts in your space — fewer than ${opts.minCohort} came back near your size (${compact(
      opts.followers,
    )} followers), so we widened the 0.3x–3x band: this is not a size-matched cohort`;
  }
  if (opts.inBand >= opts.minCohort) {
    return `Instagram accounts about your size (${compact(opts.followers)} followers) — ${opts.inBand} of them`;
  }
  return `Instagram accounts in your space, but only ${opts.inBand} near your size (${compact(
    opts.followers,
  )} followers) — too few to call a cohort`;
}

/**
 * The selection rule, pure and testable.
 *
 * Order of operations matters: drop what cannot be a peer at all (private,
 * stale, another language), *then* decide whether the size band has enough
 * members, *then* score what is left. Scoring a private account and dropping it
 * afterwards would let it take a slot from a real one.
 */
export function rankPeers(
  candidates: PeerCandidate[],
  creator: PeerCreator,
  opts: { max?: number; now?: number; minCohort?: number } = {},
): PeerRanking {
  const now = opts.now ?? Date.now();
  const max = Math.max(1, Math.floor(opts.max ?? PEER_MAX));
  const minCohort = Math.max(1, Math.floor(opts.minCohort ?? PEER_MIN_COHORT));
  const own = creator.handle ? handleKey(creator.handle) : "";

  const merged = mergeCandidates(candidates).filter(
    (c) => !own || handleKey(c.handle) !== own,
  );

  const dropped: { handle: string; why: string }[] = [];
  const eligible: PeerCandidate[] = [];
  for (const c of merged) {
    if (c.private) {
      dropped.push({ handle: c.handle, why: "private account" });
      continue;
    }
    if (
      typeof c.lastActiveAt === "number" &&
      now - c.lastActiveAt > INACTIVE_DAYS * 86_400_000
    ) {
      dropped.push({ handle: c.handle, why: `inactive for more than ${INACTIVE_DAYS} days` });
      continue;
    }
    if (
      creator.language &&
      c.languages?.length &&
      !c.languages.includes(creator.language)
    ) {
      dropped.push({
        handle: c.handle,
        why: `posts in ${c.languages.join("/")}, creator is ${creator.language}`,
      });
      continue;
    }
    eligible.push(c);
  }

  const band =
    creator.followers && creator.followers > 0
      ? {
          low: Math.round(creator.followers * BAND_LOW),
          high: Math.round(creator.followers * BAND_HIGH),
        }
      : undefined;

  const inBand = (c: PeerCandidate): boolean =>
    Boolean(
      band &&
        isKnownSize(c) &&
        c.followers! >= band.low &&
        c.followers! <= band.high,
    );

  const inside = band ? eligible.filter(inBand) : [];
  const widened = Boolean(band && inside.length < minCohort);

  const pool: PeerCandidate[] = [];
  for (const c of eligible) {
    if (band && !widened && isKnownSize(c) && !inBand(c)) {
      dropped.push({ handle: c.handle, why: "outside the size band" });
      continue;
    }
    pool.push(c);
  }

  const scored: RankedPeer[] = pool.map((c) => {
    const sources = [...new Set(c.sources)];
    const sameLanguage = Boolean(
      creator.language && c.languages?.includes(creator.language),
    );
    const insideBand = inBand(c);
    let score = sources.length
      ? Math.max(...sources.map((s) => SOURCE_WEIGHT[s] ?? 0))
      : 0;
    score += Math.max(0, sources.length - 1);
    if (sameLanguage) score += 1;
    if (band && isKnownSize(c) && !insideBand) score -= 1;
    return {
      ...c,
      reasons: reasonsFor(c, creator, band, sameLanguage, insideBand),
      source: primarySource(sources),
      inBand: insideBand,
      score,
    };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score || handleKey(a.handle).localeCompare(handleKey(b.handle)),
  );
  const peers = scored.slice(0, max);
  const keptInBand = peers.filter((p) => p.inBand).length;

  return {
    peers,
    dropped,
    band,
    widened,
    sizeMatched: Boolean(band && keptInBand >= minCohort),
    basis: basisFor({
      followers: creator.followers,
      band,
      widened,
      inBand: keptInBand,
      minCohort,
      accounts: peers.length,
    }),
  };
}

export interface PeerAccount {
  handle: string;
  followers?: number;
  reels: number;
  medianViews: number;
  /**
   * @deprecated kept for callers written before `source`. `similar` maps to
   * `related`; every other source maps to `search`.
   */
  via: "related" | "search";
  /** the strongest source that named this account */
  source: PeerSource;
  /** plain, factual sentences explaining the choice */
  reasons: string[];
  /** inside the size band, when a band could be computed at all */
  inBand: boolean;
}

export interface PeerPull {
  /** their reels, platform-stamped instagram and carrying their follower count */
  reels: RawReel[];
  accounts: PeerAccount[];
  /**
   * The sentence the page may print about this cohort. Written here, next to the
   * evidence, so the claim and the numbers cannot drift apart.
   */
  basis: string;
  /** true only when at least PEER_MIN_COHORT peers landed inside the size band */
  sizeMatched: boolean;
  band?: { low: number; high: number };
  cost: { results: number; usd: number };
  errors: string[];
}

/** Seams for tests: no network, no cache, no clock. Production uses the defaults. */
export interface PeerDeps {
  related?(handle: string): Promise<PeerCandidate[]> | PeerCandidate[];
  search?(query: string): Promise<PeerCandidate[]> | PeerCandidate[];
  readAccount?(handle: string): Promise<RawReel[]>;
  followers?(handles: string[]): Promise<Map<string, number>>;
  now?(): number;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Instagram's similar accounts, through whichever vendor can answer. */
async function relatedCandidates(handle: string): Promise<PeerCandidate[]> {
  const { data } = await request({
    path: "/instagram/related/profiles",
    handle: clean(handle),
    platform: "instagram",
  });

  const out: PeerCandidate[] = [];
  const users = Array.isArray(data.users) ? (data.users as unknown[]) : [];
  for (const raw of users) {
    const u = asObject(raw);
    const username = typeof u.username === "string" ? u.username : "";
    if (!username) continue;
    out.push({
      handle: username,
      followers: typeof u.followers === "number" ? u.followers : undefined,
      private: Boolean(u.private),
      sources: ["similar"],
    });
  }

  const related = Array.isArray(data.related) ? (data.related as unknown[]) : [];
  for (const raw of related) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    out.push({ handle: raw, sources: ["similar"] });
  }
  return out;
}

/**
 * Owners of the niche's already-pulled top reels.
 *
 * Free candidates: the rows were bought for the niche itself. The follower
 * count is reused from the row when Task 3's owner enrichment attached it, and
 * otherwise resolved later from the owner cache. This is the source that keeps
 * peer discovery useful when both Instagram listing endpoints are down.
 */
function ownersFromReels(reels: RawReel[], own: string): PeerCandidate[] {
  const best = new Map<string, { candidate: PeerCandidate; views: number }>();
  for (const row of reels) {
    const handle = clean(row.account ?? "");
    if (!handle || handle === own) continue;
    const key = handleKey(handle);
    if (!key) continue;
    const language = explicitLanguage(row);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, {
        views: row.views,
        candidate: {
          handle,
          followers: isKnownSize(row) ? row.followers : undefined,
          languages: language && language !== "other" ? [language] : undefined,
          sources: ["owner-of-top-reel"],
        },
      });
      continue;
    }
    if (row.views > prev.views) prev.views = row.views;
    if (!isKnownSize(prev.candidate) && isKnownSize(row)) {
      prev.candidate.followers = row.followers;
    }
    if (language && language !== "other") {
      prev.candidate.languages = [
        ...new Set([...(prev.candidate.languages ?? []), language]),
      ];
    }
  }
  return [...best.values()]
    .sort((a, b) => b.views - a.views)
    .slice(0, OWNER_CANDIDATES)
    .map((x) => x.candidate);
}

/**
 * Build an Instagram comparison cohort for one creator.
 *
 * Discovery cost is capped at two logical calls per plan: one similar-accounts
 * pull and one phrase search. Follower lookups (up to `PEER_LOOKUP_MAX`, mostly
 * cache hits) and the peer reads themselves are the existing spend, not new
 * discovery. A failure in any one source is reported and survived.
 */
export async function instagramPeers(opts: {
  handle: string;
  followers?: number;
  /** similar accounts the profile call already returned */
  related?: string[];
  /** the phrase to search accounts by */
  query: string;
  max?: number;
  /** the niche rows already pulled; their owners are free candidates */
  reels?: RawReel[];
  deps?: PeerDeps;
}): Promise<PeerPull> {
  const own = clean(opts.handle);
  const max = Math.max(1, Math.floor(opts.max ?? PEER_MAX));
  const deps = opts.deps ?? {};
  const now = deps.now ? deps.now() : Date.now();
  const errors: string[] = [];
  const ledgerBefore = creditLedger();
  const language = languageInQuery(opts.query)?.code ?? null;

  const gathered: PeerCandidate[] = [];

  /**
   * Similar accounts. The caller may already hold them from the profile read
   * (Apify returns them free), in which case no discovery call is made. A
   * failure here is one source failing, not the cohort failing.
   */
  if (opts.related?.length) {
    for (const handle of opts.related) {
      gathered.push({ handle, sources: ["similar"] });
    }
  } else {
    try {
      const related = deps.related
        ? await deps.related(own)
        : await relatedCandidates(own);
      gathered.push(...related);
    } catch (err) {
      errors.push(`Instagram similar accounts: ${(err as Error).message}`);
    }
  }

  /** One phrase search. No word-by-word retries: that was three calls, not one. */
  try {
    const searched = deps.search
      ? await deps.search(opts.query)
      : (await searchInstagramAccounts(opts.query)).map((row) => ({
          handle: row.handle,
          followers: row.followers,
          private: row.private,
          lastActiveAt: row.lastActiveAt,
          sources: ["search"] as PeerSource[],
          query: opts.query,
        }));
    gathered.push(...searched);
  } catch (err) {
    errors.push(`Instagram account search "${opts.query}": ${(err as Error).message}`);
  }

  /** Top-reel owners: free, because the niche search already bought the rows. */
  gathered.push(...ownersFromReels(opts.reels ?? [], own));

  const merged = mergeCandidates(gathered).filter(
    (c) => handleKey(c.handle) !== handleKey(own),
  );

  /**
   * Buy sizes only for accounts that could still be selected.
   *
   * Private, stale and other-language accounts are filtered first so a paid
   * lookup is never spent on an account the selector will drop. Handles the
   * owner cache already knows cost nothing.
   */
  const candidateForLookup = merged.filter((c) => {
    if (c.private) return false;
    if (typeof c.lastActiveAt === "number" && now - c.lastActiveAt > INACTIVE_DAYS * 86_400_000) {
      return false;
    }
    if (language && c.languages?.length && !c.languages.includes(language)) return false;
    return !isKnownSize(c);
  });

  if (candidateForLookup.length) {
    const handles = candidateForLookup.slice(0, LOOKUP_MAX).map((c) => c.handle);
    try {
      const counts = deps.followers
        ? await deps.followers(handles)
        : await resolveOwnerFollowers(handles, { max: LOOKUP_MAX });
      for (const c of candidateForLookup) {
        const followers = counts.get(normaliseOwnerHandle(c.handle));
        if (typeof followers === "number" && followers > 0) c.followers = followers;
      }
    } catch (err) {
      errors.push(`peer follower counts: ${(err as Error).message}`);
    }
  }

  const ranking = rankPeers(
    merged,
    {
      handle: own,
      followers: opts.followers,
      language,
      query: opts.query,
    },
    { max, now },
  );

  const reels: RawReel[] = [];
  const accounts: PeerAccount[] = [];

  for (const c of ranking.peers) {
    try {
      const rows = deps.readAccount
        ? await deps.readAccount(c.handle)
        : await harvestInstagramAccount(c.handle);

      /**
       * Only the peer's *own* Instagram rows. The reels call is not scoped to
       * one account (asked for @nasa it came back with `nasaadmin` and
       * `nasajpl` too), and stamping the peer's count onto a stranger's reel is
       * the exact wrong-yardstick bug this file exists to kill, only wearing
       * the right network's clothes.
       */
      const mine = rows.filter(
        (r) => r.platform === "instagram" && sameHandle(r.account, c.handle),
      );
      if (!mine.length) {
        errors.push(`@${c.handle}: no Instagram posts of its own returned`);
        continue;
      }
      const stamped = mine.map((r) =>
        c.followers ? { ...r, followers: c.followers } : r,
      );
      reels.push(...stamped);
      accounts.push({
        handle: c.handle,
        followers: c.followers,
        reels: stamped.length,
        medianViews: Math.round(median(stamped.map((r) => r.views))),
        via: c.source === "similar" ? "related" : "search",
        source: c.source,
        reasons: c.reasons,
        inBand: c.inBand,
      });
    } catch (err) {
      errors.push(`@${c.handle}: ${(err as Error).message}`);
    }
  }

  const banded = accounts.filter((a) => a.inBand);
  const sizeMatched = Boolean(ranking.band && banded.length >= PEER_MIN_COHORT);
  let basis = basisFor({
    followers: opts.followers,
    band: ranking.band,
    widened: ranking.widened,
    inBand: banded.length,
    minCohort: PEER_MIN_COHORT,
    accounts: accounts.length,
  });
  /**
   * A thin pull is a fact about the evidence, not an error. Say it, so a cohort
   * of three is not read as "everyone in this space".
   */
  if (accounts.length && merged.length < THIN_SEARCH) {
    basis +=
      " — the phrase search came back thin, so this cohort leans on similar accounts and top-reel owners";
  }

  const after = creditLedger();
  return {
    reels,
    accounts,
    basis,
    sizeMatched,
    band: ranking.band,
    cost: {
      results: after.spent - ledgerBefore.spent,
      usd: Number((after.usd - ledgerBefore.usd).toFixed(4)),
    },
    errors,
  };
}
