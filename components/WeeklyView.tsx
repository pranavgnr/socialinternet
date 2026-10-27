import Link from "next/link";

import { compact, times } from "@/lib/fmt";
import { platformName, profileUrl } from "@/lib/platform";
import { titleCase } from "@/lib/plain";
import type { WeeklyDigest } from "@/lib/weekly";

const LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted";

/** "2026-10-26" → "Mon 26 Oct". The week a creator is being asked to work in. */
function weekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[19px] font-semibold leading-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{label}</div>
    </div>
  );
}

/**
 * This week's answer, and what makes it different from last week's.
 *
 * The order is the order a creator acts in: where they stand, what moved, then
 * the moves and the posts. Every number here was measured when the digest was
 * built — nothing on this page is computed at render time, so a page view never
 * costs a credit and never disagrees with the record it came from.
 */
export default function WeeklyView({
  digest,
  history = [],
  stale = false,
  children,
}: {
  digest: WeeklyDigest;
  history?: WeeklyDigest[];
  /** the digest is from an earlier week: readable, but not this week's answer */
  stale?: boolean;
  children?: React.ReactNode;
}) {
  const { standing } = digest;
  const earlier = history.filter((d) => d.weekOf !== digest.weekOf);
  const network = platformName(digest.platform);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-[19px] font-semibold tracking-tight">
            {digest.handle ? `@${digest.handle}` : "Your week"}
            <span className="ml-2 text-[13px] font-normal text-muted">{network}</span>
          </h1>
          <a
            href={profileUrl(digest.handle, digest.platform)}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-muted underline decoration-line underline-offset-2 hover:text-text"
          >
            Open profile
          </a>
        </div>

        <p className="text-[13px] leading-relaxed text-muted">
          {stale ? (
            <>
              This is the week of <span className="text-text">{weekLabel(digest.weekOf)}</span>.
              Nothing has been pulled since — the numbers below are that week's.
            </>
          ) : (
            <>
              The week of <span className="text-text">{weekLabel(digest.weekOf)}</span>. What moved,
              what to post, and nothing else.
            </>
          )}
        </p>

        <div className="grid grid-cols-3 gap-3 rounded-xl border border-line bg-panel px-4 py-3.5">
          <Figure value={compact(standing.medianViews)} label="your typical reel" />
          <Figure value={compact(standing.bestViews)} label="your best reel" />
          <Figure
            value={standing.vsNiche ? times(standing.vsNiche) : "—"}
            label={
              standing.nicheMedianViews
                ? `vs ${compact(standing.nicheMedianViews)} typical`
                : "no yardstick yet"
            }
          />
        </div>
      </header>

      {/* What changed — the whole reason a weekly record exists. */}
      <section className="rounded-xl border border-line bg-panel px-4 py-4">
        <h2 className={LABEL}>What changed</h2>
        {digest.changes.length ? (
          <ul className="mt-2.5 space-y-2">
            {digest.changes.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            Nothing to compare against yet — this is the first week recorded. Next Monday this
            section tells you what actually moved, in numbers.
          </p>
        )}
      </section>

      {/* The moves, in the order they should be done. */}
      {digest.moves.length ? (
        <section className="space-y-2.5">
          <h2 className={LABEL}>Do these, in this order</h2>
          <ol className="space-y-2.5">
            {digest.moves.map((m, i) => (
              <li key={i} className="rounded-xl border border-line bg-panel px-4 py-3.5">
                <div className="flex gap-3">
                  <span className="mt-0.5 text-[12px] font-semibold tabular-nums text-accent">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-medium leading-snug">{titleCase(m.title)}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{m.action}</p>
                    {m.why ? (
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted/80">{m.why}</p>
                    ) : null}
                    {m.receipts > 0 ? (
                      <p className="mt-2 text-[11.5px] text-muted/60">
                        {m.receipts === 1 ? "1 post behind this" : `${m.receipts} posts behind this`}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* The posts themselves, with the line to open on. */}
      {digest.ideas.length ? (
        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={LABEL}>This week's posts</h2>
            <Link
              href="/ideas"
              className="text-[12px] text-muted underline decoration-line underline-offset-2 hover:text-text"
            >
              All of them
            </Link>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {digest.ideas.map((idea) => (
              <li key={idea.id}>
                <Link href={`/ideas#${idea.id}`} className="block px-4 py-3 transition hover:bg-panel2">
                  <div className="text-[13.5px] font-medium leading-snug">{titleCase(idea.title)}</div>
                  {idea.hook ? (
                    <div className="mt-1 text-[12.5px] leading-relaxed text-muted">
                      Open with: “{idea.hook}”
                    </div>
                  ) : null}
                  {idea.format ? (
                    <div className="mt-1 text-[11.5px] text-muted/60">{idea.format}</div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Earlier weeks — the compounding record, not a duplicate of this one. */}
      {earlier.length ? (
        <section className="space-y-2">
          <h2 className={LABEL}>Weeks before this</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel/60">
            {earlier.slice(0, 6).map((d) => (
              <li key={d.weekOf} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="shrink-0 text-[12.5px] text-muted">{weekLabel(d.weekOf)}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted/80">
                  {d.changes[0] ?? "first week recorded"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {digest.cached ? (
        <p className="text-[11.5px] leading-relaxed text-muted/60">
          Served from a recent pull — no credits spent on this digest.
        </p>
      ) : null}

      {children}
    </div>
  );
}
