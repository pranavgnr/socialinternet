/**
 * The site speaks to creators, not to the pipeline. Generated text and older
 * stored plans still carry internal vocabulary ("median", "cohort", "outlier"),
 * so every string that reaches a page goes through here first. One list to
 * maintain, and no internal word can leak because someone forgot a template.
 */

const SWAPS: [RegExp, string][] = [
  [/\bproven outlier\b/gi, "big hit"],
  [/\boutliers?\b/gi, "post that broke out"],
  [/\bmedian views\b/gi, "usual views"],
  [/\bmedian\b/gi, "usual"],
  [/\bcohort\b/gi, "accounts your size"],
  [/\bpeers?\b/gi, "similar accounts"],
  [/\bpeer reels\b/gi, "reels from similar accounts"],
  [/\bniche's typical reel\b/gi, "typical reel in your space"],
  [/\bthe niche\b/gi, "accounts in your space"],
  [/\bratio\b/gi, "multiple"],
  [/\bsignal\b/gi, "post"],
  [/\bconvergence\b/gi, "pattern"],
  [/\bclusters?\b/gi, "theme"],
  [/\bvalidated\b/gi, "confirmed"],
  [/\barchetype\b/gi, "format"],
  [/\bcanonical\b/gi, ""],
  [/\bpercentile\b/gi, "standing"],
  [/\bcontainer\b/gi, "format"],
  [/\bhook\b/gi, "opening"],
  [/\bscore\b/gi, "strength"],
];

/** Internal words a page must never show. Used by the UI audit too. */
export const INTERNAL_WORDS = [
  "median",
  "cohort",
  "percentile",
  "outlier",
  "convergence",
  "ratio",
  "cluster",
  "archetype",
  "receipt",
  "signal",
  "pipeline",
  "socialcrawl",
  "credits",
] as const;

export function plain(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SWAPS) out = out.replace(pattern, replacement);
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

export function sentenceCase(input: string): string {
  const s = input.trim().replace(/[_-]+/g, " ").replace(/\s{2,}/g, " ");
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

const ACRONYMS = new Set(["ai", "ugc", "diy", "pov", "asmr", "crm", "saas"]);

/** "ai automation" -> "AI automation", "telugu music covers" -> "Telugu music covers" */
export function pretty(input: string): string {
  const words = input.trim().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words
    .map((w, i) => {
      if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
      return i === 0 ? w[0].toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}

export function titleCase(input: string): string {
  return input
    .trim()
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** 1.4 -> "1.4x", 3 -> "3x", 51.2 -> "51.2x", 250.6 -> "251x" */
export function times(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const rounded =
    n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${rounded}x`;
}

const SMALL = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "your", "my", "how", "why",
]);

/**
 * Cluster labels are keyword lists ("connectors claude exact"). Two words read
 * like a topic; more than that get trimmed to the two strongest, joined so they
 * cannot be mistaken for a sentence.
 */
export function themeLabel(input: string): string {
  const words = input.trim().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const keep = words.filter((w) => !SMALL.has(w.toLowerCase()));
  const chosen = (keep.length ? keep : words).slice(0, 2);
  const joined = words.length <= 2 ? chosen.join(" ") : chosen.join(" + ");
  return sentenceCase(joined);
}

/**
 * A trend phase is only worth showing when it changes what the creator should
 * do right now. "Just starting" and "picking up" describe nearly every card, so
 * repeating them is noise; a crowded or fading idea is the one case where the
 * reader needs telling.
 */
export function phaseWarn(phase: string): string | null {
  if (phase === "saturation") return "getting crowded — move fast or skip";
  if (phase === "decay") return "fading";
  if (phase === "peak") return "at its peak";
  return null;
}

/** Keeps acronyms ("AI agents") but drops the capital mid-sentence. */
export function lowerFirst(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (ACRONYMS.has(s.split(/\s+/)[0].toLowerCase())) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** "x" instead of "×" in generated text, for consistency with the above. */
export function fmtViews(n: number): string {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}
