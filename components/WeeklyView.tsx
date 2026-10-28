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

      {/* A week built only on your own posts says so before it says anything else. */}
      {digest.stale ? (
        <section
          className="rounded-xl border border-warn/40 bg-warn/5 px-4 py-3.5"
          aria-live="polite"
        >
          <h2 className={LABEL}>This week has no cohort behind it</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{digest.stale}</p>
        </section>
      ) : null}

      {/* The moves, in the order they should be done. */}
      {digest.moves.length ? (
        <section className="space-y-2.5">
          <h2 className={LABEL}>
            {digest.movesBasis === "cohort" ? "Do these, in this order" : "What your own numbers say"}
          </h2>
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
                    {/* Who this was measured on — the name, not a count of posts. */}
                    {m.from?.length ? (
                      <ul className="mt-2 space-y-1">
                        {m.from.map((e) => (
                          <li key={e.handle} className="flex items-baseline gap-1.5 text-[11.5px]">
                            <a
                              href={profileUrl(e.handle, digest.platform)}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 font-medium text-accent underline decoration-line underline-offset-2"
                            >
                              @{e.handle}
                            </a>
                            <span className="truncate text-muted/80">{e.metric}</span>
                          </li>
                        ))}
                      </ul>
                    ) : m.receipts > 0 ? (
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

      {/* Who the moves were measured against — the part a creator cannot see. */}
      {digest.peers?.length ? (
        <section className="space-y-2.5">
          <h2 className={LABEL}>What accounts your size are doing</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {digest.peers.map((p) => (
              <li key={p.handle} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  {/* The handle opens the account; the post is the receipt, second. */}
                  <a
                    href={profileUrl(p.handle, digest.platform)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-[13.5px] font-medium underline decoration-line underline-offset-2 hover:text-accent"
                  >
                    @{p.handle}
                  </a>
                  <span className="shrink-0 text-right text-[12px] tabular-nums text-muted">
                    {p.metric}
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 underline decoration-line underline-offset-2 hover:text-text"
                      >
                        post
                      </a>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* The audience in their own words — the one input nobody can invent. */}
      {digest.heard && (digest.heard.asks.length || digest.heard.language.length) ? (
        <section className="space-y-2.5">
          <div>
            <h2 className={LABEL}>What people asked for</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted/80">
              {digest.heard.read === 1
                ? "1 comment thread read"
                : `${digest.heard.read} comment threads read`}
              {digest.heard.language.length
                ? ` · they say: ${digest.heard.language.slice(0, 4).join(", ")}`
                : ""}
            </p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {digest.heard.asks.map((a, i) => (
              <li key={`${a.text}-${i}`} className="px-4 py-3">
                <p className="text-[13px] leading-relaxed">“{a.text}”</p>
                <p className="mt-1 text-[11.5px] text-muted/60">
                  {a.kind === "request"
                    ? "asked for"
                    : a.kind === "question"
                      ? "asked"
                      : a.kind === "objection"
                        ? "pushed back on"
                        : "told a story about"}
                  {a.asked > 1 ? ` · ${a.asked} times` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        /**
         * Silence read as "the feature was deleted". It was not: the comments
         * were never fetched for this account, and hiding the section hid the
         * reason too.
         */
        <section className="space-y-2.5">
          <div>
            <h2 className={LABEL}>What people asked for</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted/80">
              We did not read the comments under this account&rsquo;s posts — the pull came
              back without them. Refresh this week to try again.
            </p>
          </div>
        </section>
      )}

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
                  {/* Where the post came from. Without it the list reads as the
                      creator's own subjects dressed up as next week's work. */}
                  {idea.from ? (
                    <div className="mt-1 text-[11.5px] text-muted/60">
                      {idea.from.own ? "your own post" : `from @${idea.from.handle}`}
                      {idea.from.ratio
                        ? ` · ${times(idea.from.ratio)} its usual views`
                        : ""}
                      {idea.from.url && !idea.from.own ? (
                        <a
                          href={idea.from.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1.5 underline decoration-line underline-offset-2 hover:text-text"
                        >
                          post
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          {/* A week of self-sourced posts is still a week, but it is a mirror,
              and the creator has to be told which one they are reading. */}
          {digest.ideasBasis === "own" ? (
            <p className="text-[12px] leading-relaxed text-muted/70">
              Every post here is learned from your own winners — no other account in your
              comparison produced one this week. Refresh to read the cohort again.
            </p>
          ) : null}
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
