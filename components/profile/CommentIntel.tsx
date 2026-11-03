import { pct } from "@/lib/fmt";
import type { CommentIntel as CommentIntelView } from "@/lib/profileView";

function mentionWord(n: number): string {
  return n === 1 ? "mention" : "mentions";
}

/**
 * 05 — Comment section deep analysis.
 *
 * Only comments that were actually read appear here. A null view is not a
 * design failure to paper over: it is the honest statement that no thread was
 * available for this account.
 */
export default function CommentIntel({
  intel,
}: {
  intel: CommentIntelView | null;
}) {
  return (
    <section aria-labelledby="comments-title" className="scroll-mt-24">
      <p className="mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-limelight">
        Section 05
      </p>
      <h2
        id="comments-title"
        className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-pure-white sm:text-[30px]"
      >
        05 // COMMENT SECTION DEEP ANALYSIS
      </h2>

      {!intel ? (
        <div className="card mt-5 p-5">
          <p className="text-[13px] leading-relaxed text-muted-zinc">
            Comments were not available for this account.
          </p>
        </div>
      ) : (
        <div className="card mt-5 grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <p className="mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
              Audience mood
            </p>
            {intel.mood.length ? (
              <ul className="mt-4 space-y-3">
                {intel.mood.map((mood) => (
                  <li key={mood.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[12.5px] leading-snug text-pure-white">
                        {mood.label}
                      </p>
                      <p className="mono text-[11px] text-limelight">
                        {pct(mood.pct)}
                      </p>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10"
                    >
                      <span
                        className="block h-full rounded-full bg-limelight"
                        style={{ width: `${Math.max(2, mood.pct * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted-zinc">
                The comments read did not fall into a clear mood split.
              </p>
            )}
          </div>

          <div className="border-t border-white/10 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <p className="mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
              Top recurring requests
            </p>
            {intel.requests.length ? (
              <ol className="mt-3 space-y-3">
                {intel.requests.map((request, index) => (
                  <li
                    key={`${index}-${request.text}`}
                    className="flex gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0"
                  >
                    <span className="mono shrink-0 text-[11px] font-bold text-limelight">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12.5px] leading-relaxed text-pure-white">
                        “{request.text}”
                      </p>
                      <p className="mono mt-1 text-[10px] uppercase tracking-[0.1em] text-muted-zinc">
                        {request.mentions} {mentionWord(request.mentions)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted-zinc">
                No recurring request surfaced in the comments read.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
