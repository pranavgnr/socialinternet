import { toCompetitorView } from "./competitor";
import { profileFromNiche } from "./niche";
import { ownWinnerCaptions, type AnalyseResult } from "./plan";
import type { Store } from "./store";
import type { GrowthPlan, Profile, RawReel } from "./types";

/**
 * The one request flag on `POST /api/plan`.
 *
 * `"own"` is the plan this visitor keeps: saved to their directory and used to
 * rebuild their idea feed. `"competitor"` is the same read of a public account,
 * with the advice stripped and nothing written to the visitor's own data.
 */
export type PlanMode = "own" | "competitor";

/**
 * Read `mode` from a request body. Missing means own (every existing caller
 * sends no flag); anything else that is not exactly one of the two words is
 * unknown and must be refused before a credit is charged.
 */
export function parsePlanMode(value: unknown): PlanMode | null {
  if (value === undefined) return "own";
  if (value === "own" || value === "competitor") return value;
  return null;
}

export const MODE_ERROR = 'mode must be "own" or "competitor".';

/**
 * The 400 a bad mode earns. Kept as a plain value so a test can prove the
 * refusal happens before the route reaches `take()`, `gate()` or a vendor pull:
 * an unreadable flag must never cost a credit.
 */
export function planModeRejection(
  value: unknown,
): { status: 400; error: string } | null {
  return parsePlanMode(value) === null
    ? { status: 400, error: MODE_ERROR }
    : null;
}

export interface PlanBuildInput {
  mode: PlanMode;
  handle: string;
  force?: boolean;
  niche?: string;
  /** skip transcript/OCR so a plan costs nothing — used by tests and retries */
  shallow?: boolean;
  /** the visitor's directory; competitor mode never touches it */
  store: Store;
}

export interface PlanBuildDeps {
  analyseHandle: (
    handle: string,
    opts: { force?: boolean; niche?: string; deep?: boolean },
  ) => Promise<AnalyseResult>;
  savePlan: (plan: GrowthPlan) => Promise<void>;
  getProfile: () => Promise<Profile | null>;
  runPipeline: (args: {
    profile?: Profile;
    seedReels?: RawReel[];
    db?: Store;
    ownHandle?: string;
  }) => Promise<unknown>;
  /** schedules work after the response — `after()` in the route, a spy in tests */
  scheduleAfter: (fn: () => Promise<void>) => void;
  logError: (err: unknown) => void;
}

export interface PlanBuildResult {
  plan: GrowthPlan;
  /** credits the niche research itself reported spending, for the rate limiter */
  spent: number;
}

/**
 * Run the analysis and do the mode-dependent writes.
 *
 * Extracted from the route so the one thing that matters can be tested without
 * Next: competitor mode must return the measured read and write *nothing* to the
 * visitor's account, while own mode keeps saving the plan and queueing the idea
 * feed. The credit gate and settlement stay in the route, unchanged, around this
 * function.
 */
export async function runPlanBuild(
  input: PlanBuildInput,
  deps: PlanBuildDeps,
): Promise<PlanBuildResult> {
  const analysed = await deps.analyseHandle(input.handle, {
    force: input.force,
    niche: input.niche,
    deep: !input.shallow,
  });

  const spent = analysed.research.credits.spent;

  if (input.mode === "competitor") {
    return { plan: toCompetitorView(analysed.plan), spent };
  }

  const { plan, research, seedReels, archetype, own } = analysed;

  await deps.savePlan(plan);

  // The idea feed is rebuilt from the reels the analysis already paid for, so
  // this never pulls anything twice.
  const previous = await deps.getProfile();
  const profile = profileFromNiche(research, previous, archetype);

  /**
   * Winners are the creator's own posts, so they come from the creator's own
   * feed — never from the room or from a previous record.
   */
  profile.ownWinners = ownWinnerCaptions(own.reels);

  /**
   * The songs the plan named are the songs the idea feed has to be built on:
   * a singer's reels are covers, and a cover idea without a song is not an
   * idea. Kept on the profile so a later refresh does not lose them.
   */
  profile.songs = plan.songs?.map((s) => s.title) ?? previous?.songs;

  /**
   * Same rule for video shapes: when the plan named shapes, the idea feed is
   * built on exactly those. Cleared for a song-led account, so a stale vlog
   * shape can never leak into a singer's covers.
   */
  if (plan.formats?.length) profile.formats = plan.formats.map((f) => f.label);
  else if (archetype.songLed) profile.formats = undefined;

  /**
   * The plan is saved, so the visitor can be shown it now. Writing the idea
   * feed is the long half, so `after` runs it once the response has been sent;
   * the ideas page shows the plan immediately and refreshes itself until the
   * feed arrives.
   */
  deps.scheduleAfter(async () => {
    try {
      await deps.runPipeline({
        profile,
        seedReels,
        db: input.store,
        ownHandle: input.handle,
      });
    } catch (err) {
      deps.logError(err);
    }
  });

  return { plan, spent };
}
