import { ageLabel } from "@/lib/nicheDossier";

function Count({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div>
      <dt className="mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
        {label}
      </dt>
      <dd className="mono mt-1.5 text-[24px] font-bold leading-none text-limelight sm:text-[28px]">
        {value}
      </dd>
    </div>
  );
}

/**
 * The dossier masthead: what this page is, which room it is about, and the
 * three counts the rest of the page is built from.
 *
 * The age line comes from the stored file, not the clock at render time: a room
 * outside its refresh window is still free to read, it just says how old the
 * read is instead of pretending to be current.
 */
export default function NicheHeader({
  query,
  counts,
  ageHours,
  stale,
}: {
  query: string;
  counts: { reels: number; accounts: number; breakouts: number };
  ageHours: number;
  stale: boolean;
}) {
  return (
    <header className="relative overflow-hidden border-b border-white/10 pb-7 pt-4 sm:pb-9">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-limelight/70 to-transparent"
      />
      <p className="mono text-[9.5px] font-bold uppercase tracking-[0.2em] text-limelight">
        Niche Intelligence Dossier
      </p>

      <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-[30px] font-extrabold leading-[1.03] tracking-[-0.04em] text-pure-white [overflow-wrap:anywhere] sm:text-[44px]">
            {query}
          </h1>
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted-zinc">
            Reels in this room, ranked by views per follower.{" "}
            <span className="mono text-[11px] text-muted-zinc">
              {stale ? "As of" : "Read"} {ageLabel(ageHours)}
            </span>{" "}
            · free to open
          </p>
        </div>

        <dl className="grid shrink-0 grid-cols-3 gap-x-6 gap-y-2 sm:gap-x-8">
          <Count label="Reels read" value={counts.reels} />
          <Count label="Accounts" value={counts.accounts} />
          <Count label="Breakouts" value={counts.breakouts} />
        </dl>
      </div>
    </header>
  );
}
