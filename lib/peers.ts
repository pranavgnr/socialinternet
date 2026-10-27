/**
 * Instagram-native peer discovery.
 *
 * The bug this exists to fix, stated plainly: every number in a plan is a
 * comparison against a cohort, and for an Instagram creator that cohort was
 * built from a **YouTube** keyword search. So @natgeotravel — 44.5M followers on
 * Instagram — was measured against two YouTube channels, one of them a Baltimore
 * news station. The page even said so ("the creators we compared you with are on
 * YouTube"), which is honest and still useless: a labelled wrong answer is a
 * wrong answer.
 *
 * The reason was structural rather than a slip. Keyword search is served by the
 * free YouTube reader, and Apify — the vendor that actually reads Instagram —
 * has no "reels matching this phrase" endpoint at all. But it does have two
 * things that answer the *right* question, "who else is in this space on
 * Instagram":
 *
 *   1. `searchType: "user"` — accounts matching a phrase, each with its real
 *      follower count, verified live on 2026-10-28;
 *   2. `relatedProfiles` — Instagram's own "similar accounts", free inside the
 *      profile call already being made.
 *
 * Hashtag search looks like the third answer and is junk: one row, no owner, no
 * play count, because the hashtag page is ranked by recency for anonymous
 * visitors. It is not used here.
 *
 * What this does NOT do is pretend. If Instagram has no account in the
 * creator's size band, the honest output is a cohort of the right network at the
 * wrong size, labelled as such — never a size-matched cohort from another
 * network.
 */
import {
  fetchInstagramProfile,
  harvestInstagramAccount,
  searchInstagramAccounts,
} from "./harvest";
import { creditLedger } from "./providers";
import type { RawReel } from "./types";

/**
 * How many peers to read in full.
 *
 * Three, because each one is a ~24-result profile pull ($0.055) and three is
 * enough for a convergence pass to tell "one account got lucky" from "the topic
 * travels" — `converge` needs support 2 to say anything at all, and 3 to call a
 * theme validated. The numbers were the other way round (read a dozen), which
 * put a peer cohort at ~$0.60 a plan: a fifth of the free monthly allowance for
 * a comparison that three accounts already answer.
 */
const PEER_MAX = Number(process.env.PEER_MAX ?? 3);

/**
 * How many candidate profiles may be read just to learn a follower count.
 *
 * Related accounts arrive without one, so the band cannot be applied until they
 * are read — one result each ($0.0023). Six is the point where the cost of
 * sorting stops being free: beyond it we are paying more to choose peers than to
 * read them.
 */
const LOOKUP_MAX = Number(process.env.PEER_LOOKUP_MAX ?? 6);

/**
 * The size band, wider than the plan's own (0.35–2.5).
 *
 * This pass is *choosing whom to measure* rather than filtering evidence, and a
 * peer just outside the band is still a far better comparison than a channel on
 * another network. The plan re-applies its stricter band to whatever arrives, so
 * being generous here cannot make a false "accounts your size" claim — it can
 * only add candidates for it to reject.
 */
const BAND_LOW = 0.3;
const BAND_HIGH = 3.5;

/**
 * Below this many accounts, the phrase search is judged to have failed rather
 * than answered, and its individual words are tried too.
 *
 * Five, because a cohort needs three peers and each candidate has to survive
 * being read (private, deleted, or posts of its own that never came back), so
 * fewer than five candidates is a coin toss rather than a pool.
 */
const THIN_SEARCH = 5;

export interface PeerAccount {
  handle: string;
  followers?: number;
  reels: number;
  medianViews: number;
  /** how the account was found */
  via: "related" | "search";
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
  /** true only when at least two peers landed inside the creator's size band */
  sizeMatched: boolean;
  band?: { low: number; high: number };
  cost: { results: number; usd: number };
  errors: string[];
}

const clean = (h: string) => h.replace(/^@/, "").trim().toLowerCase();

/**
 * Are these the same account?
 *
 * Compared on letters, digits and underscore only, because the vendor is not
 * consistent about the `@` and casing between the search, the profile call and
 * the rows themselves — and a formatting difference must not silently look like
 * "this peer posted nothing".
 */
function sameHandle(a: string | undefined, b: string): boolean {
  const norm = (h: string) => h.replace(/^@/, "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  return Boolean(a) && norm(a!) === norm(b);
}

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

interface Candidate {
  handle: string;
  followers?: number;
  via: "related" | "search";
}

/**
 * Collect candidate accounts from both sources, own account excluded.
 *
 * Order matters: phrase-search results arrive *with* follower counts, so they
 * can be banded for free, while related accounts cost one lookup each. Search
 * candidates are therefore kept ahead of related ones when choosing who to read.
 */
function gatherCandidates(opts: {
  own: string;
  query: string;
  related: string[];
  searched: { handle: string; followers?: number; private?: boolean }[];
}): Candidate[] {
  const out = new Map<string, Candidate>();

  for (const r of opts.searched) {
    const handle = clean(r.handle);
    if (!handle || handle === opts.own || r.private) continue;
    out.set(handle, { handle, followers: r.followers, via: "search" });
  }
  for (const raw of opts.related) {
    const handle = clean(raw);
    if (!handle || handle === opts.own || out.has(handle)) continue;
    out.set(handle, { handle, via: "related" });
  }
  return [...out.values()];
}

/**
 * Build an Instagram comparison cohort for one creator.
 *
 * Cost, measured rather than estimated: one account search (~14 results,
 * $0.032), up to six profile lookups ($0.014), and three profile pulls of ~24
 * results ($0.166) — about **$0.21 and 90 results**, i.e. roughly a twentieth of
 * the free monthly allowance per plan.
 */
export async function instagramPeers(opts: {
  handle: string;
  followers?: number;
  /** similar accounts the profile call already returned */
  related?: string[];
  /** the phrase to search accounts by */
  query: string;
  max?: number;
}): Promise<PeerPull> {
  const own = clean(opts.handle);
  const max = Math.max(1, Math.min(opts.max ?? PEER_MAX, 6));
  const errors: string[] = [];
  const ledgerBefore = creditLedger();

  /**
   * The phrase is tried first, then its individual words if that came back thin.
   *
   * Measured live on 2026-10-28: `"travel destinations"` returned **three**
   * accounts totalling 8k and 4k followers — hashtag-shaped names, nothing a
   * 44M account could be compared to — while `"travel"` returned fourteen real
   * ones (`condenasttraveller` 2,436,482 · `travelandleisure` 6,496,386). The
   * account search matches username and bio, so a two-word phrase is an AND
   * filter that very few handles satisfy; the words separately are the honest
   * query. Cost of the retry is one more search (~$0.032) and only on thin
   * results, which is cheaper than a cohort built from three accounts nobody
   * has heard of.
   */
  const searched: { handle: string; followers?: number; private?: boolean }[] = [];
  const seenHandles = new Set<string>();
  const merge = (rows: { handle: string; followers?: number; private?: boolean }[]) => {
    for (const r of rows) {
      const h = clean(r.handle);
      if (!h || seenHandles.has(h)) continue;
      seenHandles.add(h);
      searched.push(r);
    }
  };

  try {
    merge(await searchInstagramAccounts(opts.query));
  } catch (err) {
    /**
     * A failed account search is not a failed plan. Related accounts may still
     * carry the cohort, and the caller can always fall back to the room it
     * already has — so this is reported and survived, never thrown.
     */
    errors.push(`Instagram account search "${opts.query}": ${(err as Error).message}`);
  }

  if (searched.length < THIN_SEARCH) {
    const words = opts.query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && w !== opts.query.toLowerCase())
      .slice(0, 2);
    for (const w of words) {
      try {
        merge(await searchInstagramAccounts(w));
      } catch (err) {
        errors.push(`Instagram account search "${w}": ${(err as Error).message}`);
      }
    }
  }

  const candidates = gatherCandidates({
    own,
    query: opts.query,
    related: opts.related ?? [],
    searched,
  });

  if (!candidates.length) {
    return {
      reels: [],
      accounts: [],
      basis: "no Instagram accounts came back for this space",
      sizeMatched: false,
      cost: {
        results: creditLedger().spent - ledgerBefore.spent,
        usd: Number((creditLedger().usd - ledgerBefore.usd).toFixed(4)),
      },
      errors,
    };
  }

  const band = opts.followers
    ? { low: Math.round(opts.followers * BAND_LOW), high: Math.round(opts.followers * BAND_HIGH) }
    : undefined;

  /** Candidates that already carry a size, banded for free. */
  const sized = candidates.filter((c) => c.followers);
  const inBand = band
    ? sized
        .filter((c) => c.followers! >= band.low && c.followers! <= band.high)
        .sort(
          (a, b) =>
            Math.abs(a.followers! - opts.followers!) - Math.abs(b.followers! - opts.followers!),
        )
    : sized.sort((a, b) => b.followers! - a.followers!);

  /**
   * Related accounts have no size yet, so the cheapest ones are looked up —
   * capped, because each lookup is a paid result and the band is the only thing
   * it buys.
   */
  const unsized = candidates.filter((c) => !c.followers).slice(0, LOOKUP_MAX);
  const lookedUp: Candidate[] = [];
  for (const c of unsized) {
    try {
      const profile = await fetchInstagramProfile(c.handle);
      if (!profile?.followers) continue;
      lookedUp.push({ ...c, followers: profile.followers });
    } catch {
      // a private or vanished account is simply not a peer
    }
  }

  const lookedInBand = band
    ? lookedUp
        .filter((c) => c.followers! >= band.low && c.followers! <= band.high)
        .sort(
          (a, b) =>
            Math.abs(a.followers! - opts.followers!) - Math.abs(b.followers! - opts.followers!),
        )
    : lookedUp.sort((a, b) => b.followers! - a.followers!);

  /**
   * Selection, in order of preference: right network and right size first; then
   * the same space at another size, which is still a fair comparison of *topic*
   * and is labelled as such; then anything at all, so the cohort is never empty
   * when accounts exist.
   */
  const chosen: Candidate[] = [];
  const take = (list: Candidate[]) => {
    for (const c of list) {
      if (chosen.length >= max) return;
      if (chosen.some((x) => x.handle === c.handle)) continue;
      chosen.push(c);
    }
  };
  take([...inBand, ...lookedInBand]);
  if (chosen.length < Math.min(2, max)) take(sized);
  if (chosen.length < Math.min(2, max)) take(lookedUp);
  if (!chosen.length) take(candidates.slice(0, max));

  const reels: RawReel[] = [];
  const accounts: PeerAccount[] = [];

  for (const c of chosen) {
    try {
      const rows = await harvestInstagramAccount(c.handle);
      /**
       * Only Instagram rows count here.
       *
       * The router is allowed to fail over to a free vendor, and a YouTube row
       * carrying this handle's name is a different creator — the exact bug that
       * produced "435 followers" for a 268M account. Anything not stamped
       * Instagram is dropped rather than relabelled.
       */
      /**
       * Only the peer's *own* rows, and only those get their follower count.
       *
       * The reels call is not scoped to one account: asked for @nasa it came
       * back with posts by `nasaadmin`, `nasdaq`, `nasajpl` and `nasajohnson`
       * too, and asked for @natgeohistory it returned `natgeotv` and
       * `natgeotravel`. Stamping every row with the peer's count therefore
       * printed @nasa's 104,370,500 followers onto @nasajohnson (really
       * 1,578,321) — and the creator's own handle, which is the exact class of
       * wrong yardstick this whole file exists to kill, only wearing the right
       * network's clothes. Rows belonging to other accounts are dropped: they
       * are not this peer's baseline, and their number is not ours to assert.
       */
      const mine = rows.filter(
        (r) => r.platform === "instagram" && sameHandle(r.account, c.handle),
      );
      if (!mine.length) {
        errors.push(`@${c.handle}: no Instagram posts of its own returned`);
        continue;
      }
      /**
       * The follower count is stamped onto every row, because the plan's size
       * matching reads it off reels: Apify's profile pull returns an empty
       * `owner` object, so without this the peers arrive sizeless and the band
       * silently never engages — the bug that made size-matching a no-op.
       */
      const stamped = mine.map((r) => (c.followers ? { ...r, followers: c.followers } : r));
      reels.push(...stamped);
      accounts.push({
        handle: c.handle,
        followers: c.followers,
        reels: stamped.length,
        medianViews: Math.round(median(stamped.map((r) => r.views))),
        via: c.via,
        inBand: Boolean(band && c.followers && c.followers >= band.low && c.followers <= band.high),
      });
    } catch (err) {
      errors.push(`@${c.handle}: ${(err as Error).message}`);
    }
  }

  const banded = accounts.filter((a) => a.inBand);
  const sizeMatched = banded.length >= 2;

  const after = creditLedger();
  return {
    reels,
    accounts,
    basis: sizeMatched
      ? `Instagram accounts about your size (${compact(opts.followers)} followers)`
      : band
        ? `Instagram accounts in your space, but none near your size (${compact(
            opts.followers,
          )} followers) — this is a comparison of what travels in your niche, not of what is normal for an account like yours`
        : "Instagram accounts in your space — your size is unknown, so this is not size-matched",
    sizeMatched,
    band,
    cost: {
      results: after.spent - ledgerBefore.spent,
      usd: Number((after.usd - ledgerBefore.usd).toFixed(4)),
    },
    errors,
  };
}
