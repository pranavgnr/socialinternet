import { NextResponse, after } from "next/server";

import { currentUser } from "@/lib/auth";
import { saveCreatorProfile } from "@/lib/creatorProfile";
import { gate, settleAfter } from "@/lib/gate";
import { normalizeHandle } from "@/lib/handle";
import { take, tooMany, refund } from "@/lib/limits";
import { runPipeline } from "@/lib/pipeline";
import { creditLedger } from "@/lib/providers";
import { analyseHandle } from "@/lib/plan";
import {
  parsePlanMode,
  planModeRejection,
  runPlanBuild,
} from "@/lib/planRequest";
import { attachCookie, currentAccount, ensureAccount } from "@/lib/session";
import { friendly } from "@/lib/userError";

export const maxDuration = 300;

const DAY = 24 * 60 * 60 * 1000;

/** GET /api/plan → the plan belonging to whoever is asking. */
export async function GET() {
  const account = await currentAccount();
  const plan = account ? await account.store.getPlan() : null;
  return NextResponse.json({ ok: true, plan });
}

/**
 * POST /api/plan  { handle, niche?, force?, mode? }
 *
 * One handle in: read the account, work out the niche from its own posts, pull
 * what is working there, compare against size-matched peers, write a plan where
 * every move cites a reel. Everything lands in that visitor's own directory.
 *
 * `mode: "competitor"` runs the same read of a public account, but returns it in
 * the response body with the advice stripped and writes nothing to the visitor:
 * no plan, no profile, no idea feed, no remembered niche. It is charged and
 * settled exactly like an own plan.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      handle?: string;
      force?: boolean;
      niche?: string;
      /** skip transcript/OCR so a plan costs nothing — used by tests and retries */
      shallow?: boolean;
      /** "own" (default) keeps the plan; "competitor" only reads a public account */
      mode?: unknown;
    };

    /**
     * Refuse an unknown mode before the rate limiter, the gate or any pull, so
     * a typo cannot charge a credit or write a partial account.
     */
    const rejection = planModeRejection(body.mode);
    if (rejection) {
      return NextResponse.json(
        { ok: false, error: rejection.error },
        { status: rejection.status },
      );
    }
    const mode = parsePlanMode(body.mode)!;

    const handle = normalizeHandle(body.handle ?? "");
    if (!handle) throw new Error("handle is required");

    const account = await ensureAccount();
    const force = Boolean(body.force);

    // Updating is a paid re-pull, so it is the tighter allowance of the two.
    const limitKey = force
      ? `update:${account.id}`
      : `plan:${account.id}`;
    const budget = force
      ? take(limitKey, 2, 6 * 60 * 60 * 1000)
      : take(limitKey, 4, DAY);
    if (!budget.allowed) {
      return tooMany(
        budget.retryAfter,
        force
          ? "You have updated this plan a few times already."
          : "You have built a few plans today.",
      );
    }

    /**
     * The credit gate, decided before anything is pulled. A plan is always a
     * signed-in, paid action — cache or no cache — because even when the
     * handle's own feed is already on disk, the run still buys vendor work the
     * visitor steers (a fresh search on the phrase they typed, a profile read,
     * the deep enrich pass). So strangers are refused here, and the day's
     * credits are charged up front; whether the charge survives is decided
     * after the run by what the vendor ledger says it cost. A refusal means
     * nothing was read, so the rate-limit slot is handed straight back too.
     */
    /**
     * Resolve the account and let the gate use that same signed-in user, so the
     * creator profile is written for the id the charge was made against.
     */
    const user = await currentUser();
    const verdict = await gate("handle", {
      key: handle,
      getUser: async () => user,
    });
    if (!verdict.ok) {
      refund(limitKey);
      return NextResponse.json(
        { ok: false, error: verdict.message },
        { status: verdict.status },
      );
    }

    /**
     * What the run is about to spend sits on a process-wide vendor ledger, so
     * the settle below compares a snapshot taken now against one taken after.
     */
    const vendorUsdAtStart = creditLedger().usd;

    /** `settleAfter` runs the whole build, then settles the charge: a throw
     * after the charge refunds it in full, and a run the ledger measured as
     * free is refunded too. */
    return await settleAfter(
      verdict.entryId,
      async () => {
        const { plan, spent } = await runPlanBuild(
          {
            mode,
            handle,
            force,
            niche: body.niche?.trim() || undefined,
            shallow: body.shallow,
            store: account.store,
          },
          {
            analyseHandle,
            savePlan: (p) => account.store.savePlan(p),
            /**
             * Own mode only (competitor mode never reaches this dep): remember
             * who the creator is for the later marketplace. The gate above
             * guarantees a signed-in user, so `user.id` is the id that was
             * charged. A failure is caught and logged inside `runPlanBuild`.
             */
            saveCreatorProfile: async (plan) => {
              if (!user) return;
              await saveCreatorProfile(user.id, {
                handle: plan.handle,
                niche: plan.niche,
                followers: plan.account?.followers,
                platform:
                  plan.platform === "youtube"
                    ? "youtube"
                    : plan.platform === "instagram"
                      ? "instagram"
                      : undefined,
              });
            },
            getProfile: () => account.store.getProfile(),
            runPipeline,
            /**
             * Own mode queues the idea feed; competitor mode never reaches this
             * dep, so no profile, signal or idea is written for the visitor.
             * `after` runs the work once the response has been sent — see the
             * note in `lib/planRequest.ts`.
             */
            scheduleAfter: (fn) => after(fn),
            logError: (err) =>
              console.error(
                "[plan] post-build work failed:",
                (err as Error).message,
              ),
          },
        );

        /** Nothing was bought, so nothing is charged: a handle already on disk is
         * free to open, and the allowance is there to cap spending, not visits. */
        if (spent === 0) refund(limitKey);

        /**
         * Own mode keeps its existing response (the plan is on disk). Competitor
         * mode wrote nothing, so the body is the only place the read can live.
         */
        const payload =
          mode === "competitor" ? { ok: true, plan } : { ok: true };
        return await attachCookie(NextResponse.json(payload), account);
      },
      () => {
        /**
         * Measured in real vendor money (`CreditLedger.usd`), not in the result's
         * unit counter: that counter misses the handle's own pull, the profile
         * read and the deep enrich pass, and a cached room resets it to zero —
         * refunding on it gave a fresh paid pull away as a free plan.
         *
         * The ledger is process-wide, not per request, and it only ever
         * grows during a window: a concurrent request's spend landing inside
         * this snapshot can only push the measured cost up and make the user
         * keep their charge (conservative, never a free plan); our own spend
         * is always inside our own before/after pair.
         */
        return creditLedger().usd - vendorUsdAtStart;
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: friendly(err, "That did not work. Try again in a moment."),
      },
      { status: 400 },
    );
  }
}
