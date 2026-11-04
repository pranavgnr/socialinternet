import { NextResponse, after } from "next/server";

import { currentUser } from "@/lib/auth";
import { take, tooMany, refund } from "@/lib/limits";
import { buildRoomPlan, roomProfile } from "@/lib/newcomer";
import { researchNiche } from "@/lib/niche";
import { runPipeline } from "@/lib/pipeline";
import { runRoomRequest } from "@/lib/roomRequest";
import { attachCookie, currentAccount, ensureAccount } from "@/lib/session";
import { friendly } from "@/lib/userError";

export const maxDuration = 300;

const DAY = 24 * 60 * 60 * 1000;

/** GET /api/room → the last room plan this visitor built, if any. */
export async function GET() {
  const account = await currentAccount();
  const room = account ? await account.store.getRoom() : null;
  return NextResponse.json({ ok: true, room });
}

/**
 * POST /api/room  { query }
 *
 * The plan for someone who has not posted yet. A room is read once, and what
 * comes back is a first-video plan built from the accounts already in it: the
 * shape that wins, how long it runs, how it opens, and whether the winning is
 * done by accounts the visitor's own size.
 *
 * No handle anywhere in this path, because a new creator does not have one —
 * that was the dead end the site used to end at, and it was the one question
 * this audience cannot answer.
 *
 * A room is a niche pull, so it follows `/api/niche`'s rule: cached is free for
 * anyone, a fresh read is signed-in and charged up front. The gate and settle
 * live in `runRoomRequest` so they can be tested without Next.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      query?: string;
      force?: boolean;
    };

    const query = (body.query ?? "").trim().replace(/\s+/g, " ");
    if (query.length < 2) throw new Error("Type a space to plan for");

    const account = await ensureAccount();
    const limitKey = `room:${account.id}`;
    const budget = take(limitKey, 6, DAY);
    if (!budget.allowed) {
      return tooMany(budget.retryAfter, "You have planned a few rooms today.");
    }

    const user = await currentUser();
    const outcome = await runRoomRequest(
      { query, force: Boolean(body.force) },
      {
        store: account.store,
        user,
        researchNiche,
        buildRoomPlan,
        roomProfile,
        runPipeline,
        scheduleAfter: (fn) => after(fn),
        logError: (err) =>
          console.error("[room] idea feed failed:", (err as Error).message),
      },
    );

    if (outcome.status !== 200) {
      /** Nothing was pulled, so the rate-limit slot is handed straight back. */
      refund(limitKey);
      return NextResponse.json(
        { ok: false, error: outcome.error },
        { status: outcome.status },
      );
    }

    /** A room already on disk was not bought again, so it must not cost a slot. */
    if (outcome.free) refund(limitKey);

    return await attachCookie(
      NextResponse.json({ ok: true, room: outcome.room }),
      account,
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: friendly(
          err,
          "That room could not be planned. Try a broader phrase — or one closer to what the posts are about.",
        ),
      },
      { status: 400 },
    );
  }
}
