/**
 * Trending niches: the rooms already researched, ranked by the opportunity
 * score the rest of the product already uses.
 *
 * Two reasons this is not a "popular niches" list. First, the cache on disk is
 * work somebody already paid for, so ranking it costs nothing — no vendor call
 * and no credit is spent to answer the landing page. Second, the score is the
 * same one a creator sees in a room: demand, headroom, openness, freshness and
 * what a view is worth there. A bounty of reels is not an opportunity, and a
 * quiet room can be the better place to start.
 *
 * The table is only a cache of that ranking. Everything here can be rebuilt
 * from `data/niches`, which is what keeps the landing page alive when Postgres
 * is not.
 */
import { currentDb, withClient } from "./db";
import {
  cachedNiches,
  researchFromCache,
  researchNiche,
  type CachedNiche,
} from "./niche";
import { nicheLabel } from "./nicheLabel";
import {
  rankNiches,
  scoreNiche,
  signalsFrom,
  type NicheOpportunity,
} from "./opportunity";
import type { RawReel } from "./types";

export interface TrendingNiche {
  slug: string;
  label: string;
  query: string;
  score: number;
  rank: number;
}

/**
 * The floor below which a cached pull cannot honestly be scored.
 *
 * `scoreNiche` turns strict about breakouts once three accounts have their own
 * baseline (`measured.size >= 3` in opportunity.ts): below that it falls back
 * to comparing one-post accounts against the room, which is circular on a
 * search page because the rows were selected for performance. A room with one
 * or two accounts therefore cannot say who gets to win, and its "openness"
 * score is a statement about a monopoly of one or two. Ten reels is the other
 * half of the same judgement: a sample that small is a handful of postings,
 * not a room.
 *
 * Rooms under either floor are skipped, never padded with an invented score.
 * On the current cache this excludes three of the 51 files (a 9-reel room and
 * two rooms built from one and two accounts).
 */
export const MIN_TRENDING_REELS = 10;
export const MIN_TRENDING_ACCOUNTS = 3;

/**
 * Rank cached rooms by their existing opportunity score. Pure: it reads the
 * payload carried on the cache rows and never touches the network or the
 * database.
 *
 * Rows without a payload, or below the floors above, are skipped. Duplicate
 * slugs are collapsed to their first appearance.
 */
export function rankTrending(
  cached: CachedNiche[],
  limit = 30,
): TrendingNiche[] {
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0) return [];

  const seen = new Set<string>();
  const scored: { niche: TrendingNiche; opportunity: NicheOpportunity }[] = [];

  for (const row of cached) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);

    /**
     * A bubble must open the niche dossier, and that page is Instagram-only.
     * Older cache files still hold rooms read from YouTube; advertising one
     * sends a visitor to a page that can only say "no reels read". Drop those
     * rows before the size floors, so the floors describe the Instagram room
     * the page will actually render rather than a mixed pull.
     */
    const payload = (row.payload ?? []).filter(
      // A corrupt cache row can be null; leave it in place for the scorer's
      // own try/catch, but never let it count as an Instagram account.
      (r) => !r || (r.platform ?? "instagram") === "instagram",
    );
    if (payload.length < MIN_TRENDING_REELS) continue;
    const accounts = new Set(
      payload
        .filter((r): r is RawReel => Boolean(r))
        .map((r) => r.account.toLowerCase()),
    ).size;
    if (accounts < MIN_TRENDING_ACCOUNTS) continue;

    try {
      const research = researchFromCache(row.query, payload, {
        fetchedAt: row.fetchedAt,
      });
      const opportunity = scoreNiche(signalsFrom(research));
      scored.push({
        niche: {
          slug: row.slug,
          label: nicheLabel(row.query) || row.query,
          query: row.query,
          score: opportunity.score,
          rank: 0,
        },
        opportunity,
      });
    } catch (err) {
      /**
       * One unreadable cache file must not cost the whole ranking. Skip it and
       * keep the rooms that scored; the next refresh can repair the bad file.
       */
      console.warn(
        `[trending] skipping ${row.slug}: ${(err as Error).message}`,
      );
    }
  }

  if (!scored.length) return [];

  /**
   * Two cache files can name the same room ("kannada songs" and "Kannada
   * Songs"). A bubble is a phrase a visitor reads, so the phrase — not a slug
   * built by a different job — is what must be unique. Keep the highest-scored
   * room; on a tie keep the lexicographically first slug so the result does not
   * depend on the order the cache directory was read in.
   */
  const byLabel = new Map<
    string,
    { niche: TrendingNiche; opportunity: NicheOpportunity }
  >();
  for (const entry of scored) {
    const key = labelKey(entry.niche.label);
    const existing = byLabel.get(key);
    if (
      !existing ||
      entry.opportunity.score > existing.opportunity.score ||
      (entry.opportunity.score === existing.opportunity.score &&
        entry.niche.slug.localeCompare(existing.niche.slug) < 0)
    ) {
      byLabel.set(key, entry);
    }
  }

  // Slug order before the stable score sort, so equal scores get one repeatable
  // order regardless of the order the cache directory happened to be read in.
  const kept = [...byLabel.values()];
  kept.sort((a, b) => a.niche.slug.localeCompare(b.niche.slug));
  const ordered = rankNiches(kept.map((s) => s.opportunity));

  const byOpportunity = new Map(
    kept.map((s) => [s.opportunity, s.niche] as const),
  );
  const out: TrendingNiche[] = [];
  for (const opportunity of ordered) {
    const niche = byOpportunity.get(opportunity);
    if (!niche) continue;
    out.push({ ...niche, rank: out.length + 1 });
    if (out.length >= cap) break;
  }
  return out;
}

/** One spelling of a label for duplicate detection: case and spacing only. */
function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Rank straight from the pulls on disk. Costs nothing and needs no database. */
async function rankFromDisk(limit = 30): Promise<TrendingNiche[]> {
  const cached = await cachedNiches({ withPayload: true });
  return rankTrending(cached, limit);
}

/**
 * How long the disk ranking is reused in-process.
 *
 * The table is the normal path and is already cheap; this cache only matters
 * when the table is empty or Postgres is down, where a request would otherwise
 * read 51 files, rebuild every room and re-score it. Ten minutes is long enough
 * to absorb a burst of landing-page visits and short enough that a fresh cron
 * write becomes visible without a restart.
 */
export const DISK_RANK_TTL_MS = 10 * 60 * 1000;

interface DiskRankCacheEntry {
  at: number;
  niches: TrendingNiche[];
}

let diskRankCache: DiskRankCacheEntry | null = null;
let diskRankInFlight: Promise<TrendingNiche[]> | null = null;
/** Bumped by resetTrendingCache so an older in-flight read cannot repopulate it. */
let diskRankGeneration = 0;

/**
 * Forget the cached disk ranking. Exported for tests and for callers that know
 * the data directory just changed out of band.
 */
export function resetTrendingCache(): void {
  diskRankCache = null;
  diskRankInFlight = null;
  diskRankGeneration += 1;
}

/**
 * One disk ranking shared by every request in this process.
 *
 * The in-flight promise is cached as well as the result, so a burst of ten
 * requests after a restart reads and scores the cache once, not ten times. A
 * failure clears the in-flight slot and is deliberately not cached: the next
 * request may succeed (for example while Postgres is still coming up).
 */
async function rankFromDiskCached(
  read: () => Promise<TrendingNiche[]>,
  now: () => number,
): Promise<TrendingNiche[]> {
  if (diskRankCache && now() - diskRankCache.at < DISK_RANK_TTL_MS) {
    return diskRankCache.niches;
  }
  if (diskRankInFlight) return diskRankInFlight;

  const generation = diskRankGeneration;
  const startedAt = now();
  let pending!: Promise<TrendingNiche[]>;
  pending = read()
    .then((niches) => {
      if (generation === diskRankGeneration) {
        diskRankCache = { at: startedAt, niches };
      }
      return niches;
    })
    .finally(() => {
      if (diskRankInFlight === pending) diskRankInFlight = null;
    });
  diskRankInFlight = pending;
  return pending;
}

/**
 * Replace the `trending_niches` rows from the cache. Zero credits: this reads
 * pulls that are already on disk and never calls a vendor.
 *
 * Reads the disk directly rather than through the TTL cache: a refresh is the
 * operation that exists to pick up changes, so it must not repeat a stale
 * ranking. A successful write clears the cache so the next reader sees the new
 * rows.
 *
 * An empty cache leaves the existing rows alone rather than wiping a useful
 * table because the data directory was momentarily unreadable.
 */
export async function refreshTrending(): Promise<{ written: number }> {
  const ranked = await rankFromDisk();
  if (!ranked.length) return { written: 0 };

  await withClient(async (q) => {
    await q.query("BEGIN");
    try {
      await q.query("DELETE FROM trending_niches");
      for (const niche of ranked) {
        await q.query(
          "INSERT INTO trending_niches (slug, label, query, score, rank, refreshed_at)" +
            " VALUES ($1, $2, $3, $4, $5, now())",
          [niche.slug, niche.label, niche.query, niche.score, niche.rank],
        );
      }
      await q.query("COMMIT");
    } catch (err) {
      await q.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });

  resetTrendingCache();
  return { written: ranked.length };
}

interface TrendingRow {
  slug: string;
  label: string | null;
  query: string | null;
  score: number | null;
  rank: number | null;
}

/**
 * Test seams for the disk fallback. Routes call `listTrending()` with none of
 * these; the defaults are the real cache reader and the wall clock.
 */
export interface ListTrendingOptions {
  rankFromDisk?: () => Promise<TrendingNiche[]>;
  now?: () => number;
}

/**
 * What the landing page shows. Reads the ranked rows; when the table is empty,
 * the database cannot be reached, or no table row is on disk, falls back to
 * ranking the cache on disk.
 *
 * The disk ranking is the authority on what a bubble may open. A table written
 * before the Instagram-only filter could still name a YouTube room, and that
 * bubble would open a dossier with nothing in it. So the table's rows are
 * intersected with the (already cached for DISK_RANK_TTL_MS) disk ranking; a
 * row whose slug is not an Instagram room on disk is never shown. The catch is
 * deliberate and narrow: a database outage must not take the free half of the
 * product down with it. Bubbles are a cache view, so the honest answer is the
 * same rows computed a different way, not an error page.
 */
export async function listTrending(
  opts: ListTrendingOptions = {},
): Promise<TrendingNiche[]> {
  const read = opts.rankFromDisk ?? (() => rankFromDisk());
  const now = opts.now ?? Date.now;

  let tableRows: TrendingRow[] | null = null;
  try {
    const { rows } = await currentDb().query<TrendingRow>(
      "SELECT slug, label, query, score, rank FROM trending_niches" +
        " ORDER BY rank ASC NULLS LAST, slug ASC",
    );
    tableRows = rows;
  } catch (err) {
    console.warn(
      `[trending] could not read trending_niches, ranking from disk: ${
        (err as Error).message
      }`,
    );
  }

  const onDisk = await rankFromDiskCached(read, now);

  if (tableRows) {
    const allowed = new Set(onDisk.map((niche) => niche.slug));
    const niches = tableRows
      .filter((row): row is TrendingRow & { query: string } => Boolean(row.query))
      .map((row, i) => ({
        slug: row.slug,
        label: row.label || nicheLabel(row.query) || row.query,
        query: row.query,
        score: Number.isFinite(Number(row.score)) ? Number(row.score) : 0,
        rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : i + 1,
      }))
      .filter((niche) => allowed.has(niche.slug));

    if (niches.length) return niches;
  }

  return onDisk;
}

/**
 * Kept here for the existing importers (`scripts/test-trending.ts`); the one
 * implementation lives in `lib/cron.ts` alongside the secret gate itself.
 */
export { cronSecretOk } from "./cron";

/**
 * Is this failure the budget running out, rather than one room being broken?
 *
 * A budget stop is the one error worth abandoning the whole batch for: every
 * remaining research call would fail the same way and cost the same nothing,
 * so trying them just makes the cron slower and noisier.
 */
function isBudgetError(message: string): boolean {
  return /not enough credits|credit budget|no data vendor|no credits|budget reached|insufficient (credits|balance)/i.test(
    message,
  );
}

export interface ResearchStalestResult {
  /** slugs the run chose, stalest first */
  considered: string[];
  /** slugs re-researched successfully */
  refreshed: string[];
  failed: { slug: string; error: string }[];
  /** the first budget error, when the run stopped early */
  stopped: string | null;
}

export interface ResearchStalestDeps {
  list?: () => Promise<CachedNiche[]>;
  research?: (opts: { query: string; force?: boolean }) => Promise<unknown>;
}

/**
 * Re-research the stalest cached rooms, up to `limit` (five by default).
 *
 * This is the only paid step in the trending path, and it is opt-in from the
 * cron with `?refresh=1`. `researchNiche` keeps its own readiness and balance
 * guards; this wrapper adds the batch rule: stop at the first budget error
 * instead of asking the same empty account five times. Individual room failures
 * do not stop the next room.
 */
export async function researchStalest(
  limit = 5,
  deps: ResearchStalestDeps = {},
): Promise<ResearchStalestResult> {
  const list = await (deps.list ?? cachedNiches)();
  const research = deps.research ?? researchNiche;

  const stalest = list
    .filter((row) => row.stale)
    .sort((a, b) => b.ageHours - a.ageHours || a.slug.localeCompare(b.slug))
    .slice(0, Math.max(0, Math.floor(limit)));

  const result: ResearchStalestResult = {
    considered: stalest.map((row) => row.slug),
    refreshed: [],
    failed: [],
    stopped: null,
  };

  for (const row of stalest) {
    try {
      await research({ query: row.query, force: true });
      result.refreshed.push(row.slug);
    } catch (err) {
      const error = (err as Error).message;
      result.failed.push({ slug: row.slug, error });
      if (isBudgetError(error)) {
        result.stopped = error;
        break;
      }
    }
  }

  return result;
}
