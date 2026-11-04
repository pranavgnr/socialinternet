import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth";
import { gate, settleAfter } from "@/lib/gate";
import { normalizeHandle } from "@/lib/handle";
import { take, tooMany, refund, refundSlotIfFree } from "@/lib/limits";
import { analyseHandle } from "@/lib/plan";
import { runPlanBuild } from "@/lib/planRequest";
import { runProfileRead } from "@/lib/profileRequest";
import { saveProfileView } from "@/lib/profileStore";
import { creditLedger } from "@/lib/providers";
import { attachCookie, ensureAccount } from "@/lib/session";
import { friendly } from "@/lib/userError";

export const maxDuration = 300;

const DAY = 24 * 60 * 60 * 1000;

/**
 * POST /api/profile  { handle }
 *
 * Read a public account and store a profile view for it. A fresh read is paid
 * and signed-in always (the run buys vendor work the visitor steers), then the
 * charge is settled against the real vendor money the run spent — a run the
 * ledger measured as free is refunded, and a run that threw is refunded in
 * full. Once stored, later GETs of `/profile/<handle>` serve the view with
 * zero vendor calls and no gem cost.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { handle?: string };

    const handle = normalizeHandle(body.handle ?? "");
    if (!handle) throw new Error("handle is required");

    const account = await ensureAccount();

    // The same daily allowance shape as /api/plan, keyed to profile reads so a
    // competitor read never eats into a plan build's four-a-day.
    const limitKey = `profile:${account.id}`;
    const budget = take(limitKey, 4, DAY);
    if (!budget.allowed) {
      return tooMany(
        budget.retryAfter,
        "You have read a few accounts today.",
      );
    }

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

    const vendorUsdAtStart = creditLedger().lifetimeUsd;
    /** Filled in once the read ends, so the settle and the slot refund read
     * the exact same measurement. */
    let vendorUsdSpent: number | null = null;

    return await settleAfter(
      verdict.entryId,
      async () => {
        await runProfileRead(
          { handle },
          {
            runPlan: async (h) => {
              const { plan, spent } = await runPlanBuild(
                {
                  mode: "competitor",
                  handle: h,
                  store: account.store,
                },
                {
                  analyseHandle,
                  // Competitor mode writes nothing to the visitor, so these are
                  // only here to satisfy the type: `runPlanBuild` returns before
                  // it ever touches them for a competitor read.
                  savePlan: (p) => account.store.savePlan(p),
                  getProfile: () => account.store.getProfile(),
                  runPipeline: async () => undefined,
                  scheduleAfter: () => undefined,
                  logError: (err) =>
                    console.error(
                      "[profile] post-build work failed:",
                      (err as Error).message,
                    ),
                },
              );
              return { plan, spent };
            },
            saveView: saveProfileView,
          },
        );

        /**
         * A run the research measured as free (everything already on disk) must
         * not use up the daily read allowance either. Measured in real vendor
         * money, the same value the gem settle uses — a competitor read can buy
         * owner profiles without moving the research unit counter.
         */
        const vendorUsdSpentNow = creditLedger().lifetimeUsd - vendorUsdAtStart;
        vendorUsdSpent = vendorUsdSpentNow;
        refundSlotIfFree(limitKey, vendorUsdSpentNow);

        return await attachCookie(NextResponse.json({ ok: true }), account);
      },
      () => vendorUsdSpent ?? creditLedger().lifetimeUsd - vendorUsdAtStart,
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
