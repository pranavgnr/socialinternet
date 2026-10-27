import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";

import { currentAccount } from "@/lib/session";

export const metadata: Metadata = {
  title: "Creators 101 — know what to post next",
  description:
    "Put in your Instagram handle. Get the posts worth making this month, built from what is actually working for accounts your size in your space — every one linked to the post that proves it.",
  openGraph: {
    title: "Creators 101 — know what to post next",
    description:
      "A plan for your next 30 posts, built from what is actually working in your space.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  width: "device-width",
  initialScale: 1,
};

/**
 * The links. Split out from the cookie read so the shell can render before the
 * account is known.
 */
function NavLinks({ hasPlan }: { hasPlan: boolean }) {
  return (
    <nav className="flex items-center gap-1 text-[13px] text-muted">
      {/**
       * Start is for the creator with no handle yet — the first thing a new
       * visitor needs, and useless to someone who already has a plan, so it
       * leads the nav only until a plan exists.
       */}
      {!hasPlan ? (
        <Link
          href="/start"
          className="inline-flex min-h-[34px] items-center rounded-lg px-2 font-medium text-accent transition hover:text-text"
        >
          Start
        </Link>
      ) : null}
      <Link
        href="/discover"
        className="inline-flex min-h-[34px] items-center rounded-lg px-2 transition hover:text-text"
      >
        Explore
      </Link>
      {hasPlan ? (
        <>
          <Link
            href="/weekly"
            className="inline-flex min-h-[34px] items-center rounded-lg px-2 transition hover:text-text"
          >
            This week
          </Link>
          <Link
            href="/ideas"
            className="inline-flex min-h-[34px] items-center rounded-lg px-2 transition hover:text-text"
          >
            Your reels
          </Link>
          <Link
            href="/?new=1"
            className="inline-flex min-h-[34px] items-center rounded-lg px-2 transition hover:text-text"
            aria-label="Check a different handle"
          >
            <span className="hidden sm:inline">Check another handle</span>
            <span className="sm:hidden">Another</span>
          </Link>
        </>
      ) : null}
    </nav>
  );
}

/**
 * The half of the header that depends on who is asking.
 *
 * It reads the session cookie, which is runtime data: left inline in the root
 * layout it stopped every page in the app from prerendering. Behind Suspense the
 * shell ships immediately and the nav streams in, so a static page stays static.
 */
async function HeaderNav() {
  let hasPlan = false;
  try {
    const account = await currentAccount();
    hasPlan = Boolean(account ? await account.store.getPlan() : null);
  } catch {
    // No cookie store in some render contexts; a plain nav is fine.
  }
  return <NavLinks hasPlan={hasPlan} />;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-line/80 bg-bg/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-3.5">
            <Link
              href="/"
              className="inline-flex min-h-[34px] items-center text-[15px] font-semibold tracking-tight"
              aria-label="Creators 101"
            >
              Creators<span className="text-accent">101</span>
            </Link>

            {/**
             * Explore is public: what is working in a niche is worth seeing
             * before anyone hands over a handle, so it is never behind a plan.
             */}
            <Suspense fallback={<NavLinks hasPlan={false} />}>
              <HeaderNav />
            </Suspense>
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-5">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-2xl px-5 pb-10 pt-4">
          <p className="text-[11px] leading-relaxed text-muted/60">
            Reads public posts only. Nothing is posted for you. Not affiliated
            with Instagram.
          </p>
        </footer>
      </body>
    </html>
  );
}
