import { promises as fs } from "node:fs";
import path from "node:path";

import { compact } from "./fmt";
import { profileFromNiche } from "./niche";
import { runPipeline } from "./pipeline";
import { analyseHandle, ownWinnerCaptions } from "./plan";
import { createStore, type Store } from "./store";
import type { GrowthPlan, Idea, Platform } from "./types";

/**
 * One week's answer, kept so the next week has something to be measured against.
 *
 * The point of this record is not "here is a plan again" — it is what changed
 * since the last one. Without the previous digest every Monday reads exactly
 * like the first Monday, and the creator cannot tell whether the advice worked.
 */
export interface WeeklyDigest {
  /** Monday of the week this belongs to, YYYY-MM-DD. One digest per week. */
  weekOf: string;
  handle: string;
  platform?: Platform;
  generatedAt: string;
  standing: {
    followers?: number;
    medianViews: number;
    bestViews: number;
    /** multiple of the niche's typical reel */
    vsNiche: number;
    /** the yardstick's own typical reel */
    nicheMedianViews: number;
    cohortAccounts: number;
  };
  /** what moved since the last digest, in plain words; empty on a first run */
  changes: string[];
  /** this week's moves, in the order they should be done */
  moves: { title: string; action: string; why: string; receipts: number }[];
  /** this week's ideas, already written, with the hook to open on */
  ideas: { id: string; title: string; hook?: string; format?: string }[];
  /** true when the pull was served from cache, so the numbers may be stale */
  cached: boolean;
  credits: number;
}

/** The Monday of the week `d` falls in, as YYYY-MM-DD (UTC, so it is stable). */
export function mondayOf(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: 0 = Sunday, so Sunday belongs to the week that started 6 days ago
  const back = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

function delta(now: number, before: number): string | null {
  if (!before || !Number.isFinite(before) || !Number.isFinite(now)) return null;
  const change = (now - before) / before;
  const size = Math.abs(change);
  if (size < 0.05) return "flat";
  const word = change > 0 ? "up" : "down";
  return `${word} ${Math.round(size * 100)}%`;
}

/**
 * What actually changed, and nothing else.
 *
 * Every line here is a comparison of two measured numbers. When there is no
 * previous digest the list is empty rather than filled with a template
 * pretending the week was an improvement.
 */
function describeChanges(plan: GrowthPlan, previous?: WeeklyDigest): string[] {
  if (!previous) return [];
  const out: string[] = [];

  const views = delta(plan.standing.medianViews, previous.standing.medianViews);
  if (views === "flat") {
    out.push(`Your typical reel is still ${compact(plan.standing.medianViews)} views — unchanged.`);
  } else if (views) {
    out.push(
      `Your typical reel is ${compact(plan.standing.medianViews)} views, ${views} since last week.`,
    );
  }

  const followers = delta(plan.account?.followers ?? 0, previous.standing.followers ?? 0);
  if (followers && followers !== "flat") {
    out.push(`Followers ${followers}: ${compact(plan.account?.followers ?? 0)}.`);
  }

  /**
   * The yardstick moving is not the creator's doing, and it changes what the
   * advice means: the same reel is suddenly "twice the niche" because the niche
   * got quieter. Reported separately so the two are never confused.
   */
  const cohort = delta(plan.cohort.nicheMedianViews, previous.standing.nicheMedianViews);
  if (cohort && cohort !== "flat") {
    out.push(
      `The accounts you are measured against moved ${cohort} — their typical reel is now ${compact(
        plan.cohort.nicheMedianViews,
      )}.`,
    );
  }

  const before = new Set(previous.moves.map((m) => m.title));
  const fresh = plan.moves.filter((m) => !before.has(m.title));
  if (fresh.length) {
    out.push(
      fresh.length === 1
        ? `One new move this week: ${fresh[0].title}.`
        : `${fresh.length} of this week's moves are new.`,
    );
  } else if (plan.moves.length) {
    out.push("Same moves as last week — they have not been done yet, or they are still working.");
  }

  return out;
}

/** Turn a plan and its idea feed into the week's record. */
export function buildDigest(args: {
  plan: GrowthPlan;
  ideas: Idea[];
  credits: number;
  cached: boolean;
  previous?: WeeklyDigest;
  now?: Date;
}): WeeklyDigest {
  const { plan, ideas, previous } = args;
  return {
    weekOf: mondayOf(args.now),
    handle: plan.handle,
    platform: plan.platform,
    generatedAt: new Date().toISOString(),
    standing: {
      followers: plan.account?.followers ?? plan.standing.followers,
      medianViews: plan.standing.medianViews,
      bestViews: plan.standing.bestViews,
      vsNiche: plan.standing.vsNiche,
      nicheMedianViews: plan.cohort.nicheMedianViews,
      cohortAccounts: plan.cohort.accounts,
    },
    changes: describeChanges(plan, previous),
    moves: [...plan.moves]
      .sort((a, b) => a.priority - b.priority)
      .map((m) => ({
        title: m.title,
        action: m.action,
        why: m.why,
        receipts: m.evidence.length,
      })),
    ideas: ideas
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((i) => ({
        id: i.id,
        title: i.title,
        hook: i.hookVariants?.[0],
        format: i.format,
      })),
    cached: args.cached,
    credits: args.credits,
  };
}

/** Newest first, one per week: a re-run in the same week replaces that week. */
export function upsertDigest(all: WeeklyDigest[], digest: WeeklyDigest): WeeklyDigest[] {
  return [digest, ...all.filter((d) => d.weekOf !== digest.weekOf)].sort((a, b) =>
    a.weekOf < b.weekOf ? 1 : -1,
  );
}

export interface WeeklyRun {
  digest: WeeklyDigest;
  db: Store;
}

/**
 * Re-run one account for this week and record the result.
 *
 * Deliberately does not pass `force`: the harvest cache is the freshness gate
 * (12h by default), so a weekly run buys new data because last week's cache has
 * expired, not because we insisted on paying again.
 */
export async function runWeekly(handle: string, db: Store): Promise<WeeklyRun> {
  const { plan, research, seedReels, archetype, own } = await analyseHandle(handle, {
    deep: true,
  });

  await db.savePlan(plan);

  const previousProfile = await db.getProfile();
  const profile = profileFromNiche(research, previousProfile, archetype);
  profile.ownWinners = ownWinnerCaptions(own.reels);
  profile.songs = plan.songs?.map((s) => s.title) ?? previousProfile?.songs;
  if (plan.formats?.length) profile.formats = plan.formats.map((f) => f.label);
  else if (archetype.songLed) profile.formats = undefined;
  await db.saveProfile(profile);

  // Ideas are rebuilt from reels already paid for by the analysis above.
  await runPipeline({ profile, seedReels, db, ownHandle: handle });
  const ideas = await db.getIdeas();

  const history = await db.getWeekly();
  const digest = buildDigest({
    plan,
    ideas,
    credits: research.credits.spent,
    cached: research.credits.spent === 0,
    previous: history[0],
  });
  await db.saveWeekly(upsertDigest(history, digest));

  return { digest, db };
}

/** Every account directory that has ever been analysed, with the handle it holds. */
export async function listAccounts(
  root: string,
): Promise<{ id: string; dir: string; handle: string; platform?: Platform }[]> {
  const base = path.join(root, "accounts");
  let ids: string[];
  try {
    ids = await fs.readdir(base);
  } catch {
    return [];
  }

  const out: { id: string; dir: string; handle: string; platform?: Platform }[] = [];
  for (const id of ids) {
    const dir = path.join(base, id);
    try {
      const raw = await fs.readFile(path.join(dir, "plan.json"), "utf8");
      const plan = JSON.parse(raw) as GrowthPlan;
      if (plan?.handle) out.push({ id, dir, handle: plan.handle, platform: plan.platform });
    } catch {
      // no plan yet — nothing to refresh, and nothing to charge for
    }
  }
  return out;
}

/** A store for a directory that already exists. */
export function storeAt(dir: string): Store {
  return createStore(dir);
}

export function dataRoot(): string {
  return process.env.CREATORS_DATA_DIR
    ? path.resolve(process.env.CREATORS_DATA_DIR)
    : path.join(process.cwd(), "data");
}
