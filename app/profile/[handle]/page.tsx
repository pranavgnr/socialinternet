import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import CommentIntel from "@/components/profile/CommentIntel";
import CompetitorIdeas from "@/components/profile/CompetitorIdeas";
import Dna from "@/components/profile/Dna";
import ProfileHeader from "@/components/profile/ProfileHeader";
import ReadPanel from "@/components/profile/ReadPanel";
import ReelTrio from "@/components/profile/ReelTrio";
import Vitals from "@/components/profile/Vitals";
import { normalizeHandle } from "@/lib/handle";
import { enrichProfilePlan } from "@/lib/profileData";
import { buildProfileView, type ProfileNextMove } from "@/lib/profileView";
import { readProfileView } from "@/lib/profileStore";
import { currentAccount } from "@/lib/session";
import type { GrowthPlan } from "@/lib/types";
import { getViewer } from "@/lib/viewer";

export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const handle = normalizeHandle((await params).handle);
  return {
    title: handle ? `@${handle} — Shambles audit` : "Shambles audit",
    /**
     * Every profile is `noindex`: these are pages about someone's public
     * account, held as a seven-day artifact rather than a permanent record, and
     * the owner cannot be identified cheaply at metadata time. `nofollow` also
     * keeps outbound reel links from being treated as endorsements.
     */
    robots: { index: false, follow: false },
  };
}

function NextMoveCard({ move }: { move: ProfileNextMove }) {
  return (
    <section aria-labelledby="next-move-title" className="card relative overflow-hidden p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-limelight/70 to-transparent"
      />
      <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-limelight">
        Next move this week
      </p>
      <h2
        id="next-move-title"
        className="mt-2 text-[21px] font-semibold leading-snug tracking-[-0.02em] text-pure-white sm:text-[25px]"
      >
        {move.title}
      </h2>
      <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-muted-zinc">
        {move.why}
      </p>
      <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
        <div>
          <p className="mono text-[11px] font-bold uppercase tracking-[0.14em] text-limelight">
            Do this
          </p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-pure-white">
            {move.action}
          </p>
        </div>
        {move.stop ? (
          <div>
            <p className="mono text-[11px] font-bold uppercase tracking-[0.14em] text-luxury-gold">
              Stop
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-zinc">
              {move.stop}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * `/profile/[handle]` — the six-section audit.
 *
 * This page never calls a vendor. The first thing it does is read the stored
 * view for the handle; a fresh one renders for anyone, signed in or not, for
 * zero gems. Only when there is no stored view does the page offer the paid
 * read, and that work happens in `POST /api/profile`.
 *
 * The owner's own plan is built in-process (it is already on disk) with the
 * next-move card on top. Session and database reads are guarded so a stored
 * profile still renders with the database unreachable.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  await connection();

  const handle = normalizeHandle((await params).handle);
  if (!handle) notFound();

  /** Stored first: this is the path that must work with no database. */
  const stored = await readProfileView(handle).catch((err) => {
    console.error("[profile] stored view read failed:", (err as Error).message);
    return null;
  });

  let signedIn = false;
  let ownPlan: GrowthPlan | null = null;
  try {
    const viewer = await getViewer();
    signedIn = Boolean(viewer.user);
    if (viewer.user) {
      const account = await currentAccount();
      const plan = account ? await account.store.getPlan() : null;
      if (plan && normalizeHandle(plan.handle) === handle) ownPlan = plan;
    }
  } catch (err) {
    console.error("[profile] session read failed:", (err as Error).message);
  }

  const view = ownPlan
    ? buildProfileView(enrichProfilePlan(ownPlan), { own: true })
    : (stored?.view ?? null);

  const emptyReels =
    "Fewer than two recent reels were read, so there is no top and bottom to compare. A fresh read adds the rest.";
  const emptyFlops =
    view && view.winners.length === 0
      ? "See section 03 — fewer than two recent reels were read, so there is no bottom three to compare."
      : emptyReels;

  return (
    <div className="pb-24 sm:pb-4">
      <ProfileHeader
        handle={view?.handle ?? handle}
        niche={view?.niche}
        nicheVerified={view?.nicheVerified}
      />

      {view ? (
        <div className="space-y-11 pt-7 sm:space-y-14 sm:pt-9">
          {view.own && view.nextMove ? (
            <NextMoveCard move={view.nextMove} />
          ) : null}

          <Vitals view={view} />
          <Dna view={view} />

          <ReelTrio
            id="winners-title"
            section="03"
            title="03 // TOP 3 PERFORMING REELS (WHY THEY POPPED OFF)"
            whyLabel="WHY IT WORKED"
            reels={view.winners}
            emptyReason={emptyReels}
            tone="top"
          />

          <ReelTrio
            id="flops-title"
            section="04"
            title="04 // BOTTOM 3 PERFORMING REELS (WHY THEY FLOPPED)"
            whyLabel="WHY IT FLOPPED"
            reels={view.flops}
            emptyReason={emptyFlops}
            tone="bottom"
          />

          <CommentIntel intel={view.commentIntel} />
          <CompetitorIdeas ideas={view.ideas} />
        </div>
      ) : (
        <ReadPanel handle={handle} signedIn={signedIn} />
      )}
    </div>
  );
}
