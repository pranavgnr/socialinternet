import type {
  RawReel,
  ScoredSignal,
  SoundStats,
  TrendPhase,
} from "./types";

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Age in days, or NaN when the post has no usable date.
 *
 * NaN rather than 0 is deliberate. `0` means "published right now" — the best
 * possible score on every freshness term — and returning it for a missing date
 * is how a vendor that omits timestamps (YouTube Shorts) ends up topping every
 * ranking. NaN propagates through the scoring maths visibly, and the call sites
 * below turn it into an explicit "not measurable" answer instead of a flattering
 * guess. Callers must handle NaN; do not "fix" one with `|| 0`.
 */
export function ageInDays(iso: string, now = Date.now()): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.NaN;
  return Math.max(0, (now - t) / 86_400_000);
}

/** Hours since posting, or null when the date is unknown (never a fake 1h). */
function hoursSince(iso: string, now = Date.now()): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(1, (now - t) / 3_600_000);
}

/**
 * The control group. Median (not mean) of the account's recent reels, because a
 * single whale would drag a mean up and hide every other outlier.
 */
export function accountBaseline(reels: RawReel[], account: string): number {
  const own = reels.filter((r) => r.account === account);
  // The source's own measured baseline (median of ~10 recent posts) beats
  // anything we can infer from the page we pulled, so prefer it when present.
  const measured = own
    .map((r) => r.baselineMedianViews ?? 0)
    .filter((v) => v > 0);
  if (measured.length) return median(measured);

  const views = own
    /**
     * Newest-first, with undated posts last. `+new Date("")` is NaN, and NaN in
     * a comparator returns NaN, which leaves the sort order implementation-
     * defined; a real number keeps undated rows at the end deterministically.
     */
    .sort((a, b) => (+new Date(b.postedAt) || 0) - (+new Date(a.postedAt) || 0))
    .slice(0, 20)
    .map((r) => r.views)
    .filter((v) => v > 0);

  // Fewer than three posts is not a history, and using them as the control
  // group would make every reel look average (ratio 1.0). Caller falls back to
  // the peer baseline instead.
  if (views.length < 3) return 0;
  return median(views);
}

function accountMedianVelocity(reels: RawReel[], account: string): number {
  const own = reels.filter((r) => r.account === account && r.views > 0);
  /**
   * Only dated posts can have a velocity. Including undated ones at the old
   * fake "one hour old" made the denominator meaningless: the account's own
   * typical velocity was inflated, so a genuinely ordinary reel on a dated post
   * looked like it was underperforming, and undated posts looked explosive
   * relative to it. Undated posts are excluded from the baseline; they are also
   * excluded from the comparison (see `scoreSignals`), so the two sides agree.
   */
  const vels = own
    .map((r) => {
      const h = hoursSince(r.postedAt);
      return h === null ? null : r.views / h;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return median(vels) || 1;
}

/**
 * Place a sound/format on the five-phase trend curve using the SLOPE of usage,
 * not the total count. A sound with 300k videos can already be dead.
 */
export function classifyPhase(s: SoundStats | undefined): {
  phase: TrendPhase;
  saturation: number;
} {
  if (!s) return { phase: "emergence", saturation: 0.25 };

  const slope = (s.reelsLast7d - s.reelsPrev7d) / Math.max(s.reelsPrev7d, 1);
  const volume30 = s.reelsLast7d * 4.3;
  const volumeScore = clamp(Math.log10(Math.max(1, volume30)) / Math.log10(5000));
  const saturation = clamp(
    0.5 * volumeScore + 0.3 * s.largeAuthorShare + 0.2 * s.brandShare,
  );

  let phase: TrendPhase;
  if (s.firstSeenDaysAgo <= 10 && s.uniqueAuthors <= 6) {
    phase = "emergence";
  } else if (slope > 0.6 && s.uniqueAuthors >= 4) {
    phase = "acceleration";
  } else if (slope > 0.15) {
    phase = "acceleration";
  } else if (slope < -0.3) {
    phase = "decay";
  } else if (s.reelsLast7d >= 400 && s.brandShare >= 0.12) {
    phase = "saturation";
  } else if (s.reelsLast7d >= 400) {
    phase = "peak";
  } else {
    phase = s.largeAuthorShare > 0.5 ? "saturation" : "peak";
  }

  // a sound can be "peaking" numerically while brand pile-on says it is done
  if (phase === "peak" && saturation > 0.75) phase = "saturation";

  return { phase, saturation };
}

/** Below this many strict outliers, a room is treated as quiet. */
const STRICT_ENOUGH = 6;

const PHASE_WEIGHT: Record<TrendPhase, number> = {
  emergence: 0.85,
  acceleration: 1,
  peak: 0.55,
  saturation: 0.2,
  decay: 0.05,
};

export function scoreSignals(
  reels: RawReel[],
  sounds: Record<string, SoundStats> = {},
  now = Date.now(),
): ScoredSignal[] {
  const baselines = new Map<string, number>();
  const velocities = new Map<string, number>();
  for (const r of reels) {
    if (!baselines.has(r.account)) {
      baselines.set(r.account, accountBaseline(reels, r.account));
      velocities.set(
        r.account,
        accountMedianVelocity(reels, r.account) || 1,
      );
    }
  }

  /**
   * Accounts we only met through a keyword search have one reel in the pool and
   * no measured baseline, so they cannot be judged against themselves. The peer
   * baseline — the median measured baseline of the benchmark accounts — is the
   * honest stand-in: "beats a typical reel in this niche" rather than "beats
   * this creator's own median". Kept as a separate basis so ranking can weigh
   * the weaker claim accordingly.
   */
  const measured = [...baselines.values()].filter((v) => v > 0);
  const peerBaseline = measured.length
    ? median(measured)
    : median(reels.map((r) => r.views).filter((v) => v > 0)) || 1;

  return reels
    .map((r) => {
      const own = baselines.get(r.account) ?? 0;
      const useOwn = own > 0;
      const baseline = useOwn ? own : peerBaseline || r.views || 1;
      // Prefer the source's own computed ratio (it excludes pinned posts and
      // knows the true history); fall back to our own views/baseline.
      const ratio =
        r.providerRatio && r.providerRatio > 0
          ? r.providerRatio
          : r.views / Math.max(baseline, 1);
      const ratioBasis: ScoredSignal["ratioBasis"] =
        r.providerRatio && r.providerRatio > 0
          ? "account"
          : useOwn
            ? "account"
            : "niche";
      /**
       * Velocity and freshness are *claims about time*, so they can only be made
       * when the post carries a date. When it does not, the component sits at
       * the neutral midpoint (0.5) — the same treatment a missing signal gets
       * everywhere else in this file — rather than at 1.0, which is what an
       * invented "posted one hour ago" used to produce.
       *
       * Neutral is not a fudge: it means the other, measured components decide
       * the score. A dateless post can still rank well on ratio and engagement,
       * it just cannot win on recency it never proved.
       */
      const hours = hoursSince(r.postedAt, now);
      const velocityIndex =
        hours === null ? null : r.views / hours / (velocities.get(r.account) || 1);
      const engagementRate =
        (r.likes + r.comments * 2 + (r.shares ?? 0) * 4) /
        Math.max(r.views, 1);
      const ageDays = ageInDays(r.postedAt, now);
      const ageKnown = Number.isFinite(ageDays);
      const { phase, saturation } = classifyPhase(
        r.audioId ? sounds[r.audioId] : undefined,
      );

      const ratioComp = clamp(Math.log10(Math.max(ratio, 1)) / Math.log10(20));
      const velocityComp = velocityIndex === null ? 0.5 : clamp(velocityIndex / 3);
      const engagementComp = clamp(engagementRate / 0.08);
      const freshComp = ageKnown ? Math.exp(-ageDays / 14) : 0.55;

      const raw =
        0.42 * ratioComp +
        0.22 * velocityComp +
        0.14 * engagementComp +
        0.22 * PHASE_WEIGHT[phase];

      const signalScore = Math.round(
        clamp(raw * (0.45 + 0.55 * freshComp)) * 100,
      );

      const stats = r.audioId ? sounds[r.audioId] : undefined;
      const receipts = [
        `${ratio.toFixed(1)}x its account's median (${Math.round(baseline).toLocaleString()} views)`,
        velocityIndex === null
          ? "velocity not measurable — no publish date"
          : `${velocityIndex.toFixed(1)}x typical velocity`,
        `${(engagementRate * 100).toFixed(1)}% engagement`,
        stats
          ? `${stats.reelsLast7d.toLocaleString()} reels on this sound in 7d (${
              stats.reelsPrev7d
                ? `${Math.round(
                    ((stats.reelsLast7d - stats.reelsPrev7d) /
                      Math.max(stats.reelsPrev7d, 1)) *
                      100,
                  )}% w/w`
                : "new"
            })`
          : "no sound data",
        `${phase} · ${Math.round(saturation * 100)}% saturated`,
      ].join(" · ");

      return {
        ...r,
        baseline: Math.round(baseline),
        ratio: Number(ratio.toFixed(2)),
        /**
         * 1.0 = "no better and no worse than this account's usual pace", which
         * is the only defensible reading of an undated post. Downstream compares
         * against 1.0, so a neutral value here is invisible there rather than
         * silently ranking the post either first or last.
         */
        velocityIndex: velocityIndex === null ? 1 : Number(velocityIndex.toFixed(2)),
        engagementRate: Number(engagementRate.toFixed(4)),
        ageDays: ageKnown ? Number(ageDays.toFixed(1)) : null,
        phase,
        saturation: Number(saturation.toFixed(3)),
        signalScore,
        ratioBasis,
        receipts,
      } satisfies ScoredSignal;
    })
    .sort((a, b) => b.signalScore - a.signalScore);
}

/**
 * Keep only reels that clear the working thresholds.
 *
 * Age gate is 120 days, not 60: Instagram's profile and search surfaces rank by
 * relevance, not recency (median age in a live pull was ~340 days), so a 60-day
 * gate threw away ~90% of the pool and left too few outliers to prove anything
 * across accounts. Recency is still priced in — `freshComp` decays the score and
 * trend phase penalises saturation — but it no longer decides inclusion alone.
 *
 * Niche-basis ratios (one-off accounts from keyword search) have to clear a
 * higher bar, because "3x a typical niche reel" is a weaker claim than "3x this
 * creator's own median".
 */
export function filterSignals(signals: ScoredSignal[]): ScoredSignal[] {
  /**
   * Undated posts pass the age gate: the gate exists to drop stale work, and
   * "no date" is not evidence of staleness. They were already prevented from
   * winning on recency by the neutral freshness component above, so letting
   * them through here adds sample without adding flattery.
   */
  const usable = signals.filter(
    (s) => (s.ageDays === null || s.ageDays <= 120) && s.views >= 2_000,
  );

  const strict = usable.filter((s) => {
    const gate = s.ratioBasis === "niche" ? 5 : 3;
    return s.ratio >= gate && s.views >= 5_000;
  });
  if (strict.length >= STRICT_ENOUGH) {
    return strict.map((s) => ({ ...s, gate: "strict" as const }));
  }

  /**
   * A quiet room still has a best work in it.
   *
   * The fixed gate had a structural flaw: with a single niche (no per-account
   * history) the ratio is measured against the room median, so most reels sit
   * near 1.0 and a hard "5x" threshold discards the entire pool by
   * construction. Measured on a live pull of 40 reels, the best ratio in the
   * room was 1.96 — nothing could ever pass, and the plan came back empty.
   *
   * So: keep the strict gate when it can be met; when it cannot, fall back to
   * the strongest tail of the same distribution and label it. "The top tenth of
   * a quiet niche" is a real, checkable statement. An empty page is not.
   */
  const tail = usable
    .filter((s) => s.ratio >= 2)
    .sort((a, b) => b.signalScore - a.signalScore);
  const want = Math.max(STRICT_ENOUGH, Math.ceil(usable.length * 0.2));
  return tail.slice(0, want).map((s) => ({ ...s, gate: "top" as const }));
}
