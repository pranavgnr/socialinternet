import type { SessionUser } from "./auth";
import { gate, settleAfter, type IsCached } from "./gate";
import type { NicheResearch } from "./niche";
import {
  rankNiches,
  scoreNiche,
  signalsFrom,
  type NicheOpportunity,
} from "./opportunity";
import { creditLedger } from "./providers";

/**
 * `POST /api/recommend` without Next.
 *
 * Comparing rooms always needs a signed-in owner: even when every room is
 * cached, the comparison is an account action. Each room that is *fresh* is
 * charged `COSTS.niche` through the same gate `/api/niche` uses, at the moment
 * it is about to be pulled; a room already on disk is free.
 *
 * A 402 in the middle of the loop stops it and keeps the rooms already paid
 * for: discarding a finished comparison because the next one was unaffordable
 * would throw away money the visitor had already spent. A pull that throws, or
 * that measured zero real vendor spend, is refunded by `settleAfter`.
 */
export interface RecommendCandidate {
  query: string;
  interest: string;
}

export interface RecommendPullsInput {
  candidates: RecommendCandidate[];
  handle?: string;
  /** words the resolver heard from the visitor, passed to the scorer */
  fitWords: string[];
  /** null for a visitor who has not signed in */
  user: SessionUser | null;
}

export interface RecommendPullsDeps {
  researchNiche: (opts: {
    query: string;
    handle?: string;
    enrichMax?: number;
  }) => Promise<NicheResearch>;
  /** injected in tests; defaults to the disk cache through the gate */
  isCached?: IsCached;
  now?: Date;
}

export type RecommendOutcome =
  | { status: 401 | 402; error: string }
  | { status: 400; error: string; errors: string[] }
  | {
      status: 200;
      ranked: Array<NicheOpportunity & { interest: string; cached: boolean }>;
      errors: string[];
      spent: number;
      /** set when the loop stopped on credits but kept what it had already read */
      note?: string;
    };

export async function runRecommendPulls(
  input: RecommendPullsInput,
  deps: RecommendPullsDeps,
): Promise<RecommendOutcome> {
  /**
   * Signed-in always, cache or no cache: unlike a single niche read, this is a
   * comparison saved to an account, and the sign-in check must not depend on
   * whether the first room happens to be on disk.
   */
  if (!input.user) {
    return { status: 401, error: "Sign in to read a new one" };
  }
  const user = input.user;

  const results: Array<NicheOpportunity & { interest: string; cached: boolean }> = [];
  const errors: string[] = [];
  let spent = 0;
  let note: string | undefined;

  /**
   * Sequential on purpose: these are paid calls to a vendor with per-minute
   * limits, and a burst of parallel searches is how a demo turns into a 429
   * that looks like "the site is broken".
   */
  for (const c of input.candidates) {
    const verdict = await gate("niche", {
      key: c.query,
      getUser: async () => user,
      isCached: deps.isCached,
      now: deps.now,
    });

    if (verdict.ok === false) {
      if (verdict.status === 401) {
        return { status: 401, error: verdict.message };
      }
      /** The first unaffordable room stops the loop. Paid work already done
       * stays in the response; only an empty comparison becomes an error. */
      if (!results.length) {
        return { status: 402, error: verdict.message };
      }
      note = `Showing the rooms already read. ${verdict.message}`;
      break;
    }

    /**
     * Monotonic, so a reset by another niche pull cannot hide this room's
     * spend. Snapshot before the call and settle against the delta after.
     */
    const usdAtStart = creditLedger().lifetimeUsd;

    try {
      const research = await settleAfter(
        verdict.entryId,
        () =>
          deps.researchNiche({
            query: c.query,
            handle: input.handle?.trim() || undefined,
            // Breadth over depth: two baseline top-ups per room, not six.
            enrichMax: 2,
          }),
        () => creditLedger().lifetimeUsd - usdAtStart,
      );
      spent += research.credits.spent;

      const signals = signalsFrom(research);
      if (!signals.reels.length) {
        errors.push(`${c.query}: nothing came back`);
        continue;
      }

      const scored = scoreNiche(signals, { interests: input.fitWords });
      results.push({ ...scored, interest: c.interest, cached: research.cached });
    } catch (err) {
      errors.push(`${c.query}: ${(err as Error).message}`);
    }
  }

  if (!results.length) {
    return {
      status: 400,
      error:
        errors[0]?.replace(/^[^:]+:\s*/, "") ??
        "None of those rooms returned data. Try different interests.",
      errors,
    };
  }

  return {
    status: 200,
    ranked: rankNiches(results),
    errors,
    spent,
    ...(note ? { note } : {}),
  };
}
