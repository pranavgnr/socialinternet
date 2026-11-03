/**
 * The stored profile view.
 *
 * A profile view is a stored, vendor-free artifact: once a read has been paid
 * for and turned into a `ProfileView`, it is written here and served on the next
 * visit for zero credits and zero vendor calls. This is what makes "cached
 * accounts open free" true — the GET render never talks to a vendor; it reads
 * this file or shows the "read this account" panel.
 *
 * Every write is atomic (temp file + rename) and every path is a validated
 * handle, so a hostile handle can never escape the profiles directory. A corrupt
 * or expired file reads as absent, never as a crash.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { dataPath } from "./dataDir";
import { hoursFromEnv } from "./env";
import { normalizeHandle } from "./handle";
import type { ProfileView } from "./profileView";

/** How long a stored profile view is served before it is considered stale. */
const ttlHours = (): number => hoursFromEnv("PROFILE_CACHE_HOURS", 168);

/** Where stored profile views live. Resolved per call, like every other cache. */
export function profileDir(): string {
  return dataPath("profiles");
}

interface StoredProfile {
  handle: string;
  savedAt: string;
  view: ProfileView;
}

/**
 * A view is only served when it has the shape the page reads.
 *
 * This is deliberately shallow: it checks the fields that would crash a render
 * (the section arrays and the objects behind them), not every string. A file
 * written by an older or newer build with a wholly different shape reads as
 * absent, which is the same outcome as a corrupt file.
 */
function isProfileView(value: unknown): value is ProfileView {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<ProfileView>;
  const isReel = (reel: unknown): boolean => {
    if (!reel || typeof reel !== "object") return false;
    const card = reel as Record<string, unknown>;
    return (
      typeof card.url === "string" &&
      typeof card.views === "number" &&
      Array.isArray(card.why)
    );
  };
  const isIdea = (idea: unknown): boolean => {
    if (!idea || typeof idea !== "object") return false;
    const card = idea as Record<string, unknown>;
    return (
      typeof card.fromHandle === "string" &&
      typeof card.scriptHref === "string" &&
      Array.isArray(card.whyChosen)
    );
  };
  const commentIntel = view.commentIntel;
  return (
    typeof view.handle === "string" &&
    typeof view.niche === "string" &&
    typeof view.nicheVerified === "boolean" &&
    typeof view.own === "boolean" &&
    Boolean(view.vitals && typeof view.vitals === "object") &&
    Boolean(
      view.dna &&
        typeof view.dna === "object" &&
        typeof view.dna.summary === "string" &&
        Array.isArray(view.dna.audienceSignals),
    ) &&
    Array.isArray(view.winners) &&
    view.winners.every(isReel) &&
    Array.isArray(view.flops) &&
    view.flops.every(isReel) &&
    Array.isArray(view.ideas) &&
    view.ideas.every(isIdea) &&
    (commentIntel === null ||
      (Boolean(commentIntel) &&
        typeof commentIntel === "object" &&
        Array.isArray(commentIntel.mood) &&
        Array.isArray(commentIntel.requests)))
  );
}

/**
 * Persist one profile view under a validated handle. A handle that does not
 * normalise to a legal Instagram handle is refused before any file is touched.
 */
export async function saveProfileView(
  handle: string,
  view: ProfileView,
): Promise<void> {
  const clean = normalizeHandle(handle);
  if (!clean) throw new Error("handle is required");

  const dir = profileDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${clean}.json`);
  const payload: StoredProfile = {
    handle: clean,
    savedAt: new Date().toISOString(),
    view,
  };
  /**
   * A unique temp name: two requests reading the same handle at once must never
   * write through the same temp path and leave a half-file behind.
   */
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export interface StoredProfileRead {
  view: ProfileView;
  /** age in hours at read time */
  ageHours: number;
}

/**
 * Read the stored view for a handle, if one exists and is still inside the TTL.
 *
 * Returns `null` for a missing, expired or corrupt file — the caller then shows
 * the "read this account" panel instead of a broken page. A handle that fails
 * validation returns `null` immediately (it can never name a real file).
 */
export async function readProfileView(
  handle: string,
  now = Date.now(),
): Promise<StoredProfileRead | null> {
  const clean = normalizeHandle(handle);
  if (!clean) return null;

  let stored: unknown;
  try {
    const raw = await fs.readFile(
      path.join(profileDir(), `${clean}.json`),
      "utf8",
    );
    stored = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!stored || typeof stored !== "object") return null;
  const record = stored as Partial<StoredProfile>;
  if (record.handle !== clean) return null;
  if (!isProfileView(record.view)) return null;
  if (normalizeHandle(record.view.handle) !== clean) return null;

  const savedAt = Date.parse(String(record.savedAt ?? ""));
  if (!Number.isFinite(savedAt)) return null;
  const ageHours = (now - savedAt) / 36e5;
  if (ageHours < 0 || ageHours >= ttlHours()) return null;

  return { view: record.view, ageHours };
}
