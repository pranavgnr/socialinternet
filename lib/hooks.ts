import { evidenceFrom, median, type Row } from "./stats";
import type { PlanEvidence } from "./types";

/**
 * The opening line, ranked.
 *
 * This is the third of three lead recommendations, and it exists for the same
 * reason the other two do: a singer's next reel is decided by the song, a
 * vlogger's by the shape of the video, and a teacher's by the first line. Only
 * the third family belongs here — handing a hook list to a singer is exactly
 * the one-size-fits-all advice this product is meant to replace.
 *
 * A shape is named only when posts in it beat their own account's usual views
 * across more than one account. One creator's good day is not evidence.
 */

export interface HookShape {
  id: string;
  /** how the shape is named on the page */
  label: string;
  /** what to actually do with it, in the creator's own words */
  what: string;
}

export const HOOK_SHAPES: HookShape[] = [
  {
    id: "question",
    label: "a question",
    what: "Ask the thing your viewer is already half-wondering, in the first line. Not a rhetorical teaser — the actual question they came with.",
  },
  {
    id: "howwhy",
    label: "how or why framing",
    what: "Open on the mechanism, not the topic: 'why this happens' beats 'here is a tip about this'. The viewer stays for the reason.",
  },
  {
    id: "number",
    label: "a number",
    what: "Lead with a specific count or figure. Specific numbers beat round ones, and a number in the first three words survives the scroll.",
  },
  {
    id: "warning",
    label: "a warning",
    what: "Open by naming the mistake. It works because the viewer checks themselves against it before deciding to keep watching.",
  },
  {
    id: "pov",
    label: "POV framing",
    what: "Put the viewer inside the situation in the first line. Works when the situation is instantly recognisable and slightly uncomfortable.",
  },
  {
    id: "direct",
    label: "talking straight to the viewer",
    what: "Second person, present tense. It reads like advice being handed over rather than content being published.",
  },
  {
    id: "story",
    label: "a personal story",
    what: "Start in the middle of something that happened to you. The specifics carry it; a summary of the lesson up front kills it.",
  },
  {
    id: "statement",
    label: "a flat statement",
    what: "A plain declarative claim with no throat-clearing. It only works when the claim is surprising enough to be worth the next five seconds.",
  },
];

const BY_ID = new Map(HOOK_SHAPES.map((s) => [s.id, s]));

/** The human name for a shape id, for use in a sentence. */
export function hookShapeLabel(id: string): string {
  return BY_ID.get(id)?.label ?? "a flat statement";
}

/**
 * Read the shape of an opener.
 *
 * Deliberately structural: it looks at how the line is built, never at the
 * subject. That is the difference between "open with a question" — which any
 * creator can act on tomorrow — and a caption to copy, which cannot be reused
 * without sounding like someone else.
 */
export function hookShapeId(caption: string): string | null {
  const raw = caption.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  // Emoji and decoration before the first word are extremely common and would
  // otherwise hide the shape ("🔥 why your reels stall" reads as a flat
  // statement if the emoji is counted as the first character).
  const first = raw.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 80).toLowerCase();
  if (!first) return null;
  if (first.includes("?")) return "question";
  if (/^\d/.test(first)) return "number";
  if (/^pov\b/.test(first)) return "pov";
  if (/^(how|why|what|when|where|which)\b/.test(first)) return "howwhy";
  if (/^(stop|don'?t|never|quit|avoid)\b/.test(first)) return "warning";
  if (/\byou\b|\byour\b|\byou'?re\b/.test(first)) return "direct";
  if (/^(i|we)\b/.test(first)) return "story";
  return "statement";
}

export interface HookPick {
  id: string;
  label: string;
  what: string;
  /** distinct accounts that opened this way and beat their usual views */
  accounts: number;
  /** how many such posts */
  posts: number;
  /** median multiple of those accounts' usual views */
  multiple: number;
  /** the line itself, from the strongest post — shown so it can be checked */
  example: string;
  rows: Row[];
  evidence: PlanEvidence[];
}

/** The first line of a caption, as a viewer would read it. */
function openingLine(caption: string): string {
  return caption
    .replace(/#\S+/g, " ")
    .replace(/\s+/g, " ")
    .split(/[.!?\n]/)[0]
    .trim()
    .slice(0, 110);
}

/**
 * Lines that are a call to action rather than an opening. They are extremely
 * common on breakout posts and they mean nothing as a shape: "try this for free"
 * tells the next creator to say "try this for free", which is the whole failure
 * this product exists to avoid.
 */
const PROMO =
  /^(try (this|it)|link in bio|follow (me|us|for|to)|dm (me|us)|comment\b|get yours|shop now|order now|buy now|grab yours|available now|swipe up|check (this|it) out|new (drop|video|post|arrival)|now (available|live)|book now|apply now)/i;

export function rankHooks(
  rows: Row[],
  opts: { minRatio?: number } = {},
): HookPick[] {
  const minRatio = opts.minRatio ?? 1.3;
  const buckets = new Map<string, Row[]>();

  for (const row of rows) {
    if (!(row.ratio >= minRatio)) continue;
    const id = hookShapeId(row.reel.caption ?? "");
    if (!id) continue;
    /**
     * "statement" is the classifier's fallback, not a decision anyone can take.
     * Naming it as a recommendation would put the biggest, blandest bucket at
     * the top of the page — the same one-size-fits-all advice under a new label.
     * If nothing else qualifies, the hooks section stays empty instead.
     */
    if (id === "statement") continue;
    if (PROMO.test((row.reel.caption ?? "").replace(/^[^\p{L}\p{N}]+/u, ""))) continue;
    const list = buckets.get(id) ?? [];
    list.push(row);
    buckets.set(id, list);
  }

  const picks: HookPick[] = [];
  for (const [id, list] of buckets) {
    const accounts = [...new Set(list.map((r) => r.account.toLowerCase()))];
    if (accounts.length < 2 || list.length < 2) continue;
    const shape = BY_ID.get(id);
    if (!shape) continue;
    const sorted = list.slice().sort((a, b) => b.ratio - a.ratio);
    picks.push({
      id,
      label: shape.label,
      what: shape.what,
      accounts: accounts.length,
      posts: list.length,
      multiple: Math.round(median(list.map((r) => r.ratio)) * 10) / 10,
      example: openingLine(sorted[0].reel.caption ?? ""),
      rows: sorted,
      evidence: sorted.slice(0, 3).map(evidenceFrom),
    });
  }

  // Breadth first: three unrelated accounts agreeing beats one account having a
  // very good day, which is the same bar the songs and formats sections use.
  return picks.sort((a, b) => b.accounts - a.accounts || b.multiple - a.multiple);
}
