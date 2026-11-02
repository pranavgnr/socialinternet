import Link from "next/link";
import { connection } from "next/server";

import NicheSearch from "@/components/NicheSearch";
import { hoursFromEnv } from "@/lib/env";
import {
  cachedNiches,
  nicheCacheStatus,
  nicheView,
  researchFromCache,
  type NicheView,
} from "@/lib/niche";

export const instant = false;

export const metadata = {
  title: "What's working in a niche — Creators 101",
  description:
    "Type a space and see the posts breaking out there, the view count a reel has to beat, and the accounts worth studying. No handle needed.",
};

function age(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await connection();

  const { q } = await searchParams;
  const query = (q ?? "").trim();

  /**
   * The copy below states the cache rule, so it reads the same setting the
   * server applies rather than a second hard-coded number that can drift.
   */
  const nicheTtlHours = hoursFromEnv("NICHE_CACHE_HOURS", 12);

  // Payloads are only read when a phrase was asked for; without one this page
  // only needs the list of rooms already looked at.
  const [niches, status] = await Promise.all([
    cachedNiches({ withPayload: Boolean(query) }),
    query ? nicheCacheStatus(query) : Promise.resolve(null),
  ]);

  /**
   * A room that is already on disk is rebuilt here, on the server, and shown
   * without a request that could spend or ask anyone to sign in. This is the
   * path a trending bubble follows: the ranking is old enough to be "stale" by
   * the pull TTL, but the pull itself is already paid for, so reading it is
   * still free. Staleness is the cron's concern, not the visitor's.
   *
   * A phrase that is not on disk keeps the normal client search, which is where
   * a fresh pull (and therefore sign-in and credits) is decided.
   */
  const onDisk = query ? niches.find((n) => n.slug === status?.slug) : undefined;
  let initialView: NicheView | null = null;
  if (onDisk?.payload?.length) {
    try {
      initialView = nicheView(
        researchFromCache(onDisk.query, onDisk.payload, {
          fetchedAt: onDisk.fetchedAt,
        }),
      );
    } catch {
      // An unreadable cache file falls through to the normal search rather
      // than taking the page down.
      initialView = null;
    }
  }

  const autoRun = Boolean(status?.cached) && !initialView;

  return (
    <div className="space-y-7">
      <section className="pt-4">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
          Explore
        </p>
        <h1 className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-tight sm:text-[34px]">
          What&rsquo;s working in a niche
        </h1>
        <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted">
          No handle needed. Type a space and see the reels breaking out there, the
          view count yours has to beat, and the accounts worth studying — before
          you commit to anything.
        </p>
      </section>

      <NicheSearch
        key={query || "discover"}
        initialQuery={query || undefined}
        autoRun={autoRun}
        initialView={initialView}
      />

      {niches.length ? (
        <section className="border-t border-line/70 pt-5">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
            Already looked at
          </h2>
          <ul className="mt-2 divide-y divide-line/70">
            {niches.map((n) => (
              <li key={n.slug}>
                <Link
                  href={`/discover?q=${encodeURIComponent(n.query)}`}
                  className="flex items-baseline justify-between gap-3 py-2.5 transition hover:text-accent"
                >
                  <span className="min-w-0 truncate text-[13.5px] capitalize">
                    {n.query}
                  </span>
                  <span className="mono shrink-0 text-[11px] text-muted">
                    {/**
                     * "checked", not "reels": this count is the whole pull,
                     * before the language and subject gates. Calling it reels
                     * would promise a room size the page does not have without
                     * rebuilding it, and this list is built from stored files
                     * on purpose — it must stay free.
                     */}
                    {n.reels} checked · {age(n.ageHours)}
                    {n.stale ? " · re-pull" : " · free"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted/60">
            Reopening one of these costs nothing. A phrase that has not been read
            in the last {nicheTtlHours} hour{nicheTtlHours === 1 ? "" : "s"} is
            pulled fresh.
          </p>
        </section>
      ) : null}
    </div>
  );
}
