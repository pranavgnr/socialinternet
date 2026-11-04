import Link from "next/link";

const LINK =
  "inline-flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-white/10 bg-obsidian/40 px-3 text-[14px] text-pure-white transition hover:border-limelight/40 hover:text-limelight";

/**
 * The owner's shortcuts to the two pages kept from the old interface.
 *
 * They are only on the owner's own profile, so a visitor looking at someone
 * else's audit never sees another person's tools. `/ideas` and `/weekly` are
 * still full pages; they simply no longer have a nav of their own.
 */
export default function YourToolsCard() {
  return (
    <section aria-labelledby="your-tools-title" className="card p-4 sm:p-5">
      <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-limelight">
        Your tools
      </p>
      <h2
        id="your-tools-title"
        className="mt-1.5 text-[17px] font-semibold tracking-[-0.01em] text-pure-white"
      >
        Kept from the old studio
      </h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Link href="/ideas" className={LINK}>
          <span>This week&rsquo;s ideas</span>
          <span aria-hidden="true" className="text-muted-zinc">
            &rarr;
          </span>
        </Link>
        <Link href="/weekly" className={LINK}>
          <span>Weekly digest</span>
          <span aria-hidden="true" className="text-muted-zinc">
            &rarr;
          </span>
        </Link>
        <Link href="/?new=1" className={LINK}>
          <span>Check another handle</span>
          <span aria-hidden="true" className="text-muted-zinc">
            &rarr;
          </span>
        </Link>
      </div>
    </section>
  );
}
