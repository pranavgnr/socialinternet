import Link from "next/link";
import { connection } from "next/server";

import IdeaCard from "@/components/IdeaCard";
import WaitingFeed from "@/components/WaitingFeed";
import { currentAccount } from "@/lib/session";
import { titleCase } from "@/lib/plain";
import type { Recommendation } from "@/lib/types";

export const instant = false;

/**
 * "Singer · Kannada" — the way a person would describe the account.
 *
 * The niche phrase used to be printed here, but it is search vocabulary
 * ("kannada songs singing covers"), not something the visitor asked to see, and
 * it repeated the heading above it.
 */
function shape(archetype: { label: string; language?: string }): string {
  return [titleCase(archetype.label), archetype.language ? titleCase(archetype.language) : null]
    .filter(Boolean)
    .join(" · ");
}

export default async function IdeasPage() {
  await connection();
  const account = await currentAccount();

  const [plan, ideas, runs] = account
    ? await Promise.all([
        account.store.getPlan(),
        account.store.getIdeas(),
        account.store.getRuns(),
      ])
    : [null, [], []];

  const visible = ideas
    .filter((i) => i.status !== "skipped")
    .sort((a, b) => b.score - a.score);

  /**
   * A run that has already finished is not "still writing".
   *
   * Thin niches converge to nothing — the harvest comes back, but too few posts
   * beat their own account's usual views to build a week from. The page used to
   * leave those visitors on an endless "keep this page open for a moment", then
   * "reload in a minute", which was never going to come true. Say what actually
   * happened instead, with the numbers the run recorded.
   */
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  const finished = Boolean(plan && lastRun?.finishedAt);
  const harvest = lastRun?.steps.find((s) => s.name === "harvest")?.detail ?? "";
  const pulled = /(\d+)\s+reels?\s+from\s+(\d+)\s+accounts?/i.exec(harvest);
  const inSpace = lastRun?.counts?.signals ?? 0;

  const family: Recommendation =
    plan?.archetype?.recommendation ??
    (plan?.archetype?.songLed ? "songs" : "hooks");
  const songLed = family === "songs";

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[23px] font-semibold leading-tight tracking-tight">
          {songLed
            ? "Your covers for this week"
            : family === "formats"
              ? "Your videos for this week"
              : "Your posts for this week"}
        </h1>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">
          {plan?.archetype ? `${shape(plan.archetype)}. ` : ""}
          {songLed
            ? "Each one names a song that broke out for accounts your size, and the line to start on."
            : family === "formats"
              ? "Each one is a video shape that broke out for accounts your size, with the moment to open on."
              : "Each one is built on a post that beat its own account’s usual views."}{" "}
          Pick what fits, make it, and tell us how it did.
        </p>
      </header>

      {visible.length ? (
        <div className="space-y-3">
          {visible.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} family={family} />
          ))}
        </div>
      ) : finished ? (
        /* The build is over and kept nothing. Never imply more is coming. */
        <div className="card px-4 py-10 text-center">
          <p className="text-[14px] font-medium">
            {ideas.length ? "You have skipped everything on the list." : "Nothing cleared the bar this week."}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted">
            {ideas.length ? (
              "That is fine — last week's list stays here until you pick one back up."
            ) : pulled ? (
              <>
                We read {pulled[1]} public reels from {pulled[2]} accounts in this space.{" "}
                {inSpace === 0
                  ? "None of them beat their own account’s usual views"
                  : `Only ${inSpace} beat their own account’s usual views`}
                {" "}— too few to build posts from. That is the room being small or sewn
                up, not anything you did.
              </>
            ) : (
              <>
                The posts in this space did not beat their own accounts’ usual views, so
                there was nothing solid to build from. That is the room being small or
                sewn up, not anything you did.
              </>
            )}
          </p>
          {ideas.length ? null : (
            <p className="mx-auto mt-3 max-w-xs text-[12.5px] leading-relaxed text-muted">
              A neighbouring room with a thinner field is usually the way in.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/start"
              className="rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-black"
            >
              {ideas.length ? "See this week" : "Find a thinner room"}
            </Link>
            <Link
              href="/discover"
              className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-semibold"
            >
              Explore a niche
            </Link>
          </div>
        </div>
      ) : plan ? (
        /* A plan exists but the feed has not landed yet: the server is writing
           it, so say that instead of telling them to start over. */
        <WaitingFeed />
      ) : (
        <div className="card px-4 py-10 text-center">
          <p className="text-[14px] font-medium">Nothing here yet.</p>
          <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted">
            Put in your handle and this week’s posts appear here, ready to film.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-black"
          >
            Build my plan
          </Link>
        </div>
      )}
    </div>
  );
}
