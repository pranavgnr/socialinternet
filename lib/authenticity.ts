/**
 * The bot-to-real estimate, and the follower sample that feeds it.
 *
 * A percentage of "real followers" is a claim about people, so this module is
 * deliberately conservative:
 *
 *   - nothing is claimed below 40 sampled followers (an estimate from twelve
 *     rows is noise wearing a percentage sign);
 *   - every heuristic has a documented weight, and the rows are averaged, so
 *     the same sample always produces the same number;
 *   - private accounts are not evidence of anything and are never penalised;
 *   - a field the payload did not carry never counts against anyone.
 *
 * The sample is a paid HikerAPI call, so it runs at most `AUTH_SAMPLE_PAGES`
 * requests (default 4) and a successful estimate is cached for seven days in
 * `<dataRoot()>/authenticity.json`. A failed sample, an unreadable account or a
 * sample too small to estimate all return `null`; none of them throws, because
 * the estimate is an extra on a page that must still render.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { dataRoot } from "./dataDir";
import { hoursFromEnv, intFromEnv } from "./env";
import { normalizeHandle } from "./handle";
import { request } from "./providers";

/** A row as `/v1/user/followers/chunk` actually returns it. */
export interface FollowerSampleRow {
  username: string;
  full_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  profile_pic_url?: string;
  /**
   * Accepted for callers that only know whether a picture exists, but never
   * scored: the recorded payload always carries `profile_pic_url`, and treating
   * a missing field as "no picture" would punish the absence of data.
   */
  has_profile_pic?: boolean;
}

export interface AuthenticityEstimate {
  /** 0..100, rounded */
  realPct: number;
  /** how many followers were actually inspected */
  sample: number;
  confidence: "low" | "medium" | "high";
}

/** Below this many rows the answer is "not enough evidence", never a number. */
export const MIN_SAMPLE = 40;

/**
 * Documented weights. A row is suspicious in proportion to what it matched,
 * capped at 1 so one account cannot outweigh another; `realPct` is the mean of
 * `1 - suspicion` across the sample.
 *
 *   - numeric-heavy username (6+ trailing digits, or more than half the
 *     username is digits): 1.0. This is the single strongest signal in the
 *     recorded sample — `user123456` is not a person's chosen handle.
 *   - empty display name: 0.5. A real account usually fills it in; many do not,
 *     so it is a soft signal.
 *   - the shared placeholder avatar: 0.5. Six unrelated accounts in the
 *     recorded fixture were served the same image id, which is what Instagram
 *     hands out when no photo is set.
 *
 * `is_private` is deliberately absent: private accounts are not bots.
 */
export const WEIGHTS = {
  numericUsername: 1,
  emptyName: 0.5,
  defaultAvatar: 0.5,
} as const;

/**
 * The image id Instagram served to six unrelated accounts in the recorded
 * `followers_chunk` fixture. It is the placeholder, not a person's photo.
 */
export const DEFAULT_AVATAR_MARKER =
  "573323465_1219825463302212_7278921664109726296";

/** Six or more digits at the end, or a username that is mostly digits. */
export function isNumericHeavy(username: string): boolean {
  const value = username.trim();
  if (!value) return false;
  if (/\d{6,}$/.test(value)) return true;
  const digits = (value.match(/\d/g) ?? []).length;
  return digits / value.length > 0.5;
}

/** The placeholder avatar, recognised from the recorded image id. */
export function isDefaultAvatar(profilePicUrl: string | undefined): boolean {
  if (!profilePicUrl) return false;
  return profilePicUrl.includes(DEFAULT_AVATAR_MARKER);
}

function suspicion(row: FollowerSampleRow): number {
  let score = 0;
  if (isNumericHeavy(row.username)) score += WEIGHTS.numericUsername;
  if (!row.full_name || !row.full_name.trim()) score += WEIGHTS.emptyName;
  if (isDefaultAvatar(row.profile_pic_url)) score += WEIGHTS.defaultAvatar;
  return Math.min(1, score);
}

function confidenceFor(sample: number): AuthenticityEstimate["confidence"] {
  if (sample < 80) return "low";
  if (sample < 200) return "medium";
  return "high";
}

/**
 * Estimate the share of a follower sample that looks like real people.
 *
 * Returns `null` below 40 rows, and clamps/rounds the percentage so no caller
 * can print 100.4% or a negative share. The sample size is the number of rows
 * given, not the account's follower count.
 */
export function estimateAuthenticity(
  sample: FollowerSampleRow[],
): AuthenticityEstimate | null {
  const rows = Array.isArray(sample)
    ? sample.filter((row) => row && typeof row.username === "string")
    : [];
  if (rows.length < MIN_SAMPLE) return null;

  const total = rows.reduce((sum, row) => sum + suspicion(row), 0);
  const real = 100 * (1 - total / rows.length);
  const realPct = Math.min(100, Math.max(0, Math.round(real)));

  return { realPct, sample: rows.length, confidence: confidenceFor(rows.length) };
}

/* ------------------------------------------------------------------- caps */

/** How many follower pages a profile read may buy; 4 by default. */
export function authSamplePages(): number {
  return intFromEnv("AUTH_SAMPLE_PAGES", 4, 20);
}

/** How long an estimate is trusted; seven days. */
function cacheHours(): number {
  return hoursFromEnv("AUTH_CACHE_HOURS", 168);
}

export function authenticityCachePath(): string {
  return path.join(dataRoot(), "authenticity.json");
}

/* ------------------------------------------------------------------ cache */

interface CacheEntry {
  savedAt: string;
  estimate: AuthenticityEstimate;
}

type AuthenticityCache = Record<string, CacheEntry>;

/** Data keys, not object members: a handle may be `__proto__`. */
function emptyCache(): AuthenticityCache {
  return Object.create(null) as AuthenticityCache;
}

function isEstimate(value: unknown): value is AuthenticityEstimate {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<AuthenticityEstimate>;
  return (
    typeof e.realPct === "number" &&
    Number.isFinite(e.realPct) &&
    e.realPct >= 0 &&
    e.realPct <= 100 &&
    typeof e.sample === "number" &&
    Number.isFinite(e.sample) &&
    e.sample > 0 &&
    (e.confidence === "low" ||
      e.confidence === "medium" ||
      e.confidence === "high")
  );
}

function keyFor(handle: string): string | null {
  return normalizeHandle(handle);
}

function isFresh(entry: CacheEntry, nowMs: number): boolean {
  const at = Date.parse(entry.savedAt);
  if (!Number.isFinite(at)) return false;
  const age = nowMs - at;
  // A clock that moved backwards must not make a fresh entry look ancient.
  if (age < 0) return true;
  return age < cacheHours() * 3_600_000;
}

async function loadCache(): Promise<AuthenticityCache> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(authenticityCachePath(), "utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyCache();
    }
    const out = emptyCache();
    for (const [rawHandle, rawEntry] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const handle = keyFor(rawHandle);
      if (!handle) continue;
      const entry = rawEntry as Partial<CacheEntry> | null;
      if (!entry || typeof entry !== "object") continue;
      const at = Date.parse(String(entry.savedAt ?? ""));
      if (!Number.isFinite(at)) continue;
      if (!isEstimate(entry.estimate)) continue;
      out[handle] = {
        savedAt: new Date(at).toISOString(),
        estimate: entry.estimate,
      };
    }
    return out;
  } catch {
    return emptyCache();
  }
}

/**
 * One estimate for one handle, atomic and last-write-wins.
 *
 * Expired lines are pruned on the way out. A failed write is swallowed: the
 * caller still has a correct estimate for this page, and losing a cache line is
 * cheaper than failing a read that already succeeded.
 */
export async function saveAuthenticity(
  handle: string,
  estimate: AuthenticityEstimate,
  now = Date.now(),
): Promise<void> {
  const key = keyFor(handle);
  if (!key) return;
  if (!isEstimate(estimate)) return;

  const cache = await loadCache();
  cache[key] = { savedAt: new Date(now).toISOString(), estimate };

  const kept = emptyCache();
  for (const [h, entry] of Object.entries(cache)) {
    if (isFresh(entry, now)) kept[h] = entry;
  }

  const target = authenticityCachePath();
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(kept, null, 2), "utf8");
    await fs.rename(tmp, target);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** The stored estimate for a handle, or `null` when absent, stale or corrupt. */
export async function readAuthenticity(
  handle: string,
  now = Date.now(),
): Promise<AuthenticityEstimate | null> {
  const key = keyFor(handle);
  if (!key) return null;
  const cache = await loadCache();
  const entry = cache[key];
  if (!entry || !isFresh(entry, now)) return null;
  return entry.estimate;
}

/* -------------------------------------------------------------- resolution */

export interface AuthenticityAccountFacts {
  followers?: number;
  isPrivate?: boolean;
  /** the Instagram pk, when the profile read already returned it */
  pk?: string | null;
}

export interface AuthenticityOptions {
  /** How many calls the sample may buy; defaults to `AUTH_SAMPLE_PAGES`. */
  pages?: number;
  /** Injected clock, epoch milliseconds, for tests. */
  now?: () => number;
  /** Injected cache reader, for tests. */
  read?: (handle: string, now?: number) => Promise<AuthenticityEstimate | null>;
  /** Injected cache writer, for tests. */
  save?: (
    handle: string,
    estimate: AuthenticityEstimate,
    now?: number,
  ) => Promise<void>;
  /** Injected follower sampler, for tests. */
  sample?: (userId: string, pages: number) => Promise<FollowerSampleRow[]>;
  /** Injected account reader (pk + privacy), for tests. */
  account?: (handle: string) => Promise<AuthenticityAccountFacts>;
}

const MIN_FOLLOWERS = 1000;

function idOf(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return undefined;
}

/**
 * The account facts the estimate needs, bought through the router so the call
 * is inside the run's measured vendor spend.
 */
async function readAccount(handle: string): Promise<AuthenticityAccountFacts> {
  const result = await request({
    path: "/instagram/profile",
    handle,
    platform: "instagram",
  });
  const user =
    (result.data as { user?: Record<string, unknown> }).user ?? {};
  return {
    pk: idOf(user.pk) ?? idOf(user.id),
    isPrivate: user.is_private === true,
    followers:
      typeof user.follower_count === "number" ? user.follower_count : undefined,
  };
}

/** The default sample: the router's HikerAPI capability. */
async function sampleFollowers(
  userId: string,
  pages: number,
): Promise<FollowerSampleRow[]> {
  const result = await request({
    path: "/instagram/followers/sample",
    userId,
    pages: String(pages),
    platform: "instagram",
  });
  const rows = (result.data as { followers?: unknown }).followers;
  return Array.isArray(rows) ? (rows as FollowerSampleRow[]) : [];
}

/**
 * Resolve the estimate for a handle, buying at most one sample.
 *
 * The cache is consulted first and costs nothing. An account that is private or
 * below 1,000 followers is skipped entirely — the page shows its follower count
 * and says the estimate is unavailable rather than sampling a tiny audience.
 * Any failure returns `null`; this function never throws.
 */
export async function resolveAuthenticity(
  handle: string,
  facts: AuthenticityAccountFacts = {},
  opts: AuthenticityOptions = {},
): Promise<AuthenticityEstimate | null> {
  const now = opts.now ?? Date.now;
  const read = opts.read ?? readAuthenticity;
  const save = opts.save ?? saveAuthenticity;
  const sample = opts.sample ?? sampleFollowers;
  const account = opts.account ?? readAccount;
  const pages = Math.max(1, Math.floor(opts.pages ?? authSamplePages()));

  try {
    const cached = await read(handle, now());
    if (cached) return cached;

    if (typeof facts.followers !== "number" || facts.followers < MIN_FOLLOWERS) {
      return null;
    }
    if (facts.isPrivate === true) return null;

    let pk = facts.pk ?? null;
    let isPrivate: boolean | undefined = facts.isPrivate;
    if (!pk || isPrivate === undefined) {
      const looked = await account(handle);
      pk = pk ?? looked.pk ?? null;
      if (isPrivate === undefined) isPrivate = looked.isPrivate;
    }
    if (!pk || isPrivate === true) return null;

    const rows = await sample(pk, pages);
    const estimate = estimateAuthenticity(rows);
    if (!estimate) return null;

    await save(handle, estimate, now());
    return estimate;
  } catch {
    return null;
  }
}
