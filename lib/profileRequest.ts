/**
 * The profile read, behind `POST /api/profile`.
 *
 * The route's only real work — turn a paid competitor read into a stored,
 * vendor-free profile view — lives here so it can be tested without a vendor
 * or a Next request, exactly like `runPlanBuild` in `lib/planRequest.ts`. The
 * credit gate, the rate limiter and the settlement stay in the route around
 * this function; this function only builds and saves.
 */
import { buildProfileView, type ProfileView } from "./profileView";
import type { GrowthPlan } from "./types";

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
 * a fresh read is ever turned into a reusable artifact. A throw anywhere here —
 * the plan build or the save — propagates to the route's `settleAfter`, which
 * refunds the charge in full.
 */
export async function runProfileRead(
  input: ProfileReadInput,
  deps: ProfileReadDeps,
): Promise<ProfileReadResult> {
  const { plan, spent } = await deps.runPlan(input.handle);
  const view = buildProfileView(plan, { own: false });
  await deps.saveView(input.handle, view);
  return { handle: input.handle, spent };
}
