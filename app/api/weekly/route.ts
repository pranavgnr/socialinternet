import { NextResponse } from "next/server";

import { take, tooMany, refund } from "@/lib/limits";
import { currentAccount } from "@/lib/session";
import { currentUser } from "@/lib/auth";
import { friendly } from "@/lib/userError";
import { runWeekly } from "@/lib/weekly";
import { runWeeklyRequest } from "@/lib/weeklyRequest";

export const maxDuration = 300;

/** GET /api/weekly → this week's digest, plus the weeks before it. */
export async function GET() {
  const account = await currentAccount();
  if (!account) return NextResponse.json({ ok: true, digest: null, history: [] });
  const history = await account.store.getWeekly();
  return NextResponse.json({ ok: true, digest: history[0] ?? null, history });
}

/**
 * POST /api/weekly → make this week's digest now.
 *
 * This is a real re-pull, so it is allowed once a day: the cron job is the
 * normal path, and a person pressing the button is a correction, not a loop.
 *
 * It is also a paid, signed-in action exactly like an own plan: the handle
 * charge is taken up front and settled against the measured vendor spend, so a
 * run that threw or bought nothing is refunded. The gate and settle live in
 * `runWeeklyRequest` so they can be tested without Next.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to refresh this week." },
      { status: 401 },
    );
  }

  const account = await currentAccount();
  if (!account) {
    return NextResponse.json(
      { ok: false, error: "Analyse a handle first — there is nothing to refresh yet." },
      { status: 400 },
    );
  }

  const key = `weekly:${account.id}`;
  const budget = take(key, 1, 24 * 60 * 60 * 1000);
  if (!budget.allowed) {
    return tooMany(budget.retryAfter, "This week's plan is already made. The next one is due Monday.");
  }

  try {
    const outcome = await runWeeklyRequest({
      store: account.store,
      user,
      runWeekly,
    });

    if (outcome.status !== 200) {
      /** Nothing was pulled, so the once-a-day slot goes straight back. */
      refund(key);
      return NextResponse.json(
        { ok: false, error: outcome.error },
        { status: outcome.status },
      );
    }

    return NextResponse.json({ ok: true, digest: outcome.digest });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: friendly(err, "That did not work. Try again in a moment.") },
      { status: 400 },
    );
  }
}
