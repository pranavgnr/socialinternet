import { promises as fs } from "node:fs";
import path from "node:path";

import { dataRoot } from "./dataDir";
import { hoursFromEnv, intFromEnv } from "./env";
import { fetchInstagramProfile, NO_INSTAGRAM_DATA_SOURCE } from "./harvest";
import { ProviderUnavailable } from "./providers/types";

/**
 * Owner follower counts for search results.
 *
 * `/v2/search/reels` names the account on every row but never carries its
 * follower count, so a search alone cannot answer the question the product
 * actually asks: "how big is this account for the views it is getting?" The
 * count is one more profile read per trailing account, which is real money, so
 * this module buys it carefully:
 *
 *   - cached sizes are free and are reused for a week;
 *   - a fresh read costs one call and the per-call cap is a hard ceiling;
 *   - a handle that cannot be read is remembered for a day, so a private or
 *     deleted account does not cost a call on every search;
 *   - a write is atomic, and a missing or corrupt cache file is simply empty;
 *   - concurrent writers are last-write-wins: each writes a complete snapshot,
 *     so the file stays valid and self-heals on the next write.
 *
 * The resolver takes an injected reader, so tests can prove all of that without
 * touching the network or spending anything.
 */

/** One line in the cache file. `followers: null` marks a known-dead handle. */
export interface OwnerProfileEntry {
  followers: number | null;
  fetchedAt: string;
}

/** Everything the cache file holds, keyed by normalised (lowercase) handle. */
type OwnerCache = Record<string, OwnerProfileEntry>;

/** A profile reader. The default goes through the provider router. */
export type OwnerReader = (handle: string) => Promise<{ followers?: number } | null>;

export interface ResolveOwnerOptions {
  /** fresh reads this call may buy; defaults to `OWNER_PROFILE_MAX` (12) */
  max?: number;
  /** injected clock, epoch milliseconds, for tests */
  now?: () => number;
  /** injected reader, for tests */
  read?: OwnerReader;
}

const CACHE_FILE = "_owner_profiles.json";
/** How long a read follower count is trusted. */
const positiveTtlHours = (): number => hoursFromEnv("OWNER_CACHE_HOURS", 168);
/** How long a failed read is remembered before it is worth trying again. */
const NEGATIVE_TTL_HOURS = 24;
/** The per-call fresh-read ceiling, in the same spirit as the other caps. */
export function ownerProfileMax(): number {
  return intFromEnv("OWNER_PROFILE_MAX", 12, 100);
}

/**
 * One handle, one spelling.
 *
 * Vendor rows carry the username as Instagram wrote it, which may keep the
 * casing the creator chose; cached keys, de-duplication and the Map returned to
 * callers all compare on this form. `@` and a pasted profile URL are accepted
 * because a hand-typed handle is not a different account.
 */
export function normaliseOwnerHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
}

export function ownerCachePath(): string {
  return path.join(dataRoot(), CACHE_FILE);
}

function isFresh(entry: OwnerProfileEntry, nowMs: number): boolean {
  const at = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(at)) return false;
  const ageMs = nowMs - at;
  // A clock that moved backwards must not make a fresh entry look ancient.
  if (ageMs < 0) return true;
  const ttlMs =
    entry.followers === null
      ? NEGATIVE_TTL_HOURS * 3_600_000
      : positiveTtlHours() * 3_600_000;
  return ageMs < ttlMs;
}

/**
 * A cache object with no prototype, safe for any handle as a key.
 *
 * A plain `{}` treats `__proto__` as a setter and inherits `constructor` and
 * `toString`, so a real account with one of those names would corrupt the map
 * or silently vanish from it. The cache is data, not an object with behaviour.
 */
function emptyCache(): OwnerCache {
  return Object.create(null) as OwnerCache;
}

/**
 * Read the cache, trusting nothing it cannot prove.
 *
 * A missing file and a corrupt one are the same answer: no sizes yet. A bad
 * single entry is dropped rather than poisoning the file, because the cost of
 * ignoring it is one profile read while the cost of trusting it is a number
 * that was never measured.
 */
async function loadCache(): Promise<OwnerCache> {
  try {
    const parsed = JSON.parse(await fs.readFile(ownerCachePath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyCache();
    /**
     * A null-prototype map, not a plain object: a handle may legitimately be
     * `__proto__` (or `constructor`, `toString`), and assigning it on `{}`
     * would rewrite the prototype or collide with an inherited key instead of
     * storing an entry.
     */
    const out = emptyCache();
    for (const [rawHandle, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
      const handle = normaliseOwnerHandle(rawHandle);
      if (!handle) continue;
      const entry = rawEntry as Partial<OwnerProfileEntry> | null;
      if (!entry || typeof entry !== "object") continue;
      const at = Date.parse(String(entry.fetchedAt ?? ""));
      if (!Number.isFinite(at)) continue;
      const fetchedAt = new Date(at).toISOString();
      const followers = entry.followers;
      if (followers === null) {
        out[handle] = { followers: null, fetchedAt };
      } else if (
        typeof followers === "number" &&
        Number.isFinite(followers) &&
        followers > 0
      ) {
        out[handle] = { followers, fetchedAt };
      }
    }
    return out;
  } catch {
    return emptyCache();
  }
}

/**
 * Write the cache atomically.
 *
 * A reader may be serving the file while this runs, so it is written beside the
 * target and renamed into place: a crash or a concurrent read can see the old
 * file or the new one, never half of either. Expired lines are pruned on the
 * way out so a long-lived deployment does not grow a file of dead handles.
 *
 * A failed write is swallowed: the sizes in memory are still a correct answer
 * for this call, and losing a cache line is cheaper than failing a search that
 * already succeeded.
 */
async function saveCache(cache: OwnerCache, nowMs: number): Promise<void> {
  const target = ownerCachePath();
  /** Null prototype for the same reason as `loadCache`: these are data keys. */
  const kept = emptyCache();
  for (const [handle, entry] of Object.entries(cache)) {
    if (isFresh(entry, nowMs)) kept[handle] = entry;
  }
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(kept, null, 2), "utf8");
    await fs.rename(tmp, target);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/**
 * Is this failure about the vendor rather than about the handle?
 *
 * A spent wallet, a spend ceiling or a missing capability says nothing about
 * whether the account has a follower count, so it must not be written into a
 * 24-hour negative entry: doing that would make one exhausted run hide a dozen
 * real accounts from every search for the rest of the day. A 404, a private
 * account and a 500 after the retry are answers about the handle and are
 * remembered.
 */
function vendorWideFailure(err: unknown): boolean {
  const e = err as
    | { exhausted?: unknown; unsupported?: unknown; name?: unknown; message?: unknown }
    | null;
  return (
    e?.exhausted === true ||
    e?.unsupported === true ||
    e?.name === "NoDataVendor" ||
    e?.message === NO_INSTAGRAM_DATA_SOURCE
  );
}

/**
 * Was this a network problem rather than an answer about the account?
 *
 * A timeout, an abort, a refused connection or a DNS failure says nothing about
 * whether the handle has a follower count, so it must not become a 24-hour
 * negative entry: the next search should try again. These arrive as DOM
 * exceptions or `TypeError: fetch failed` with a cause code, not as a
 * `ProviderUnavailable`, which every adapter uses for an HTTP answer.
 */
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

function transientFailure(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) return true;
  if (err instanceof ProviderUnavailable) return false;
  const e = err as
    | { name?: unknown; code?: unknown; cause?: unknown }
    | null;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return true;
  if (err instanceof TypeError) return true;
  const cause = (e?.cause ?? null) as { code?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : cause?.code;
  return typeof code === "string" && NETWORK_CODES.has(code);
}

async function readProfile(handle: string): Promise<{ followers?: number } | null> {
  return await fetchInstagramProfile(handle);
}

/**
 * Resolve follower counts for the owners of a set of reels.
 *
 * Returns only counts that were actually read (or are still cached): a handle
 * whose profile is private, missing or unreadable is absent from the Map, never
 * present as zero, because "we could not read this account" is not "this account
 * has no followers".
 *
 * Handles are read in the order given, so the caller decides what the cap buys —
 * the niche path passes the biggest reels first. Cached handles do not consume
 * the cap, and one failed read never throws for the rest.
 */
export async function resolveOwnerFollowers(
  handles: string[],
  opts: ResolveOwnerOptions = {},
): Promise<Map<string, number>> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const max = Math.max(0, Math.floor(opts.max ?? ownerProfileMax()));
  const read = opts.read ?? readProfile;

  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const raw of handles) {
    const handle = normaliseOwnerHandle(raw);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    wanted.push(handle);
  }

  const cache = await loadCache();
  const resolved = new Map<string, number>();
  const toRead: string[] = [];
  for (const handle of wanted) {
    const entry = cache[handle];
    if (entry && isFresh(entry, startedAt)) {
      if (typeof entry.followers === "number") resolved.set(handle, entry.followers);
      continue;
    }
    toRead.push(handle);
  }

  let changed = false;
  let reads = 0;
  for (const handle of toRead) {
    if (reads >= max) break;
    reads += 1;
    const fetchedAt = new Date(now()).toISOString();
    try {
      const profile = await read(handle);
      const followers = profile?.followers;
      if (
        typeof followers === "number" &&
        Number.isFinite(followers) &&
        followers > 0
      ) {
        resolved.set(handle, followers);
        cache[handle] = { followers, fetchedAt };
      } else {
        // Read, but no size: a negative entry saves the same call tomorrow.
        cache[handle] = { followers: null, fetchedAt };
      }
      changed = true;
    } catch (err) {
      if (vendorWideFailure(err)) break;
      if (transientFailure(err)) continue;
      cache[handle] = { followers: null, fetchedAt };
      changed = true;
    }
  }

  if (changed) await saveCache(cache, startedAt);
  return resolved;
}

/**
 * Views per follower for one reel.
 *
 * `null` when the account size is unknown or zero: a multiple against nothing is
 * not a small number, it is no number, and printing one would invent a
 * benchmark for an account that was never read.
 */
export function multiple(views: number, followers: number | undefined): number | null {
  if (!Number.isFinite(views)) return null;
  if (typeof followers !== "number" || !Number.isFinite(followers) || followers <= 0) {
    return null;
  }
  return views / followers;
}
