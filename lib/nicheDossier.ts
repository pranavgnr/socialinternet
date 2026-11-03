/**
 * The Niche Intelligence Dossier: the pure core behind `/search/niche/[query]`.
 *
 * The page it feeds answers one question — *who is breaking out here, and by how
 * much?* — using only what was actually read. A reel's multiple is its views
 * divided by its owner's follower count; an account with no read size has no
 * multiple at all, not a zero. Nothing here talks to a vendor, a database or the
 * network, so the tests can pin the ranking and Koko's briefing to fixtures.
 *
 * The briefing is assembled from the numbers that also appear on the page: the
 * room's usual views, the number of reels and accounts, how many accounts broke
 * out, how many listed reels come from small accounts, and the room's language.
 * It deliberately makes no claim about how Instagram distributes posts, because
 * this data cannot support one.
 */
import { compact as compactViews, times } from "./fmt";
import type { NicheReelRow, NicheView } from "./niche";
import { multiple } from "./ownerProfiles";
import { plain } from "./plain";

export const OUTLIER_LIMIT = 12;
export const SMALL_ACCOUNT_FOLLOWERS = 100_000;

/** What a cached room with nothing usable in it says. No number, no advice. */
export const EMPTY_DOSSIER_LINE = "No reels read for this niche yet.";

/* -------------------------------------------------------------- query input */

export const NICHE_QUERY_MIN = 2;
export const NICHE_QUERY_MAX = 120;

/** A phrase means words or numbers, not just punctuation or emoji. */
const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Decode one route segment without ever throwing.
 *
 * Next normally hands the param over already decoded, but a hand-typed URL can
 * contain a lone `%` or a truncated escape. In that case the raw text is the
 * safest answer; a 500 is not. Whitespace is collapsed because two visually
 * identical phrases must resolve to the same cache file.
 */
export function decodeNicheParam(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return decoded.replace(/\s+/g, " ").trim();
}

export type NicheQueryParse =
  | { ok: true; query: string }
  | { ok: false; reason: "empty" | "short" | "long" | "punctuation" };

/** The one place the route's 2-to-120-character rule lives. */
export function parseNicheQuery(
  raw: string | null | undefined,
): NicheQueryParse {
  const query = decodeNicheParam(raw);
  if (!query) return { ok: false, reason: "empty" };

  const length = [...query].length;
  if (length < NICHE_QUERY_MIN) return { ok: false, reason: "short" };
  if (length > NICHE_QUERY_MAX) return { ok: false, reason: "long" };
  if (!HAS_WORD.test(query)) return { ok: false, reason: "punctuation" };

  return { ok: true, query };
}

/**
 * How old a cached room is, said the way a person says it. Mirrors the age line
 * the old explore page showed, so a stale-but-paid-for room reads the same on
 * both surfaces. A malformed timestamp reads as "just now", never "NaN".
 */
export function ageLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/* ------------------------------------------------------------ access states */

export type NicheAccess = "show" | "sign-in" | "read-panel";

/**
 * What the page may render, before any work happens.
 *
 * A room already on disk is free to anyone — signed in or not. Only a phrase
 * that is not on disk needs an account: anonymous visitors get the sign-in
 * prompt, signed-in visitors get the paid read panel. Nothing here spends.
 */
export function nicheAccess({
  cached,
  signedIn,
}: {
  cached: boolean;
  signedIn: boolean;
}): NicheAccess {
  if (cached) return "show";
  return signedIn ? "read-panel" : "sign-in";
}

/* --------------------------------------------------------------- reel links */

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);

/**
 * A stored reel URL, or nothing.
 *
 * The payload carries whatever the vendor returned; the page only ever links to
 * an Instagram host, over https, so a poisoned cache cannot turn "Open reel"
 * into a redirect somewhere else. `URL` handles userinfo and port tricks.
 */
export function safeReelUrl(raw: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;

  url.protocol = "https:";
  return url.toString();
}

/* ------------------------------------------------------------------ dossier */

export interface DossierOutlier {
  url: string;
  handle: string;
  views: number;
  followers?: number;
  /** views / followers; null when the account's size was not read */
  multiple: number | null;
  caption: string;
}

export interface NicheDossier {
  outliers: DossierOutlier[];
  briefing: string[];
  bar?: { views: number; basis: string };
  counts: { reels: number; accounts: number; breakouts: number };
}

interface CleanRow {
  account: string;
  url: string;
  caption: string;
  views: number;
  followers?: number;
}

interface Ranked {
  row: CleanRow;
  key: string;
  multiple: number | null;
}

const EMPTY: NicheDossier = {
  outliers: [],
  briefing: [],
  counts: { reels: 0, accounts: 0, breakouts: 0 },
};

/** Collapse the caption to one honest line; React does the HTML escaping. */
function excerpt(caption: string): string {
  const flat = (caption ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= 140) return flat;
  const cut = [...flat].slice(0, 139).join("");
  return `${cut}…`;
}

function accountKey(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

function displayHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

/**
 * Every row the dossier may consider: the reel rows when the page asked for
 * them, otherwise the account summary's top reel. The fallback keeps old views
 * renderable, though only the page's call carries the full room.
 */
function sourceRows(view: NicheView): NicheReelRow[] {
  if (view.reelRows?.length) return view.reelRows;
  return view.top.map((account) => ({
    account: account.handle,
    platform: account.platform ?? "instagram",
    url: account.topReel?.url ?? "",
    caption: account.topReel?.caption ?? "",
    views: account.topReel?.views ?? 0,
    ...(typeof account.followers === "number"
      ? { followers: account.followers }
      : {}),
  }));
}

function compareRanked(a: Ranked, b: Ranked): number {
  if (a.multiple === null && b.multiple !== null) return 1;
  if (a.multiple !== null && b.multiple === null) return -1;
  if (a.multiple !== null && b.multiple !== null && a.multiple !== b.multiple) {
    return b.multiple - a.multiple;
  }
  return b.row.views - a.row.views || a.row.url.localeCompare(b.row.url);
}

/**
 * Pick the twelve. One reel per account first, then the account's second reel,
 * and so on — a single prolific account cannot fill the page with its own
 * posts. The selection is re-sorted afterwards so the list still reads strongest
 * multiple first, with accounts of unknown size last.
 */
function pickOutliers(ranked: Ranked[]): Ranked[] {
  const groups = new Map<string, Ranked[]>();
  for (const entry of ranked) {
    const list = groups.get(entry.key) ?? [];
    list.push(entry);
    groups.set(entry.key, list);
  }

  const groupsInRankOrder = [...groups.values()];
  const picked: Ranked[] = [];
  for (let depth = 0; picked.length < OUTLIER_LIMIT; depth += 1) {
    let added = false;
    for (const group of groupsInRankOrder) {
      if (picked.length >= OUTLIER_LIMIT) break;
      const entry = group[depth];
      if (!entry) continue;
      picked.push(entry);
      added = true;
    }
    if (!added) break;
  }

  return picked.sort(compareRanked);
}

function sentence(singular: string, plural: string, count: number): string {
  return count === 1 ? singular : plural;
}

/**
 * Three to five sentences, computed before they are phrased.
 *
 * If there is no bar (a room with no room median) the sentence about accounts
 * breaking out has nothing to compare against and is left out rather than
 * softened into a guess. `plain()` is the last step so an internal word cannot
 * reach the page through a template.
 */
function brief(
  view: NicheView,
  outliers: DossierOutlier[],
  counts: NicheDossier["counts"],
  bar: NicheDossier["bar"],
): string[] {
  const sentences: string[] = [];

  if (bar) {
    sentences.push(
      `The usual reel in this room gets ${compactViews(bar.views)} views across ${counts.reels} ${sentence("reel", "reels", counts.reels)} read.`,
    );
  } else {
    // No median means no bar. Saying so is more honest than softening it into
    // a guess, and it keeps a thin room at the same three-sentence minimum.
    sentences.push(
      "No usual view count was read for this room, so there is no bar to compare against.",
    );
  }

  const listedAccounts = new Set(outliers.map((o) => accountKey(o.handle))).size;
  sentences.push(
    `The ${outliers.length} ${sentence("reel", "reels", outliers.length)} below ${outliers.length === 1 ? "comes" : "come"} from ${listedAccounts} ${sentence("account", "accounts", listedAccounts)}.`,
  );

  if (bar && counts.accounts > 0) {
    sentences.push(
      `${counts.breakouts} of the ${counts.accounts} ${sentence("account", "accounts", counts.accounts)} read ${sentence("has", "have", counts.breakouts)} at least one reel above twice that.`,
    );
  }

  const known = outliers.filter(
    (outlier) => typeof outlier.followers === "number",
  );
  if (known.length > 0) {
    const small = known.filter(
      (outlier) => (outlier.followers ?? 0) < SMALL_ACCOUNT_FOLLOWERS,
    ).length;
    /**
     * The denominator is the list's known sizes, not every listed reel. A reel
     * whose owner was never read could be small or large; counting it either
     * way would turn an unknown into a claim.
     */
    sentences.push(
      `${small} of the ${known.length} ${sentence("reel", "reels", known.length)} listed with a follower count ${small === 1 ? "comes" : "come"} from accounts under 100k followers.`,
    );
  } else if (outliers.length > 0) {
    sentences.push(
      "Follower counts were not read for the reels listed, so account size does not decide this order.",
    );
  }

  /**
   * `nicheView()` fills an undecided room's name with the placeholder "this
   * language", so the basis is the honest test: "none" means nothing was
   * settled, and a sentence naming a language would be an invention.
   */
  if (view.language.basis !== "none" && view.language.name) {
    sentences.push(`The reels kept for this room are in ${view.language.name}.`);
  }

  return sentences.slice(0, 5).map(plain);
}

/**
 * Turn a niche view into the page's ranked outliers, its briefing and its
 * counts. Pure: no clock, no disk, no vendor.
 */
export function buildDossier(view: NicheView): NicheDossier {
  const seen = new Set<string>();
  const rows: CleanRow[] = [];

  for (const raw of sourceRows(view)) {
    // Instagram only, even if an older cache or a future vendor slipped a row
    // through: every number on this page is presented as an Instagram reading.
    if ((raw.platform ?? "instagram") !== "instagram") continue;

    const url = safeReelUrl(raw.url ?? "");
    if (!url || seen.has(url)) continue;

    const handle = displayHandle(raw.account ?? "");
    if (!handle) continue;

    const views =
      typeof raw.views === "number" && Number.isFinite(raw.views) && raw.views > 0
        ? raw.views
        : 0;
    if (!views) continue;

    const followers =
      typeof raw.followers === "number" &&
      Number.isFinite(raw.followers) &&
      raw.followers > 0
        ? raw.followers
        : undefined;

    seen.add(url);
    rows.push({
      account: handle,
      url,
      caption: raw.caption ?? "",
      views,
      ...(followers !== undefined ? { followers } : {}),
    });
  }

  // A fresh counts object: callers must not be able to mutate the constant.
  if (!rows.length) return { ...EMPTY, counts: { ...EMPTY.counts } };

  const ranked: Ranked[] = rows.map((row) => ({
    row,
    key: accountKey(row.account),
    multiple: multiple(row.views, row.followers),
  }));
  ranked.sort(compareRanked);

  const chosen = pickOutliers(ranked);
  const outliers: DossierOutlier[] = chosen.map(({ row, multiple: value }) => ({
    url: row.url,
    handle: row.account,
    views: row.views,
    ...(row.followers !== undefined ? { followers: row.followers } : {}),
    multiple: value,
    caption: excerpt(row.caption),
  }));

  const median = view.nicheMedianViews;
  const bar =
    Number.isFinite(median) && median > 0
      ? { views: median, basis: "the usual reel in this niche" }
      : undefined;

  const breakoutAccounts = new Set<string>();
  if (bar) {
    for (const row of rows) {
      if (row.views > bar.views * 2) breakoutAccounts.add(accountKey(row.account));
    }
  }

  const counts = {
    reels: view.reels > 0 ? view.reels : rows.length,
    accounts:
      view.accountCount > 0
        ? view.accountCount
        : new Set(rows.map((row) => accountKey(row.account))).size,
    breakouts: breakoutAccounts.size,
  };

  return {
    outliers,
    briefing: brief(view, outliers, counts, bar),
    ...(bar ? { bar } : {}),
    counts,
  };
}
