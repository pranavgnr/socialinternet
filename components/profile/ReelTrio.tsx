import { compact } from "@/lib/fmt";
import { reelBasisLine, type ReelCard } from "@/lib/profileView";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-zinc">
        {label}
      </dt>
      <dd className="mono mt-1 text-[15px] font-bold leading-none text-pure-white">
        {value}
      </dd>
    </div>
  );
}

/**
 * 03 or 04 — the top three or bottom three reels.
 *
 * Rank, the measured numbers, the "why" bullets and the basis line. The basis
 * line is not decoration: a card either watched the video (and says so) or it
 * reasons from the caption and the numbers, and a viewer must be able to tell
 * which one they are reading.
 */
export default function ReelTrio({
  id,
  section,
  title,
  whyLabel,
  reels,
  emptyReason,
  tone = "top",
}: {
  id: string;
  section: string;
  title: string;
  whyLabel: string;
  reels: ReelCard[];
  emptyReason: string;
  tone?: "top" | "bottom";
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <p className="mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-limelight">
        Section {section}
      </p>
      <h2
        id={id}
        className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-pure-white sm:text-[30px]"
      >
        {title}
      </h2>

      {reels.length ? (
        <ol className="mt-5 grid gap-3 lg:grid-cols-3">
          {reels.map((reel, index) => (
            <li key={reel.url} className="card flex h-full flex-col p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={`mono text-[11px] font-bold uppercase tracking-[0.14em] ${
                    tone === "top" ? "text-limelight" : "text-luxury-gold"
                  }`}
                >
                  #{index + 1}
                </p>
                <a
                  href={reel.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open reel ${index + 1} on Instagram`}
                  className="mono text-[10px] uppercase tracking-[0.1em] text-muted-zinc underline-offset-4 transition hover:text-pure-white hover:underline"
                >
                  Open reel ↗
                </a>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-white/10 py-3">
                <Metric label="Views" value={compact(reel.views)} />
                <Metric
                  label="Likes"
                  value={
                    reel.likes === null ? "likes unavailable" : compact(reel.likes)
                  }
                />
                <Metric
                  label="Comments"
                  value={
                    reel.comments === null
                      ? "comments unavailable"
                      : compact(reel.comments)
                  }
                />
              </dl>

              <div className="mt-4">
                <p className="mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
                  {whyLabel}
                </p>
                <ul className="mt-2 space-y-2">
                  {reel.why.map((line, lineIndex) => (
                    <li key={`${lineIndex}-${line}`} className="flex gap-2">
                      <span
                        aria-hidden="true"
                        className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${
                          tone === "top" ? "bg-limelight" : "bg-luxury-gold"
                        }`}
                      />
                      <p className="text-[12px] leading-relaxed text-muted-zinc">
                        {line}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-auto pt-4 text-[10.5px] leading-relaxed text-muted-zinc/70">
                {reelBasisLine(reel.basis)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="card mt-5 p-5">
          <p className="text-[13px] leading-relaxed text-muted-zinc">
            {emptyReason}
          </p>
        </div>
      )}
    </section>
  );
}
