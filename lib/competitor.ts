import type { GrowthPlan } from "./types";

/**
 * Rewrite second person to third person, preserving the original casing.
 *
 * The plan builder writes every explanation to the account's owner ("Your best
 * posts opened on a line", "accounts about your size"). On a competitor page
 * that text is still correct *about the account*, but it reads as if it were
 * addressed to the visitor and can make them mistake the numbers for their own.
 * So the kept evidence is translated once, at the route boundary.
 */
export function neutralisePerson(text: string): string {
  return text.replace(SECOND_PERSON, (word) => matchCase(word, replacementFor(word)));
}

/**
 * Longest alternatives first: "yourself" before "yours" before "your", and the
 * contractions before the bare "you" so "you're" never becomes "they're" by way
 * of matching "you" alone.
 *
 * Both straight and curly apostrophes are accepted because captions and model
 * output use both.
 */
const SECOND_PERSON =
  /\b(yourself|yours|your|you['’]re|you['’]ve|you['’]ll|you)\b/gi;

const THIRD_PERSON: Record<string, string> = {
  yourself: "themselves",
  yours: "theirs",
  your: "their",
  "you're": "they're",
  "you've": "they've",
  "you'll": "they'll",
  you: "they",
};

function replacementFor(word: string): string {
  const lower = word.toLowerCase().replace(/’/g, "'");
  const base = THIRD_PERSON[lower] ?? "they";
  // Give the replacement the same apostrophe the source used.
  if (word.includes("’") && base.includes("'")) {
    return base.replace("'", "’");
  }
  return base;
}

/** "Your" → "Their", "YOUR" → "THEIR", "your" → "their". */
function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return replacement.toUpperCase();
  }
  const first = source[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Keys whose values are identifiers, not prose: never rewrite their contents. */
const IDENTIFIER_KEYS = new Set(["id", "handle", "url", "href"]);

/** A string that is a link or a handle, not a sentence addressed to anyone. */
function isOpaque(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("@");
}

/**
 * Walk the kept plan and translate every prose string.
 *
 * Keys are never rewritten, and values that are identifiers, links or handles
 * are left exactly as authored. Numbers and booleans pass through untouched.
 * Fields `toCompetitorView` strips are already absent, so this cannot rewrite
 * advice that was removed.
 */
function neutraliseDeep(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (IDENTIFIER_KEYS.has(key) || /Id$/.test(key)) return value;
    if (isOpaque(value)) return value;
    return neutralisePerson(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => neutraliseDeep(item, key));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = neutraliseDeep(v, k);
    }
    return out;
  }
  return value;
}

/**
 * The competitor view of a plan.
 *
 * `analyseHandle` builds one plan shape for everyone: it diagnoses the account,
 * decides the next move, and writes the ideas behind it. That is right for the
 * creator who owns the handle and wrong for someone reading a public account —
 * advice is not transferable, and the evidence is.
 *
 * So the measured half stays (standing, the best and worst posts with their
 * explanations, the comment themes, the archetype label, the cohort) and every
 * field that speaks to the account's owner is removed: the next move, the move
 * list, the diagnosis, the songs/formats/hooks advice and the hook reading.
 * `moves`, `gaps`, `questions`, `diagnosis` are cleared rather than deleted so
 * the returned value still satisfies `GrowthPlan` and a page can render it
 * without defensive checks.
 *
 * What survives is then translated out of second person, because the source
 * strings were written for the account's owner, not for this visitor.
 */
export function toCompetitorView(plan: GrowthPlan): GrowthPlan {
  const kept: GrowthPlan = {
    ...plan,
    diagnosis: "",
    gaps: [],
    moves: [],
    questions: [],
    nextMove: undefined,
    songs: undefined,
    formats: undefined,
    hooks: undefined,
    hookRead: undefined,
  };
  return neutraliseDeep(kept) as GrowthPlan;
}
