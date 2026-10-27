"use client";

import { useEffect, useRef, useState } from "react";

const STAGES = [
  "Reading your latest reels…",
  "Working out what you post about…",
  "Finding what works for accounts your size…",
  "Comparing you with them…",
  "Writing your plan…",
];

const GET = [
  {
    t: "Advice shaped for what you actually post",
    d: "A singer gets songs to cover. A vlogger gets the shapes of video working right now. A coach gets the opening line. Nothing to pick from a list — it is read from your own posts.",
  },
  {
    t: "Only accounts your size",
    d: "No advice borrowed from people with a million followers.",
  },
  {
    t: "The post behind every move",
    d: "Open it and check the numbers yourself.",
  },
];

export default function ConnectHandle({
  initialNiche,
}: {
  /** set when the visitor picked a space on the discover page */
  initialNiche?: string;
}) {
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState(initialNiche ?? "");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  /**
   * Reading an account that is not cached takes the better part of a minute.
   * The ceiling is generous but finite: a request that never answers must end in
   * a sentence the visitor can act on, never in a button stuck on "Working…".
   */
  const TIMEOUT_MS = 150_000;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = handle.trim().replace(/^@/, "");
    if (!clean) {
      setError("Add your Instagram handle first.");
      return;
    }

    setBusy(true);
    setError(null);
    setStage(0);
    setSlow(false);

    timer.current = setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      4500,
    );
    const slowTimer = setTimeout(() => setSlow(true), 25_000);

    const ctl = new AbortController();
    const killer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: clean, niche: niche.trim() || undefined }),
        signal: ctl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "That did not work. Try again in a moment.");
      }

      /**
       * A full page load rather than router.refresh(). The plan is tied to the
       * cookie set by this response, and only a real navigation guarantees the
       * browser sends it — a refresh that raced it would drop the visitor back
       * on an empty form with no explanation.
       */
      window.location.replace("/");
      return;
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      setError(
        aborted
          ? "That took too long to read. Try again — or try a smaller account."
          : ((err as Error).message ||
              "That did not work. Try again in a moment."),
      );
    } finally {
      clearTimeout(killer);
      clearTimeout(slowTimer);
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="pt-6">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
          For creators
        </p>
        <h1 className="mt-3 text-[32px] font-semibold leading-[1.06] tracking-tight sm:text-[42px]">
          Know exactly what
          <br />
          to post next.
        </h1>
        <p className="mt-4 max-w-lg text-[14.5px] leading-relaxed text-muted">
          Put in your handle. We work out what kind of account it is, find the
          posts breaking out for accounts your size, and give you what to make
          this month — each one with the post that proves it.
        </p>

        <form onSubmit={submit} className="mt-7">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-panel px-3 focus-within:border-accent/60">
              <span className="text-[15px] text-muted">@</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="yourhandle"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="Your Instagram handle"
                className="min-w-0 flex-1 bg-transparent px-1.5 py-3.5 text-[16px] outline-none placeholder:text-muted/50"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-accent px-5 py-3.5 text-[14px] font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
            >
              {busy ? "Working…" : "Build my plan"}
            </button>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-muted/70">
            Free to try · about a minute · no login
          </p>

          {niche ? (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[11.5px] text-text">
                <span className="truncate">In &ldquo;{niche}&rdquo;</span>
                <button
                  type="button"
                  onClick={() => setNiche("")}
                  aria-label="Clear the chosen niche"
                  className="shrink-0 px-0.5 text-muted transition hover:text-text"
                >
                  &times;
                </button>
              </span>
              <span className="text-[11px] text-muted/70">
                from Explore — the plan is built for this space
              </span>
            </div>
          ) : null}
        </form>

        {busy ? (
          <div className="mt-5 rounded-xl border border-line bg-panel px-4 py-3.5">
            <p className="text-[13px] text-text">{STAGES[stage]}</p>
            {slow ? (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                Still reading — a busy account can take up to a minute. Keep this
                page open.
              </p>
            ) : null}
            <div className="mt-2.5 flex gap-1">
              {STAGES.map((_, i) => (
                <span
                  key={i}
                  className={`h-0.5 flex-1 rounded-full transition-colors ${
                    i <= stage ? "bg-accent" : "bg-line"
                  }`}
                />
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-bad/40 bg-bad/5 px-3.5 py-3 text-[13px] leading-relaxed text-bad">
            {error}
          </p>
        ) : null}
      </section>

      <section className="border-t border-line/70 pt-5">
        <ul className="space-y-3">
          {GET.map((s) => (
            <li key={s.t} className="flex gap-3">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
              <p className="text-[13.5px] leading-snug text-muted">
                <span className="font-medium text-text">{s.t}.</span> {s.d}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-muted/70">
          Whatever you post about — singing, vlogging, dancing, fitness, baking,
          family life, money, AI tools, fashion, teaching — the plan is shaped for
          that kind of account, worked out from your own posts. No category to
          pick, nothing to set up.
        </p>
      </section>
    </div>
  );
}
