"use client";

import { useEffect, useRef, useState } from "react";

import SignInButton from "@/components/SignInButton";
import { PENDING_HANDLE_KEY } from "@/components/ConnectHandle";
import { plain } from "@/lib/plain";

const STAGES = [
  "Reading the room…",
  "Finding the reels that broke out…",
  "Ranking them against their followers…",
  "Writing the briefing…",
];

const TIMEOUT_MS = 150_000;

/**
 * The "read this niche" panel.
 *
 * A niche dossier is a stored artifact. When the phrase is not on disk, an
 * anonymous visitor is asked to sign in (the phrase survives the trip through
 * Google in the same session-storage key the handle and chat forms use); a
 * signed-in visitor may spend six gems on a fresh read. The vendor work happens
 * in POST /api/niche, exactly as before — this panel never calls one itself.
 */
export default function ReadPanel({
  query,
  signedIn,
}: {
  query: string;
  signedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(!signedIn);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function remember() {
    try {
      window.sessionStorage.setItem(
        PENDING_HANDLE_KEY,
        JSON.stringify({ niche: query }),
      );
    } catch {
      // Storage blocked: sign-in still works, the phrase is just not kept.
    }
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function read() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    setStage(0);
    setSlow(false);

    timer.current = setInterval(
      () => setStage((current) => Math.min(current + 1, STAGES.length - 1)),
      5000,
    );
    const slowTimer = setTimeout(() => setSlow(true), 30_000);
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch("/api/niche", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (res.status === 401) {
        /**
         * Do not write the pending phrase here: the prompt below is a new,
         * explicit sign-in action, and that click is what remembers it.
         */
        setNeedsSignIn(true);
        return;
      }

      if (res.status === 402) {
        setError(
          plain(
            json.error ??
              "You do not have enough gems for a fresh read today. Niches already read stay free.",
          ),
        );
        return;
      }

      if (res.status === 429) {
        setError("You have read a few niches today. Try again in a little while.");
        return;
      }

      if (!res.ok || !json.ok) {
        setError(
          plain(
            json.error ??
              "That did not work. Try again in a moment — the niche was not read.",
          ),
        );
        return;
      }

      /** The pull is now on disk; a full load is guaranteed to show it. */
      window.location.reload();
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      setError(
        aborted
          ? "That took too long to read. Try again — or try a broader phrase."
          : "That did not work. Try again in a moment — the niche was not read.",
      );
    } finally {
      clearTimeout(killer);
      clearTimeout(slowTimer);
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="read-niche-title" className="card mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-luxury-gold">
            Niche not on disk
          </p>
          <h2
            id="read-niche-title"
            className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.03em] text-pure-white"
          >
            Read this niche
          </h2>
        </div>
        <p className="mono text-[11px] uppercase tracking-[0.1em] text-muted-zinc">
          Public posts only
        </p>
      </div>

      <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted-zinc">
        A fresh read of{" "}
        <span className="font-semibold text-pure-white">&ldquo;{query}&rdquo;</span>{" "}
        costs six gems and takes about a minute. Once it is read, this dossier
        opens free for everyone — no gems, no new vendor calls.
      </p>

      {needsSignIn ? (
        <div className="mt-5 rounded-xl border border-limelight/25 bg-limelight/[0.04] p-4">
          <p className="text-[13px] font-medium text-pure-white">
            Sign in to read this niche
          </p>
          <p className="mt-1 text-[15px] leading-relaxed text-muted-zinc">
            Reads are tied to an account so the gems and the daily allowance
            cannot be spent anonymously. Niches already read stay free.
          </p>
          {/**
           * Remember the phrase only when the visitor actually presses the
           * sign-in action. A page load must not leave a pending entry behind:
           * a later visit to the landing form would inherit an unrelated niche.
           */}
          <span onClick={remember} className="mt-3 inline-flex">
            <SignInButton
              label="Continue with Google"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-limelight px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-limelight/85"
            />
          </span>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={read}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-limelight px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-limelight/85 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              "Reading…"
            ) : (
              <>
                <span aria-hidden="true">Read this niche (6 💎)</span>
                <span className="sr-only">
                  Read the niche {query} for 6 gems
                </span>
              </>
            )}
          </button>
          <p className="text-[11px] leading-relaxed text-muted-zinc">
            Charged once. A run that reads nothing is refunded.
          </p>
        </div>
      )}

      {busy ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-obsidian/40 p-4">
          <p role="status" className="text-[13px] text-limelight">
            {STAGES[stage]}
          </p>
          {slow ? (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-zinc">
              Still reading — a busy room can take up to a minute. Keep this page
              open.
            </p>
          ) : null}
          <div className="mt-2.5 flex gap-1" aria-hidden="true">
            {STAGES.map((_, index) => (
              <span
                key={index}
                className={`h-0.5 flex-1 rounded-full transition-colors ${
                  index <= stage ? "bg-limelight" : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-bad/40 bg-bad/5 px-3.5 py-3"
        >
          <p className="text-[15px] leading-relaxed text-bad">{error}</p>
          {!needsSignIn ? (
            <button
              type="button"
              onClick={read}
              className="mt-2 inline-flex min-h-[44px] items-center rounded-md border border-bad/40 px-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-bad transition hover:bg-bad/10"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
