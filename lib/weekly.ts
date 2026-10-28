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
  moves: {
    title: string;
    action: string;
    why: string;
    receipts: number;
    /**
     * The other accounts this move was measured on.
     *
     * Carried per move, not only in `peers`, because a move that says "one
     * account your size broke out with it" and names nobody is advice the
     * creator cannot check or copy. The name belongs next to the sentence that
     * depends on it.
     */
    from: { handle: string; metric: string; url?: string }[];
  }[];
  /**
   * This week's ideas, already written, with the hook to open on.
   *
   * Each one now carries the post it was learned from. Without it the section
   * read as a list of the creator's own subjects dressed as next week's work:
   * all four posts in @natgeotravel's week cited @natgeotravel, so a page that
   * promised "what to post" was showing the account talking to itself. The
   * source is per idea rather than per week because the point of the list is
   * where each one came from, and the peer-backed ones are ranked first.
   */
  ideas: {
    id: string;
    title: string;
    hook?: string;
    format?: string;
    from?: { handle: string; ratio?: number; url?: string; own: boolean };
  }[];
  /**
   * The other accounts behind this week's moves, strongest first.
   *
   * A week that names nobody is a week the creator cannot check. These are the
   * handles and the numbers the moves were built from, so "what is working for
   * accounts your size" is a claim with receipts attached rather than advice
   * that could have been written without reading anything.
   */
  peers: { handle: string; metric: string; url?: string }[];
  /** what the audience asked for, in their own words; absent when none were read */
  heard?: {
    /** comment threads actually read */
    read: number;
    /** the most-repeated asks, strongest first */
    asks: { text: string; kind: string; asked: number }[];
    /** the words the audience keeps using */
    language: string[];
  };
  /**
   * Whether this week's moves were built on other accounts or only on your own.
   *
   * "cohort" means at least one move cites a handle that is not the creator's.
   * "own" means every move is the account measured against itself — a mirror.
   * The two are shown differently because they are not the same product: one is
   * a competitive read, the other is arithmetic about work already posted.
   */
  movesBasis: "cohort" | "own";
  /**
   * Whether this week's posts came from other accounts or only from your own.
   *
   * Same distinction as `movesBasis`, for the other half of the page: a week
   * whose four posts all reword the creator's own winners is a mirror, and the
   * creator cannot tell that from a competitive read unless the page says it.
   * Optional because weeks recorded before this field existed have no answer.
   */
  ideasBasis?: "cohort" | "own";
  /**
   * Said out loud when `movesBasis` is "own", so a mirror week is never dressed
   * as a competitive one. Absent on a cohort week.
   */
  stale?: string;
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

/**
 * The other accounts one move was measured on, own posts excluded.
 *
 * Kept as a function of its own because both the move and the peer list read
 * from it: the name next to a sentence and the name in the list can then never
 * disagree about who was cited.
 */
function namesBehind(
  move: GrowthPlan["moves"][number],
  own: string,
): { handle: string; metric: string; url?: string }[] {
  const out: { handle: string; metric: string; url?: string }[] = [];
  const seen = new Set<string>();
  for (const e of move.evidence) {
    const handle = e.handle.replace(/^@/, "");
    const key = handle.toLowerCase();
    if (!handle || key === own || seen.has(key)) continue;
    seen.add(key);
    out.push({ handle, metric: e.metric, url: e.url });
  }
  return out.slice(0, 3);
}

/**
 * Other accounts named by this plan's moves, one row each, strongest first.
 *
 * Moved to the front of the plan now that the cohort move exists, but the order
 * here follows the moves rather than a second opinion about who matters.
 */
function peerEvidence(plan: GrowthPlan): { handle: string; metric: string; url?: string }[] {
  const own = plan.handle.replace(/^@/, "").toLowerCase();
  const seen = new Set<string>();
  const out: { handle: string; metric: string; url?: string }[] = [];
  for (const move of [...plan.moves].sort((a, b) => a.priority - b.priority)) {
    for (const e of namesBehind(move, own)) {
      const key = e.handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.slice(0, 5);
}

/**
 * What the audience asked for, in their own words.
 *
 * Falls back to the flat question/request/objection lists when no seed survived
 * ranking, so a run that read comments never shows an empty section just
 * because nothing repeated. `read` is the gate: no threads read, no section.
 */
function heardFrom(plan: GrowthPlan): WeeklyDigest["heard"] {
  const c = plan.comments;
  if (!c?.read) return undefined;
  const asks = c.seeds.length
    ? c.seeds.slice(0, 5).map((s) => ({ text: s.text, kind: s.kind, asked: s.asked }))
    : [
        ...c.requests.map((text) => ({ text, kind: "request", asked: 1 })),
        ...c.questions.map((text) => ({ text, kind: "question", asked: 1 })),
        ...c.objections.map((text) => ({ text, kind: "objection", asked: 1 })),
      ].slice(0, 5);
  return { read: c.read, asks, language: c.language.slice(0, 6) };
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
  const own = plan.handle.replace(/^@/, "").toLowerCase();

  /**
   * A week that only cites the creator's own posts is not a competitive read.
   *
   * It is still true, so it is not deleted — but it is labelled, and the reason
   * it came out that way is stated next to the fix. The case this exists for: a
   * plan recorded before the cohort move existed (the week keeps whatever shape
   * it was recorded in), or a pull whose peers' posts never reached the row set.
   * Either way the creator is reading their own arithmetic and being told it is
   * advice for the week, which is the thing they asked not to be given.
   */
  const citesPeer = (m: GrowthPlan["moves"][number]) =>
    m.evidence.some((e) => e.handle.replace(/^@/, "").toLowerCase() !== own);
  const movesBasis: WeeklyDigest["movesBasis"] =
    plan.moves.length && plan.moves.some(citesPeer) ? "cohort" : "own";
  const stale =
    movesBasis === "cohort"
      ? undefined
      : plan.cohort.accounts > 0
        ? `Nothing here is measured on another account, though ${plan.cohort.accounts} ${
            plan.cohort.accounts === 1 ? "is" : "are"
          } already in your comparison. Refresh below to rebuild this week from their posts.`
        : `No other account could be read for your comparison, so this week measures you only against yourself. Refresh below to try the cohort again.`;

  /**
   * Another account's proven post beats the creator's own reworded one.
   *
   * Sorted in that order, then by score inside each group: a week whose posts
   * are all self-sourced is still shown, but with every line saying so, instead
   * of quietly presenting a mirror as a plan.
   */
  const weekIdeas = ideas
    .slice()
    .map((i) => {
      const account = (i.receipt?.account ?? "").replace(/^@/, "");
      return {
        i,
        from: account
          ? {
              handle: account,
              ratio: i.receipt?.ratio,
              url: i.receipt?.url,
              own: account.toLowerCase() === own,
            }
          : undefined,
      };
    })
    .sort((a, b) => Number(a.from?.own ?? true) - Number(b.from?.own ?? true) || b.i.score - a.i.score)
    .slice(0, 6)
    .map(({ i, from }) => ({
      id: i.id,
      title: i.title,
      hook: i.hookVariants?.[0],
      format: i.format,
      from,
    }));

  const ideasBasis: WeeklyDigest["ideasBasis"] = weekIdeas.length
    ? weekIdeas.some((i) => i.from && !i.from.own)
      ? "cohort"
      : "own"
    : undefined;

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
        from: namesBehind(m, own),
      })),
    ideas: weekIdeas,
    ideasBasis,
    /**
     * Read off the moves' own evidence rather than re-derived here: the handle
     * and the number a move cites are the same ones the week is claiming, so
     * they cannot disagree. Own posts are excluded — the point of the list is
     * what other people's accounts are doing.
     */
    peers: peerEvidence(plan),
    heard: heardFrom(plan),
    movesBasis,
    stale,
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
