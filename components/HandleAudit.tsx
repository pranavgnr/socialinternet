"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { routeFor } from "@/lib/omni";
import { plain } from "@/lib/plain";

const STAGES = [
  "Reading the account…",
  "Working out what it posts about…",
  "Finding what is working in its space…",
  "Writing the audit…",
];

const TIMEOUT_MS = 150_000;

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
 * The handle audit box.
 *
 * `/profile/<handle>` is built in Task 4. Until it exists, the box keeps the
 * behaviour that works today: a signed-out visitor is simply sent to the
 * route's href (a 404 is expected for one task, never a silent spend), while a
 * signed-in visitor keeps the old dashboard flow — read the account, save the
 * plan, reload `/`. Both paths still decide the destination with `routeFor`,
 * so the box cannot drift from the header search bar.
 */
export default function HandleAudit({ signedIn = false }: { signedIn?: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimers() {
    if (timers.current) clearInterval(timers.current);
    timers.current = null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const raw = value.trim();
    const shaped =
      !raw || raw.startsWith("@") || /instagram\.com\//i.test(raw)
        ? raw
        : `@${raw}`;
    const result = routeFor(shaped);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setError(null);

    /**
     * No account yet, or a niche phrase that does not need a paid read: the
     * route's href is the whole job. POSTing here would mint a cookie or spend
     * a read the visitor did not ask for.
     */
    if (!signedIn || result.kind !== "profile") {
      router.push(result.href);
      return;
    }

    setBusy(true);
    setStage(0);
    timers.current = setInterval(
      () => setStage((current) => Math.min(current + 1, STAGES.length - 1)),
      4500,
    );

    const handle = decodeURIComponent(result.href.split("/").pop() ?? "");
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (res.status === 401) {
        router.push(result.href);
        return;
      }
      if (!res.ok || !json.ok) {
        throw new Error(
          plain(json.error ?? "That did not work. Try again in a moment."),
        );
      }

      window.location.replace("/");
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      setError(
        aborted
          ? "That took too long to read. Try again — or try a smaller account."
          : plain(
              (err as Error).message ||
                "That did not work. Try again in a moment.",
            ),
      );
    } finally {
      clearTimeout(killer);
      clearTimers();
      setBusy(false);
    }
  }

  return (
    <div className="card relative mt-8 overflow-hidden p-5 pr-14 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-limelight/60 to-transparent"
      />

      <label
        htmlFor={inputId}
        className="mono block text-[10px] font-bold uppercase tracking-[0.16em] text-limelight"
      >
        Enter your handle to run an instant audit:
      </label>

      <form onSubmit={submit} noValidate className="mt-3">
        <div className="flex flex-col gap-2.5 lg:flex-row">
          <div
            className={`flex min-w-0 flex-1 items-center rounded-xl border bg-obsidian/60 px-3.5 transition focus-within:ring-1 ${
              error
                ? "border-bad/60 focus-within:ring-bad/20"
                : "border-white/10 focus-within:border-limelight/60 focus-within:ring-limelight/20"
            }`}
          >
            <span className="text-[17px] text-muted-zinc" aria-hidden="true">
              @
            </span>
            <input
              id={inputId}
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError(null);
              }}
              placeholder="your_instagram_handle"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className="min-w-0 flex-1 bg-transparent px-1.5 py-3.5 text-[16px] text-pure-white outline-none placeholder:text-muted-zinc/60"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-[50px] items-center justify-center rounded-xl bg-limelight px-6 text-[11px] font-bold uppercase tracking-[0.12em] text-obsidian transition hover:bg-limelight/85 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Reading…" : "See analytics"}
          </button>

          <Link
            href="#vault"
            aria-label="IG Wrapped is locked — join the VIP waitlist"
            className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl border border-luxury-gold/35 bg-luxury-gold/10 px-5 text-[10px] font-bold uppercase tracking-[0.12em] text-luxury-gold transition hover:border-luxury-gold/60 hover:bg-luxury-gold/15"
          >
            <LockGlyph />
            IG Wrapped
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[11.5px] leading-relaxed text-muted-zinc">
            Cached accounts open free. A fresh read uses 6 of your 15 daily gems
            after a free Google sign-in.
          </p>
          <p className="mono text-[10px] uppercase tracking-[0.1em] text-muted-zinc/60">
            Public posts only
          </p>
        </div>

        {busy ? (
          <p role="status" className="mt-3 text-[12px] text-limelight">
            {STAGES[stage]}
          </p>
        ) : null}

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="mt-3 rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[12.5px] leading-relaxed text-bad"
          >
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
