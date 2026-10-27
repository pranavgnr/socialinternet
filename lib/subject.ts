import { words, type Matchable } from "./relevance";

/**
 * Is this reel about the thing the search asked for?
 *
 * Three vocabularies, deliberately different in strength:
 *
 *   · the phrase's subject words — matching "home" from "home cooking" proves
 *     very little, because half of Instagram lives at home;
 *   · the tags the pull itself uses (#recipe, #cooking);
 *   · the words at least a third of the *accounts* in the pull use. This is the
 *     one that carries the room: a cooking room says "recipe", "masala" and
 *     "chicken", and a house tour in the middle of it says none of them.
 *
 * A reel is kept when it matches any of the three, so a genuine outlier with an
 * odd caption is never thrown out for being unusual — it has to be described in
 * words the room does not use at all to be dropped.
 *
 * Language is not the only way a pull goes wrong. "english music covers" also
 * returns the cover artists' fit checks, birthday transitions and memes: they
 * are genuinely English, genuinely from the right creators, and completely
 * beside the point. One of them had 904k views — nearly four times the room's
 * median — so it did not merely sit in the list, it *was* the list: the median,
 * the hashtags and "what works in your space" were all computed over a fit
 * check.
 *
 * The test is the room's own vocabulary, because a space knows what it is
 * called better than a fixed word list does:
 *
 *   · the phrase's subject words ("cover" from "english music covers"), and
 *   · the tags the pull itself uses most — #cover, #songcover, #singingcover.
 *
 * Reach tags (#fyp, #viral, #explore) and the language in the phrase are
 * already stripped by `words()`, so what is left is the subject.
 *
 * Fails soft, like every other gate: if the vocabulary would leave too few
 * reels to build anything from, nothing is dropped and the page says the pull
 * could not be read that way. A wrong vocabulary must never empty a page.
 */

export interface SubjectOptions {
  /** below this many surviving reels, the gate stands down */
  minKept?: number;
  /** a tag has to appear in this share of the pull to enter the vocabulary */
  tagShare?: number;
}

/**
 * Words that join clauses rather than name a subject.
 *
 * "personal finance for young adults" is a request about *finance*; the words
 * after "for" describe who it is for. Only the part before the first of these
 * can carry the topic, which is what makes "finance" the head of that phrase
 * and "young" a modifier.
 */
const PHRASE_BREAK = new Set([
  "for", "in", "with", "at", "on", "to", "of", "and", "or", "from", "about",
  "into", "that", "which", "who",
]);

/**
 * The word that carries the topic: the last content word before the first
 * phrase break.
 *
 * This exists because the old gate accepted a reel that shared *any* one word
 * with the phrase, and one shared word is how a longevity video ended up as the
 * top finance benchmark: "MIT Longevity Expert: Do These 3 Things Now to Stay
 * Young" shares "young" with "personal finance for young adults", which is a
 * true match on the phrase and a useless match on the subject. "Young" is a
 * modifier; "finance" is the room. A match on the head alone is strong
 * evidence, a match on any other single word is not.
 */
export function headWord(query: string): string | null {
  const all = words(query);
  if (!all.length) return null;
  const raw = query.toLowerCase().replace(/[^a-z0-9\s#]/g, " ").split(/\s+/);
  let cutoff = raw.length;
  for (let i = 0; i < raw.length; i += 1) {
    if (PHRASE_BREAK.has(raw[i])) {
      cutoff = i;
      break;
    }
  }
  const head = words(raw.slice(0, cutoff).join(" "));
  if (head.length) return head[head.length - 1];
  /** The phrase opens with a break ("in the gym"): fall back to any subject word. */
  return all[0] ?? null;
}

export interface SubjectVerdict<T> {
  kept: T[];
  dropped: { reel: T; why: string }[];
  /** the words a reel had to share with the room */
  vocab: string[];
  /** false when the gate stood down; `reason` says why */
  applied: boolean;
  reason?: string;
}

/**
 * Words that at least two accounts in the pull use, so one account's habit
 * cannot define the room.
 *
 * This is the fix for the leak the tag vocabulary could not see: a search for
 * "home cooking" returned a lifestyle channel whose top video was a house tour,
 * and the tour caption shared the word "home" with the query — a true match on
 * the phrase and a useless match on the subject. A room-wide vocabulary is the
 * part that knows "kitchen", "recipe" and "chicken" belong and "apartment" does
 * not, because the cooking accounts all say the first three and none of them
 * say the fourth.
 */
/**
 * Words that title-writing makes frequent and that say nothing about a subject.
 *
 * The room vocabulary is "words most accounts use", and that test alone lets
 * YouTube's house style in: on a personal-finance pull, six of sixteen accounts
 * wrote "up" — "glow up", "grow up", "level up" — so "up" became a room word
 * and every beauty video that said "glow up" cleared the gate. The same pull
 * promoted "never", "wish", "need" and "feel" out of clickbait titles.
 *
 * None of these name a topic, so they are excluded from the vocabulary. Note
 * that "money", "finance" and "investing" survive: they are frequent *because*
 * the room is about them, which is exactly the signal this is meant to keep.
 */
const GENERIC = new Set([
  "up", "down", "out", "off", "over", "under", "back", "away", "again",
  "never", "ever", "always", "still", "even", "only", "just", "very",
  "wish", "need", "want", "feel", "think", "know", "look", "seem", "keep",
  "thing", "stuff", "way", "time", "minut", "second", "hour", "day", "week",
  "year", "life", "people", "someone", "anyone", "everyone", "nobody",
  "world", "part", "full", "real", "true", "whole", "half", "kind", "sort",
  "big", "small", "best", "worst", "top", "first", "last", "next", "many",
  "much", "more", "most", "every", "some", "any", "all", "other", "same",
  "guy", "dude", "bro", "girl", "boy", "man", "woman", "kid", "teen",
]);

function accountCoreTerms<T extends Matchable & { account?: string }>(
  posts: T[],
  share = 0.35,
): Set<string> {
  const perAccount = new Map<string, Set<string>>();
  for (const p of posts) {
    const key = (p.account ?? "").toLowerCase() || `__anon${perAccount.size}`;
    const set = perAccount.get(key) ?? new Set<string>();
    const text = [p.caption ?? "", (p.hashtags ?? []).join(" ")].join(" ");
    for (const w of words(text)) set.add(w);
    perAccount.set(key, set);
  }
  if (perAccount.size < 3) return new Set();

  const holders = new Map<string, number>();
  for (const set of perAccount.values()) {
    for (const w of set) holders.set(w, (holders.get(w) ?? 0) + 1);
  }
  const floor = Math.max(2, Math.ceil(perAccount.size * share));
  return new Set(
    [...holders.entries()]
      .filter(([w, n]) => n >= floor && w.length >= 2 && !GENERIC.has(w))
      .map(([w]) => w),
  );
}

export function keepOnSubject<
  T extends Matchable & { audioName?: string | null; account?: string },
>(
  posts: T[],
  query: string,
  opts: SubjectOptions = {},
): SubjectVerdict<T> {
  const tagShare = opts.tagShare ?? 0.2;

  const subject = new Set(words(query));
  if (!subject.size) {
    return { kept: posts, dropped: [], vocab: [], applied: false, reason: "the phrase names no subject" };
  }

  const core = accountCoreTerms(posts);

  /**
   * The pull's own tags, by how many reels carry them. Counting reels rather
   * than occurrences matters: one account that tags #songcover fifty times is
   * one account's habit, not the room's subject.
   */
  const holders = new Map<string, number>();
  for (const p of posts) {
    const seen = new Set<string>();
    for (const h of p.hashtags ?? []) for (const w of words(h)) seen.add(w);
    for (const w of seen) holders.set(w, (holders.get(w) ?? 0) + 1);
  }
  const floor = Math.max(3, Math.ceil(posts.length * tagShare));
  const fromTags = [...holders.entries()]
    .filter(([w, n]) => n >= floor && !subject.has(w) && !GENERIC.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);

  const vocab = [...new Set([...subject, ...fromTags])];
  const vocabSet = new Set(vocab);
  const head = headWord(query);

  /**
   * A reel is dropped only when it had the words to say what it is about and
   * said something else.
   *
   * This is the same one-sided rule as the language gate, and for the same
   * reason: a Kannada cover captioned and tagged entirely in Kannada script has
   * no Latin word to match the room's English vocabulary, and reading that as
   * "not about covers" threw out 28 of 66 real Kannada covers. Silence is a gap
   * in the evidence, not a contradiction — so a reel with fewer than two
   * readable words is kept, and only a caption that plainly describes something
   * else ("lil fit check") is dropped.
   */
  const fits = (p: T): boolean => {
    const text = [p.caption ?? "", (p.hashtags ?? []).join(" "), p.audioName ?? ""].join(" ");
    const tokens = words(text);
    /**
     * Two readable words minimum before the silence rule applies. A caption of
     * "🎵" or "#shorts" says nothing either way and must never be evidence
     * against a reel; a caption with four words chose them.
     */
    if (tokens.length < 2) return true;

    /**
     * Evidence is counted, not merely detected.
     *
     * One shared word used to be enough, and that is how a longevity video
     * became the top benchmark in a personal-finance pull: its caption shares
     * "young" with "personal finance for young adults". The head word is worth
     * two because it names the room; every other match is worth one, so a reel
     * that only says "young" scores 1 and is dropped, while one that says
     * "finance" or "money and investing" clears the bar.
     */
    let weight = 0;
    for (const w of tokens) {
      /**
       * Two kinds of strong evidence: the head word ("finance"), and any word
       * the room itself keeps using ("money", "investing"). A room word is
       * strong precisely because the *accounts* chose it — "money" is not in
       * the phrase the user typed, it is how 10 of 16 finance accounts talk, so
       * "Major MONEY Milestones To Accomplish in Your 20s" is kept.
       */
      if (w === head || core.has(w)) weight += 2;
      /** A modifier from the phrase, or the pull's own tag, is a single vote. */
      else if (vocabSet.has(w)) weight += 1;
      if (weight >= 2) return true;
    }
    return false;
  };

  const kept: T[] = [];
  const dropped: { reel: T; why: string }[] = [];
  for (const p of posts) {
    if (fits(p)) kept.push(p);
    else dropped.push({ reel: p, why: "described in words the room does not use" });
  }

  /**
   * Stand down only when the *accounts* have nothing to say about the subject.
   *
   * The old rule stood down whenever fewer than six in ten reels matched, and
   * that was measuring the wrong thing. Plenty of real accounts post mostly
   * beside the point: a comedy channel whose uploads include three finance
   * interviews has 2 on-subject reels out of 31, and that pulled the whole-pull
   * share down to 36% on a personal-finance search. The room was right — 13 of
   * its 16 accounts had on-subject work — but the gate read the account's own
   * variety as evidence that the search was wrong, switched itself off, and
   * handed back every reel including the off-subject ones it was built to drop.
   *
   * So the question is asked per account: if at least three accounts have two
   * or more on-subject reels, this is the right room and filtering is safe. A
   * genuinely wrong room fails that test hard — a cooking pull answering a
   * finance search leaves no account with finance evidence at all.
   */
  const perAccount = new Map<string, number>();
  for (const p of kept) {
    const key = (p.account ?? "").toLowerCase() || "__anon";
    perAccount.set(key, (perAccount.get(key) ?? 0) + 1);
  }
  const anchored = [...perAccount.values()].filter((n) => n >= 2).length;
  const floorKept = opts.minKept ?? 8;

  if (kept.length < floorKept || anchored < 3) {
    return {
      kept: posts,
      dropped: [],
      vocab,
      applied: false,
      reason:
        `only ${kept.length} of ${posts.length} reels from ${anchored} accounts use words from this room, ` +
        "so nothing was dropped — the phrase and the pull may not describe the same subject",
    };
  }
  return { kept, dropped, vocab, applied: true };
}

