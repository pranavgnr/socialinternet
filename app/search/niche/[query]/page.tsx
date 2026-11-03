import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import Briefing from "@/components/niche/Briefing";
import NicheHeader from "@/components/niche/NicheHeader";
import OutlierList from "@/components/niche/OutlierList";
import ReadPanel from "@/components/niche/ReadPanel";
import {
  cachedNichePull,
  nicheView,
  researchFromCache,
  type CachedNichePull,
  type NicheView,
} from "@/lib/niche";
import {
  NICHE_QUERY_MAX,
  OUTLIER_LIMIT,
  buildDossier,
  nicheAccess,
  parseNicheQuery,
  type NicheQueryParse,
} from "@/lib/nicheDossier";
import { getViewer } from "@/lib/viewer";

export const instant = false;

/**
 * The phrase the visitor typed, decoded once and never used as a path.
 *
 * `parseNicheQuery` collapses whitespace and enforces the 2-to-120-character
 * rule shared with OmniSearch. The page only ever renders the result as text;
 * `cachedNichePull` builds the cache filename from its own slug function.
 */
function InvalidNiche({
  reason,
}: {
  reason: Extract<NicheQueryParse, { ok: false }>["reason"];
}) {
  const message =
    reason === "short"
      ? "Type at least two characters — a word or two about the posts."
      : reason === "long"
        ? `Keep the niche under ${NICHE_QUERY_MAX} characters.`
        : reason === "punctuation"
          ? "That is punctuation, not a niche. Try words like “kannada songs”."
          : "Type a niche — a word or two about the posts.";

  return (
    <div className="pb-24 pt-4 sm:pb-4">
      <p className="mono text-[11px] font-bold uppercase tracking-[0.2em] text-limelight">
        Niche Intelligence Dossier
      </p>
      <h1 className="mt-3 break-words text-[30px] font-extrabold leading-[1.05] tracking-[-0.04em] text-pure-white [overflow-wrap:anywhere] sm:text-[40px]">
        That niche is not readable
      </h1>
      <p className="mt-3 max-w-lg text-[16px] leading-relaxed text-muted-zinc">
        {message}
      </p>
      <Link
        href="/"
        className="mono mt-5 inline-flex min-h-[44px] items-center rounded-lg border border-white/10 bg-card px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-pure-white transition hover:border-limelight/40 hover:text-limelight"
      >
        Back to Shambles
      </Link>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ query: string }>;
}): Promise<Metadata> {
  const parsed = parseNicheQuery((await params).query);

  if (!parsed.ok) {
    return {
      title: "Niche dossier — Shambles",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${parsed.query} — Shambles niche dossier`,
    description: `Instagram reels in ${parsed.query}, ranked by views per follower, with Koko's briefing written only from the numbers read.`,
    robots: { index: true, follow: true },
  };
}

/**
 * `/search/niche/[query]` — the Niche Intelligence Dossier.
 *
 * The GET is free to anyone and never calls a vendor. A room on disk is rebuilt
 * in-process; a room that is stale by the pull window is still served from disk
 * with an "as of" line, exactly as the old explore page did. Only a phrase with
 * no stored read offers the paid panel, and that panel posts to the existing
 * `/api/niche` route so the credit gate stays in one place.
 */
export default async function NichePage({
  params,
}: {
  params: Promise<{ query: string }>;
}) {
  await connection();

  const parsed = parseNicheQuery((await params).query);
  if (!parsed.ok) return <InvalidNiche reason={parsed.reason} />;
  const query = parsed.query;

  let pull: CachedNichePull | null = null;
  try {
    pull = await cachedNichePull(query);
  } catch (err) {
    // An unreadable cache file is the same as no cache: offer the read panel
    // rather than taking the page down.
    console.error("[niche] cached dossier read failed:", (err as Error).message);
  }

  /**
   * A stored room is rendered without asking who the visitor is. The session
   * read is deferred to the uncached path, so a database outage cannot affect
   * a free dossier (and the header's own guarded read is unaffected).
   */
  let signedIn = false;
  if (!pull) {
    try {
      const viewer = await getViewer();
      signedIn = Boolean(viewer.user);
    } catch (err) {
      console.error("[niche] session read failed:", (err as Error).message);
    }
  }

  const access = nicheAccess({ cached: Boolean(pull), signedIn });

  if (access === "show" && pull) {
    let view: NicheView | null = null;
    try {
      view = nicheView(
        researchFromCache(pull.query, pull.payload, {
          fetchedAt: pull.fetchedAt,
          errors: pull.errors,
        }),
        OUTLIER_LIMIT,
        { dossier: true },
      );
    } catch (err) {
      console.error("[niche] rebuilding the cached room failed:", (err as Error).message);
    }

    if (view) {
      const dossier = buildDossier(view);

      return (
        <div className="pb-24 sm:pb-4">
          <NicheHeader
            query={query}
            counts={dossier.counts}
            ageHours={pull.ageHours}
            stale={pull.stale}
          />

          <div className="space-y-9 pt-7 sm:space-y-11 sm:pt-9">
            <Briefing lines={dossier.briefing} />

            <section
              aria-labelledby="koko-cta-title"
              className="card relative overflow-hidden p-5 sm:p-6"
            >
              <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-luxury-gold">
                Next move
              </p>
              <h2
                id="koko-cta-title"
                className="mt-2 text-[21px] font-semibold leading-snug tracking-[-0.02em] text-pure-white sm:text-[25px]"
              >
                Turn this room into your next reels
              </h2>
              <Link
                href={`/chat?niche=${encodeURIComponent(query)}`}
                className="mt-4 flex min-h-[46px] items-center justify-center rounded-lg bg-limelight px-4 text-center text-[11.5px] font-bold uppercase leading-tight tracking-[0.08em] text-obsidian transition hover:bg-limelight/85"
              >
                ⚡ Generate custom scripts &amp; strategies with Koko (1 💎)
              </Link>
              <p className="mt-2.5 text-[11px] leading-relaxed text-muted-zinc">
                Opening Koko is free — the gem is spent only when you ask for the
                scripts. Want the full read on one of the accounts below? Open its
                handle to see that profile.
              </p>
            </section>

            <OutlierList outliers={dossier.outliers} />

            {view.errors.length ? (
              /**
               * The stored errors are operator detail ("credits", "confirmed"),
               * and internal words must not reach the page. The visitor only
               * needs to know the counts may be incomplete.
               */
              <p className="text-[11px] leading-relaxed text-warn/80">
                Part of this read did not come back, so the counts above may be
                smaller than the room.
              </p>
            ) : null}
          </div>
        </div>
      );
    }
  }

  /**
   * No usable stored room. A stored file that could not be rebuilt lands here
   * too, so read the session now if that has not happened yet; `getViewer` is
   * memoised for this render.
   */
  if (!signedIn) {
    try {
      const viewer = await getViewer();
      signedIn = Boolean(viewer.user);
    } catch (err) {
      console.error("[niche] session read failed:", (err as Error).message);
    }
  }
  const panelAccess = nicheAccess({ cached: false, signedIn });

  /**
   * The masthead still names the phrase so the visitor knows what they are
   * about to read; no counts are printed because nothing has been read.
   */
  return (
    <div className="pb-24 sm:pb-4">
      <header className="border-b border-white/10 pb-7 pt-4 sm:pb-9">
        <p className="mono text-[11px] font-bold uppercase tracking-[0.2em] text-limelight">
          Niche Intelligence Dossier
        </p>
        <h1 className="mt-3 break-words text-[30px] font-extrabold leading-[1.03] tracking-[-0.04em] text-pure-white [overflow-wrap:anywhere] sm:text-[44px]">
          {query}
        </h1>
        <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-muted-zinc">
          Not read yet. Once this room is read, the dossier opens free for anyone.
        </p>
      </header>

      <ReadPanel query={query} signedIn={panelAccess === "read-panel"} />
    </div>
  );
}
