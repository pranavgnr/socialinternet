"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { NicheView } from "@/lib/niche";

/**
 * Numbers as a creator reads them. Kept local rather than imported from the
 * pipeline so nothing server-side leaks into the bundle.
 */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function age(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** A caption is evidence, not the point: one line, ellipsis, no newlines. */
function firstLine(caption: string, max = 110): string {
  const flat = caption.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export default function NicheSearch({
  initialQuery,
  autoRun = false,
}: {
  initialQuery?: string;
  /** only when the phrase is already on disk, so mounting cannot spend */
  autoRun?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<NicheView | null>(null);
  const [planHref, setPlanHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  const search = useCallback(async (raw: string) => {
    const clean = raw.trim();
    if (clean.length < 2) {
      setError("Type a couple of words — what the posts are about.");
      return;
    }

    setBusy(true);
    setError(null);
    setView(null);
    setPlanHref(null);

    try {
      const res = await fetch("/api/niche", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: clean }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        view?: NicheView;
        planHref?: string;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.view) {
        throw new Error(
          json.error ?? "That search did not work. Try again in a moment.",
        );
      }
      setView(json.view);
      setPlanHref(json.planHref ?? null);
    } catch (err) {
      setError(
        (err as Error).message || "That search did not work. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (ran.current || !autoRun || !initialQuery) return;
    ran.current = true;
    void search(initialQuery);
  }, [autoRun, initialQuery, search]);

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="telugu music covers"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="The niche to look at"
            className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3.5 py-3.5 text-[16px] outline-none placeholder:text-muted/50 focus:border-accent/60"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-accent px-5 py-3.5 text-[14px] font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? "Reading…" : "Look at this niche"}
          </button>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted/70">
          A space, not a handle — &ldquo;fitness for beginners&rdquo;,
          &ldquo;kannada singing&rdquo;, &ldquo;AI tools&rdquo;. Niches already
          looked at are free to reopen.
        </p>
      </form>

      {error ? (
        <p className="rounded-xl border border-bad/40 bg-bad/5 px-3.5 py-3 text-[13px] leading-relaxed text-bad">
          {error}
        </p>
      ) : null}

      {view ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[17px] font-semibold tracking-tight">
              {view.query}
            </h2>
            <p className="mono text-[11px] text-muted">
              {view.cached
                ? `reopened · free · ${age(view.ageHours)}`
                : `${view.credits.spent} credit${
                    view.credits.spent === 1 ? "" : "s"
                  }`}
            </p>
          </div>

          <div className="card px-4 py-3.5">
            <p className="text-[13px] leading-relaxed text-muted">
              A reel here has to beat{" "}
              <span className="font-semibold text-text">
                {compact(view.nicheMedianViews)} views
              </span>{" "}
              to count as breaking out. That is the usual for{" "}
              {view.reels} reel{view.reels === 1 ? "" : "s"} across{" "}
              {view.accountCount} account{view.accountCount === 1 ? "" : "s"}.
            </p>
          </div>

          {view.top.length ? (
            <div>
              <h3 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
                Who is breaking out
              </h3>
              <ul className="mt-2 divide-y divide-line/70 border-y border-line/70">
                {view.top.map((a) => (
                  <li key={a.handle} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <a
                        href={`https://www.instagram.com/${a.handle}/`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate text-[14px] font-medium hover:text-accent"
                      >
                        @{a.handle}
                      </a>
                      <span className="mono shrink-0 text-[11.5px] text-muted">
                        {compact(a.medianViews)} usual · {compact(a.bestViews)} best
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {a.reels} reel{a.reels === 1 ? "" : "s"}
                      {a.followers ? ` · ${compact(a.followers)} followers` : ""}
                      {a.outliers
                        ? ` · ${a.outliers} broke out`
                        : " · none broke out"}
                    </p>
                    {a.topReel?.caption ? (
                      <p className="mt-1.5 text-[12.5px] leading-snug text-muted/90">
                        {firstLine(a.topReel.caption)}
                      </p>
                    ) : null}
                    {a.topReel?.url ? (
                      <a
                        href={a.topReel.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-block text-[12px] text-accent underline decoration-accent/30 underline-offset-2"
                      >
                        See the post · {compact(a.topReel.views)} views
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {view.hashtags.length ? (
            <div>
              <h3 className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
                What they keep talking about
              </h3>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {view.hashtags.map((h) => (
                  <span
                    key={h.tag}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-[11.5px] text-muted"
                  >
                    #{h.tag} <span className="mono text-muted/60">{h.count}</span>
                  </span>
                ))}
              </p>
            </div>
          ) : null}

          {planHref ? (
            <a
              href={planHref}
              className="block rounded-xl bg-accent px-4 py-3.5 text-center text-[14px] font-semibold text-black transition active:scale-[0.99]"
            >
              Build my plan in this niche
            </a>
          ) : null}

          {view.errors.length ? (
            <p className="text-[11px] leading-relaxed text-warn/80">
              Part of this pull did not come back: {view.errors.join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
