import type { ProfileView } from "@/lib/profileView";

/**
 * 02 — Who they are & creator DNA.
 *
 * The executive summary is the plan's own prose: the archetype blurb plus the
 * positioning paragraph, with no model call. Audience signals replace
 * demographics (which public data does not carry) with the languages and asks
 * that were actually read.
 */
export default function Dna({ view }: { view: ProfileView }) {
  return (
    <section aria-labelledby="dna-title" className="scroll-mt-24">
      <p className="mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-limelight">
        Section 02
      </p>
      <h2
        id="dna-title"
        className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-pure-white sm:text-[30px]"
      >
        02 // WHO THEY ARE &amp; CREATOR DNA
      </h2>

      <div className="card mt-5 grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.45fr_1fr]">
        <div>
          <p className="mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
            Executive summary
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-pure-white">
            {view.dna.summary ||
              "There is not enough read from this account to describe its positioning yet."}
          </p>
        </div>

        <div className="border-t border-white/10 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
            Audience signals
          </p>
          <ul className="mt-3 space-y-2.5">
            {view.dna.audienceSignals.map((signal, index) => (
              <li key={`${index}-${signal}`} className="flex gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-limelight"
                />
                <p className="text-[12.5px] leading-relaxed text-muted-zinc">
                  {signal}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
