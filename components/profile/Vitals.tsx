import { compact } from "@/lib/fmt";
import type { ProfileView } from "@/lib/profileView";
import StatSlab from "./StatSlab";

function share(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "Unavailable";
  const pct = fraction * 100;
  if (pct <= 0) return "0.0%";
  if (pct < 0.05) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

function reelCount(n: number): string {
  return `${n} recent ${n === 1 ? "reel" : "reels"}`;
}

/**
 * 01 — Vitals & authenticity.
 *
 * Four slabs. Every figure is one the plan actually holds; where it does not,
 * the slab says what is missing instead of printing a zero or a guess. The
 * bot-to-real slab is an estimate from a sampled follower list: it says how many
 * followers were inspected and how confident the sample makes it, so it can
 * never be mistaken for a measured percentage.
 */
export default function Vitals({ view }: { view: ProfileView }) {
  const { vitals } = view;
  const bot = vitals.botToReal;

  return (
    <section aria-labelledby="vitals-title" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-limelight">
            Section 01
          </p>
          <h2
            id="vitals-title"
            className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-pure-white sm:text-[30px]"
          >
            01 // VITALS &amp; AUTHENTICITY
          </h2>
        </div>
        <p className="mono text-[11px] uppercase tracking-[0.1em] text-muted-zinc">
          {vitals.reelsRead > 0 ? reelCount(vitals.reelsRead) : "No reels read"}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatSlab
          label="Followers"
          value={
            typeof vitals.followers === "number"
              ? compact(vitals.followers)
              : "Not read"
          }
          detail={
            typeof vitals.followers === "number"
              ? "From the public profile."
              : "The profile was not read, so there is no follower count."
          }
        />

        <StatSlab
          label="Bot-to-real ratio"
          tag="Estimate"
          locked={!bot}
          value={bot ? `${bot.realPct}%` : "Estimate coming"}
          detail={
            bot
              ? `Estimated from a sample of ${bot.sample} followers · ${bot.confidence} confidence. A sample of the audience, not all of it.`
              : "Built from a sampled follower list in a later release. No percentage is shown until it is measured."
          }
        />

        <StatSlab
          label="Likes ratio"
          value={share(vitals.likesRatio)}
          detail={
            vitals.likesRatio === null
              ? "Likes were not reported for the reels read."
              : `${compact(vitals.avgLikes ?? 0)} average likes per reel, from ${reelCount(
                  vitals.reelsRead,
                )}.`
          }
        />

        <StatSlab
          label="Comments ratio"
          value={share(vitals.commentRatio)}
          detail={
            vitals.commentRatio === null
              ? "Comments were not reported for the reels read."
              : `${compact(vitals.avgComments ?? 0)} average comments per reel, from ${reelCount(
                  vitals.reelsRead,
                )}.`
          }
        />
      </div>

      {view.comparison ? (
        <p className="mono mt-3 rounded-lg border border-white/10 bg-card/60 px-3 py-2 text-[11px] leading-relaxed text-muted-zinc">
          {view.comparison}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-zinc/70">
        A likes ratio is likes divided by views; a comments ratio is comments
        divided by views. Both are taken only from the reels actually read.
      </p>
    </section>
  );
}
