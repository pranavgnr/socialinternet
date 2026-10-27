import type { NicheAccount, NicheResearch } from "./niche";
import { tokens } from "./text";
import type { PlanEvidence, RawReel } from "./types";

/**
 * The arithmetic the plan is built on, kept in one place so the plan engine and
 * the per-archetype playbooks cannot drift apart on how a median is taken or
 * how a reel is described.
 */

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

export function median(values: number[]): number {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * Words that are written in capitals even mid-sentence. Theme labels are built
 * from the creator's own words, so they arrive lowercased — "pov day vlog" —
 * and "Pov" in a sentence reads like machine output.
 */
const ACRONYMS = new Set([
  "pov", "grwm", "ootd", "diy", "ai", "ui", "ux", "gym", "asmr", "q&a",
  "faq", "vfx", "cgi", "ar", "vr", "pc", "app", "nri", "it", "hr", "ca",
]);

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.replace(/\b[a-z]/, (c) => c.toUpperCase()),
    )
    .join(" ");
}

/** Lowercase a label for mid-sentence use, keeping its acronyms readable. */
export function sentenceCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
      return w.toLowerCase();
    })
    .join(" ");
}

export function durationBucket(sec: number): string {
  if (sec <= 15) return "under 15s";
  if (sec <= 30) return "15–30s";
  if (sec <= 60) return "30–60s";
  if (sec <= 90) return "60–90s";
  return "over 90s";
}

/** Days between posts, so cadence advice is measured rather than assumed. */
export function medianGapDays(reels: RawReel[]): number | null {
  const times = reels
    .map((r) => new Date(r.postedAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 86_400_000);
  return median(gaps.map((g) => Math.round(g * 10))) / 10;
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/* ------------------------------------------------------------------ *
 * Rows: one reel with the one number that matters
 * ------------------------------------------------------------------ */

export interface Row {
  reel: RawReel;
  account: string;
  /** this reel's views vs that account's own median */
  ratio: number;
  /** true when the ratio is against the account, false when against the niche */
  accountBased: boolean;
}

/**
 * Every reel measured against its own account's usual views. The niche median is
 * only the fallback for accounts we met once through a keyword search.
 */
export function buildRows(research: NicheResearch, exclude?: string): Row[] {
  const medians = new Map(research.accounts.map((a) => [a.handle.toLowerCase(), a]));
  const nicheMedian = research.nicheMedianViews || 1;
  const rows: Row[] = [];

  for (const reel of research.payload ?? []) {
    if (!reel.views || !reel.account) continue;
    if (exclude && reel.account.toLowerCase() === exclude.toLowerCase()) continue;
    const acc = medians.get(reel.account.toLowerCase());
    /**
     * The provider's own creator baseline is the best denominator available: it
     * is measured over that account's recent posts, not over the handful we
     * happened to pull. It also survives the case where we only hold one reel
     * from the account, which is what made every ratio exactly 1.0.
     */
    const providerBase = reel.baselineMedianViews ?? 0;
    const ownBase = acc && acc.reels >= 2 ? acc.medianViews : 0;
    const base = providerBase || ownBase;
    const denominator = base || nicheMedian;
    if (!denominator) continue;
    rows.push({
      reel,
      account: reel.account,
      ratio: reel.views / denominator,
      accountBased: Boolean(base),
    });
  }
  return rows;
}

/**
 * How a reel is described in an evidence line. The comparison and the words have
 * to match: "3.4x its usual views" is a claim about that account, and saying it
 * when the ratio was taken against the niche median is a false statement on the
 * page. Accounts met once through a search get the honest version.
 */
export function ratioLine(row: Row): string {
  return row.accountBased
    ? `${row.ratio.toFixed(1)}x its usual views`
    : `${row.ratio.toFixed(1)}x the typical post here`;
}

export function evidenceFrom(row: Row): PlanEvidence {
  return {
    handle: `@${row.account}`,
    metric: `${ratioLine(row)} · ${fmt(row.reel.views)} views`,
    url: row.reel.url,
    caption: row.reel.caption.replace(/\s+/g, " ").slice(0, 120),
  };
}

export function evidenceRow(
  account: string,
  metric: string,
  reel?: RawReel,
): PlanEvidence {
  return {
    handle: `@${account}`,
    metric,
    url: reel?.url,
    caption: reel?.caption.replace(/\s+/g, " ").slice(0, 120),
  };
}

/* ------------------------------------------------------------------ *
 * Themes: the same idea on unrelated accounts
 * ------------------------------------------------------------------ */

export interface Theme {
  label: string;
  rows: Row[];
  accounts: string[];
  medianRatio: number;
  score: number;
}

/** Themes = the same idea showing up on unrelated accounts. */
/** Words that cannot end a label, because they only point at the next one. */
const LABEL_TAIL = new Set(
  "a an the before after with without in on at of to for from and or but my your his her their our this that these those it its is was when while as by into over under about".split(
    " ",
  ),
);

export function clusterThemes(rows: Row[], minRatio = 1.8): Theme[] {
  const outliers = rows
    .filter((r) => r.ratio >= minRatio)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 60);
  if (!outliers.length) return [];

  const wordSets = outliers.map((r) => tokens(r.reel.caption));
  const groups: number[][] = [];
  const taken = new Set<number>();

  for (let i = 0; i < outliers.length; i++) {
    if (taken.has(i) || !wordSets[i].size) continue;
    const group = [i];
    taken.add(i);
    for (let j = i + 1; j < outliers.length; j++) {
      if (taken.has(j)) continue;
      // same poster twice is one data point, not two
      if (outliers[j].account === outliers[i].account) continue;
      if (overlap(wordSets[i], wordSets[j]) >= 0.3) {
        group.push(j);
        taken.add(j);
      }
    }
    if (group.length >= 2) groups.push(group);
  }

  return groups
    .map((group) => {
      const rowsIn = group.map((i) => outliers[i]);
      const sets = group.map((i) => wordSets[i]);
      const shared = [...sets[0]].filter((w) => sets.slice(1).every((s) => s.has(w)));
      /**
       * The label is the words every post in the cluster has in common, taken in
       * the order the first caption said them. Cutting that at three words can
       * land on a preposition — "morning routine before" — which then reads as
       * "Post more morning routine before" on the page, a sentence that stops
       * mid-thought. Function words are dropped from the tail so the label ends
       * on the thing being described.
       */
      const picked = shared.slice(0, 3);
      while (picked.length && LABEL_TAIL.has(picked[picked.length - 1].toLowerCase()))
        picked.pop();
      const label = titleCase(picked.join(" ")) || "the top-performing idea";
      const accounts = [...new Set(rowsIn.map((r) => r.account))];
      const ratios = rowsIn.map((r) => Math.round(r.ratio * 10));
      return {
        label,
        rows: rowsIn,
        accounts,
        medianRatio: median(ratios) / 10,
        score: accounts.length * (median(ratios) / 10),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Group rows by any key, biggest groups first. */
export function groupRows(
  rows: Row[],
  key: (r: Row) => string | undefined,
  limit = 3,
): { key: string; rows: Row[] }[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  return [...map.entries()]
    .map(([k, list]) => ({ key: k, rows: list.sort((a, b) => b.ratio - a.ratio) }))
    .sort((a, b) => b.rows.length - a.rows.length || b.rows[0].ratio - a.rows[0].ratio)
    .slice(0, limit);
}

/** Median of a set of peer accounts' medians. */
export function peersMedian(peers: NicheAccount[]): number {
  return median(peers.map((p) => p.medianViews));
}
