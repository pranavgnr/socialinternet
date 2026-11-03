import Link from "next/link";

import {
  FEATURE_STATUS,
  statusLabel,
  type PillarKey,
} from "@/lib/featureStatus";

interface Pillar {
  number: string;
  title: string;
  body: string;
  feature: PillarKey;
}

const PILLARS: Pillar[] = [
  {
    number: "01",
    title: "Audit & diagnose",
    feature: "audit",
    body: "Followers, likes and comment share, a bot share estimated from a follower sample, and a structural read of every Reel from captions and numbers — video watched only when enabled.",
  },
  {
    number: "02",
    title: "Competitor intel",
    feature: "competitor-intel",
    body: "Study the hooks, formats and comment patterns of the accounts closest to yours, and see what is earning them reach.",
  },
  {
    number: "03",
    title: "Lifestyle VIP",
    feature: "lifestyle-vip",
    body: "Turn audience value into private dining, boutique resort privileges and UPI cashback at luxury venues.",
  },
];

function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * The three parts of the system. A pillar's badge comes from
 * `FEATURE_STATUS`, so it can only say "Live now" when the feature has actually
 * shipped; anything planned keeps the gold lock and links to the vault.
 */
export default function Pillars() {
  return (
    <section aria-labelledby="pillars-title" className="py-14 sm:py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono text-[10px] font-bold uppercase tracking-[0.2em] text-limelight">
            The system
          </p>
          <h2
            id="pillars-title"
            className="mt-3 text-[30px] font-semibold leading-[1.02] tracking-[-0.035em] text-pure-white sm:text-[40px]"
          >
            Three layers of unfair advantage.
          </h2>
        </div>
        <p className="max-w-sm text-[13px] leading-relaxed text-muted-zinc">
          Precision diagnostics first, competitor intelligence second, lifestyle
          privileges once the audience is verified.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {PILLARS.map((pillar) => {
          const status = FEATURE_STATUS[pillar.feature];
          const live = status === "live";
          const planned = status === "planned";

          return (
            <article
              key={pillar.number}
              className="card group flex flex-col p-5 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="mono text-[12px] font-bold tracking-[0.14em] text-limelight">
                  {pillar.number} <span className="text-muted-zinc/70">//</span>
                </p>
                <span
                  className={`mono inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${
                    live
                      ? "border-limelight/25 bg-limelight/10 text-limelight"
                      : "border-luxury-gold/30 bg-luxury-gold/10 text-luxury-gold"
                  }`}
                >
                  {planned ? <LockGlyph /> : null}
                  {statusLabel(status)}
                </span>
              </div>

              <h3 className="mt-5 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-pure-white uppercase">
                {pillar.title}
              </h3>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-zinc">
                {pillar.body}
              </p>

              {planned ? (
                <Link
                  href="#vault"
                  className="mt-5 inline-flex min-h-[32px] w-fit items-center gap-2 rounded-full border border-luxury-gold/35 bg-luxury-gold/10 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-luxury-gold transition hover:border-luxury-gold/60 hover:bg-luxury-gold/15"
                >
                  Join the vault
                  <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <p className="mono mt-5 text-[10px] uppercase tracking-[0.14em] text-muted-zinc/60">
                  {live ? "Include it in your next audit" : "Part of the full profile view"}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
