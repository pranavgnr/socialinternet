import type { CommentMining, CommentSeed, RawComment } from "./types";

/**
 * Mining the comments for the next topic.
 *
 * A breakout reel tells you what travelled. The comments under it tell you why
 * people stayed, and they are written in the audience's own words — the one
 * input a creator cannot invent and a generated caption cannot fake. This is
 * also the cheapest useful thing in the whole product: the comments arrive in
 * the same one-credit call that returns the video.
 */

const QUESTION = /\?|^(how|why|what|when|where|which|can|could|do|does|did|is|are|should|would|will)\b/i;
const REQUEST =
  /\b(part 2|part two|tutorial|please (do|make|show)|can you (do|make|show|explain)|do a video|make a video|next video|more of this|teach (me|us)|where (do|did) you (get|buy)|link|price|which (one|app|tool|song)|what('s| is) the (song|audio|sound))\b/i;
const OBJECTION =
  /\b(doesn'?t work|not true|fake|misleading|too (expensive|hard|late)|no way|impossible|actually|but |wrong|cap\b|scam|overrated|easy for you)\b/i;
const LOW_SIGNAL =
  /^(nice|cool|awesome|great|wow+|love (it|this)|amazing|beautiful|🔥+|❤️+|👏+|🙌+|😂+|😍+|💯+|\p{Emoji}+)$/iu;
const SPAM = /\b(follow (me|back)|check (my|out my) (page|profile)|dm me|free followers|click (the )?link|promo|collab\?)\b/i;

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
  if (QUESTION.test(text)) return "question";
  if (REQUEST.test(text)) return "request";
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

  for (const c of all) {
    const text = clean(c.text ?? "");
    if (text.length < 8 || text.length > 240) continue;
    if (LOW_SIGNAL.test(text) || SPAM.test(text)) continue;
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
   */
  const seeds = [...buckets.values()]
    .filter((s) => s.kind !== "story" || s.asked > 1)
    .sort((a, b) => b.asked * 2 + Math.log10(b.likes + 1) - (a.asked * 2 + Math.log10(a.likes + 1)))
    .slice(0, 6);

  const language = [...languageCount.entries()]
    .filter(([, n]) => n >= Math.max(2, Math.round(read.length * 0.5)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);

  return {
    posts: reels.length,
    read: read.length,
    questions,
    objections,
    requests,
    seeds,
    language,
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
