import { detectFormat, videoFormat } from "./formats";
import type {
  AuditGap,
  CreatorAudit,
  HookMode,
  HookVerdict,
  RawReel,
} from "./types";

/**
 * The creator's own account, read against itself.
 *
 * Every other module in this product compares a creator to strangers. This one
 * compares them to their own best week, which is the only evidence they will
 * believe without an argument: it is their video, their face, their words, and
 * it already worked once.
 *
 * The rule for calling something a gap is deliberately strict — at least two
 * winners must agree, and the two sides must actually differ. One lucky reel is
 * not a finding, and a beginner who is told to "do more of your best post" has
 * been told nothing at all.
 */

const MIN_POSTS_FOR_AUDIT = 4;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** The opening a viewer actually meets, preferring a measured hook. */
function openingOf(reel: RawReel): { mode: HookMode; text: string; measured: boolean } {
  if (reel.hook && reel.hook.mode !== "unknown") {
    return { mode: reel.hook.mode, text: reel.hook.hookText, measured: true };
  }
  const first = reel.caption.split(/[.!?\n]/)[0]?.trim() ?? "";
  const isQuestion = /^(how|why|what|when|where|which|who|can|could|do|does|did|is|are|should|would|will)\b/i.test(first) || first.includes("?");
  return { mode: isQuestion ? "spoken" : "visual", text: first.slice(0, 90), measured: false };
}

const MODE_LABEL: Record<HookMode, string> = {
  spoken: "said out loud in the first second",
  on_screen: "written on the screen, no speech",
  both: "said and written at the same time",
  visual: "pure picture — no words to open with",
  unknown: "no readable opening",
};

function lengthBucket(sec?: number): string {
  if (!sec || sec <= 0) return "unknown";
  if (sec < 12) return "<12s";
  if (sec < 25) return "12–25s";
  if (sec < 45) return "25–45s";
  if (sec < 75) return "45–75s";
  return ">75s";
}

function captionBucket(reel: RawReel): string {
  const words = reel.caption.trim().split(/\s+/).filter(Boolean).length;
  const tags = reel.hashtags?.length ?? 0;
  if (words <= 4 && tags === 0) return "a line or less, no hashtags";
  if (words <= 12) return "one short line";
  if (words <= 40) return "a short paragraph";
  return "a long caption";
}

/**
 * How often a lever's value on the winning side is missing from the losing
 * side. 1 means the winners all share something the losers never did.
 */
function contrast(winners: string[], losers: string[]): { value: string; strength: number; wins: number } | null {
  const tally = new Map<string, number>();
  for (const w of winners) if (w !== "unknown") tally.set(w, (tally.get(w) ?? 0) + 1);
  let best: { value: string; strength: number; wins: number } | null = null;
  for (const [value, wins] of tally) {
    const losses = losers.filter((l) => l === value).length;
    const strength = (wins - losses) / Math.max(1, winners.length);
    if (strength <= 0.2) continue;
    if (!best || strength > best.strength) best = { value, strength, wins };
  }
  return best;
}

function gap(
  lever: AuditGap["lever"],
  winners: string[],
  losers: string[],
  render: (value: string) => { winners: string; losers: string; note: string },
): AuditGap | null {
  const c = contrast(winners, losers);
  if (!c || c.wins < 2) return null;
  const losing = [...new Set(losers.filter((l) => l !== "unknown" && l !== c.value))].slice(0, 2);
  const r = render(c.value);
  return {
    lever,
    winners: r.winners,
    losers: losing.length ? r.losers : "no clear pattern",
    support: c.wins,
    strength: Number(c.strength.toFixed(2)),
    note: r.note,
  };
}

export interface AuditInput {
  reels: RawReel[];
  /** views of a typical peer, for the "how you stand" sentence */
  peerMedian?: number;
  nicheMedian?: number;
}

export function buildAudit({ reels, peerMedian, nicheMedian }: AuditInput): CreatorAudit | null {
  const usable = reels.filter((r) => r.views > 0);
  if (usable.length < MIN_POSTS_FOR_AUDIT) return null;

  const byViews = [...usable].sort((a, b) => b.views - a.views);
  const medianViews = median(byViews.map((r) => r.views));
  // Three vs three: enough to see a pattern, few enough that one huge reel
  // cannot drag the "winner" side on its own.
  const n = Math.min(3, Math.floor(byViews.length / 2));
  const winners = byViews.slice(0, Math.max(1, n));
  const losers = byViews.slice(-Math.max(1, n));
  const watched = usable.filter((r) => r.hook?.basis === "measured").length;

  const dates = usable
    .map((r) => new Date(r.postedAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86_400_000);
  const daysSinceLast = dates.length
    ? (Date.now() - dates[dates.length - 1]) / 86_400_000
    : null;

  /* --- the four levers a creator can actually change this week --- */

  const winOpen = winners.map((r) => openingOf(r).mode);
  const loseOpen = losers.map((r) => openingOf(r).mode);
  const openGap = gap("opening", winOpen, loseOpen, (v) => ({
    winners: MODE_LABEL[v as HookMode] ?? v,
    losers: "no consistent opening",
    note: `Your best posts all open the same way: ${MODE_LABEL[v as HookMode] ?? v}. ${
      watched ? "This was read from the video, not guessed from the caption." : "Read from the caption — connect ffmpeg and whisper to confirm it on the video."
    }`,
  }));

  const winShape = winners.map((r) => detectFormat(r) ?? "unknown");
  const loseShape = losers.map((r) => detectFormat(r) ?? "unknown");
  const shapeGap = gap("shape", winShape, loseShape, (v) => ({
    winners: videoFormat(v)?.label ?? v,
    losers: "whatever came next",
    note: `The shape that travels for you is ${videoFormat(v)?.label ?? v}. It is not a trend you found, it is a thing you already do.`,
  }));

  const winLen = winners.map((r) => lengthBucket(r.durationSec));
  const loseLen = losers.map((r) => lengthBucket(r.durationSec));
  const lengthGap = gap("length", winLen, loseLen, (v) => ({
    winners: v,
    losers: ["<12s", "12–25s", "25–45s", "45–75s", ">75s"].filter((b) => !winLen.includes(b)).slice(0, 2).join(" / ") || "no clear pattern",
    note: `Your winners sit in ${v}. That is a budget, not a rule — but stop writing past it.`,
  }));

  const winCap = winners.map(captionBucket);
  const loseCap = losers.map(captionBucket);
  const captionGap = gap("caption", winCap, loseCap, (v) => ({
    winners: v,
    losers: "longer or hashtag-stuffed",
    note: `Your best-performing captions are ${v}. Captions are searched, so this is also what you are being found for.`,
  }));

  /* --- cadence: not winners vs losers, but what the history says --- */
  const medianGap = gaps.length ? median(gaps) : null;
  const longestGap = gaps.length ? Math.max(...gaps) : null;
  let cadenceGap: AuditGap | null = null;
  if (medianGap !== null && medianGap > 7) {
    cadenceGap = {
      lever: "cadence",
      winners: "posting more often",
      losers: `one post every ${Math.round(medianGap)} days`,
      support: Math.min(3, gaps.length),
      strength: Math.min(1, Number(((medianGap - 7) / 14).toFixed(2))),
      note: `You average a post every ${Math.round(medianGap)} days. Nothing else in this plan matters until that number comes down — the algorithm stops showing your work to people who have forgotten you.`,
    };
  }

  /* --- consistency: how predictable the account is --- */
  const mean = byViews.reduce((s, r) => s + r.views, 0) / byViews.length;
  const sd = Math.sqrt(byViews.reduce((s, r) => s + (r.views - mean) ** 2, 0) / byViews.length);
  const consistency = mean > 0 ? Number(Math.max(0, 1 - sd / mean).toFixed(2)) : 0;

  const shapes = new Map<string, { posts: number; views: number[] }>();
  for (const r of usable) {
    const id = detectFormat(r) ?? "unknown";
    const label = id === "unknown" ? "unclassified" : videoFormat(id)?.label ?? id;
    const row = shapes.get(label) ?? { posts: 0, views: [] };
    row.posts += 1;
    row.views.push(r.views);
    shapes.set(label, row);
  }

  const modes = new Map<HookMode, { posts: number; views: number[] }>();
  for (const r of usable) {
    const mode = openingOf(r).mode;
    const row = modes.get(mode) ?? { posts: 0, views: [] };
    row.posts += 1;
    row.views.push(r.views);
    modes.set(mode, row);
  }

  const best = byViews[0];
  const worst = byViews[byViews.length - 1];
  const ceiling = medianViews > 0 ? Number((best.views / medianViews).toFixed(2)) : 0;

  const versus = (() => {
    const against = peerMedian ?? nicheMedian;
    if (!against) return `Your typical post does ${Math.round(medianViews).toLocaleString()} views.`;
    const x = medianViews / against;
    if (x >= 1.5) return `Your typical post gets ${x.toFixed(1)}x what the same-size accounts in this niche get. The problem is not reach — it is repeatability.`;
    if (x >= 0.75) return `Your typical post is level with accounts your size. Small edits decide who breaks out from here.`;
    return `Your typical post does ${(x * 100).toFixed(0)}% of what accounts your size get. That gap is usually format, not talent.`;
  })();

  const found = [openGap, shapeGap, lengthGap, captionGap, cadenceGap].filter(
    (g): g is AuditGap => Boolean(g),
  ).sort((a, b) => b.strength - a.strength);

  const topShapes = [...shapes.entries()]
    .map(([label, row]) => ({
      label,
      posts: row.posts,
      share: Number((row.posts / usable.length).toFixed(2)),
      medianViews: Math.round(median(row.views)),
    }))
    .sort((a, b) => b.posts - a.posts);

  return {
    posts: usable.length,
    watched,
    medianViews: Math.round(medianViews),
    best: {
      views: best.views,
      multiple: medianViews ? Number((best.views / medianViews).toFixed(1)) : 0,
      caption: best.caption.slice(0, 140),
      url: best.url,
      hookMode: best.hook?.mode,
    },
    worst: {
      views: worst.views,
      multiple: medianViews ? Number((worst.views / medianViews).toFixed(1)) : 0,
      caption: worst.caption.slice(0, 140),
      url: worst.url,
      hookMode: worst.hook?.mode,
    },
    cadence: {
      medianGapDays: medianGap === null ? null : Number(medianGap.toFixed(1)),
      longestGapDays: longestGap === null ? null : Number(longestGap.toFixed(1)),
      daysSinceLast: daysSinceLast === null ? null : Number(daysSinceLast.toFixed(1)),
    },
    shapes: topShapes,
    hookModes: [...modes.entries()]
      .map(([mode, row]) => ({ mode, posts: row.posts, medianViews: Math.round(median(row.views)) }))
      .sort((a, b) => b.medianViews - a.medianViews),
    breadth: topShapes.filter((s) => s.label !== "unclassified").length,
    consistency,
    ceiling,
    versusPeers: versus,
    gaps: found,
  };
}

/**
 * Is the hook the video, or the audio?
 *
 * The answer decides what the creator spends the next hour on: writing a line,
 * filming a face, or picking a sound. So it is read from the posts that got
 * read, weighted by how well they did — a mode that only appears on flops is
 * not an answer, it is a warning.
 */
export function hookVerdict(reels: RawReel[]): HookVerdict | undefined {
  const read = reels.filter((r) => r.hook && r.hook.mode !== "unknown" && r.hook.hookText);
  if (!read.length) return undefined;

  const measured = read.some((r) => r.hook?.basis === "measured");
  // Weight by performance: a mode that carried 4x posts should not lose to a
  // mode that appears often on posts nobody watched to the end.
  const weight = new Map<HookMode, number>();
  const count = new Map<HookMode, number>();
  for (const r of read) {
    const mode = r.hook!.mode;
    const med = median(read.map((x) => x.views));
    const lift = med > 0 ? Math.max(0.25, Math.min(4, r.views / med)) : 1;
    weight.set(mode, (weight.get(mode) ?? 0) + lift);
    count.set(mode, (count.get(mode) ?? 0) + 1);
  }
  const [mode] = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = (count.get(mode) ?? 0) / read.length;

  const sentence: Record<HookMode, string> = {
    spoken: `Your hook is audio. The video only has to be inoffensive — the first sentence is what holds people. Write it before you film.`,
    on_screen: `Your hook is written on the screen. Speech is optional; the first frame of text is doing the work, so design that frame first.`,
    both: `Your hook is said and written at once. That is the strongest combination you have — keep the words identical in both places.`,
    visual: `Your hook is the picture. Words are not stopping anyone; the movement in frame one is. Start on the action, never on a talking head.`,
    unknown: `Your openings are inconsistent, which is the real problem — there is no repeatable hook to improve yet.`,
  };

  const examples = [...read]
    .sort((a, b) => b.views - a.views)
    .slice(0, 3)
    .map((r) => ({
      text: r.hook!.hookText.slice(0, 110),
      views: r.views,
      url: r.url,
    }));

  return {
    mode,
    share: Number(share.toFixed(2)),
    sampled: read.length,
    basis: measured ? "measured" : "caption",
    sentence: measured
      ? sentence[mode]
      : `${sentence[mode]} (Read from captions — run the deep pass to confirm it on the video.)`,
    examples,
  };
}

/** One line for a page header, or empty when the account is too new to audit. */
export function auditLine(audit: CreatorAudit | undefined): string {
  if (!audit) return "";
  const g = audit.gaps[0];
  return g
    ? `${audit.posts} of your posts read · strongest difference: ${g.winners}`
    : `${audit.posts} of your posts read · no lever separates your winners yet`;
}

export { pct };
