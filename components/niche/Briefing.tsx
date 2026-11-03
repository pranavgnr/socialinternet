import KokoAvatar from "@/components/koko/KokoAvatar";
import { EMPTY_DOSSIER_LINE } from "@/lib/nicheDossier";

/**
 * Koko's executive briefing: three to five sentences, each one a number that
 * also appears elsewhere on this page. When there is nothing read, the card
 * says so without a figure or a prediction.
 */
export default function Briefing({ lines }: { lines: string[] }) {
  return (
    <section
      aria-labelledby="briefing-title"
      className="card relative overflow-hidden p-5 sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-limelight/60 to-transparent"
      />

      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-limelight/25 bg-limelight/[0.04]">
          <KokoAvatar className="h-8 w-8" />
        </span>
        <div className="min-w-0">
          <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-limelight">
            Koko
          </p>
          <h2
            id="briefing-title"
            className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-pure-white sm:text-[23px]"
          >
            Koko&rsquo;s briefing
          </h2>
        </div>
      </div>

      {lines.length ? (
        <ul className="mt-4 space-y-2.5">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-limelight"
              />
              <p className="text-[16px] leading-relaxed text-pure-white/90">
                {line}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[16px] leading-relaxed text-muted-zinc">
          {EMPTY_DOSSIER_LINE}
        </p>
      )}

      <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-muted-zinc/80">
        Written from the numbers on this page.
      </p>
    </section>
  );
}
