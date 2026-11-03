import Link from "next/link";

import { plain } from "@/lib/plain";
import type { TrendingNiche } from "@/lib/trending";

/**
 * The rooms worth opening right now.
 *
 * Every bubble is a cached niche, so the link is free to follow and works
 * without an account. The ranking already happened in `lib/trending.ts`; this
 * component only presents it. With no niches (a failed cron, an empty cache)
 * it renders nothing at all rather than an empty heading or a broken shell.
 */
export default function NicheBubbles({ niches }: { niches: TrendingNiche[] }) {
  if (!niches.length) return null;

  return (
    <section className="border-t border-line/70 pt-5">
      <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
        What&rsquo;s working right now
      </h2>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted/70">
        Rooms where small accounts are breaking out. Open one free — no sign-in.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {niches.map((niche) => (
          <li key={niche.slug}>
            <Link
              href={`/discover?q=${encodeURIComponent(niche.query)}`}
              className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-panel px-3 text-[12.5px] text-text transition hover:border-accent/50 hover:text-accent"
            >
              {plain(niche.label)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
