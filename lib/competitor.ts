import type { GrowthPlan } from "./types";

/**
 * Rewrite second person to third person, preserving the original casing.
 *
 * The plan builder writes its own explanations to the account's owner ("Your
 * best posts opened on a line", "accounts about your size"). On a competitor
 * page that text is still correct *about the account*, but it reads as if it
 * were addressed to the visitor. So authored prose is translated once, at the
 * route boundary — never the words other people actually wrote.
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

/*
 * What is rewritten, and what is not.
 *
 * A competitor read shows evidence about someone else, so only the sentences
 * *this product* wrote may be touched. Every piece of verbatim text — a
 * caption, a bio, a comment, a handle, a URL — is evidence, and rewriting it
 * would falsify what the account or its audience actually said. In particular,
 * a real comment "you need to watch this" must stay "you need to watch this".
 *
 * Authored prose (allow-list):
 *   cohort.basis
 *   standing.unreadReason
 *   audit.versusPeers
 *   audit.shapes[].label
 *   audit.gaps[].winners / .losers / .note
 *   archetype.label / .blurb / .language
 *   language.caveat / language.watched.skipped
 *   nicheFit.creatorShape / .creatorLanguage / .reasons[] / .accounts[].why
 *
 * Verbatim or opaque (never rewritten):
 *   audit.best/worst.caption and .url
 *   account.bio
 *   comments.questions / .objections / .requests / .praise / .language
 *   comments.seeds[].text
 *   any key named caption, bio, text, username, author or title
 *   handles, ids, URLs and numbers
 *   the searched phrase and language labels (niche, nicheFit.searched,
 *   language.wanted, language.word)
 *
 * `comments.seeds[].ideas` is not audience words and not a measured theme; it
 * is advice and is stripped in `toCompetitorView` rather than rewritten,
 * because its templates quote the comment inside the sentence.
 */
const AUTHORED_PROSE: readonly (readonly string[])[] = [
  ["cohort", "basis"],
  ["standing", "unreadReason"],
  ["audit", "versusPeers"],
  ["audit", "shapes", "*", "label"],
  ["audit", "gaps", "*", "winners"],
  ["audit", "gaps", "*", "losers"],
  ["audit", "gaps", "*", "note"],
  ["archetype", "label"],
  ["archetype", "blurb"],
  ["archetype", "language"],
  ["language", "caveat"],
  ["language", "watched", "skipped"],
  ["nicheFit", "creatorShape"],
  ["nicheFit", "creatorLanguage"],
  ["nicheFit", "reasons", "*"],
  ["nicheFit", "accounts", "*", "why"],
];

function isAuthoredProse(path: readonly string[]): boolean {
  return AUTHORED_PROSE.some(
    (pattern) =>
      pattern.length === path.length &&
      pattern.every((segment, i) => segment === "*" || segment === path[i]),
  );
}

/**
 * Walk the kept plan, translating only the paths this product authored.
 *
 * Keys are never rewritten; string values at verbatim paths pass through
 * byte-for-byte. Arrays use "*" as their path segment.
 */
function rewriteAuthoredProse(value: unknown, path: readonly string[] = []): unknown {
  if (typeof value === "string") {
    return isAuthoredProse(path) ? neutralisePerson(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteAuthoredProse(item, [...path, "*"]));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteAuthoredProse(v, [...path, k]);
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
 * Kept evidence is then split: authored prose is translated out of second
 * person, while captions, bios, comments and other verbatim text are left
 * exactly as written. Comment ideas are advice, not quotes, so they are
 * dropped.
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
    comments: plan.comments
      ? {
          ...plan.comments,
          seeds: plan.comments.seeds.map((seed) => ({ ...seed, ideas: [] })),
        }
      : undefined,
  };
  return rewriteAuthoredProse(kept) as GrowthPlan;
}
