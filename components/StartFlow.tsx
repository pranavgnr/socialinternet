"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The new-creator flow: pick what you know, get ranked rooms.
 *
 * Deliberately not a wizard. A creator arrives with "I cook but nobody watches"
 * and needs two things fast: a short list of spaces they could actually win in,
 * and the evidence for why. Everything on screen is a number from the pull —
 * no advice that would read the same for every account.
 */

interface Interest {
  id: string;
  label: string;
  example: string;
}

interface Reason {
  label: string;
  value: string;
  direction: "up" | "down" | "flat";
}

interface Room {
  query: string;
  why: string;
}

interface Ranked {
  rank: number;
  query: string;
  score: number;
  verdict: string;
  medianViews: number;
  smallAccountShare: number;
  distinctWinners: number;
  topShare: number;
  medianAgeDays: number | null;
  reasons: Reason[];
  angle: string;
  study: { handle: string; followers?: number; medianViews: number }[];
  tags: { tag: string; count: number }[];
  cached?: boolean;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** Score as a word, because "72" means nothing without a reference. */
function band(score: number): { label: string; tone: string } {
  if (score >= 66) return { label: "Strong", tone: "text-good" };
  if (score >= 45) return { label: "Workable", tone: "text-accent" };
  if (score >= 28) return { label: "Hard", tone: "text-warn" };
  return { label: "Avoid for now", tone: "text-bad" };
}

export default function StartFlow() {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [spent, setSpent] = useState<number | null>(null);
  const [partial, setPartial] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** neighbouring rooms, free — what else they could post about */
  const [adjacent, setAdjacent] = useState<Room[]>([]);
  /** what the engine understood from the description */
  const [heard, setHeard] = useState<{ input: string; via: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/recommend");
        const json = (await res.json()) as { interests?: Interest[] };
        if (alive && json.interests) setInterests(json.interests);
      } catch {
        /* the chips are convenience; free text still works without them */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 4),
    );

  const run = useCallback(async () => {
    if (!picked.length && freeText.trim().length < 3) {
      setError("Pick at least one thing you know, or type a couple of words about it.");
      return;
    }
    setBusy(true);
    setError(null);
    setRanked(null);
    setPartial(null);
    setAdjacent([]);
    setHeard(null);

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interests: picked, freeText: freeText.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        ranked?: Ranked[];
        spent?: number;
        partial?: string[];
        adjacent?: Room[];
        heard?: { input: string; via: string } | null;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.ranked?.length) {
        throw new Error(json.error ?? "That did not work. Try again in a moment.");
      }
      setRanked(json.ranked);
      setSpent(json.spent ?? null);
      setPartial(json.partial?.length ? json.partial : null);
      setAdjacent(json.adjacent ?? []);
      setHeard(json.heard ?? null);
    } catch (err) {
      setError((err as Error).message || "That did not work. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [picked, freeText]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
          What do you actually know or enjoy?
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted/80">
          Pick up to four. These are what get priced — not what gets recommended.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {interests.map((i) => {
            const on = picked.includes(i.id);
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => toggle(i.id)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-2 text-[12.5px] transition active:scale-[0.98] ${
                  on
                    ? "border-accent bg-accent/15 font-medium text-text"
                    : "border-line bg-panel text-muted hover:border-accent/40"
                }`}
              >
                {i.label}
              </button>
            );
          })}
          {!interests.length ? (
            <span className="text-[12px] text-muted/60">Loading options…</span>
          ) : null}
        </div>

        <input
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="or just type it — “I cook, mostly Bengali food”"
          autoComplete="off"
          aria-label="Describe what you know"
          className="mt-3 w-full rounded-xl border border-line bg-panel px-3.5 py-3.5 text-[16px] outline-none placeholder:text-muted/50 focus:border-accent/60"
        />

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-accent px-5 py-3.5 text-[14px] font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? "Reading the rooms…" : "Show me where I could win"}
        </button>

        <p className="mt-2.5 text-[11px] leading-relaxed text-muted/60">
          Each space is read once and kept on disk, so coming back to it costs
          nothing. Spaces already read are reused rather than re-pulled.
        </p>
      </section>

      {error ? (
        <p className="rounded-xl border border-bad/40 bg-bad/5 px-3.5 py-3 text-[13px] leading-relaxed text-bad">
          {error}
        </p>
      ) : null}

      {ranked ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line/70 pt-4">
            <h2 className="text-[17px] font-semibold tracking-tight">
              Where you could win
            </h2>
            <p className="mono text-[11px] text-muted">
              {spent === 0 ? "all reused · free" : `${spent} credit${spent === 1 ? "" : "s"}`}
            </p>
          </div>

          <ol className="space-y-3">
            {ranked.map((r) => {
              const b = band(r.score);
              return (
                <li key={r.query} className="card px-4 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mono text-[10.5px] uppercase tracking-[0.14em] text-muted/70">
                        #{r.rank}
                      </p>
                      <h3 className="mt-0.5 truncate text-[16px] font-semibold capitalize tracking-tight">
                        {r.query}
                      </h3>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`mono text-[13px] font-semibold ${b.tone}`}>
                        {b.label}
                      </p>
                      <p className="mono text-[10.5px] text-muted/70">{r.score}/100</p>
                    </div>
                  </div>

                  <p className="mt-2 text-[13px] leading-relaxed text-muted">
                    <span className="font-medium text-text">{r.verdict}.</span>{" "}
                    A typical reel here gets {compact(r.medianViews)} views.
                  </p>

                  <ul className="mt-3 space-y-1.5">
                    {r.reasons.map((reason) => (
                      <li key={reason.label} className="flex gap-2 text-[12px] leading-snug">
                        <span
                          aria-hidden
                          className={
                            reason.direction === "up"
                              ? "text-good"
                              : reason.direction === "down"
                                ? "text-bad"
                                : "text-muted/50"
                          }
                        >
                          {reason.direction === "up" ? "▲" : reason.direction === "down" ? "▼" : "•"}
                        </span>
                        <span className="min-w-0 text-muted">
                          {reason.label}{" "}
                          <span className="mono text-[11px] text-muted/70">{reason.value}</span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-3 rounded-lg border border-line/70 bg-panel/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
                    {r.angle}
                  </p>

                  {r.tags.length ? (
                    <p className="mt-2.5 flex flex-wrap gap-1.5">
                      {r.tags.slice(0, 6).map((t) => (
                        <span
                          key={t.tag}
                          className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-muted"
                        >
                          #{t.tag}
                        </span>
                      ))}
                    </p>
                  ) : null}

                  {r.study.length ? (
                    <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted/80">
                      Study:{" "}
                      {r.study.slice(0, 3).map((s, i) => (
                        <span key={s.handle}>
                          {i > 0 ? ", " : ""}
                          <a
                            href={`https://www.instagram.com/${s.handle}/`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-accent underline decoration-accent/30 underline-offset-2"
                          >
                            @{s.handle}
                          </a>{" "}
                          <span className="mono text-[10.5px] text-muted/60">
                            {compact(s.medianViews)} usual
                          </span>
                        </span>
                      ))}
                    </p>
                  ) : null}

                  {/**
                    * Straight to the first-posts plan, not to the handle form.
                    * The visitor has just told us they have no account to check —
                    * sending them to a "your handle" box was the dead end.
                    */}
                  <a
                    href={`/room?q=${encodeURIComponent(r.query)}`}
                    className="mt-3 block rounded-xl bg-accent px-4 py-3 text-center text-[13.5px] font-semibold text-black transition active:scale-[0.99]"
                  >
                    Plan my first posts in {r.query}
                  </a>
                </li>
              );
            })}
          </ol>

          {partial ? (
            <p className="text-[11px] leading-relaxed text-warn/80">
              Some spaces did not come back: {partial.join(" · ")}
            </p>
          ) : null}

          {/**
            * Reading their words back is what turns a black box into a tool
            * they can correct: if this line is wrong, the ranking below it is
            * wrong, and they can see that in one glance instead of guessing.
            */}
          {heard ? (
            <p className="text-[11px] leading-relaxed text-muted/60">
              Understood from “{heard.input}”.
            </p>
          ) : null}

          {adjacent.length ? (
            <section className="border-t border-line/70 pt-4">
              <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
                Neighbouring rooms worth a look
              </h2>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted/70">
                Same knowledge, thinner competition. Not researched yet, so
                these cost nothing — read one when you want it.
              </p>
              <ul className="mt-3 divide-y divide-line/70">
                {adjacent.map((a) => (
                  <li key={a.query}>
                    <a
                      href={`/discover?q=${encodeURIComponent(a.query)}`}
                      className="flex items-baseline justify-between gap-3 py-2.5 transition hover:text-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] capitalize">
                          {a.query}
                        </span>
                        {a.why ? (
                          <span className="mt-0.5 block truncate text-[11px] text-muted/60">
                            {a.why}
                          </span>
                        ) : null}
                      </span>
                      <span aria-hidden className="shrink-0 text-[11px] text-muted/50">
                        →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
