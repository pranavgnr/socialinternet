/**
 * Does the cohort actually look like the creator?
 *
 * The phrase decides the search, the search decides the cohort, and every
 * number on the page is a comparison against that cohort. So a phrase that
 * reads well but points at the wrong room is not a wording bug — it is a
 * wrong answer with confident numbers attached. One Telugu tag on a Kannada
 * singer's feed produced "dance comedy telugu", a cohort of comedy pages, and
 * a plan for someone who does not do comedy.
 *
 * The check is free: it reads the reels already bought, asks what each account
 * is (lib/archetype.ts) and what language it posts in, and compares that with
 * the creator. Accounts that are plainly in another room are dropped before the
 * medians are computed, so the benchmark is rebuilt from the reels that belong
 * in it rather than from everything the search happened to return.
 *
 * Deliberately conservative: an account is only dropped on a conflict that is
 * visible — a different language, or a different kind of account with no shared
 * vocabulary. Weak agreement never drops anything, because most cohort accounts
 * arrive with a single reel and a single reel proves very little.
 */
import { detectArchetype, type ArchetypeGuess } from "./archetype";
import { contentWords } from "./text";
import type { AccountFit, CohortFit, RawReel } from "./types";

export type { AccountFit, CohortFit };

/** The creator's own vocabulary: what their captions keep saying. */
function vocabulary(reels: RawReel[], limit = 14): Set<string> {
  const counts = new Map<string, number>();
  for (const r of reels) {
    for (const w of contentWords(r.caption ?? "")) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([w]) => w),
  );
}

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Score every account in the cohort against the creator.
 *
 * Three signals, weighted by what the creator's own kind of account turns on:
 *
 *  - language (heavier for a singer, because a cover in a language you do not
 *    sing is not a lead, it is a different job);
 *  - the kind of account the posts point at;
 *  - shared vocabulary, which catches the case both of the above miss — two
 *    accounts that are the same genre and the same language but about different
 *    subjects ("workout form" against "weight loss diet").
 */
export function cohortFitness(opts: {
  query: string;
  creator: RawReel[];
  cohort: RawReel[];
  shape?: ArchetypeGuess;
  /**
   * The creator's own account was never read, so `creator` holds some other
   * creator's posts (or nothing).
   *
   * Every signal below compares the cohort *to the creator*, so with the wrong
   * creator in hand the comparison is not a weak check — it is a confident wrong
   * answer. It never fails loudly: the cohort just shares no vocabulary with a
   * stranger, every account is marked off, the room is pruned to nothing, and
   * the plan loses the evidence it was built from.
   */
  creatorUnread?: boolean;
}): CohortFit {
  const creatorShape = opts.shape ?? detectArchetype(opts.creator);
  const creatorWords = vocabulary(opts.creator);
  const creatorLang = creatorShape.language?.toLowerCase();

  const byAccount = new Map<string, RawReel[]>();
  for (const r of opts.cohort) {
    const key = (r.account ?? "").toLowerCase();
    if (!key) continue;
    const list = byAccount.get(key);
    if (list) list.push(r);
    else byAccount.set(key, [r]);
  }

  /**
   * No creator, no comparison.
   *
   * Reported as `unknown` rather than skipped silently, so the page can say
   * "we could not check this against your posts" instead of either implying the
   * room was verified or claiming it was wrong. Nothing is marked off: an
   * account is not "in another space" just because we never saw the space the
   * creator is in.
   */
  if (opts.creatorUnread) {
    const accounts: AccountFit[] = [...byAccount.entries()].map(([handle, reels]) => ({
      handle,
      reels: reels.length,
      fit: 0.5,
      off: false,
    }));
    accounts.sort((a, b) => b.fit - a.fit);
    return {
      searched: opts.query,
      score: 0.5,
      agreement: 0.5,
      verdict: "unknown",
      ok: true,
      accounts,
      off: [],
      creatorShape: creatorShape.label,
      creatorLanguage: creatorLang,
      reasons: [
        "We could not read your account, so there was nothing to check this room against. " +
          "The accounts below are shown as they were found, not filtered.",
      ],
    };
  }

  const weights = creatorShape.songLed
    ? { shape: 0.35, lang: 0.45, words: 0.2 }
    : { shape: 0.5, lang: 0.3, words: 0.2 };

  const accounts: AccountFit[] = [];
  /** fit relative to each account's own ceiling; verdict evidence */
  const agreements: number[] = [];
  for (const [handle, reels] of byAccount) {
    const guess = detectArchetype(reels);
    const lang = guess.language?.toLowerCase();

    // Unknown on either side is "no evidence", never a conflict.
    const langMatch =
      !creatorLang || !lang ? 0.5 : lang === creatorLang ? 1 : 0;
    const shapeMatch =
      !creatorShape.id || creatorShape.id === "general" || guess.id === "general"
        ? 0.5
        : guess.id === creatorShape.id
          ? 1
          : 0;

    const accountWords = vocabulary(reels);
    const shared = [...accountWords].filter((w) => creatorWords.has(w)).length;
    const wordMatch = creatorWords.size
      ? Math.min(1, shared / Math.max(3, Math.min(8, creatorWords.size)))
      : 0.5;

    const fit =
      weights.shape * shapeMatch +
      weights.lang * langMatch +
      weights.words * wordMatch;

    /**
     * Shape cannot police a cohort for a "general" creator.
     *
     * `detectArchetype` returns "general" for every account it has no label
     * for — a tech reviewer, a finance channel — so shapeMatch collapses to the
     * 0.5 placeholder on both sides and every room looks alike. Two bad answers
     * came out of that: nine tech reviewers were reported as a "mixed" room, and
     * a recipe cohort was reported as a match for the same creator.
     *
     * When there is no shape to compare, the captions carry the check: two
     * accounts about entirely different things share no vocabulary at all. This
     * only fires when both sides have enough words for silence to mean
     * something, so a cohort of one-word captions is not thrown out for being
     * quiet.
     */
    const wordsComparable = creatorWords.size >= 4 && accountWords.size >= 3;
    const noOverlap = wordsComparable && shared === 0;

    const off = fit < 0.35 || noOverlap;

    // Only accounts that survived the conflict check speak for the room.
    if (wordsComparable && !off) agreements.push(wordMatch);
    let why: string | undefined;
    if (off) {
      if (langMatch === 0) {
        why = `posts in ${lang}, creator is ${creatorLang}`;
      } else if (shapeMatch === 0) {
        why = `${guess.label}, creator is ${creatorShape.label.toLowerCase()}`;
      } else {
        why = "nothing in common with the creator's captions";
      }
    }
    accounts.push({ handle, reels: reels.length, fit, off, why });
  }

  accounts.sort((a, b) => b.fit - a.fit);
  const score = medianOf(accounts.map((a) => a.fit));
  const off = accounts.filter((a) => a.off).map((a) => a.handle);
  const offShare = accounts.length ? off.length / accounts.length : 0;

  /**
   * How much the captions of the surviving accounts overlap the creator's.
   *
   * An empty list means there was nothing to compare (short captions on either
   * side), which is not evidence against the cohort — 0.5 keeps the verdict on
   * the side of "no opinion" instead of turning silence into a mismatch.
   */
  const wordMedian = agreements.length ? medianOf(agreements) : 0.5;

  /**
   * Conflict first, overlap second.
   *
   * `off` is the hard signal: that account is in another space — a different
   * language, a different kind of account, or nothing in common at all. When
   * most of the room is off, the room is wrong. With no conflict and captions
   * that actually overlap, it is the same room. Anything between the two is
   * reported as mixed rather than rounded to a comfortable answer.
   */
  /**
   * Whether the creator has a shape worth comparing at all. "general" is the
   * label for every account the detector cannot place, so it carries no
   * information — and only then does the caption overlap have to carry the
   * verdict on its own.
   */
  const shapeInformative = Boolean(creatorShape.id) && creatorShape.id !== "general";

  const verdict: CohortFit["verdict"] =
    !accounts.length || offShare >= 0.6
      ? "wrong"
      : offShare <= 0.25 && (shapeInformative || wordMedian >= 0.34)
        ? "matches"
        : "mixed";

  // What the cohort actually is, for the reason line.
  const langCounts = new Map<string, number>();
  for (const [handle, reels] of byAccount) {
    if (off.includes(handle)) continue;
    const l = detectArchetype(reels).language?.toLowerCase();
    if (l) langCounts.set(l, (langCounts.get(l) ?? 0) + 1);
  }
  const cohortLanguage = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const reasons: string[] = [];
  if (!accounts.length) {
    reasons.push("The search returned no other accounts, so there is nothing to compare against.");
  } else if (verdict === "matches") {
    // The kept accounts, not the whole pull: an excluded one is not part of
    // the room being described.
    const kept = accounts.length - off.length;
    reasons.push(
      `The cohort is ${
        kept === 1 ? "one account" : `${kept} accounts`
      } that post the same kind of thing` +
        (creatorLang && cohortLanguage ? ` in ${creatorLang}` : "") +
        ".",
    );
  } else if (verdict === "mixed") {
    reasons.push(
      off.length
        ? `${off.length} of ${accounts.length} accounts were in a different space and were left out of the benchmark.`
        : "Nothing here conflicts with this account, but the overlap is thin, so the numbers are a loose comparison rather than a close one.",
    );
  } else {
    reasons.push(
      `Nothing the search returned looks like this account${
        off.length ? ` — ${off.length} of ${accounts.length} were in a different space` : ""
      }. The numbers below compare against their own feed, not against strangers.`,
    );
  }
  if (creatorLang && cohortLanguage && creatorLang !== cohortLanguage && verdict !== "matches") {
    reasons.push(
      `The creator posts in ${creatorLang}; most of what came back is in ${cohortLanguage}.`,
    );
  }

  return {
    searched: opts.query,
    score: Number(score.toFixed(2)),
    agreement: Number(wordMedian.toFixed(2)),
    verdict,
    ok: verdict !== "wrong",
    accounts,
    off,
    creatorShape: creatorShape.label,
    creatorLanguage: creatorLang,
    reasons,
  };
}

/** Drop the dropped accounts' reels, so the medians are rebuilt without them. */
export function pruneCohort(payload: RawReel[], off: string[], keep?: string): RawReel[] {
  if (!off.length) return payload;
  const drop = new Set([...off, ...(keep ? [keep.toLowerCase()] : [])]);
  return payload.filter((r) => !drop.has((r.account ?? "").toLowerCase()));
}
