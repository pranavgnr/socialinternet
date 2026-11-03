import Link from "next/link";

function GoldLock() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * The profile masthead: avatar, handle, niche provenance and the two locked
 * actions. Both actions open the waitlist; neither pretends to be shipped.
 *
 * There is no avatar in the public payload, so the monogram is explicitly
 * labelled as a placeholder rather than pretending to be the creator's photo.
 */
export default function ProfileHeader({
  handle,
  niche,
  nicheVerified = false,
}: {
  handle: string;
  niche?: string;
  nicheVerified?: boolean;
}) {
  const initial =
    (handle.replace(/^[^a-z0-9]+/i, "").slice(0, 1) || handle.slice(0, 1) || "?").toUpperCase();
  const badge = niche
    ? `${nicheVerified ? "VERIFIED NICHE" : "NICHE"}: ${niche}`
    : null;

  return (
    <header className="relative border-b border-white/10 pb-7 pt-4 sm:pb-9">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            role="img"
            aria-label={`${handle} avatar placeholder`}
            className="mono flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-limelight/30 bg-[radial-gradient(circle_at_30%_25%,rgba(204,255,0,0.18),rgba(19,19,24,0.95))] text-[26px] font-bold text-limelight sm:h-20 sm:w-20 sm:text-[32px]"
          >
            {initial}
          </span>

          <div className="min-w-0">
            <h1 className="break-words text-[30px] font-extrabold leading-[1.02] tracking-[-0.04em] text-pure-white [overflow-wrap:anywhere] sm:text-[44px]">
              @{handle}
            </h1>
            {badge ? (
              <p className="mono mt-3 inline-flex max-w-full min-h-[26px] flex-wrap items-center rounded-full border border-white/10 bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-limelight">
                {badge}
              </p>
            ) : (
              <p className="mono mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-zinc">
                Not read yet
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <Link
            href="/#vault"
            aria-label="IG Wrapped is locked — join the waitlist"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-luxury-gold/35 bg-luxury-gold/10 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-luxury-gold transition hover:border-luxury-gold/60 hover:bg-luxury-gold/15"
          >
            <GoldLock />
            <span>IG WRAPPED</span>
          </Link>
          <Link
            href="/#vault"
            aria-label="See my verified rate card — locked, join the waitlist"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-luxury-gold/35 bg-luxury-gold/10 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-luxury-gold transition hover:border-luxury-gold/60 hover:bg-luxury-gold/15"
          >
            <GoldLock />
            <span>SEE MY VERIFIED RATE CARD</span>
            <span className="font-semibold normal-case tracking-normal text-luxury-gold/70">
              (Waitlist locked)
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
