import { NextResponse } from "next/server";

import { take, tooMany, refund } from "@/lib/limits";
import { researchNiche } from "@/lib/niche";
import { resolveIntent } from "@/lib/nicheIntent";
import { INTERESTS, candidatesFor, wordsFor } from "@/lib/nicheSeeds";
import { rankNiches, scoreNiche, signalsFrom } from "@/lib/opportunity";
import { availableProviders } from "@/lib/providers";
import { attachCookie, ensureAccount } from "@/lib/session";
import { friendly } from "@/lib/userError";

export const maxDuration = 300;

const DAY = 24 * 60 * 60 * 1000;

/** Enough rooms to compare, few enough to stay cheap. */
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;

/**
 * GET /api/recommend → the interest menu (free).
 *
 * The chips are served from the taxonomy rather than hardcoded in the page, so
 * adding a space in one file is enough and the UI cannot drift from what the
 * engine can actually price.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    interests: INTERESTS.map((g) => ({
      id: g.id,
      label: g.label,
      /** a sample of what picking this would cost a search */
      example: g.niches[0],
    })),
    providers: availableProviders().map((p) => ({ id: p.id, name: p.name })),
  });
}

/**
 * POST /api/recommend { interests?: string[], freeText?: string, handle?: string }
 *
 * Researches several rooms and ranks them for someone with no audience yet.
 *
 * The ranking is not "which niche is biggest" — that answer is always the same
 * and always useless. It is "where can a newcomer realistically break out",
 * which comes mostly from how often small accounts are the ones breaking out
 * (see lib/opportunity). Each room costs one search plus a small baseline
 * top-up, so a five-room comparison is a few credits; rooms already on disk are
 * free and are reused rather than re-pulled.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      interests?: string[];
      freeText?: string;
      handle?: string;
      limit?: number;
    };

    const account = await ensureAccount();
    const limitKey = `recommend:${account.id}`;
    const budget = take(limitKey, 3, DAY);
    if (!budget.allowed) {
      return tooMany(budget.retryAfter, "You have compared niches a few times today.");
    }

    if (!availableProviders().length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No Instagram data vendor is configured yet. Add HIKERAPI_KEY (about 7x cheaper) or SOCIALCRAWL_API_KEY to .env.local.",
        },
        { status: 400 },
      );
    }

    /**
     * Interests can arrive as ids, as free text, or both.
     *
     * Free text goes through `resolveIntent` rather than straight to the
     * taxonomy, because the taxonomy only knows its own 26 groups: measured on
     * realistic creator descriptions it resolved 73% of them to nothing, and
     * the route then told someone who had just described themselves in detail
     * to "pick at least one thing you know". The resolver keeps the taxonomy as
     * a free fast path and falls back to the LLM for any subject at all.
     */
    const pickedIds = (body.interests ?? []).filter((id) =>
      INTERESTS.some((g) => g.id === id),
    );

    const intent = body.freeText?.trim()
      ? await resolveIntent(body.freeText.trim())
      : null;

    /**
     * Explicit chips win the ordering, because a person who tapped "Fitness"
     * meant fitness; free text fills the rest of the list. Rooms from the
     * resolver are cut to the same budget so a long description cannot inflate
     * a comparison into eight paid searches.
     */
    const pickedRooms = candidatesFor(pickedIds, 1);
    const intentRooms = (intent?.rooms ?? []).map((r) => ({
      query: r.query,
      interest: r.source === "taxonomy" ? "taxonomy" : "your description",
    }));

    const seen = new Set<string>();
    const candidates = [...pickedRooms, ...intentRooms].filter((c) => {
      const k = c.query.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const wanted = Math.max(1, Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    const toPrice = candidates.slice(0, wanted);

    if (!toPrice.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Could not turn that into a searchable niche. Try naming the subject — what the posts are about — or pick a chip.",
          heard: intent?.input ?? null,
        },
        { status: 400 },
      );
    }

    /**
     * Fit uses the resolver's vocabulary when it has one: the LLM returns the
     * words of the person's actual knowledge ("hyderabadi", "masala", "dum"),
     * which is a far better yardstick for "does this room suit you" than the
     * six-word vocabulary of a taxonomy group.
     */
    const fitWords = intent?.words.length ? intent.words : wordsFor(pickedIds);

    const results = [];
    const errors: string[] = [];
    let spent = 0;

    /**
     * Sequential on purpose: these are paid calls to a vendor with per-minute
     * limits, and a burst of five parallel searches is how a demo turns into a
     * 429 that looks like "the site is broken".
     */
    for (const c of toPrice) {
      try {
        const research = await researchNiche({
          query: c.query,
          handle: body.handle?.trim() || undefined,
          // Breadth over depth: two baseline top-ups per room, not six.
          enrichMax: 2,
        });
        spent += research.credits.spent;

        const signals = signalsFrom(research);
        if (!signals.reels.length) {
          errors.push(`${c.query}: nothing came back`);
          continue;
        }

        const scored = scoreNiche(signals, { interests: fitWords });
        results.push({ ...scored, interest: c.interest, cached: research.cached });
      } catch (err) {
        errors.push(`${c.query}: ${(err as Error).message}`);
      }
    }

    /** Free runs must not eat the daily cap — re-reading is not spending. */
    if (spent === 0 && results.length) refund(limitKey);

    if (!results.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            errors[0]?.replace(/^[^:]+:\s*/, "") ??
            "None of those rooms returned data. Try different interests.",
          tried: toPrice.map((c) => c.query),
          errors,
        },
        { status: 400 },
      );
    }

    const ranked = rankNiches(results);

    return await attachCookie(
      NextResponse.json({
        ok: true,
        ranked: ranked.map((r, i) => ({ rank: i + 1, ...r })),
        /** the best room, so the page can lead with one recommendation */
        best: ranked[0].query,
        planHref: `/?new=1&niche=${encodeURIComponent(ranked[0].query)}`,
        spent,
        /**
         * Neighbouring rooms worth entering later. Not priced, so they cost
         * nothing — they are the answer to "what else could I post about",
         * which for a creator with no audience is the real question.
         */
        adjacent: intent?.adjacent ?? [],
        /** what the engine understood, so a wrong answer is visible not silent */
        heard: intent ? { input: intent.input, via: intent.via } : null,
        partial: errors.length ? errors : undefined,
      }),
      account,
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: friendly(
          err,
          "That comparison did not work. Try fewer interests, or a broader one.",
        ),
      },
      { status: 400 },
    );
  }
}
