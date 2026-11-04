import type { SessionUser } from "./auth";
import { gate, settleAfter } from "./gate";
import { creditLedger } from "./providers";
import type { Store } from "./store";
import type { WeeklyDigest, WeeklyRun } from "./weekly";

/**
 * `POST /api/weekly` without Next.
 *
 * The one-press weekly refresh is a real re-pull, so it is charged exactly like
 * an own plan (`POST /api/plan`): signed-in always, `COSTS.handle` charged up
 * front, and settled against the measured real-money delta — refunded when the
 * run threw or cost the vendor nothing. The cron route is the operator path and
 * stays ungated; this is the visitor path.
 */
export interface WeeklyRequestDeps {
  store: Pick<Store, "getPlan">;
  /** null for a visitor who has not signed in */
  user: SessionUser | null;
  runWeekly: (handle: string, store: Store) => Promise<WeeklyRun>;
  now?: Date;
}

export type WeeklyOutcome =
  | { status: 200; digest: WeeklyDigest }
  | { status: 400 | 401 | 402; error: string };

export async function runWeeklyRequest(
  deps: WeeklyRequestDeps,
): Promise<WeeklyOutcome> {
  if (!deps.user) {
    return { status: 401, error: "Sign in to refresh this week." };
  }
  const user = deps.user;

  /** Nothing to refresh means nothing to charge: check the plan first. */
  const plan = await deps.store.getPlan();
  if (!plan?.handle) {
    return {
      status: 400,
      error: "Analyse a handle first — there is nothing to refresh yet.",
    };
  }

  const verdict = await gate("handle", {
    key: plan.handle,
    getUser: async () => user,
    now: deps.now,
  });
  if (verdict.ok === false) {
    return { status: verdict.status, error: verdict.message };
  }

  /** Monotonic: a fresh niche pull elsewhere cannot reset this run's spend. */
  const usdAtStart = creditLedger().lifetimeUsd;

  const run = await settleAfter(
    verdict.entryId,
    () => deps.runWeekly(plan.handle!, deps.store as Store),
    () => creditLedger().lifetimeUsd - usdAtStart,
  );

  return { status: 200, digest: run.digest };
}
