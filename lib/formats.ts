import { evidenceFrom, median, type Row } from "./stats";
import type { PlanEvidence, RawReel, Recommendation } from "./types";

/**
 * The shape of a video, named.
 *
 * A singer is told which song to cover. A teacher is told how to open. A vlogger
 * can act on neither: their next video is a day, a routine, a list, a place, and
 * what makes it travel is the shape it is cut into. So the shapes are catalogued
 * here, detected from captions, and ranked by how well they did for accounts the
 * creator's own size.
 *
 * Nothing in this file invents a shape: a shape only gets recommended when posts
 * in that shape beat their own account's usual views.
 */

export type VideoFormatId =
  | "day_in_life"
  | "routine"
  | "come_with_me"
  | "numbered_list"
  | "storytime"
  | "pov"
  | "first_time"
  | "behind_scenes"
  | "place_guide"
  | "before_after"
  | "how_to";

export interface VideoFormat {
  id: VideoFormatId;
  /** how the shape is said out loud: "Day in the life" */
  label: string;
  /** how it is built, in one sentence a creator can act on */
  what: string;
  /** which families this shape is native to — a tiebreak, never the reason */
  families: Recommendation[];
  /** caption patterns that identify the shape */
  re: RegExp[];
  /** title templates — {topic} is replaced with the creator's own subject */
  titles: string[];
  /** what the first second should be, three options */
  openings: string[];
  /** scene-by-scene beats */
  beats: string[];
  /** what to point the camera at */
  shots: string[];
  /** short text overlays */
  overlays: string[];
}

/**
 * The catalogue. Caption patterns are deliberately narrow: "before" appears in
 * "before I go to work", so before/after needs a pair or an explicit result
 * word, otherwise every vlog would be filed as a transformation.
 */
export const VIDEO_FORMATS: VideoFormat[] = [
  {
    id: "day_in_life",
    label: "Day in the life",
    what: "one day cut around a single decision or turning point, not a list of everything you did",
    families: ["formats"],
    re: [
      /\bday in (my|the|a) life\b/,
      /\bweek in (my|the) life\b/,
      /\bspend (the|a) day\b/,
      /\bmy day\b/,
      /\bdaily (life|vlog)\b/,
    ],
    titles: [
      "A day in the life — cut around the one thing that went wrong",
      "The part of {topic} nobody films",
      "What {topic} looks like on a normal Tuesday",
    ],
    openings: [
      "Open on the thing going wrong, mid-action.",
      "First shot: you already dressed and leaving — no waking up, no bed.",
      "Open on the clock, then cut straight to the decision.",
    ],
    beats: [
      "Cold open on the middle of something — no intro, no greeting.",
      "One line telling us what today is actually about.",
      "Two or three real moments, each with a reason to be there.",
      "The turn: what changed, or what did not go to plan.",
      "End on the honest line about how the day went.",
    ],
    shots: [
      "Handheld, one hand, walking shots with the phone at chest height",
      "Two or three static shots of the places the day moves through",
      "One close-up of the thing the day is about",
      "End shot looking at the camera, not away from it",
    ],
    overlays: ["{topic}", "this did not go to plan", "day in the life"],
  },
  {
    id: "routine",
    label: "Routine",
    what: "a repeated block of time, cut fast, with one habit worth stealing",
    families: ["formats", "craft"],
    re: [/\broutine\b/, /\bmorning\b/, /\bnight\b/, /\bevening\b/, /\bbefore i (start|sleep|leave)\b/],
    titles: [
      "My {topic} routine — the part that actually matters",
      "The 20 minutes that decide the rest of my day",
      "What I stopped doing in my routine",
    ],
    openings: [
      "Open on the first action, already in progress.",
      "Open on the finished result, then rewind.",
      "Open on the one step people always skip.",
    ],
    beats: [
      "Open mid-action, no greeting.",
      "Name the block of time and who it is for.",
      "Three to five steps, each one shot, no explanation between them.",
      "One step gets a sentence: why it earns its place.",
      "Close on what the routine buys you.",
    ],
    shots: [
      "Overhead or side-on for prep steps",
      "One shot per step, 1-2 seconds each",
      "One static wide shot to establish the room",
      "Final shot of the result or the space left behind",
    ],
    overlays: ["my {topic} routine", "step 2 is the one", "no talking, just the steps"],
  },
  {
    id: "come_with_me",
    label: "Come with me",
    what: "a stretch of the day filmed like a friend tagging along, held together by one destination",
    families: ["formats"],
    re: [/\bcome with me\b/, /\bcome along\b/, /\btake you with me\b/, /\brunning errands\b/, /\bcome to\b/],
    titles: [
      "Come with me to {topic}",
      "Come with me — the version I don't usually post",
      "Running the day with me, start to finish",
    ],
    openings: [
      "Open on the door closing behind you.",
      "Open on the destination, then cut to leaving.",
      "Open already in the car, saying where we're going.",
    ],
    beats: [
      "Say where you are going in the first line.",
      "Two or three stops, each with something small happening.",
      "One unplanned moment — that is the part people watch for.",
      "The arrival: pay it off with the reason you went.",
      "Close on the way back, not on a sign-off.",
    ],
    shots: [
      "Walking shots, phone low, feet in frame",
      "Window or mirror shots for movement",
      "One shot of each place you stop",
      "End on the last place, held for a beat",
    ],
    overlays: ["come with me", "we're going to {topic}", "not sponsored, just my day"],
  },
  {
    id: "numbered_list",
    label: "Numbered list",
    what: "a count in the first line that promises a finish, with one item per shot",
    families: ["formats", "hooks", "craft"],
    re: [/^\s*\d+\s/i, /\b\d+ (things|ways|reasons|tips|mistakes|places)\b/],
    titles: [
      "{topic} — 3 things, no filler",
      "3 things I got wrong about {topic}",
      "The 5 {topic} rules I actually follow",
    ],
    openings: [
      "Say the number, then start at one — no setup.",
      "Open on item three, the best one, then go back to one.",
      "Open with the number and the reason to trust it.",
    ],
    beats: [
      "Number and promise in the first line.",
      "One item per shot or per beat, no preamble between.",
      "Each item gets a concrete detail, not an adjective.",
      "Save the strongest item for last, or open with it.",
      "Close by asking which one they'd try.",
    ],
    shots: [
      "One shot per item, same framing each time",
      "Cut on the beat, no transitions",
      "Number overlay on each cut",
      "Hold the last frame a beat longer",
    ],
    overlays: ["3 things", "1.", "2.", "3."],
  },
  {
    id: "storytime",
    label: "Storytime",
    what: "one story told in order, opened at the most tense moment",
    families: ["formats", "hooks"],
    re: [/\bstory ?time\b/, /\blet me tell you\b/, /\bthis happened\b/, /\bso this happened\b/],
    titles: [
      "The {topic} story I've never told properly",
      "Storytime: the day {topic} went sideways",
      "I need to tell you what happened",
    ],
    openings: [
      "Open on the most tense moment, then go back to the start.",
      "Open with the outcome in one line, then 'let me explain'.",
      "Open mid-sentence, as if we already know the story.",
    ],
    beats: [
      "Open at the peak, out of order.",
      "Go back: where it started, in two lines.",
      "Escalate in three steps — each one worse or stranger.",
      "The turn, told plainly.",
      "Close on what you took from it, one sentence only.",
    ],
    shots: ["Talking to camera, one take", "One re-enactment or B-roll of the place", "Cut to a detail shot for the turn"],
    overlays: ["storytime", "this gets worse", "the ending is not what you think"],
  },
  {
    id: "pov",
    label: "POV",
    what: "a point of view held for the whole video, with the situation named in one line",
    families: ["formats", "hooks"],
    re: [/\bpov\b/, /\bpoint of view\b/],
    titles: [
      "POV: {topic}, from the inside",
      "POV: you're the one who has to decide",
      "POV: the side of {topic} nobody films",
    ],
    openings: [
      "Open already inside the situation — no context line.",
      "Open on the other person's reaction, not yours.",
      "Open on the object that tells the whole story.",
    ],
    beats: [
      "Situation named in the first two seconds, in text.",
      "Hold the POV — never cut to a third person explaining.",
      "Two to three beats that only make sense inside that POV.",
      "The detail that makes it feel real.",
      "Cut before it resolves, so it replays.",
    ],
    shots: ["Single continuous take, handheld", "Phone at eye level, subject looking past the lens", "One insert shot of the object"],
    overlays: ["POV: {topic}", "you know exactly where this is going"],
  },
  {
    id: "first_time",
    label: "First time / trying it",
    what: "a genuine first attempt, with the reaction left in",
    families: ["formats", "craft"],
    re: [/\bfirst time\b/, /\bi tried\b/, /\btrying .{0,20}first time\b/, /\bnever done\b/, /\bi've never\b/],
    titles: [
      "Trying {topic} for the first time, no practice",
      "First attempt at {topic} — reaction included",
      "I tried {topic} so you don't have to",
    ],
    openings: [
      "Open on the attempt itself, not the setup.",
      "Open on your face right after the first try.",
      "Open by saying what you expect to happen — then break it.",
    ],
    beats: [
      "Name the attempt and the stake in one line.",
      "Go — no tutorial, no explanation first.",
      "Show the first failure or surprise, unedited.",
      "One adjustment, then the second attempt.",
      "React honestly at the end, including if it was bad.",
    ],
    shots: ["Wide enough to see the whole attempt", "Close on hands or face for the reaction", "One shot of the result"],
    overlays: ["first time trying {topic}", "attempt 1", "attempt 2"],
  },
  {
    id: "behind_scenes",
    label: "Behind the scenes",
    what: "the making of a thing, opened on the finished piece",
    families: ["craft", "formats"],
    re: [/\bbehind the scenes\b/, /\bbts\b/, /\bhow it'?s made\b/, /\bprocess\b/, /\bmaking of\b/],
    titles: [
      "How this {topic} actually gets made",
      "Behind the scenes of {topic}",
      "The 4 hours behind this 20 seconds",
    ],
    openings: [
      "Open on the finished thing, then show the mess.",
      "Open with the step that always goes wrong.",
      "Open on the workspace before anyone touches it.",
    ],
    beats: [
      "Show the finished result first, in the first second.",
      "Then rewind to the start of the process.",
      "Three steps, sped up, with only the key step in real time.",
      "Include the mistake — it is what makes it believable.",
      "Return to the finished result, side by side with the start.",
    ],
    shots: ["Overhead of the workspace", "Timelapse of the middle section", "Close-up on the difficult step", "Finished piece, clean background"],
    overlays: ["how it's made", "the hard part", "4 hours → 20 seconds"],
  },
  {
    id: "place_guide",
    label: "Place guide",
    what: "one place, a few specifics, and a reason to go — not a list of five",
    families: ["formats"],
    re: [/\bthings to do in\b/, /\bwhere to (go|eat|stay)\b/, /\bhidden (place|gem)\b/, /\bguide to\b/, /\bmust visit\b/],
    titles: [
      "The one place in {topic} worth the trip",
      "{topic} — what I'd actually do again",
      "Skip the list. Go here.",
    ],
    openings: [
      "Open on the view, no talking.",
      "Open by naming the place and the one reason to go.",
      "Open on the thing you can only get there.",
    ],
    beats: [
      "Show the place before you name it.",
      "Name it, and one reason it earns the trip.",
      "Two specifics — a price, a time, a dish, a route.",
      "One honest caveat.",
      "Close on the moment worth going for.",
    ],
    shots: ["Wide establishing shot", "One detail shot that only exists there", "One shot of you in the place, small in frame"],
    overlays: ["{topic}", "go at 6pm", "worth it"],
  },
  {
    id: "before_after",
    label: "Before and after",
    what: "the result in the first second, then the work that produced it",
    families: ["craft"],
    re: [/\bbefore\b.*\bafter\b/, /\bafter\b.*\bbefore\b/, /\btransformation\b/, /\bglow ?up\b/, /\bprogress\b/, /\bday 1\b/, /\bturned (it|this) into\b/],
    titles: [
      "{topic}: before and after, honestly",
      "What 30 days of {topic} actually changed",
      "The result first, then how",
    ],
    openings: [
      "Open on the finished result, held for a full second.",
      "Open on the before, then hard-cut to the after.",
      "Open on the moment of change itself.",
    ],
    beats: [
      "Result on screen in the first second — no build-up.",
      "Cut to the before, same angle, same light.",
      "The one thing that made the difference.",
      "The cost: time, money, attempts.",
      "End on the result again, from the same framing as the before.",
    ],
    shots: ["Match the before and after framing exactly", "One mid-process shot", "One close-up of the difference that matters"],
    overlays: ["before", "after", "the one change"],
  },
  {
    id: "how_to",
    label: "How-to",
    what: "one outcome promised in the first line, then the shortest path to it",
    families: ["craft", "hooks"],
    re: [/\bhow to\b/, /\btutorial\b/, /\bstep by step\b/, /\bhere'?s how\b/],
    titles: [
      "How to {topic} without the usual mess",
      "{topic}, in the order that actually works",
      "Do this first, not that",
    ],
    openings: [
      "Open on the finished outcome, then say what it is.",
      "Open with the mistake everyone makes.",
      "Open on step one, already in progress.",
    ],
    beats: [
      "Promise the outcome in one line, with a number if there is one.",
      "Step one, shown not described.",
      "The step people skip, called out.",
      "The result, shown again.",
      "One line on when not to do this.",
    ],
    shots: ["Overhead or over-shoulder for the work", "Close-up on the critical step", "Final shot of the outcome"],
    overlays: ["how to {topic}", "the step everyone skips", "done"],
  },
];

const BY_ID = new Map(VIDEO_FORMATS.map((f) => [f.id, f]));

export function videoFormat(id: string): VideoFormat | undefined {
  return BY_ID.get(id as VideoFormatId);
}

/** Resolve a stored shape back to its id — plans carry labels, not ids. */
export function formatIdFromLabel(label: string): VideoFormatId | null {
  const l = label.trim().toLowerCase();
  const hit = VIDEO_FORMATS.find(
    (f) => f.id === l || f.label.toLowerCase() === l,
  );
  return hit?.id ?? null;
}

/** The shape a single post is in, or null when the caption does not say. */
export function detectFormat(reel: RawReel): VideoFormatId | null {
  const blob = `${reel.caption} ${(reel.hashtags ?? []).join(" ")}`
    .toLowerCase()
    .replace(/[#_]+/g, " ")
    .replace(/\s+/g, " ");
  for (const f of VIDEO_FORMATS) {
    if (f.re.some((re) => re.test(blob))) return f.id;
  }
  return null;
}

export interface FormatPick {
  id: VideoFormatId;
  label: string;
  what: string;
  /** distinct accounts that posted this shape and beat their usual views */
  accounts: number;
  /** how many such posts */
  posts: number;
  /** median multiple of those accounts' usual views */
  multiple: number;
  rows: Row[];
  evidence: PlanEvidence[];
}

/**
 * Rank the shapes by how they did, not by how often they appear.
 *
 * A shape becomes a recommendation only when posts in it beat their own
 * account's usual views across more than one account — the same bar the rest of
 * the product uses. One account's good day in a routine is not evidence that
 * routines work.
 */
export function rankFormats(
  rows: Row[],
  opts: { minRatio?: number; family?: Recommendation } = {},
): FormatPick[] {
  const minRatio = opts.minRatio ?? 1.3;
  const buckets = new Map<VideoFormatId, Row[]>();

  for (const row of rows) {
    if (!(row.ratio >= minRatio)) continue;
    const id = detectFormat(row.reel);
    if (!id) continue;
    const list = buckets.get(id) ?? [];
    list.push(row);
    buckets.set(id, list);
  }

  const picks: FormatPick[] = [];
  for (const [id, list] of buckets) {
    const accounts = [...new Set(list.map((r) => r.account.toLowerCase()))];
    if (accounts.length < 2 || list.length < 2) continue;
    const format = BY_ID.get(id);
    if (!format) continue;
    const sorted = list.slice().sort((a, b) => b.ratio - a.ratio);
    picks.push({
      id,
      label: format.label,
      what: format.what,
      accounts: accounts.length,
      posts: list.length,
      multiple: Math.round(median(list.map((r) => r.ratio)) * 10) / 10,
      rows: sorted,
      evidence: sorted.slice(0, 3).map(evidenceFrom),
    });
  }

  /**
   * Order by breadth first (how many independent accounts), then by how well it
   * did, then — only as a tiebreak — by whether the shape belongs to this kind of
   * account. Evidence decides; the family hint never overrules it.
   */
  const affinity = (id: VideoFormatId) => {
    const f = BY_ID.get(id);
    if (!f || !opts.family) return 0;
    return f.families.includes(opts.family) ? 1 : 0;
  };

  return picks.sort(
    (a, b) =>
      b.accounts - a.accounts ||
      b.multiple - a.multiple ||
      affinity(b.id) - affinity(a.id),
  );
}

/** Shapes the creator already posts, most used first. Used to name the gap. */
export function shapesTheyUse(reels: RawReel[]): { id: VideoFormatId; label: string; count: number }[] {
  const counts = new Map<VideoFormatId, number>();
  for (const r of reels) {
    const id = detectFormat(r);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: BY_ID.get(id)?.label ?? id, count }))
    .sort((a, b) => b.count - a.count);
}
