import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline — Shambles",
  description: "Shambles needs a connection for live reads.",
  robots: { index: false, follow: false },
};

/**
 * The service worker's fallback shell. Everything live — audits, niche reads,
 * Koko replies — needs the network; this page says so plainly and offers one
 * retry, without pretending cached creator data is current.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl flex-col justify-center py-10">
      <p className="mono text-[11px] font-bold uppercase tracking-[0.2em] text-limelight">
        <span aria-hidden="true">●</span> No connection
      </p>
      <h1 className="mt-4 text-[36px] font-extrabold leading-[0.98] tracking-[-0.04em] text-pure-white sm:text-[52px]">
        You&rsquo;re offline.
      </h1>
      <p className="mt-5 max-w-md text-[16px] leading-relaxed text-muted-zinc">
        Shambles reads Instagram live, so audits, niche intel and Koko&rsquo;s
        replies all need a connection. Nothing here is served stale or
        pretending to be current.
      </p>

      <div className="card mt-8 p-5">
        <p className="mono text-[11px] font-bold uppercase tracking-[0.14em] text-luxury-gold">
          Still available
        </p>
        <p className="mt-2 text-[16px] leading-relaxed text-muted-zinc">
          This page, the app shell and any screen you already loaded. Cached
          creator reads are never shown as fresh.
        </p>
      </div>

      <Link
        href="/"
        className="mt-6 inline-flex min-h-[52px] w-fit items-center justify-center rounded-xl bg-limelight px-6 text-[11px] font-bold uppercase tracking-[0.12em] text-obsidian transition hover:bg-limelight/85"
      >
        Try again
      </Link>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-zinc/70">
        If you are on a phone, check mobile data or Wi-Fi, then tap retry.
      </p>
    </div>
  );
}
