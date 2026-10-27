import { NextResponse, after } from "next/server";

import { take, tooMany, refund } from "@/lib/limits";
import { buildRoomPlan, roomProfile } from "@/lib/newcomer";
import { researchNiche } from "@/lib/niche";
import { runPipeline } from "@/lib/pipeline";
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

    const research = await researchNiche({ query, force: Boolean(body.force) });

    /** A room already on disk was not bought again, so it must not cost a slot. */
    if (research.credits.spent === 0) refund(limitKey);

    const room = buildRoomPlan(research);
    const profile = roomProfile(research, await account.store.getProfile());

    await account.store.saveRoom(room);
    await account.store.saveProfile(profile);

    /**
     * The idea feed is written after the response, exactly as on the handle
     * path: the plan is the answer the visitor is waiting for, and holding the
     * request open for ten model calls is how a phone request gets dropped. The
     * feed is rebuilt from the reels this search already paid for, so it adds no
     * cost.
     */
    after(async () => {
      try {
        await runPipeline({
          profile,
          seedReels: research.payload,
          seedCredits: research.credits,
          db: account.store,
        });
      } catch (err) {
        console.error("[room] idea feed failed:", (err as Error).message);
      }
    });

    return await attachCookie(NextResponse.json({ ok: true, room }), account);
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
