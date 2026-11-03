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
import type { GrowthPlan, PlanCompetitor, RawReel } from "./types";

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

/** Views written into a peer metric, e.g. "· 2.4M views" -> 2400000. */
function viewsFromMetric(metric: string): number {
  const match = metric.match(/·\s*([\d.]+)\s*([kKmM]?)\s*views/i);
  if (!match) return 0;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = match[2].toLowerCase();
  if (unit === "m") return Math.round(n * 1_000_000);
  if (unit === "k") return Math.round(n * 1_000);
  return Math.round(n);
}

/** The multiple written at the start of a peer metric, e.g. "2.4x ..." -> 2.4. */
function metricMultiple(metric: string): number | null {
  const match = metric.trim().match(/^([\d.]+)x\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * The competitors the plan already cites, wherever the move list still exists.
 *
 * New plans carry them on `competitors`. Older plans keep the same evidence on
 * the moves (and on the next move), which is enough to name the account, their
 * reel, its views and why they were chosen without buying anything again.
 */
function competitorsFrom(plan: GrowthPlan): PlanCompetitor[] {
  const out: PlanCompetitor[] = [];
  const seen = new Set<string>();
  const own = plan.handle.replace(/^@/, "").toLowerCase();

  const add = (idea: PlanCompetitor) => {
    const handle = idea.handle.replace(/^@/, "");
    if (!handle || handle.toLowerCase() === own) return;
    if (!idea.url || seen.has(idea.url)) return;
    const multiple = idea.reasons
      .map((reason) => metricMultiple(reason))
      .find((value): value is number => value !== null);
    if (multiple !== undefined && multiple < 1) return;
    seen.add(idea.url);
    out.push({ ...idea, handle });
  };

  for (const idea of plan.competitors ?? []) add(idea);

  if (!out.length) {
    for (const move of plan.moves ?? []) {
      for (const evidence of move.evidence ?? []) {
        add({
          handle: evidence.handle.replace(/^@/, ""),
          views: viewsFromMetric(evidence.metric),
          url: evidence.url ?? "",
          caption: evidence.caption ?? move.title,
          reasons: [evidence.metric],
        });
      }
    }
  }

  if (!out.length && plan.nextMove) {
    for (const evidence of plan.nextMove.evidence ?? []) {
      add({
        handle: evidence.handle.replace(/^@/, ""),
        views: viewsFromMetric(evidence.metric),
        url: evidence.url ?? "",
        caption: evidence.caption ?? plan.nextMove.title,
        reasons: [evidence.metric],
      });
    }
  }

  return out.slice(0, 3).map((idea) => ({
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

  const competitors = withReels.competitors?.length
    ? withReels.competitors
    : competitorsFrom(withReels);

  return {
    ...withReels,
    comments: comments?.read ? comments : undefined,
    competitors: competitors.length ? competitors : undefined,
  };
}
