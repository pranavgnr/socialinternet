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

  const [plan, ideas] = account
    ? await Promise.all([account.store.getPlan(), account.store.getIdeas()])
    : [null, []];

  const visible = ideas
    .filter((i) => i.status !== "skipped")
    .sort((a, b) => b.score - a.score);

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
