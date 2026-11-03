import Link from "next/link";

import Faq from "./Faq";
import Gems from "./Gems";
import HandleAudit from "./HandleAudit";
import HeroTicker from "./HeroTicker";
import Pillars from "./Pillars";
import Vault from "./Vault";
import { plain } from "@/lib/plain";
import { listTrending } from "@/lib/trending";

const EXAMPLE_METRICS = [
  { label: "Followers", value: "48.2K" },
  { label: "Average views", value: "12.4K" },
  { label: "Comment share", value: "0.8%" },
  { label: "Estimated bot share", value: "29%" },
];

/**
 * The public front door.
 *
 * A server component: trending niches are read once on the server and the
 * signed-in flag is handed down from the page that already resolved it. The
 * interactive pieces (ticker, audit box, vault) are client components at the
 * leaves, so the page still renders when the database is unreachable —
 * `listTrending` falls back to disk and zero niches simply removes the
 * bubbles.
 */
export default async function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const niches = await listTrending();

  return (
    <div className="pb-4">
      <section className="relative pb-16 pt-8 sm:pb-24 sm:pt-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-0 h-[420px] w-[420px] rounded-full bg-limelight/[0.045] blur-3xl"
        />

        <HeroTicker />

        <h1 className="mt-7 max-w-5xl text-[40px] font-extrabold uppercase leading-[0.94] tracking-[-0.045em] text-pure-white sm:text-[64px] lg:text-[82px]">
          THE OPERATING SYSTEM FOR ELITE INSTAGRAM CREATORS.
        </h1>

        <p className="mt-6 max-w-3xl text-[15px] leading-relaxed text-muted-zinc sm:text-[16.5px]">
          Precision algorithmic diagnostics, automated comment intelligence, and
          instant access to private lifestyle perks, private dining, and boutique
          resort privileges based on your true audience value.
        </p>
        <p className="mono mt-3 text-[10px] uppercase tracking-[0.14em] text-luxury-gold">
          Lifestyle privileges are planned for the wave-2 vault.
        </p>

        <HandleAudit signedIn={signedIn} />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center lg:pr-64">
          <Link
            href="#vault"
            className="group inline-flex min-h-[54px] flex-1 items-center justify-between gap-4 rounded-xl bg-pure-white px-5 text-[13px] font-bold uppercase tracking-[0.02em] text-obsidian transition hover:bg-limelight"
          >
            <span>
              Create a free account to join the VIP waitlist &amp; unlock full
              access
            </span>
            <span
              aria-hidden="true"
              className="text-[18px] transition group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
          <p className="flex items-center gap-2 text-[11.5px] text-muted-zinc">
            <Gems value={15} />
            <span>daily free gems · no card</span>
          </p>
        </div>
      </section>

      <Pillars />

      <Vault />

      {/* An example, never a testimonial: every number here is a placeholder. */}
      <section aria-labelledby="example-title" className="py-14 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-14">
          <div>
            <p className="mono text-[10px] font-bold uppercase tracking-[0.2em] text-luxury-gold">
              No testimonials, just the shape
            </p>
            <h2
              id="example-title"
              className="mt-3 text-[32px] font-semibold leading-[1.02] tracking-[-0.035em] text-pure-white sm:text-[42px]"
            >
              What an audit looks like.
            </h2>
            <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-muted-zinc">
              We do not publish invented creator quotes. This is a labelled
              example of the result shape — run the box above for numbers that
              were actually read from an account.
            </p>
          </div>

          <article className="card relative overflow-hidden p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="mono rounded-full border border-luxury-gold/35 bg-luxury-gold/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-luxury-gold">
                Example
              </span>
              <span className="mono rounded-full border border-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
                Example data
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[20px] font-semibold tracking-tight text-pure-white">
                @example
              </h3>
              <p className="mono text-[10px] uppercase tracking-[0.12em] text-muted-zinc">
                Illustrative audit
              </p>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10">
              {EXAMPLE_METRICS.map((metric) => (
                <div key={metric.label} className="bg-card p-4">
                  <dt className="text-[10.5px] leading-tight text-muted-zinc">
                    {metric.label}
                  </dt>
                  <dd className="mono mt-1.5 text-[24px] font-bold leading-none text-pure-white">
                    {metric.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 rounded-xl border border-limelight/20 bg-limelight/[0.04] p-4">
              <p className="mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-limelight">
                Example diagnosis
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-zinc">
                Hooks land after the third second, and comment requests repeat
                the same three questions. The next three Reels answer those
                questions in the first line.
              </p>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-muted-zinc/70">
              Placeholder figures. Not a real creator and not a promise of
              results.
            </p>
          </article>
        </div>
      </section>

      {niches.length ? (
        <section aria-labelledby="trending-title" className="pb-14 sm:pb-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mono text-[10px] font-bold uppercase tracking-[0.2em] text-limelight">
                Live from the cache
              </p>
              <h2
                id="trending-title"
                className="mt-3 text-[30px] font-semibold leading-[1.02] tracking-[-0.035em] text-pure-white sm:text-[40px]"
              >
                What&rsquo;s working right now
              </h2>
            </div>
            <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-zinc">
              Niches already read, ranked by opportunity. Open one free — no
              sign-in.
            </p>
          </div>

          <ul className="mt-6 flex flex-wrap gap-2.5">
            {niches.slice(0, 18).map((niche) => (
              <li key={niche.slug}>
                <Link
                  href={`/search/niche/${encodeURIComponent(niche.query)}`}
                  prefetch={false}
                  className="group inline-flex min-h-[38px] items-center gap-2 rounded-full border border-white/10 bg-card px-4 text-[12.5px] text-pure-white transition hover:border-limelight/50 hover:text-limelight"
                >
                  <span className="truncate">{plain(niche.label)}</span>
                  <span
                    aria-hidden="true"
                    className="text-[11px] text-muted-zinc transition group-hover:text-limelight"
                  >
                    ↗
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Faq />

      <footer className="border-t border-white/10 py-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="inline-flex items-baseline gap-1">
              <span className="text-[18px] font-extrabold uppercase leading-none tracking-[-0.055em] text-pure-white">
                Shambles
              </span>
              <span
                className="mb-0.5 h-1.5 w-1.5 rounded-full bg-limelight shadow-[0_0_10px_rgba(204,255,0,0.85)]"
                aria-hidden="true"
              />
            </p>
            <p className="mt-2 text-[11.5px] text-muted-zinc">
              The operating system for elite Instagram creators.
            </p>
          </div>
          <Link
            href="#vault"
            className="inline-flex min-h-[38px] w-fit items-center gap-2 rounded-full bg-luxury-gold px-4 text-[10px] font-bold uppercase tracking-[0.12em] text-obsidian transition hover:bg-luxury-gold/85"
          >
            Join the VIP waitlist
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
