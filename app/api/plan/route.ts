import { NextResponse, after } from "next/server";

import { gate, settleAfter } from "@/lib/gate";
import { take, tooMany, refund } from "@/lib/limits";
import { profileFromNiche } from "@/lib/niche";
import { runPipeline } from "@/lib/pipeline";
import { analyseHandle, cleanHandle, ownWinnerCaptions } from "@/lib/plan";
import { attachCookie, currentAccount, ensureAccount } from "@/lib/session";
import { friendly } from "@/lib/userError";
import type { NicheResearch } from "@/lib/niche";

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
     * The credit gate, decided before anything is pulled. A handle whose feed
     * is still inside its TTL opens for free to anyone; a fresh pull belongs to
     * a signed-in account with the day's credits. A refusal means nothing was
     * read, so the rate-limit slot is handed straight back too.
     */
    const verdict = await gate("handle", { key: handle, force });
    if (!verdict.ok) {
      refund(limitKey);
      return NextResponse.json(
        { ok: false, error: verdict.message },
        { status: verdict.status },
      );
    }

    /** `settleAfter` runs the whole build, then settles the charge: a throw
     * after the charge refunds it in full, and a pull that cost the vendor
     * nothing is refunded too. The count comes from the same field the
     * rate-limit free-shell check reads. */
    let research: NicheResearch | undefined;
    return await settleAfter(
      verdict.entryId,
      async () => {
        /**
         * The deep pass runs on every plan, not behind a flag: six posts, one
         * credit each, cached for a week. It is the only way to answer whether the
         * scroll was stopped by a sentence, a caption, or the picture itself — and
         * that answer decides which of the moves is worth doing first.
         */
        const { plan, research: pulled, seedReels, archetype, own } = await analyseHandle(handle, {
          force,
          niche: body.niche?.trim() || undefined,
          deep: !body.shallow,
        });
        research = pulled;

        /** Nothing was bought, so nothing is charged: a handle already on disk is
         * free to open, and the allowance is there to cap spending, not visits. */
        if (pulled.credits.spent === 0) refund(limitKey);

        await account.store.savePlan(plan);

        // The idea feed is rebuilt from the reels the analysis already paid for,
        // so this never pulls anything twice.
        const previous = await account.store.getProfile();
        const profile = profileFromNiche(pulled, previous, archetype);

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

        /**
         * `ownWinners` stays exactly as set above: the creator's own captions.
         *
         * A second assignment used to overwrite it with every move's evidence
         * captions, which are mostly *peer* posts. That is the same wrong-attribution
         * bug the paragraph above describes — a competitor's caption presented to
         * the idea generator as "a post that worked for you" — and it silently
         * undid the correct value set two lines earlier.
         */

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
      },
      () => research?.credits.spent ?? 0,
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
