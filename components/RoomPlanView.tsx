import Link from "next/link";

import type { RoomPlan } from "@/lib/newcomer";
import { fmtViews, plain, titleCase } from "@/lib/plain";
import { profileUrl } from "@/lib/platform";

/**
 * The page for someone who has not posted yet.
 *
 * Every other view in the app is about the visitor's own account. This one is
 * about the room, and it has to answer three questions in order: can someone my
 * size win here, what do the winning posts look like, and who should I watch.
 * The numbers come first because they are the argument; the advice is the
 * caption under them, not the headline.
 */

const LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted";

const TONE: Record<RoomPlan["verdict"]["tone"], { badge: string; ring: string }> = {
  good: { badge: "text-good", ring: "border-good/40 bg-good/5" },
  ok: { badge: "text-accent", ring: "border-accent/40 bg-accent/5" },
  hard: { badge: "text-warn", ring: "border-warn/40 bg-warn/5" },
  thin: { badge: "text-muted", ring: "border-line bg-panel" },
};

export default function RoomPlanView({ room }: { room: RoomPlan }) {
  const tone = TONE[room.verdict.tone] ?? TONE.thin;
  const bar = room.bar.small ?? room.bar.typical;

  return (
    <div className="space-y-6">
      <section>
        <p className={LABEL}>Your first posts</p>
        <h1 className="mt-2 text-[26px] font-semibold leading-[1.1] tracking-tight sm:text-[32px]">
          {titleCase(room.query)}
        </h1>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-muted">
          {plain(room.headline)}
        </p>

        <div className="mt-4 grid grid-cols-3 divide-x divide-line/70 rounded-xl border border-line bg-panel">
          <div className="px-3 py-3">
            <div className="text-[19px] font-medium leading-none tabular-nums">
              {fmtViews(bar)}
            </div>
            <div className="mt-1.5 text-[11px] leading-tight text-muted">
              views to beat
            </div>
          </div>
          <div className="px-3 py-3">
            <div className="text-[19px] font-medium leading-none tabular-nums">
              {Math.round(room.openness.smallShare * 100)}%
            </div>
            <div className="mt-1.5 text-[11px] leading-tight text-muted">
              breakouts from small accounts
            </div>
          </div>
          <div className="px-3 py-3">
            <div className="text-[19px] font-medium leading-none tabular-nums">
              {room.room.accounts}
            </div>
            <div className="mt-1.5 text-[11px] leading-tight text-muted">
              accounts read
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted/60">
          {fmtViews(bar)} is the {room.bar.basis}. The room&rsquo;s typical post is{" "}
          {fmtViews(room.bar.typical)}.
        </p>
      </section>

      <section className={`rounded-2xl border px-4 py-4 ${tone.ring}`}>
        <p className={`text-[12px] font-semibold uppercase tracking-[0.12em] ${tone.badge}`}>
          {room.verdict.label}
        </p>
        <p className="mt-2 text-[14px] leading-relaxed">{plain(room.verdict.sentence)}</p>
      </section>

      {room.steps.length ? (
        <section className="space-y-3">
          <h2 className={LABEL}>What to make first</h2>
          {room.steps.map((step, i) => (
            <article key={step.id} className="card px-4 py-4">
              <div className="flex items-baseline gap-2.5">
                <span className="mono shrink-0 text-[11px] text-accent">{i + 1}</span>
                <h3 className="min-w-0 text-[15px] font-semibold leading-snug tracking-tight">
                  {plain(step.title)}
                </h3>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{plain(step.why)}</p>
              <p className="mt-2.5 border-t border-line/60 pt-2.5 text-[13px] leading-relaxed">
                {plain(step.action)}
              </p>
              {step.evidence.length ? (
                <ul className="mt-2.5 space-y-1">
                  {step.evidence.map((e) => (
                    <li key={`${step.id}-${e.handle}-${e.metric}`} className="text-[11.5px] leading-snug text-muted/80">
                      {e.url ? (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-accent underline decoration-accent/30 underline-offset-2"
                        >
                          {e.handle}
                        </a>
                      ) : (
                        <span className="text-text">{e.handle}</span>
                      )}
                      <span className="mono ml-1.5 text-[10.5px] text-muted/60">{e.metric}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </section>
      ) : (
        <section className="card px-4 py-4">
          <p className="text-[13.5px] leading-relaxed text-muted">
            Nothing in this pull was strong enough to copy yet — the winning posts
            either came from one account or did not repeat a shape. Read a wider
            phrase, or come back after a few more posts land here.
          </p>
        </section>
      )}

      {room.study.length ? (
        <section>
          <h2 className={LABEL}>Who to watch</h2>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted/70">
            Small accounts first — their numbers are the ones you could inherit.
          </p>
          <ul className="mt-2 divide-y divide-line/70">
            {room.study.map((a) => (
              <li key={a.handle} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <a
                    href={profileUrl(a.handle, a.platform)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="min-w-0 truncate text-[13.5px] transition hover:text-accent"
                  >
                    @{a.handle}
                  </a>
                  <span className="mono shrink-0 text-[11px] text-muted">
                    {fmtViews(a.medianViews)} usual
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted/70">
                  {a.followers ? `${fmtViews(a.followers)} followers · ` : ""}
                  {a.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {room.shapes.length ? (
        <section>
          <h2 className={LABEL}>What this room posts</h2>
          <ul className="mt-2 space-y-1.5">
            {room.shapes.map((s) => (
              <li key={s.label} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate text-muted">{s.label}</span>
                <span className="mono shrink-0 text-[11px] text-muted/60">
                  {Math.round(s.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2.5">
        <Link
          href="/ideas"
          className="block rounded-xl bg-accent px-4 py-3.5 text-center text-[14px] font-semibold text-black transition active:scale-[0.99]"
        >
          See the posts to make
        </Link>
        <Link
          href="/start"
          className="block rounded-xl border border-line bg-panel px-4 py-3 text-center text-[13.5px] font-medium text-muted transition hover:text-text active:scale-[0.99]"
        >
          Compare another space
        </Link>
      </section>

      <section className="border-t border-line/70 pt-4">
        <h2 className={LABEL}>What these numbers are</h2>
        <ul className="mt-2 space-y-1.5">
          {room.honesty.map((line) => (
            <li key={line} className="text-[11px] leading-relaxed text-muted/60">
              {plain(line)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
