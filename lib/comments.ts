import { readFileSync } from "node:fs";
import path from "node:path";

import type { CommentMining, CommentSeed, RawComment } from "./types";

/** The enrichment step's own cache; the comments in it are already paid for. */
const CACHE_PATH = path.join(process.cwd(), "data", "_post_cache.json");

/**
 * Mining the comments for the next topic.
 *
 * A breakout reel tells you what travelled. The comments under it tell you why
 * people stayed, and they are written in the audience's own words — the one
 * input a creator cannot invent and a generated caption cannot fake. This is
 * also the cheapest useful thing in the whole product: the comments arrive in
 * the same one-credit call that returns the video.
 */

/**
 * What counts as a question.
 *
 * This used to be `/^(how|why|what|when|where|which|can|…)\b/` — a bare
 * word-start test — and it labelled the audience's praise as questions. On a
 * real @natgeotravel week the "what people asked for" section read:
 *
 *   "What a wonderful video for our beautiful country! 🇬🇷"
 *   "Where I'm from and where I live! 😍"
 *   "Where the mountains sing through the screams of seagulls…"
 *
 * All three were shown as *asked*, all three are a compliment and a song
 * lyric, and the one line a creator could have acted on was pushed down the
 * list. A word at the start of a sentence is not a question; the mark is, or
 * the ask has to be spelled out. Praise is checked before this runs.
 */
const QMARK = /\?/;
const ASK_OPEN =
  /^(how (do|did|can|would) (i|you|we)|how (long|much|many)\b|where (can|do|did) (i|you)|what('s| is| was) the (song|audio|sound|name)|which (app|tool|song|one|filter)\b|can (you|someone|anyone)|could you|do you (know|have|sell)|does (anyone|anybody) know|any(one|body) know|is (there|it) (a|possible)|should i)\b/i;
const REQUEST =
  /\b(part 2|part two|tutorial|please (do|make|show)|can you (do|make|show|explain)|do a video|make a video|next video|more of this|teach (me|us)|where (do|did) you (get|buy)|link|price|which (one|app|tool|song)|what('s| is) the (song|audio|sound))\b/i;
/**
 * A real disagreement, not the word "but".
 *
 * `but ` and `actually` used to be in here, and they are ordinary words in a
 * joke: "Before seeing it I thought your mother was innocent but the reality
 * is 🔥😂" was being filed as pushback the creator should answer. An objection
 * has to say what is wrong, so the patterns name the wrongness.
 */
const OBJECTION =
  /\b(doesn'?t work|didn'?t work|not true|fake|misleading|misinform\w*|clickbait|too (expensive|hard|late|long|slow)|no way|impossible|wrong|scam|overrated|easy for you|(don'?t|do not) like|not (accurate|correct|right)|you missed|nothing new)\b/i;
const LOW_SIGNAL =
  /^(nice|cool|awesome|great|wow+|love (it|this)|amazing|beautiful|🔥+|❤️+|👏+|🙌+|😂+|😍+|💯+|\p{Emoji}+)$/iu;
const SPAM = /\b(follow (me|back)|check (my|out my) (page|profile)|dm me|free followers|click (the )?link|promo|collab\?)\b/i;

/**
 * Emoji, with and without the pieces that break the obvious regex.
 *
 * `\p{Emoji}+` looks like it covers this and does not: a heart arrives as
 * U+2764 + U+FE0F, a fist as an emoji + skin-tone modifier, a family as three
 * emoji joined by U+200D, and a keycap ends in U+20E3. Any one of those makes
 * the anchored match fail, so "❤️🙌🔥😍😍😍" was passing as a real comment and
 * — because it appeared three times — was being ranked as the top thing the
 * audience asked for.
 */
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu;

/** Praise, which is not a request however often it is repeated. */
const PRAISE =
  /\b(beautiful|gorgeous|stunning|nice|cool|awesome|amazing|great|superb|wonderful|lovely|perfect|best|mast|mastt|sahi|badiya|so good|too good|well done|keep it up|keep going|respect)\b/i;

/** How many real words are left once the emoji and the punctuation are gone. */
function substance(text: string): number {
  const bare = text
    .replace(EMOJI, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!bare) return 0;
  return bare.split(" ").filter((w) => w.length > 1).length;
}

/**
 * True when a comment says nothing that could become a post.
 *
 * Two shapes: nothing left after the emoji, and short praise. The word count
 * only decides the second case — "Song name?" has two words and is the single
 * most useful comment on the post, so a question is never dropped for being
 * short. Four words is the ceiling for praise so that "the song is beautiful
 * but what are the chords?" survives.
 */
/**
 * Whether a comment is shaped like a question at all.
 *
 * A question mark, or an ask spelled out in the opening words. Deliberately
 * not "starts with what/where/who": that is how praise and lyrics were being
 * counted as requests.
 */
function asks(text: string): boolean {
  return QMARK.test(text) || ASK_OPEN.test(text);
}

function isNoise(text: string): boolean {
  if (substance(text) === 0) return true;
  if (asks(text)) return false;
  if (substance(text) < 3) return true;
  return PRAISE.test(text) && substance(text) <= 4;
}

function clean(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\w+/g, "")
    .trim();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

const STOP = new Set([
  "this", "that", "with", "have", "your", "youre", "just", "from", "they", "them",
  "what", "when", "will", "would", "could", "should", "about", "there", "their",
  "like", "make", "made", "video", "reel", "please", "really", "very", "much",
  "more", "than", "then", "also", "because", "into", "over", "only", "some",
  "want", "need", "know", "think", "gonna", "thing", "things", "here", "where",
]);

/** The same ask phrased five ways has to collapse to one idea. */
function signature(text: string): string {
  const w = words(text).slice(0, 4).sort();
  return w.join(" ");
}

function kindOf(text: string): CommentSeed["kind"] {
  /**
   * Order matters: a request is the most actionable thing in a thread, then a
   * disagreement (which tells the creator what to defend or correct), and only
   * then a plain question. Praise never reaches here — it is counted as noise
   * upstream — and anything left is a story, which is not an ask.
   */
  if (REQUEST.test(text)) return "request";
  if (PRAISE.test(text) && !asks(text)) return "story";
  if (OBJECTION.test(text) && !ASK_OPEN.test(text)) return "objection";
  if (asks(text)) return "question";
  if (OBJECTION.test(text)) return "objection";
  return "story";
}

/** What to make from one comment, in the creator's terms. */
function ideasFor(text: string, kind: CommentSeed["kind"]): string[] {
  const subject = text.replace(/[?.!]+$/, "").replace(/^(how|why|what|can|do|does|is|are|should)\s+/i, "");
  switch (kind) {
    case "question":
      return [
        `Answer it on camera in the first line, then show it: “${subject.slice(0, 80)}”`,
        `Make the answer the hook of a 20-second reel — the question is already proven demand`,
      ];
    case "objection":
      return [
        `Take the objection head-on: start with the doubt, then disprove it with one clip`,
        `Show the failure case first, then the fix — objections are the best openings`,
      ];
    case "request":
      return [
        `Make exactly what was asked for: “${subject.slice(0, 80)}”`,
        `Do the promised part two — a request in the comments is a title already written`,
      ];
    default:
      return [
        `Turn their story into a hook: “someone told me ${subject.slice(0, 70)}…”`,
        `Ask the same thing back to the camera and let the comments answer it`,
      ];
  }
}

/**
 * Comments already paid for, read back off the post cache.
 *
 * The bug this closes: the comment section appeared and vanished between runs.
 * Mining only ever looked at what this run's enrichment pass returned, and
 * enrichment is skipped whenever its six credits are gone or the vendor is out
 * of allowance — at which point a plan that had read 14 comments under a reel
 * last week showed no comment section at all, with no hint that it had ever
 * existed. The same comments were sitting in `data/_post_cache.json` for a week.
 *
 * A comment is a paid-for fact, so it outlives the run that bought it. Nothing
 * here spends credits: it reads the cache the enrichment step already writes.
 */
export function cachedCommentsByUrl(): Map<string, RawComment[]> {
  const out = new Map<string, RawComment[]>();
  try {
    const raw = readFileSync(CACHE_PATH, "utf8");
    const cache = JSON.parse(raw) as Record<string, { topComments?: RawComment[] }>;
    for (const [url, row] of Object.entries(cache)) {
      const list = (row?.topComments ?? []).filter((c) => typeof c?.text === "string");
      if (list.length) out.set(normaliseUrl(url), list);
    }
  } catch {
    /* no cache, no comments — the page says it read none, which is true */
  }
  return out;
}

/** Post URLs arrive with and without a trailing slash and with tracking junk. */
export function normaliseUrl(url: string): string {
  return url.split("?")[0].replace(/\/+$/, "").toLowerCase();
}

export function mineComments(
  reels: { url: string; comments?: RawComment[] }[],
  opts: { minComments?: number } = {},
): CommentMining {
  const read = reels.filter((r) => (r.comments?.length ?? 0) > 0);
  const all: RawComment[] = read.flatMap((r) => r.comments ?? []);

  const buckets = new Map<string, CommentSeed>();
  const languageCount = new Map<string, number>();
  const questions: string[] = [];
  const objections: string[] = [];
  const requests: string[] = [];
  /** everything that was read but could never become a post, by repetition */
  const noise = new Map<string, { text: string; n: number }>();
  let dropped = 0;

  for (const c of all) {
    const text = clean(c.text ?? "");
    if (text.length < 8 || text.length > 240) {
      dropped += 1;
      const key = text.slice(0, 40).toLowerCase();
      const seen = noise.get(key);
      if (seen) seen.n += 1;
      else if (text) noise.set(key, { text: text.slice(0, 60), n: 1 });
      continue;
    }
    if (LOW_SIGNAL.test(text) || SPAM.test(text) || isNoise(text)) {
      dropped += 1;
      const key = text.slice(0, 40).toLowerCase();
      const seen = noise.get(key);
      if (seen) seen.n += 1;
      else noise.set(key, { text: text.slice(0, 60), n: 1 });
      continue;
    }
    const kind = kindOf(text);
    for (const w of words(text)) languageCount.set(w, (languageCount.get(w) ?? 0) + 1);

    const sig = signature(text);
    const key = `${kind}:${sig}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.asked += 1;
      existing.likes = Math.max(existing.likes, c.likes ?? 0);
      continue;
    }
    buckets.set(key, {
      text: text.slice(0, 180),
      asked: 1,
      likes: c.likes ?? 0,
      kind,
      ideas: ideasFor(text, kind),
    });

    if (kind === "question" && questions.length < 12) questions.push(text.slice(0, 160));
    if (kind === "objection" && objections.length < 8) objections.push(text.slice(0, 160));
    if (kind === "request" && requests.length < 8) requests.push(text.slice(0, 160));
  }

  /**
   * Ranking is by how often the thing was asked and how loudly, never by how
   * nice the comment reads. One ask with 400 likes outranks five quiet ones.
   *
   * Stories are excluded outright. "This is beautiful, I love it" repeated
   * three times used to sit at the top of this list, pushing "can you show the
   * strumming pattern" to fourth — the section was technically full and told
   * the creator nothing they could make. Only questions, requests and
   * objections are asks; a story is not one, no matter how often it repeats.
   */
  const seeds = [...buckets.values()]
    .filter((s) => s.kind !== "story")
    .sort((a, b) => b.asked * 2 + Math.log10(b.likes + 1) - (a.asked * 2 + Math.log10(a.likes + 1)))
    .slice(0, 6);

  const language = [...languageCount.entries()]
    .filter(([, n]) => n >= Math.max(2, Math.round(read.length * 0.5)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);

  /**
   * What the thread said when it asked for nothing.
   *
   * A NatGeo reel draws "😍😍😍😍", "Bravo au photographe", "C superbe quelle
   * beauté" — a real audience, a full comment section, and not one thing to
   * make. That is an answer, and it is worth showing: it tells the creator the
   * posts are being admired rather than used, which is a different problem
   * from having nothing to say. Reported as counts and samples, never dressed
   * up as a request.
   */
  const praise = [...noise.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((p) => p.text);

  return {
    posts: reels.length,
    read: read.length,
    questions,
    objections,
    requests,
    seeds,
    language,
    dropped,
    praise,
  };
}

/** One line for the page header. Empty when nothing was read. */
export function commentLine(mining: CommentMining | undefined): string {
  if (!mining || mining.read === 0) return "";
  const top = mining.seeds[0];
  return top
    ? `${mining.read} comment threads read · most-repeated ask: “${top.text.slice(0, 70)}”`
    : `${mining.read} comment threads read`;
}
