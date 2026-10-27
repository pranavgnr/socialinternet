/**
 * Free text -> the rooms an engine can actually price.
 *
 * The recommendation flow used to be: free text -> matchInterests -> candidatesFor.
 * `matchInterests` only fires on words already listed in the taxonomy, so what a
 * real creator types mostly produced nothing: measured on 86 realistic phrases
 * (`scripts/check-coverage.ts`), **63 of them (73%) resolved to zero rooms**, and
 * the route answered "Pick at least one thing you know" to someone who had just
 * told us exactly what they know. A brand-new creator is the user who can only
 * describe themselves in their own words, so that dead end hit the exact person
 * this product exists for.
 *
 * This module fixes the class of failure rather than the instances. The taxonomy
 * stays as the fast path — it is free, instant and already right for its 26
 * groups — and everything else is resolved by an LLM that turns a description
 * into concrete rooms, with a disk cache so the second person to type the same
 * thing pays nothing, and a heuristic fallback so the flow still works when the
 * LLM is down.
 *
 * The rules in `nicheSeeds.ts` (a subject not a mood, two to four words, no
 * platform words) are the contract for every phrase that comes out of here,
 * because each one becomes a paid vendor call and a room with no winners in it
 * is a wasted credit.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { jsonCall, llmReady } from "./llm";
import {
  INTERESTS,
  ambiguousWords,
  candidatesFor,
  matchInterests,
  wordWeight,
} from "./nicheSeeds";

const CACHE_PATH = path.join(process.cwd(), "data", "_intent_cache.json");
/**
 * Bumped whenever the resolver's *decisions* would change, not just its code.
 * Version 4 weights ambiguous words at half and orders a group by how much of
 * it the creator actually named — so every room list cached before it is the
 * old, wrong ranking ("home cooking" answered with a gym).
 *
 * Version 5 ranks interests by match quality instead of declaration order and
 * chooses the room inside a group by overlap with what was typed. Every cached
 * room list before it is the old one, where "dog training" answered with a gym.
 */
const CACHE_VERSION = 5;

/** One room, ready to become a vendor search. */
export interface Room {
  query: string;
  /** why this room, in the creator's terms — shown under the chip */
  why: string;
  /** where it came from, so a wrong answer is diagnosable */
  source: "taxonomy" | "llm" | "heuristic";
}

export interface ResolvedIntent {
  input: string;
  /** rooms to price, best first */
  rooms: Room[];
  /** neighbouring spaces a newcomer could enter — the "what else could I do" answer */
  adjacent: Room[];
  /** words describing what they know, for the fit score */
  words: string[];
  /** taxonomy groups that fired, if any */
  interests: string[];
  /** how the answer was produced */
  via: "taxonomy" | "llm" | "cache" | "heuristic" | "none";
}

/**
 * Words that describe the platform rather than a subject. A search for these
 * returns the whole of Instagram instead of a room, so they are rejected on the
 * way in and on the way out of the LLM.
 */
const PLATFORM_WORDS =
  /\b(reels?|viral|fyp|foryou|trending|content|creator|followers?|instagram|ig|tiktok|shorts?|algorithm|engagement|niche|channel)\b/i;

/** Words that carry no subject on their own. */
const STOPWORDS = new Set(
  `a an the and or but if then than that this these those i im i'm my me we our you your
   he she it they them his her its is am are was were be been being do does did doing
   have has had having will would can could should may might must just very really quite
   about into onto from with without for to of in on at by as so not no yes want wanna
   like love enjoy know good at something anything stuff things thing work working
   new beginner starting start post posting make making create creating get getting
   more most some any all also too only even still because while when where who what
   how why your yours theirs mine ours day days week weeks year years time times lot
   bit little much many few own same other another around`
    .split(/\s+/)
    .filter(Boolean),
);

interface CacheRow {
  version: number;
  at: string;
  result: ResolvedIntent;
}

type Cache = Record<string, CacheRow>;

function readCache(): Cache {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf8");
  } catch {
    /* a failed cache write costs one LLM call later, not a broken flow */
  }
}

function keyFor(text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha1").update(norm).digest("hex").slice(0, 16);
}

/**
 * Is this phrase usable as a room?
 *
 * Enforced on every phrase regardless of source, because the LLM will
 * occasionally answer with "content creation" or a single abstract noun, and an
 * untrimmed phrase is a paid search for nothing.
 */
export function usableRoom(query: string): boolean {
  const q = query.trim().replace(/^#+/, "").toLowerCase();
  if (!q) return false;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (PLATFORM_WORDS.test(q)) return false;
  // A room needs at least one concrete word that is not a stopword.
  const concrete = words.filter((w) => !STOPWORDS.has(w) && w.length > 2);
  if (!concrete.length) return false;
  return true;
}

function clean(query: string): string {
  return query
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * The no-LLM fallback: pull the most subject-like words out of the sentence.
 *
 * Deliberately crude. Its only job is to stop a dead end when the LLM is
 * unreachable — a mediocre room that gets priced beats an error message. It
 * prefers 2-3 word phrases because single words ("pottery") tend to be too broad
 * to have a coherent set of winners while 4+ words are usually a whole title.
 */
export function heuristicRooms(text: string): Room[] {
  const words = (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter(
    (w) => !STOPWORDS.has(w) && !PLATFORM_WORDS.test(w),
  );
  if (!words.length) return [];

  const uniq: string[] = [];
  for (const w of words) if (!uniq.includes(w)) uniq.push(w);

  const out: Room[] = [];
  // Adjacent pairs first: "vintage watch", "dog training" — the shape of a room.
  for (let i = 0; i < uniq.length - 1 && out.length < 3; i++) {
    const phrase = `${uniq[i]} ${uniq[i + 1]}`;
    if (usableRoom(phrase)) {
      out.push({ query: phrase, why: `built from “${phrase}” in what you wrote`, source: "heuristic" });
    }
  }
  // Then the strongest single words, as a fallback of last resort.
  for (const w of uniq) {
    if (out.length >= 4) break;
    if (out.some((r) => r.query.includes(w))) continue;
    if (usableRoom(w)) {
      out.push({ query: w, why: `the subject word “${w}”`, source: "heuristic" });
    }
  }
  return out;
}

interface LlmIntent {
  rooms?: { query?: string; why?: string }[];
  adjacent?: { query?: string; why?: string }[];
  words?: string[];
  note?: string;
}

const SYSTEM = `You map a creator's own description of themselves onto Instagram "rooms" (niches) that can be searched.

A room is a subject that a set of accounts post about. Good rooms: "home workout", "street food", "personal finance", "dog training", "vintage watch restoration".
Not rooms: "fitness" (too broad), "discipline" (a mood), "reels" (the platform), "content creation" (a job description).

Rules for every room you return:
1. Two to four words, lowercase, the way a person would type a search.
2. A concrete subject, not a feeling and not a platform word.
3. Specific enough that its winners have something in common, broad enough that more than a handful of accounts post in it.
4. Rooms must be distinct from each other, not four synonyms of one idea.

Return JSON exactly:
{
  "rooms": [{"query": "...", "why": "under 12 words, why this fits what they said"}],
  "adjacent": [{"query": "...", "why": "under 12 words, what makes this a reachable next step"}],
  "words": ["8-12 lowercase words describing what this person knows or has access to"],
  "note": "one short line naming the space you think they are really in"
}

"rooms": 3-4 rooms that directly match what they described.
"adjacent": 2-3 neighbouring rooms where the same knowledge is valuable but the competition is thinner — this is for someone with no audience yet.
"words": the vocabulary of their knowledge, used to score how well a room fits them.`;

/**
 * Ask the LLM for rooms, and keep it honest: bad phrases are dropped here, not
 * downstream, because downstream every phrase costs a real vendor call.
 */
async function llmIntent(text: string): Promise<ResolvedIntent | null> {
  if (!llmReady()) return null;

  let raw: LlmIntent;
  try {
    raw = await jsonCall<LlmIntent>(SYSTEM, `The creator wrote: "${text}"`, {
      temperature: 0.3,
      maxTokens: 900,
    });
  } catch {
    return null;
  }

  const take = (
    list: { query?: string; why?: string }[] | undefined,
    source: "llm",
    max: number,
  ): Room[] => {
    const out: Room[] = [];
    const seen = new Set<string>();
    for (const item of list ?? []) {
      const query = clean(item?.query ?? "");
      if (!usableRoom(query) || seen.has(query)) continue;
      seen.add(query);
      out.push({
        query,
        why: (item?.why ?? "").trim().slice(0, 90),
        source,
      });
      if (out.length >= max) break;
    }
    return out;
  };

  const rooms = take(raw.rooms, "llm", 4);
  const adjacent = take(raw.adjacent, "llm", 3);
  if (!rooms.length && !adjacent.length) return null;

  const words = (raw.words ?? [])
    .map((w) => String(w).toLowerCase().trim())
    .filter((w) => /^[a-z][a-z-]{2,}$/.test(w) && !PLATFORM_WORDS.test(w))
    .slice(0, 12);

  return {
    input: text,
    rooms,
    adjacent,
    words,
    interests: matchInterests(text),
    via: "llm",
  };
}

/**
 * Resolve anything a creator types into rooms that can be priced.
 *
 * Order matters and is chosen for cost: the taxonomy is free and instant, so it
 * goes first; the cache is free, so it goes next; the LLM is cheap but not free,
 * so it is last. A text that the taxonomy fully covers never reaches the LLM.
 */
export async function resolveIntent(
  raw: string,
  opts: { force?: boolean } = {},
): Promise<ResolvedIntent> {
  const text = raw.trim();
  if (text.length < 2) {
    return { input: text, rooms: [], adjacent: [], words: [], interests: [], via: "none" };
  }

  /* ---- 1. the cache: the second person to type this pays nothing ---- */
  const key = keyFor(text);
  if (!opts.force) {
    const hit = readCache()[key];
    if (hit && hit.version === CACHE_VERSION) {
      return { ...hit.result, via: "cache" };
    }
  }

  /* ---- 2. the taxonomy fast path ---- */
  const ambiguous = ambiguousWords();
  const saidWords = new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
    (w) => !STOPWORDS.has(w),
  ));

  /**
   * Score each group by how many of its words actually appear, then keep only
   * the strongest.
   *
   * Keeping every group that matched even once is how "home workout" came back
   * with "home decor" and "small apartment ideas": the word "home" is listed in
   * the home-and-interiors group as well as in fitness, so a gym creator was
   * handed interior design. Ties are kept — "fitness and cooking" is genuinely
   * two spaces — but a group that matched one incidental word loses to one that
   * matched the whole phrase.
   */
  const scored = INTERESTS.map((g) => ({
    id: g.id,
    /**
     * Weighted rather than counted, because a shared word is weak evidence.
     * "home" belongs to both fitness and interiors; on a plain count, "home
     * cooking for busy people" scored fitness and food identically off the same
     * one word and the gym room outranked the kitchen. Half credit for a word
     * that lives in two groups settles it correctly without a hand-tuned list.
     */
    hits: g.words
      .filter((w) => saidWords.has(w))
      .reduce((n, w) => n + wordWeight(w, ambiguous), 0),
  })).filter((g) => g.hits > 0);
  const bestHits = scored.reduce((m, g) => Math.max(m, g.hits), 0);
  const ids = scored.filter((g) => g.hits === bestHits).map((g) => g.id);

  const fromTaxonomy: Room[] = candidatesFor(ids, 2, text)
    .map((c) => ({
      query: c.query,
      why: `the usual entry point for ${c.interest}`,
      source: "taxonomy" as const,
    }))
    /**
     * Put the room they actually named first, and the rest in the order the
     * taxonomy lists them.
     *
     * Searching "street food" and being shown "quick recipes" at the top is the
     * kind of small wrongness that makes an engine feel like it is not
     * listening. Sorting on a strict equality test only helped when the text was
     * *exactly* one of the phrases, so "home cooking for busy people" left
     * "home cooking" sitting third behind two rooms that shared no word with it.
     * Overlap is the honest measure: how much of the phrase did they say.
     */
    .sort((a, b) => {
      const named = (q: string) => {
        const words = q.toLowerCase().match(/[a-z]{3,}/g) ?? [];
        const hits = words.filter((w) => saidWords.has(w)).length;
        // A full-phrase hit outranks a partial one at any overlap.
        const exact = text.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
        return exact * 10 + hits;
      };
      return named(b.query) - named(a.query);
    });

  /**
   * The taxonomy only wins outright when it actually understood the text.
   * Matching one word out of a long description is how "I'm a dentist who loves
   * pottery" became a search for "quick recipes" — the word "love" is in the
   * food group's list, so it fired, and the person was handed a cooking niche.
   * Requiring the matches to be a *meaningful share* of what they wrote keeps
   * the fast path for "home workout" and sends real sentences to the LLM.
   */
  const taxonomyHits = scored
    .filter((g) => ids.includes(g.id))
    .reduce((n, g) => n + g.hits, 0);
  const coverage = saidWords.size ? taxonomyHits / saidWords.size : 0;
  const taxonomyWins = fromTaxonomy.length > 0 && coverage >= 0.5;

  if (taxonomyWins) {
    /**
     * Adjacent rooms on this path are the *siblings*: the other spaces in the
     * same group. They cost nothing, they are real rooms rather than invented
     * ones, and for a newcomer they answer exactly the question the LLM branch
     * answers — "what else could I post about" — without a second call.
     */
    const used = new Set(fromTaxonomy.map((r) => r.query));
    const adjacent: Room[] = [];
    for (const id of ids) {
      const group = INTERESTS.find((g) => g.id === id);
      for (const query of group?.niches ?? []) {
        if (used.has(query) || adjacent.length >= 3) continue;
        if (!usableRoom(query)) continue;
        adjacent.push({
          query,
          why: `another room in ${id} — usually less crowded`,
          source: "taxonomy",
        });
      }
    }

    const result: ResolvedIntent = {
      input: text,
      rooms: fromTaxonomy.slice(0, 4),
      adjacent,
      words: [...saidWords].slice(0, 12),
      interests: ids,
      via: "taxonomy",
    };
    writeCache({ ...readCache(), [key]: { version: CACHE_VERSION, at: new Date().toISOString(), result } });
    return result;
  }

  /* ---- 3. the LLM: any subject, in the creator's own words ---- */
  const llm = await llmIntent(text);
  if (llm) {
    writeCache({ ...readCache(), [key]: { version: CACHE_VERSION, at: new Date().toISOString(), result: llm } });
    return llm;
  }

  /* ---- 4. heuristic: never a dead end ---- */
  const fallback = heuristicRooms(text);
  if (fallback.length || fromTaxonomy.length) {
    const result: ResolvedIntent = {
      input: text,
      rooms: (fallback.length ? fallback : fromTaxonomy).slice(0, 4),
      adjacent: [],
      words: [...saidWords].slice(0, 12),
      interests: ids,
      via: fallback.length ? "heuristic" : "taxonomy",
    };
    writeCache({ ...readCache(), [key]: { version: CACHE_VERSION, at: new Date().toISOString(), result } });
    return result;
  }

  return { input: text, rooms: [], adjacent: [], words: [...saidWords], interests: ids, via: "none" };
}
