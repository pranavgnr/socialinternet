/**
 * Disk-only enrichment for the profile page.
 *
 * A saved plan is the source of truth, but plans written before Task 4 kept
 * only the audit's best and worst posts — no per-reel likes or comments, no
 * competitor list. The data those files need is already on disk, paid for by the
 * same run:
 *
 *   - `data/handles/<handle>.json` holds the account's recent reels;
 *   - `data/_post_cache.json` holds the comments read under those reels.
 *
 * Reading either here costs nothing and touches no vendor. Nothing is invented:
 * a field that is not on disk stays absent, and the page says so.
 */
import { readFileSync } from "node:fs";

import { cachedCommentsByUrl, mineComments, normaliseUrl } from "./comments";
import { dataPath } from "./dataDir";
import { normalizeHandle } from "./handle";
import { plain } from "./plain";
import type { GrowthPlan, RawReel } from "./types";

interface HandleCache {
  handle?: string;
  reels?: RawReel[];
}

function readHandleReels(handle: string): RawReel[] {
  const clean = normalizeHandle(handle);
  if (!clean) return [];
  try {
    const raw = readFileSync(dataPath("handles", `${clean}.json`), "utf8");
    const cache = JSON.parse(raw) as HandleCache;
    return Array.isArray(cache.reels)
      ? cache.reels.filter((reel) => reel && typeof reel.url === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Keep only the plan's Instagram competitor evidence.
 *
 * A competitor without a platform is legacy data we cannot prove was measured
 * on Instagram, so it is dropped rather than defaulted. The page then shows its
 * empty state, which is the honest outcome.
 */
function instagramCompetitors(plan: GrowthPlan) {
  return (plan.competitors ?? [])
    .filter((idea) => idea.platform === "instagram")
    .slice(0, 3)
    .map((idea) => ({
      ...idea,
      reasons: idea.reasons.map((reason) => plain(reason)),
    }));
}

/**
 * Fill a plan's profile fields from the caches the run already wrote.
 *
 * Pure with respect to the network and the clock: it only reads disk. A missing
 * cache returns the plan unchanged so the page can show its empty state.
 */
export function enrichProfilePlan(plan: GrowthPlan): GrowthPlan {
  const reels =
    plan.reels?.length && plan.reels.some((reel) => reel?.url)
      ? plan.reels
      : readHandleReels(plan.handle);

  const withReels: GrowthPlan = reels.length ? { ...plan, reels } : plan;

  let comments = withReels.comments;
  if (!comments || !(comments.read > 0)) {
    const cached = cachedCommentsByUrl();
    const mined = mineComments(
      reels.map((reel) => ({
        url: reel.url,
        comments: reel.topComments?.length
          ? reel.topComments
          : cached.get(normaliseUrl(reel.url)),
      })),
    );
    if (mined.read > 0) comments = mined;
  }

  const competitors = instagramCompetitors(withReels);

  return {
    ...withReels,
    comments: comments?.read ? comments : undefined,
    competitors: competitors.length ? competitors : undefined,
  };
}
