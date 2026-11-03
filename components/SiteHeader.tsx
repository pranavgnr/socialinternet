import { Suspense } from "react";
import Link from "next/link";

import Gems from "./Gems";
import OmniSearch from "./OmniSearch";
import SignInButton from "./SignInButton";
import { currentUser, type SessionUser } from "@/lib/auth";
import { balance } from "@/lib/credits";

const PILL =
  "inline-flex min-h-[32px] items-center rounded-full border border-white/10 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-pure-white transition";

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function AccountSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 min-w-[92px] items-center rounded-full border border-white/10 bg-white/[0.04]"
    />
  );
}

/**
 * The half of the header that depends on who is asking. The static shell keeps
 * its shape; this streams in behind Suspense. A database outage must not take
 * the header (or the page under it) down, so both reads fall back to null.
 */
async function HeaderAccount() {
  const user = await currentUser().catch(() => null);
  const credits = user ? await balance(user.id).catch(() => null) : null;
  return <AccountArea user={user} credits={credits} />;
}

function AccountArea({
  user,
  credits,
}: {
  user: SessionUser | null;
  credits: number | null;
}) {
  if (!user) {
    return (
      <SignInButton
        label="SIGN IN"
        className={`${PILL} hover:border-white/25 hover:bg-white/5`}
      />
    );
  }

  const name = user.name?.trim() || user.email || "Account";
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <div role="group" aria-label="Your account" className="flex items-center gap-2">
      {credits !== null ? (
        <Gems
          value={credits}
          className="min-h-[32px] rounded-full border border-white/10 bg-card px-2.5 text-[11px] text-pure-white"
        />
      ) : (
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted-zinc">
          Signed in
        </span>
      )}
      <span
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-card text-[11px] font-semibold text-limelight"
        title={`Signed in as ${name}`}
        role="img"
        aria-label={`Signed in as ${name}`}
      >
        {initial}
      </span>
    </div>
  );
}

/**
 * The brand shell. Public and static on purpose: the only runtime read is the
 * account, and it lives behind Suspense. The search bar drops under the
 * wordmark row on narrow screens and sits between the wordmark and the VIP
 * controls from `sm` up.
 */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-obsidian/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
        <Link
          href="/"
          aria-label="Shambles home"
          className="inline-flex shrink-0 items-baseline gap-1"
        >
          <span className="text-[17px] font-extrabold uppercase leading-none tracking-[-0.055em] text-pure-white">
            SHAMBLES
          </span>
          <span
            className="mb-0.5 h-1.5 w-1.5 rounded-full bg-limelight shadow-[0_0_10px_rgba(204,255,0,0.85)]"
            aria-hidden="true"
          />
        </Link>

        <div className="order-last w-full min-w-0 sm:order-none sm:flex-1">
          <OmniSearch />
        </div>

        <nav
          aria-label="Account and VIP"
          className="ml-auto flex shrink-0 items-center gap-2"
        >
          <Link
            href="/#vault"
            aria-label="IG Wrapped — join the waitlist"
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-luxury-gold/35 bg-luxury-gold/10 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-luxury-gold transition hover:border-luxury-gold/60 hover:bg-luxury-gold/15"
          >
            <LockIcon />
            <span>IG WRAPPED</span>
          </Link>

          <Suspense fallback={<AccountSkeleton />}>
            <HeaderAccount />
          </Suspense>

          <Link
            href="/#vault"
            className="inline-flex min-h-[32px] items-center rounded-full bg-luxury-gold px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-obsidian transition hover:bg-luxury-gold/85"
          >
            JOIN VIP
          </Link>
        </nav>
      </div>
    </header>
  );
}
