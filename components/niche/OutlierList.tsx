import Link from "next/link";

import { compact, times } from "@/lib/fmt";
import { normalizeHandle } from "@/lib/handle";
import type { DossierOutlier } from "@/lib/nicheDossier";
import { plain } from "@/lib/plain";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-zinc/80">
        {label}
      </dt>
      <dd className="mono mt-1 text-[13px] font-bold leading-none text-pure-white">
        {value}
      </dd>
    </div>
  );
}

/**
 * The ranked breakouts.
 *
 * There is no thumbnail: the public payload carries a signed, expiring CDN
 * link to the video, not a durable image URL, so the card is text and numbers
 * rather than a broken hotlink. Videos open on Instagram instead.
 */
export default function OutlierList({
  outliers,
}: {
  outliers: DossierOutlier[];
}) {
  if (!outliers.length) return null;

  return (
    <section aria-labelledby="breakouts-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-limelight">
            Ranked reels
          </p>
          <h2
            id="breakouts-title"
            className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-pure-white sm:text-[30px]"
          >
            Ranked by views per follower
          </h2>
        </div>
        <p className="mono text-[11px] uppercase tracking-[0.1em] text-muted-zinc">
          Instagram reels only
        </p>
      </div>

      <ol className="mt-5 space-y-3">
        {outliers.map((outlier, index) => {
          const rank = index + 1;
          const multiple = outlier.multiple;
          const profileHandle = normalizeHandle(outlier.handle);
          return (
            <li
              key={outlier.url}
              className="card flex gap-3.5 p-4 sm:gap-5 sm:p-5"
            >
              <span
                aria-hidden="true"
                className="mono w-6 shrink-0 pt-0.5 text-[12px] font-bold text-limelight/60 sm:w-8 sm:text-[14px]"
              >
                #{rank}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  {profileHandle ? (
                    <Link
                      href={`/profile/${profileHandle}`}
                      aria-label={`Read the profile for @${outlier.handle}, reel ${rank}`}
                      className="inline-flex min-h-[44px] min-w-0 items-center truncate text-[16px] font-semibold text-pure-white underline decoration-white/20 underline-offset-4 transition hover:text-limelight hover:decoration-limelight/50"
                    >
                      @{outlier.handle}
                    </Link>
                  ) : (
                    /**
                     * A stored row can carry a vendor artefact as its account.
                     * Without a legal Instagram handle there is no profile to
                     * open, so the handle stays plain text, not a dead link.
                     */
                    <span className="min-w-0 truncate text-[15px] font-semibold text-pure-white">
                      @{outlier.handle}
                    </span>
                  )}
                  <p className="mono shrink-0 text-[14px] font-bold text-pure-white">
                    {compact(outlier.views)}{" "}
                    <span className="text-[11px] font-normal uppercase tracking-[0.1em] text-muted-zinc">
                      views
                    </span>
                  </p>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-white/10 py-3 sm:max-w-sm">
                  <Stat
                    label="Against their followers"
                    value={
                      multiple !== null
                        ? `${times(multiple)} their followers`
                        : "follower count not read"
                    }
                  />
                  <Stat
                    label="Followers"
                    value={
                      typeof outlier.followers === "number"
                        ? compact(outlier.followers)
                        : "not read"
                    }
                  />
                </dl>

                {outlier.caption ? (
                  /**
                   * Captions are creator text, so they can carry a hashtag run
                   * or a link with no spaces. `anywhere` keeps a long token from
                   * widening the whole mobile layout viewport.
                   */
                  <p className="mt-3 break-words text-[15px] leading-relaxed text-muted-zinc [overflow-wrap:anywhere]">
                    {plain(outlier.caption)}
                  </p>
                ) : null}

                <a
                  href={outlier.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open reel ${rank} from @${outlier.handle} on Instagram`}
                  className="mono mt-3 inline-flex min-h-[44px] items-center text-[11px] font-bold uppercase tracking-[0.1em] text-limelight underline decoration-limelight/30 underline-offset-4 transition hover:decoration-limelight"
                >
                  Open reel ↗
                </a>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
