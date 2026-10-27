import { clamp, jaccard, tokens } from "./text";
import type {
  ConvergenceCluster,
  ConvergenceTier,
  ScoredSignal,
  TrendPhase,
} from "./types";

/**
 * Cross-account convergence.
 *
 * The single biggest failure mode of outlier research is mistaking one account's
 * spike for market demand. Industry practice (1of10, vidIQ, CreatorSignal) scores
 * outliers PER CHANNEL, so a creator still has to eyeball whether a topic repeats.
 * This module does that pass automatically: it clusters outlier reels by what they
 * are about, then counts how many INDEPENDENT accounts the theme shows up on.
 *
 * support 1 = one creator got lucky.
 * support 2 = worth testing.
 * support 3+ = the topic has pull of its own. Build this.
 */

const STRONG_MATCH = 0.28;
const WEAK_MATCH = 0.13; // needs 2+ shared distinctive stems to count
const MAX_CLUSTERS = 24;

const PHASE_VALUE: Record<TrendPhase, number> = {
  acceleration: 1,
  emergence: 0.85,
  peak: 0.5,
  saturation: 0.2,
  decay: 0.05,
};

function signalText(s: ScoredSignal): string {
  return [s.caption, s.onScreenText ?? "", s.transcript ?? ""]
    .join(" ")
    .slice(0, 900);
}

const SUFFIXES = [
  "ations",
  "ation",
  "ings",
  "ing",
  "ies",
  "ied",
  "ers",
  "er",
  "ed",
  "es",
  "s",
  "ly",
];

/**
 * Light stemmer. Short captions share almost no exact words
 * ("automated" / "automation" / "automate" / "looped" / "loops"), so without
 * this every reel looks like its own theme and convergence never fires.
 * Strip the inflection, drop a trailing e, then cut to 6 characters.
 */
function stem(word: string): string {
  let s = word;
  for (const suf of SUFFIXES) {
    if (s.endsWith(suf) && s.length - suf.length >= 3) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  if (s.endsWith("e") && s.length > 4) s = s.slice(0, -1);
  return s.length > 6 ? s.slice(0, 6) : s;
}

function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of tokens(text)) out.add(stem(w));
  return out;
}

function labelFor(signals: ScoredSignal[]): {
  label: string;
  keywords: string[];
} {
  // count stems (so inflections merge) but remember the most common surface
  // form of each stem so the label reads like English, not like "automa client"
  const counts = new Map<string, number>();
  const forms = new Map<string, Map<string, number>>();
  for (const s of signals) {
    for (const w of tokens(signalText(s))) {
      const st = stem(w);
      counts.set(st, (counts.get(st) ?? 0) + 1);
      const f = forms.get(st) ?? new Map<string, number>();
      f.set(w, (f.get(w) ?? 0) + 1);
      forms.set(st, f);
    }
  }

  const surface = (st: string) =>
    [...(forms.get(st) ?? new Map())].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? st;

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || surface(a[0]).localeCompare(surface(b[0])))
    .map(([st]) => st);

  const keywords = ranked.slice(0, 5).map(surface);
  const label =
    keywords.slice(0, 3).join(" ") ||
    signals[0]?.caption.slice(0, 40) ||
    "untitled theme";
  return { label, keywords };
}

function tierFor(support: number, medianRatio: number): ConvergenceTier {
  if (support >= 3 && medianRatio >= 2.5) return "validated";
  if (support >= 2) return "supported";
  return "single";
}

function confidenceFor(
  support: number,
  medianRatio: number,
  phase: TrendPhase,
  saturation: number,
  newestAgeDays: number | null,
): number {
  // Independent accounts dominate on purpose: one creator's 130x is a single
  // observation and may be that account's luck or an ad push, while the same
  // theme outliering on two unrelated accounts is demand. 2 accounts → 0.5,
  // 3+ → 1. Everything else only breaks ties.
  const supportPart = clamp((support - 1) / 2);
  const ratioPart = clamp(Math.log10(Math.max(medianRatio, 1)) / Math.log10(12));
  const phasePart = PHASE_VALUE[phase] ?? 0.5;
  /**
   * No usable dates means no recency credit — not maximum recency.
   *
   * `Math.min(...[null])` coerces to 0, so the old code read "no dates at all"
   * as "published today" and handed the cluster a full freshness boost. A null
   * now scores 0.45, just below the 0.5 a month-old post earns, so an undated
   * theme can still be validated by support and magnitude, but never because of
   * an age it never proved.
   */
  const freshPart =
    newestAgeDays === null ? 0.45 : Math.exp(-Math.max(0, newestAgeDays) / 21);
  const raw =
    0.5 * supportPart +
    0.22 * ratioPart +
    0.16 * phasePart +
    0.12 * freshPart -
    0.15 * clamp(saturation);
  return Number(clamp(raw).toFixed(3));
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildCluster(signals: ScoredSignal[]): ConvergenceCluster {
  const accounts = [...new Set(signals.map((s) => s.account))];
  const ratios = signals.map((s) => s.ratio);
  const medianRatio = Number(median(ratios).toFixed(2));
  const maxRatio = Number(Math.max(...ratios).toFixed(2));
  const bestPhase = signals
    .map((s) => s.phase)
    .sort((a, b) => PHASE_VALUE[b] - PHASE_VALUE[a])[0] ?? "peak";
  const saturation = Number(median(signals.map((s) => s.saturation)).toFixed(3));
  /**
   * Newest *known* age across the cluster, or null when none of the posts carry
   * a date. Filtering before `Math.min` is what stops null being read as zero.
   */
  const knownAges = signals
    .map((s) => s.ageDays)
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const newestAgeDays = knownAges.length
    ? Number(Math.min(...knownAges).toFixed(1))
    : null;
  const support = accounts.length;
  const tier = tierFor(support, medianRatio);
  const confidence = confidenceFor(
    support,
    medianRatio,
    bestPhase,
    saturation,
    newestAgeDays,
  );
  const { label, keywords } = labelFor(signals);

  const why =
    tier === "validated"
      ? `${support} unrelated accounts all beat their own median on this theme (median ${medianRatio}x). The topic is doing the work, not any one creator's audience.`
      : tier === "supported"
        ? `Two accounts independently outliered on this theme (median ${medianRatio}x). Real pull, thin evidence — worth a test post.`
        : `Only one account produced this outlier (${maxRatio}x). Could be topic demand, could be that creator's luck. Treat as a hunch, not a mandate.`;

  return {
    id: `conv_${signals
      .map((s) => s.id)
      .sort()
      .join("_")
      .slice(0, 40)}`,
    label,
    keywords,
    signalIds: signals.map((s) => s.id),
    accounts,
    platforms: [...new Set(signals.map((s) => s.platform))],
    support,
    medianRatio,
    maxRatio,
    bestPhase,
    saturation,
    newestAgeDays,
    tier,
    confidence,
    why,
  };
}

/**
 * Greedy agglomerative clustering over outlier captions/transcripts.
 * Seeded by the strongest signal so clusters stay stable between runs.
 */
export function converge(signals: ScoredSignal[]): ConvergenceCluster[] {
  if (!signals.length) return [];

  const pool = signals
    .slice()
    .filter((s) => s.ratio >= 2)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, 120);

  const byId = new Map(pool.map((s) => [s.id, s]));
  const tok = new Map(pool.map((s) => [s.id, stems(signalText(s))]));

  // document frequency → rare words carry more weight than "video"/"make"
  const df = new Map<string, number>();
  for (const set of tok.values()) {
    for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const N = pool.length;
  const weight = (w: string) => Math.log(1 + N / (df.get(w) ?? 1));

  const vec = (set: Set<string>) => {
    const v = new Map<string, number>();
    for (const w of set) v.set(w, weight(w));
    return v;
  };
  const norm = (v: Map<string, number>) =>
    Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0)) || 1;

  const cosine = (
    a: Map<string, number>,
    b: Map<string, number>,
  ): number => {
    let num = 0;
    for (const [w, x] of a) num += x * (b.get(w) ?? 0);
    return num / (norm(a) * norm(b));
  };

  const shared = (a: Set<string>, b: Set<string>) => {
    const out: string[] = [];
    for (const w of a) if (b.has(w)) out.push(w);
    return out;
  };

  const clusters: {
    ids: string[];
    centroid: Map<string, number>;
    stems: Set<string>;
  }[] = [];

  for (const signal of pool) {
    const t = tok.get(signal.id)!;
    const v = vec(t);
    let best = -1;
    let bestScore = Infinity;

    clusters.forEach((c, i) => {
      const sim = cosine(v, c.centroid);
      const overlap = shared(t, c.stems);
      const strong = sim >= STRONG_MATCH;
      const weak = sim >= WEAK_MATCH && overlap.length >= 2;
      if ((strong || weak) && 1 - sim < bestScore) {
        bestScore = 1 - sim;
        best = i;
      }
    });

    if (best === -1) {
      clusters.push({ ids: [signal.id], centroid: v, stems: new Set(t) });
    } else {
      const c = clusters[best];
      c.ids.push(signal.id);
      for (const w of t) c.stems.add(w);
      c.centroid = vec(c.stems); // recompute so the centre tracks the cluster
    }
  }

  return clusters
    .map((c) => buildCluster(c.ids.map((id) => byId.get(id)!).filter(Boolean)))
    .filter((c) => c.signalIds.length > 0)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.support - a.support ||
        b.medianRatio - a.medianRatio,
    )
    .slice(0, MAX_CLUSTERS);
}

/** signalId → cluster, for O(1) lookup during ranking. */
export function clusterIndex(
  clusters: ConvergenceCluster[],
): Map<string, ConvergenceCluster> {
  const map = new Map<string, ConvergenceCluster>();
  // strongest cluster wins if a signal somehow lands in two
  for (const c of [...clusters].sort((a, b) => b.confidence - a.confidence)) {
    for (const id of c.signalIds) if (!map.has(id)) map.set(id, c);
  }
  return map;
}

export function convergenceSummary(clusters: ConvergenceCluster[]): {
  validated: number;
  supported: number;
  single: number;
} {
  return {
    validated: clusters.filter((c) => c.tier === "validated").length,
    supported: clusters.filter((c) => c.tier === "supported").length,
    single: clusters.filter((c) => c.tier === "single").length,
  };
}
