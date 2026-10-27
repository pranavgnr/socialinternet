import { NextResponse } from "next/server";

import { take, tooMany } from "@/lib/limits";
import { currentAccount } from "@/lib/session";
import { friendly } from "@/lib/userError";
import { runWeekly } from "@/lib/weekly";

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
 */
export async function POST() {
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

  const plan = await account.store.getPlan();
  if (!plan?.handle) {
    return NextResponse.json(
      { ok: false, error: "Analyse a handle first — there is nothing to refresh yet." },
      { status: 400 },
    );
  }

  try {
    const { digest } = await runWeekly(plan.handle, account.store);
    return NextResponse.json({ ok: true, digest });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: friendly(err, "That did not work. Try again in a moment.") },
      { status: 400 },
    );
  }
}
