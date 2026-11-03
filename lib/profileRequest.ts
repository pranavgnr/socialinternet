/**
 * The profile read, behind `POST /api/profile`.
 *
 * The route's only real work — turn a paid competitor read into a stored,
 * vendor-free profile view — lives here so it can be tested without a vendor
 * or a Next request, exactly like `runPlanBuild` in `lib/planRequest.ts`. The
 * credit gate, the rate limiter and the settlement stay in the route around
 * this function; this function only builds and saves.
 *
 * Two optional extras run after the plan exists, and neither can fail the read:
 *
 *   - a follower sample produces the bot-to-real estimate for a public account
 *     with at least 1,000 followers (cached seven days). Sampling is **dormant
 *     unless `AUTH_SAMPLE_PAGES` is explicitly positive**, because one page
 *     holds ~25 rows — below the 40-row floor — so the default buys an estimate
 *     that can never render;
 *   - the configured video reader watches the same top-3/bottom-3 reels the
 *     page will show (captions only unless `GEMINI_API_KEY` is set).
 *
 * Both are deliberately inside this function: their vendor calls land on the
 * shared ledger, so the route's measured settle sees the money they spent.
 */
import {
  authSamplePages,
  resolveAuthenticity,
  type AuthenticityEstimate,
  type AuthenticityOptions,
} from "./authenticity";
import { buildProfileView, reelsToRead, type ProfileView } from "./profileView";
import type { GrowthPlan } from "./types";
import {
  configuredReader,
  readReels,
  videoReadMax,
  type VideoReader,
  type VideoReading,
} from "./videoReader";

export interface ProfileReadInput {
  handle: string;
}

export interface ProfileReadDeps {
  /**
   * Run the competitor-mode plan build and return the competitor view plus the
   * credits the research itself reported spending. The route binds this to
   * `runPlanBuild` with `mode: "competitor"`, which already strips the
   * owner-addressed advice via `toCompetitorView`.
   */
  runPlan: (handle: string) => Promise<{ plan: GrowthPlan; spent: number }>;
  /** write the built view to the shared profile store */
  saveView: (handle: string, view: ProfileView) => Promise<void>;
  /**
   * The authenticity extras. Injected in tests; the defaults read the cache and
   * buy one follower sample through the router.
   */
  authenticity?: AuthenticityOptions;
  /** The video reader. Injected in tests; defaults to Gemini only with a key. */
  reader?: VideoReader;
  /** Per-profile video ceiling; defaults to `VIDEO_READ_MAX` (6). */
  videoMax?: number;
  /** Injected clock, epoch milliseconds, for tests. */
  now?: () => number;
}

export interface ProfileReadResult {
  handle: string;
  /** the credits the research reported spending, for the rate limiter */
  spent: number;
}

/**
 * Build and store the neutral competitor view for a handle.
 *
 * The stored view is what later GETs serve for free, so this is the only place
 * a fresh read is ever turned into a reusable artifact. A throw from the plan
 * build or the save propagates to the route's `settleAfter`, which refunds the
 * charge in full. The extras are wrapped: a vendor that cannot sample followers
 * or read a video leaves the page with one fewer number, never with no page.
 */
export async function runProfileRead(
  input: ProfileReadInput,
  deps: ProfileReadDeps,
): Promise<ProfileReadResult> {
  const { plan, spent } = await deps.runPlan(input.handle);

  let authenticity: AuthenticityEstimate | null = null;
  /**
   * Sampling is dormant unless a page cap is explicitly positive. With the
   * default 0 the read must not make even the account lookup: no request, no
   * spend, and `vitals.botToReal` stays null so the slab says "Estimate coming".
   */
  const samplePages = deps.authenticity?.pages ?? authSamplePages();
  if (samplePages > 0) {
    try {
      authenticity = await resolveAuthenticity(
        plan.handle,
        {
          followers: plan.account?.followers ?? plan.standing?.followers,
        },
        deps.authenticity,
      );
    } catch {
      authenticity = null;
    }
  }

  let readings = new Map<string, VideoReading>();
  try {
    readings = await readReels(
      reelsToRead(plan),
      deps.reader ?? configuredReader(),
      {
        max: deps.videoMax ?? videoReadMax(),
        now: deps.now,
      },
    );
  } catch {
    readings = new Map();
  }

  const view = buildProfileView(plan, {
    own: false,
    authenticity,
    readings,
  });
  await deps.saveView(input.handle, view);
  return { handle: input.handle, spent };
}
