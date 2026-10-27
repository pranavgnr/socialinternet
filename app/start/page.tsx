import StartFlow from "@/components/StartFlow";

export const metadata = {
  title: "Where could you win? — Creators 101",
  description:
    "No handle needed. Say what you know, and see which spaces a newcomer can realistically break out in — and why.",
};

/**
 * The entry point for someone with no handle yet.
 *
 * Nothing server-rendered here: every number on this page comes from a paid
 * pull, so it must never be rendered on a page load. The work starts when the
 * creator presses the button.
 */
export default function StartPage() {
  return (
    <div className="space-y-7">
      <section className="pt-4">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
          Start here
        </p>
        <h1 className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-tight sm:text-[34px]">
          Where could you actually win?
        </h1>
        <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted">
          Most niche advice is a list of big spaces. This ranks the opposite way:
          it looks for rooms where small accounts are the ones breaking out, so
          the ranking answers &ldquo;can someone starting from nothing do this&rdquo;
          rather than &ldquo;is this popular&rdquo;.
        </p>
      </section>

      <StartFlow />

      <section className="border-t border-line/70 pt-4">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
          How the ranking works
        </h2>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted/80">
          <li>
            <span className="text-text">Headroom (30%)</span> — how often the
            accounts breaking out are small ones. This is the signal that matters
            most, because it is the one that transfers to you.
          </li>
          <li>
            <span className="text-text">Demand (28%)</span> — the views a typical
            reel in the room gets. A big audience you cannot reach is worth
            nothing.
          </li>
          <li>
            <span className="text-text">Openness (16%)</span> — how many different
            accounts get to win, and whether one account takes most of the room.
          </li>
          <li>
            <span className="text-text">Money (16%)</span> — how readily attention
            in that space turns into income.
          </li>
          <li>
            <span className="text-text">Freshness (10%)</span> — whether the
            winners are recent, or a graveyard of old hits.
          </li>
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-muted/60">
          Ratios are measured against each account&rsquo;s own median, not against
          the room, so an account that was already large cannot look like a
          breakout just by being large.
        </p>
      </section>
    </div>
  );
}
