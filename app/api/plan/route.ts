import { NextResponse, after } from "next/server";

import { take, tooMany, refund } from "@/lib/limits";
import { profileFromNiche } from "@/lib/niche";
import { runPipeline } from "@/lib/pipeline";
import { analyseHandle, cleanHandle, ownWinnerCaptions } from "@/lib/plan";
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
 * POST /api/plan  { handle, niche?, force? }
 *
 * One handle in: read the account, work out the niche from its own posts, pull
 * what is working there, compare against size-matched peers, write a plan where
 * every move cites a reel. Everything lands in that visitor's own directory.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      handle?: string;
      force?: boolean;
      niche?: string;
      /** skip transcript/OCR so a plan costs nothing — used by tests and retries */
      shallow?: boolean;
    };

    const handle = cleanHandle(body.handle ?? "");
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
     * The deep pass runs on every plan, not behind a flag: six posts, one
     * credit each, cached for a week. It is the only way to answer whether the
     * scroll was stopped by a sentence, a caption, or the picture itself — and
     * that answer decides which of the moves is worth doing first.
     */
    const { plan, research, seedReels, archetype, own } = await analyseHandle(handle, {
      force,
      niche: body.niche?.trim() || undefined,
      deep: !body.shallow,
    });

    /** Nothing was bought, so nothing is charged: a handle already on disk is
     * free to open, and the allowance is there to cap spending, not visits. */
    if (research.credits.spent === 0) refund(limitKey);

    await account.store.savePlan(plan);

    // The idea feed is rebuilt from the reels the analysis already paid for,
    // so this never pulls anything twice.
    const previous = await account.store.getProfile();
    const profile = profileFromNiche(research, previous, archetype);

    /**
     * Winners are the creator's own posts, so they come from the creator's own
     * feed — never from the room or from a previous record.
     *
     * `profileFromNiche` falls back to the previous profile when the pull found
     * no row for this handle, and that fallback is how a benchmark creator's
     * caption ("Ali Sigma slapped us for Range Rover") was being listed as
     * natgeo's own winning post. The feed is on disk and already paid for, so
     * there is no reason to inherit a claim about whose post it was.
     */
    profile.ownWinners = ownWinnerCaptions(own.reels);

    /**
     * The songs the plan named are the songs the idea feed has to be built on:
     * a singer's reels are covers, and a cover idea without a song is not an
     * idea. Kept on the profile so a later refresh does not lose them.
     */
    profile.songs = plan.songs?.map((s) => s.title) ?? previous?.songs;

    /**
     * Same rule for video shapes: when the plan named shapes, the idea feed is
     * built on exactly those. Cleared for a song-led account, so a stale vlog
     * shape can never leak into a singer's covers.
     */
    if (plan.formats?.length) profile.formats = plan.formats.map((f) => f.label);
    else if (archetype.songLed) profile.formats = undefined;

    // Captions from posts that worked for accounts this size become the
    // strongest grounding signal the idea generator has.
    profile.ownWinners = plan.moves
      .flatMap((m) => m.evidence.map((e) => e.caption ?? ""))
      .filter(Boolean)
      .slice(0, 3);

    /**
     * The plan is saved, so the visitor can be shown it now. Writing the idea
     * feed is the long half — a model call per card plus a copy audit — and
     * holding the response open for it meant a save took 10s on a warm cache
     * and over two minutes cold. On a phone that is a dropped request and a
     * spent credit with nothing to show.
     *
     * `after` runs it once the response has been sent, so the same work happens
     * and lands in the same place; the ideas page shows the plan immediately and
     * refreshes itself until the feed arrives.
     */
    after(async () => {
      try {
        await runPipeline({ profile, seedReels, db: account.store, ownHandle: handle });
      } catch (err) {
        console.error("[plan] idea feed failed:", (err as Error).message);
      }
    });

    return await attachCookie(NextResponse.json({ ok: true }), account);
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
