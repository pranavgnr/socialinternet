import Link from "next/link";

import type { ProfileIdea } from "@/lib/profileView";

/**
 * 06 — Three next reel ideas from the top niche competitors.
 *
 * Each idea names where it came from, how big that reel was, why the account
 * was chosen and the concept itself. "Script this" hands the idea to Koko; the
 * index and handle travel in the query so the studio does not have to guess.
 */
export default function CompetitorIdeas({ ideas }: { ideas: ProfileIdea[] }) {
  return (
    <section aria-labelledby="ideas-title" className="scroll-mt-24">
      <p className="mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-limelight">
        Section 06
      </p>
      <h2
        id="ideas-title"
        className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-pure-white sm:text-[30px]"
      >
        06 // 3 NEXT REEL IDEAS FETCHED FROM TOP NICHE COMPETITORS
      </h2>

      {ideas.length ? (
        <ol className="mt-5 grid gap-3 lg:grid-cols-3">
          {ideas.map((idea, index) => (
            <li key={`${idea.fromHandle}-${index}`} className="card flex h-full flex-col p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="mono text-[11px] font-bold uppercase tracking-[0.14em] text-limelight">
                  Idea {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mono text-[10px] uppercase tracking-[0.1em] text-muted-zinc">
                  {idea.theirViews}
                </p>
              </div>

              <p className="mt-3 text-[13px] font-semibold text-pure-white">
                @{idea.fromHandle}
              </p>

              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
                  Why chosen
                </p>
                <ul className="mt-2 space-y-1.5">
                  {idea.whyChosen.map((reason, reasonIndex) => (
                    <li
                      key={`${reasonIndex}-${reason}`}
                      className="flex gap-2 text-[11.5px] leading-relaxed text-muted-zinc"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-luxury-gold"
                      />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
                  The concept
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-pure-white">
                  {idea.concept || "The competitor's caption was not available."}
                </p>
              </div>

              <div className="mt-auto pt-4">
                <Link
                  href={idea.scriptHref}
                  aria-label={`Script idea ${index + 1} from @${idea.fromHandle} for one gem in Koko`}
                  className="inline-flex min-h-[36px] w-full items-center justify-center rounded-lg bg-limelight px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-limelight/85"
                >
                  <span aria-hidden="true">Script this (1💎)</span>
                </Link>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="card mt-5 p-5">
          <p className="text-[13px] leading-relaxed text-muted-zinc">
            No Instagram competitor evidence in this read yet.
          </p>
        </div>
      )}
    </section>
  );
}
