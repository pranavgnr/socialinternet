import { isLanguageWord } from "./lang";
import { isStopword, looksEnglish } from "./text";
import type { Profile } from "./types";

/**
 * Is this post actually about the creator's space?
 *
 * A keyword search for "ai automation" returns anything an SEO-hungry account
 * decided to tag that way. Without this gate the plan recommends a reel about a
 * high-speed packing machine to someone who posts AI agent demos: the maths is
 * right (it did 50x its account's usual views) and the advice is useless.
 *
 * Relevance is measured against the space's own vocabulary — the niche phrase,
 * the mined pillars and the creator's own winning captions — so a singer is
 * judged on music words, not on Instagram's suggested tags.
 */

/** Words too common in any caption to prove anything about the topic. */
const WEAK = new Set([
  "the", "and", "for", "with", "your", "you", "this", "that", "from", "how",
  "why", "what", "when", "who", "are", "was", "were", "have", "has", "had",
  "not", "but", "all", "can", "will", "just", "get", "got", "make", "made",
  "new", "one", "two", "day", "days", "week", "weeks", "today", "now",
  "video", "videos", "reel", "reels", "post", "posts", "content", "creator",
  "creators", "instagram", "follow", "like", "comment", "share", "link", "bio",
  "more", "best", "top", "here", "there", "they", "them", "their", "our",
  "about", "into", "out", "off", "over", "under", "than", "then", "also",
  "very", "really", "actually", "literally", "would", "could", "should",
  // reach tags: every account in every space uses these, so they prove nothing
  "fyp", "fypage", "foryou", "foryoupage", "viral", "trending", "trend",
  "explore", "explorepage", "reelsinstagram", "instagood", "love", "song",
  "songs", "music", "video", "new", "short", "shorts",
]);

/** "covers" and "cover" are the same evidence; "covers" as a noun is too. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("es") && !word.endsWith("ses")) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Two letters matter here ("AI"), so this does not reuse contentWords(), which
 * drops them. Hashtags count: they are the account's own description of itself.
 */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    // Stopwords are tested before stemming: "this" would otherwise become "thi"
    // and start matching unrelated captions.
    /**
     * The language in a phrase ("english music covers") is a constraint, not a
     * subject. Counting it as a topic word made "english" match any caption
     * containing the word, and left the real mismatch to be caught by nothing.
     * lib/lang.ts gates on it properly, before the maths.
     */
    .filter(
      (w) =>
        w.length >= 2 &&
        /[a-z]/.test(w) &&
        !isStopword(w) &&
        !WEAK.has(w) &&
        !isLanguageWord(w),
    )
    .map(stem);
}

export interface NicheVocab {
  terms: Map<string, number>;
}

/**
 * The vocabulary of a space, weighted by how much it says about the space.
 * The niche phrase is the strongest signal; mined pillars and the creator's own
 * winners are supporting evidence.
 */
export function nicheVocab(profile: Profile): NicheVocab {
  const terms = new Map<string, number>();
  const add = (text: string | undefined, weight: number) => {
    if (!text) return;
    for (const w of words(text)) {
      terms.set(w, Math.max(terms.get(w) ?? 0, weight));
    }
  };

  // The space's own name is the one description we know is right — it is what
  // the creator (or the search) asked for.
  add(profile.niche, 1);
  for (const k of profile.keywords ?? []) add(k, 1);

  /**
   * Mined pillars are supporting evidence only. They are guesses derived from
   * other people's captions, so they count a quarter and can never carry a post
   * over the bar on their own — a bad pillar ("riding bag") would otherwise
   * pull a whole unrelated account into the space.
   *
   * Captions the creator wrote are deliberately not here: they arrive with the
   * hashtag soup attached (#fyp, #fypppp), which makes every post look relevant.
   */
  for (const p of profile.pillars ?? []) add(p, 0.25);

  return { terms };
}

export interface Matchable {
  caption: string;
  hashtags?: string[];
}

/**
 * Weighted count of the space's words this post uses. 0 means "not about it".
 *
 * The caption counts fully and hashtags count half: what a creator wrote is
 * evidence, what they tagged themselves is a claim. An SEO account will happily
 * tag #aiautomation on an industrial packing machine.
 */
export interface RelevanceParts {
  /** caption + hashtag evidence, the number the gate used to rank on */
  score: number;
  /** the part of that which the creator actually wrote, not tagged */
  caption: number;
  /**
   * A written English caption long enough that its silence means something. A
   * "Adiga Adiga 🎵 #telugucovers" post has no room to name its subject; an
   * eleven-line industrial product description has plenty, and if it never
   * mentions the space, it is not in it however it tagged itself.
   */
  longForm: boolean;
}

export function relevanceParts(post: Matchable, vocab: NicheVocab): RelevanceParts {
  if (!vocab.terms.size) return { score: 1, caption: 1, longForm: false };

  const text = post.caption ?? "";
  const inCaption = new Set(words(text));
  const longForm = inCaption.size >= 20 && looksEnglish(text);
  /**
   * A Telugu, Hindi or Indonesian caption says nothing in English, so its
   * hashtags are the only evidence available and they have to count in full.
   * When the caption does speak — English, three words or more — tags are the
   * creator's marketing claim and count half.
   */
  const speaks = inCaption.size >= 3 && looksEnglish(text);
  const tagWeight = speaks ? 0.5 : 1;

  let caption = 0;
  for (const w of inCaption) caption += vocab.terms.get(w) ?? 0;

  let tagged = 0;
  for (const w of new Set((post.hashtags ?? []).flatMap((h) => words(h)))) {
    if (!inCaption.has(w)) tagged += tagWeight * (vocab.terms.get(w) ?? 0);
  }
  return { score: caption + tagged, caption, longForm };
}

export function relevance(post: Matchable, vocab: NicheVocab): number {
  return relevanceParts(post, vocab).score;
}

/**
 * Drop posts that are not about the space.
 *
 * The bar is two separate words from the space, because one shared word is how
 * noise gets in: an industrial packing machine caption says "automation", which
 * is a true match on the keyword and a useless match on the topic.
 *
 * Tags alone never qualify a post. An SEO account tags #aiautomation on a
 * screw-counting machine and would otherwise clear any keyword bar; what makes
 * a post evidence is the creator *writing* about the space, not claiming it.
 * So the first pass keeps only posts whose own words match, and tags are the
 * fallback for the accounts that cannot say it in English at all.
 *
 * Fails soft rather than empty. If too few posts clear the caption bar the gate
 * drops to tag evidence, and if nothing at all matches the pool is returned
 * untouched — a bad vocabulary must not leave a creator with an empty page.
 */
export function keepRelevant<T extends Matchable>(
  posts: T[],
  vocab: NicheVocab,
  min = 2,
): T[] {
  if (!vocab.terms.size) return posts;

  const scored = posts.map((p) => ({ p, ...relevanceParts(p, vocab) }));

  /**
   * Wrote about it: two words from the space in the caption, or one in the
   * caption plus a matching tag. Requires the caption to carry weight either
   * way, which is what keeps tagged-only accounts out.
   */
  const written = scored
    .filter((s) => s.caption >= 1 && s.score >= min)
    .map((s) => s.p);
  if (written.length >= Math.min(posts.length, 8)) return written;

  /**
   * Not enough to build anything from on captions alone — normal in spaces
   * whose captions are transliterated ("Adiga Adiga from Ninnukori #TeluguCovers")
   * and score only through their tags. Take every post with a match rather than
   * shipping two ideas.
   */
  /**
   * A long caption gets no discount for being long: it had every chance to
   * clear the normal bar, so it is held to it. One stray "AI" in an eleven-line
   * description of a screw-counting machine is not evidence of anything.
   */
  const tagged = scored
    .filter((s) => (s.longForm ? s.score >= min : s.score >= 1))
    .map((s) => s.p);
  if (tagged.length > written.length) return tagged;
  /**
   * Nothing matched at all. Returning the whole pool here was how a Japanese
   * tag-spam page and a Mexican corridos singer ended up as benchmark evidence
   * for an English covers creator: the gate failed open exactly when the pool
   * was worst. No evidence means no evidence — an empty list is the honest
   * answer, and the page says so.
   */
  return written;
}

/**
 * One lucky account should not fill the feed. Keeps the strongest post per
 * account first, then allows a second, so the ideas stay varied without
 * discarding a genuinely strong account.
 */
export function capPerAccount<T extends { account: string }>(
  items: T[],
  max = 2,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const n = counts.get(item.account) ?? 0;
    if (n >= max) continue;
    counts.set(item.account, n + 1);
    out.push(item);
  }
  return out;
}
