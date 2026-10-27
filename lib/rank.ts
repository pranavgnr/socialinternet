import type { DraftIdea } from "./adapt";
import { clusterIndex } from "./converge";
import { clamp, contentWords, jaccard, tokens } from "./text";
import type {
  ConvergenceCluster,
  FormatContainer,
  HookType,
  Idea,
  Profile,
  ScoredSignal,
} from "./types";

export { tokens, jaccard } from "./text";

/**
 * Longest chain of consecutive content words shared with the source opening.
 * Order is kept on purpose: what a paraphrase actually reuses is a run of
 * words ("proof beats single takeaway"), not a bag of them, and a bag is all
 * jaccard can see.
 */
function sharedRun(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let best = 0;
  let prevRow = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const curRow = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        curRow[j] = prevRow[j - 1] + 1;
        if (curRow[j] > best) best = curRow[j];
      }
    }
    prevRow = curRow;
  }
  return best;
}

const PHASE_WEIGHT: Record<string, number> = {
  emergence: 0.8,
  acceleration: 1,
  peak: 0.5,
  saturation: 0.15,
  decay: 0,
};

const EFFORT_PENALTY = { low: 0, medium: 0.5, high: 1 } as const;

/**
 * Learned reweighting from the creator's own results. This is the part a prompt
 * wrapper cannot do: which hook types and formats actually produce outliers
 * for THIS account.
 */
export function learnedBoosts(history: Idea[]): {
  hook: Partial<Record<HookType, number>>;
  format: Partial<Record<FormatContainer, number>>;
} {
  const posted = history.filter(
    (i) => i.status === "posted" && typeof i.viewsAfter7d === "number",
  );
  if (posted.length < 4) return { hook: {}, format: {} };

  const baseline =
    posted.reduce((s, i) => s + (i.viewsAfter7d ?? 0), 0) / posted.length;
  if (!baseline) return { hook: {}, format: {} };

  const aggregate = <K extends string>(key: (i: Idea) => K) => {
    const buckets = new Map<K, { sum: number; n: number }>();
    for (const idea of posted) {
      const k = key(idea);
      const cur = buckets.get(k) ?? { sum: 0, n: 0 };
      cur.sum += (idea.viewsAfter7d ?? 0) / baseline;
      cur.n += 1;
      buckets.set(k, cur);
    }
    const out: Partial<Record<K, number>> = {};
    for (const [k, v] of buckets) {
      // small-sample shrink so one lucky post doesn't rewrite the weights
      const lift = v.sum / v.n;
      const confidence = v.n / (v.n + 2);
      out[k] = 1 + clamp((lift - 1) * confidence, -0.25, 0.35);
    }
    return out;
  };

  return {
    hook: aggregate((i) => i.hookType),
    format: aggregate((i) => i.format),
  };
}

export function rank(
  drafts: DraftIdea[],
  signals: ScoredSignal[],
  profile: Profile,
  history: Idea[] = [],
  limit = 10,
  clusters: ConvergenceCluster[] = [],
): Idea[] {
  const signalById = new Map(signals.map((s) => [s.id, s]));
  const clusterBySignal = clusterIndex(clusters);
  const pillarTokens = tokens(
    [profile.niche, ...(profile.pillars ?? []), profile.audience].join(" "),
  );
  const questionTokens = tokens((profile.commentQuestions ?? []).join(" "));
  const winnerTokens = tokens((profile.ownWinners ?? []).join(" "));
  const boosts = learnedBoosts(history);

  /** How close each idea's opening line sits to the reel it was learned from. */
  const copyRisk = new Map<string, { run: number; jaccard: number }>();
  const sourceWordCache = new Map<string, string[]>();
  const sourceWords = (hookText: string) => {
    const hit = sourceWordCache.get(hookText);
    if (hit) return hit;
    const words = contentWords(hookText);
    sourceWordCache.set(hookText, words);
    return words;
  };

  const scored = drafts.map((d, idx) => {
    const signal = signalById.get(d.pattern.signalId);
    const cluster = clusterBySignal.get(d.pattern.signalId);
    const ideaTokens = tokens(
      [d.title, d.topic, ...d.hookVariants, ...d.beats].join(" "),
    );

    const signalPart = (signal?.signalScore ?? 50) / 100;
    const fitPart = clamp(
      0.6 * jaccard(ideaTokens, pillarTokens) * 2.2 +
        0.25 * jaccard(ideaTokens, questionTokens) * 3 +
        0.15 * jaccard(ideaTokens, winnerTokens) * 3,
    );
    // novelty: unlike the source execution AND unlike the ideas already shown
    const sourceSimilarity = jaccard(ideaTokens, tokens(d.pattern.hookText));
    const siblingSimilarity = Math.max(
      0,
      ...drafts
        .filter((_, j) => j !== idx)
        .map((o) => jaccard(ideaTokens, tokens(o.hookVariants[0] ?? ""))),
    );
    const noveltyPart = clamp(1 - 0.6 * sourceSimilarity - 0.4 * siblingSimilarity);

    // cross-account validation beats a single-channel spike
    const convergencePart = cluster?.confidence ?? 0;

    const timingPart = PHASE_WEIGHT[signal?.phase ?? "peak"] ?? 0.5;
    const saturationPenalty = signal?.saturation ?? 0.4;
    const effortPenalty = EFFORT_PENALTY[d.effort] ?? 0;

    const hookBoost = boosts.hook[d.hookType] ?? 1;
    const formatBoost = boosts.format[d.format] ?? 1;
    const learned = hookBoost * formatBoost;

    const raw =
      0.3 * signalPart +
      0.2 * fitPart +
      0.16 * noveltyPart +
      0.24 * convergencePart +
      0.08 * timingPart -
      0.18 * saturationPenalty -
      0.05 * effortPenalty;

    const score = Math.round(clamp(raw) * 100 * learned);

    const idea: Idea = {
      id: `idea_${Date.now().toString(36)}_${idx}`,
      title: d.title,
      hookVariants: d.hookVariants,
      hookType: d.hookType,
      format: d.format,
      topic: d.topic,
      beats: d.beats,
      shotList: d.shotList,
      onScreenText: d.onScreenText,
      sound: d.sound,
      soundWindowDays: d.soundWindowDays,
      caption: d.caption,
      hashtags: d.hashtags,
      whyThis: d.whyThis,
      effort: d.effort,
      score,
      scoreParts: {
        signal: Math.round(signalPart * 100),
        fit: Math.round(fitPart * 100),
        novelty: Math.round(noveltyPart * 100),
        timing: Math.round(timingPart * 100),
        saturationPenalty: Math.round(saturationPenalty * 100),
        effortPenalty: Math.round(effortPenalty * 100),
        convergence: Math.round(convergencePart * 100),
      },
      receipt: {
        signalId: d.pattern.signalId,
        account: signal?.account ?? "unknown",
        platform: signal?.platform ?? "instagram",
        url: signal?.url ?? "",
        ratio: signal?.ratio ?? 0,
        phase: signal?.phase ?? "peak",
      },
      proof: cluster
        ? {
            support: cluster.support,
            accounts: cluster.accounts,
            tier: cluster.tier,
            medianRatio: cluster.medianRatio,
            label: cluster.label,
          }
        : undefined,
      status: "new",
      createdAt: new Date().toISOString(),
    };

    // Measured on the opening line alone: beats and shot lists dilute jaccard
    // until a verbatim lift looks "novel".
    const hookWords = contentWords(d.hookVariants[0] ?? d.title);
    const src = sourceWords(d.pattern.hookText);
    copyRisk.set(idea.id, {
      run: sharedRun(hookWords, src),
      jaccard: jaccard(new Set(hookWords), new Set(src)),
    });

    return idea;
  });

  /**
   * A near-copy cannot be fixed by ranking it lower — it is the same film with
   * a new caption, and it is the one thing this feed must never ship. Four
   * consecutive content words, or a mostly-overlapping opening, is a lift.
   */
  const COPY_RUN = 4;
  const COPY_JACCARD = 0.6;
  const clean = scored.filter((idea) => {
    const risk = copyRisk.get(idea.id);
    if (!risk) return true;
    return risk.run < COPY_RUN && risk.jaccard < COPY_JACCARD;
  });
  /**
   * If the gate emptied the feed the source set was too narrow to learn from;
   * serve the closest survivors rather than nothing, but never claim they are
   * original. Surfaced in the run log so it shows up in analysis.
   */
  const pool = clean.length >= Math.min(limit, 4) ? clean : scored;
  if (pool !== clean) {
    console.warn(
      `[rank] copy gate kept only ${clean.length} of ${scored.length} ideas; serving the full pool`,
    );
  }

  // dedupe: same idea wearing a different hook
  const kept: Idea[] = [];
  for (const idea of pool.sort((a, b) => b.score - a.score)) {
    const t = tokens([idea.title, idea.topic, idea.hookVariants[0]].join(" "));
    if (kept.some((k) => jaccard(t, tokens(k.hookVariants[0])) > 0.55)) continue;
    kept.push(idea);
    if (kept.length >= limit) break;
  }
  return kept;
}
