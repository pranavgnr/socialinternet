import { NextResponse } from "next/server";

import { gate, settleAfter } from "@/lib/gate";
import { take, tooMany, refund, refundSlotIfFree } from "@/lib/limits";
import {
  cachedNiches,
  nicheCacheStatus,
  nicheView,
  researchNiche,
  type NicheResearch,
} from "@/lib/niche";
import { attachCookie, ensureAccount } from "@/lib/session";
import { creditLedger } from "@/lib/providers";
import { friendly } from "@/lib/userError";

export const maxDuration = 300;

const DAY = 24 * 60 * 60 * 1000;

/**
 * GET /api/niche           → the niches already on disk (free, no spend)
 * GET /api/niche?q=singer  → what searching that phrase would cost (free)
 *
 * Both are free on purpose: the page has to be able to say "this is already
 * researched, opening it costs nothing" BEFORE anyone presses a button that
 * spends a credit.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ ok: true, niches: await cachedNiches() });
  }

  return NextResponse.json({ ok: true, status: await nicheCacheStatus(q) });
}

/**
 * POST /api/niche  { query, handle?, force? }
 *
 * Reads what is working in a niche as a whole — the accounts breaking out, the
 * baseline a reel has to beat, the themes that recur — without needing a handle
 * first. Served from disk inside the TTL, which is why reopening a niche someone
 * already paid for is free.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      query?: string;
      handle?: string;
      force?: boolean;
    };

    const query = (body.query ?? "").trim();
    if (query.length < 2) throw new Error("Type a niche to search for");

    const account = await ensureAccount();
    const limitKey = `niche:${account.id}`;
    const budget = take(limitKey, 6, DAY);
    if (!budget.allowed) {
      return tooMany(budget.retryAfter, "You have searched a few niches today.");
    }

    /**
     * The credit gate, decided before anything is pulled. A phrase already on
     * disk inside its TTL reads for free to anyone; a fresh pull belongs to a
     * signed-in account with the day's credits. Refused means nothing happened,
     * so the rate-limit slot is handed straight back too.
     */
    const handle = body.handle?.trim() || undefined;
    const verdict = await gate("niche", {
      key: query,
      nicheHandle: handle,
      force: Boolean(body.force),
    });
    if (!verdict.ok) {
      refund(limitKey);
      return NextResponse.json(
        { ok: false, error: verdict.message },
        { status: verdict.status },
      );
    }

    /** `settleAfter` runs the pull and the response build, then settles the
     * charge: a throw after the charge refunds it in full, and a pull that
     * turned out to cost the vendor nothing is refunded too. */
    const vendorUsdAtStart = creditLedger().lifetimeUsd;
    let research: NicheResearch | undefined;
    /** Filled in once the pull ends, so the settle and the slot refund read
     * the exact same measurement. */
    let vendorUsdSpent: number | null = null;
    return await settleAfter(
      verdict.entryId,
      async () => {
        research = await researchNiche({
          query,
          handle,
          force: Boolean(body.force),
        });

        /** Free searches are refunded: reopening a niche on disk must never use up
         * the day's allowance, or a visitor gets locked out of their own work.
         * Measured in real vendor money, the same value the gem settle uses — a
         * search can buy owner profile reads without moving the research unit
         * counter. */
        const vendorUsdSpentNow = creditLedger().lifetimeUsd - vendorUsdAtStart;
        vendorUsdSpent = vendorUsdSpentNow;
        refundSlotIfFree(limitKey, vendorUsdSpentNow);

        return await attachCookie(
          NextResponse.json({
            ok: true,
            view: nicheView(research),
            /**
             * How the caller can turn this niche into a plan.
             *
             * The room route, not the handle form: someone reading a niche is
             * usually deciding whether to enter it, and has nothing to check yet.
             * The room plan answers that with the same data the view was built
             * from, and costs nothing extra because the pull is already on disk.
             */
            planHref: `/room?q=${encodeURIComponent(research.query)}`,
          }),
          account,
        );
      },
      () => vendorUsdSpent ?? creditLedger().lifetimeUsd - vendorUsdAtStart,
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: friendly(
          err,
          "That search did not work. Try a broader phrase — or one closer to what the posts are about.",
        ),
      },
      { status: 400 },
    );
  }
}
