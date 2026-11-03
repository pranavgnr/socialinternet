"use client";

import { useEffect, useRef, useState } from "react";

import SignInButton from "../SignInButton";
import { PENDING_HANDLE_KEY } from "@/lib/pendingHandle";
import { plain } from "@/lib/plain";

const STAGES = [
  "Reading the account…",
  "Working out what it posts about…",
  "Finding what works in its space…",
  "Comparing it with similar accounts…",
  "Writing the audit…",
];

const TIMEOUT_MS = 150_000;

/**
 * The "read this account" panel.
 *
 * A profile view is a stored artifact. When there is none, an anonymous visitor
 * is asked to sign in (and the handle survives the trip through Google in the
 * same session-storage key the handle form uses); a signed-in visitor may spend
 * six gems on a fresh read. The actual vendor work happens in POST /api/profile,
 * never in this render.
 */
export default function ReadPanel({
  handle,
  signedIn,
}: {
  handle: string;
  signedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(!signedIn);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Keep the handle for the return from Google, as the other sign-in prompts do. */
  useEffect(() => {
    if (signedIn) return;
    try {
      window.sessionStorage.setItem(
        PENDING_HANDLE_KEY,
        JSON.stringify({ handle }),
      );
    } catch {
      // Storage blocked: sign-in still works, the handle just is not kept.
    }
  }, [handle, signedIn]);

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
      4500,
    );
    const slowTimer = setTimeout(() => setSlow(true), 25_000);
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch("/api/profile", {
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
        try {
          window.sessionStorage.setItem(
            PENDING_HANDLE_KEY,
            JSON.stringify({ handle }),
          );
        } catch {
          // Storage blocked: the prompt still works.
        }
        setNeedsSignIn(true);
        return;
      }

      if (res.status === 402) {
        setError(
          plain(
            json.error ??
              "You do not have enough gems for a fresh read today. Cached accounts still open free.",
          ),
        );
        return;
      }

      if (res.status === 429) {
        setError("You have read a few accounts today. Try again in a little while.");
        return;
      }

      if (!res.ok || !json.ok) {
        setError(
          plain(
            json.error ??
              "That did not work. Try again in a moment — the account was not read.",
          ),
        );
        return;
      }

      /** The stored view is now on disk; a full load is guaranteed to show it. */
      window.location.reload();
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      setError(
        aborted
          ? "That took too long to read. Try again — or try a smaller account."
          : "That did not work. Try again in a moment — the account was not read.",
      );
    } finally {
      clearTimeout(killer);
      clearTimeout(slowTimer);
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="read-title" className="card mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-luxury-gold">
            Profile not on disk
          </p>
          <h2
            id="read-title"
            className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.03em] text-pure-white"
          >
            Read this account
          </h2>
        </div>
        <p className="mono text-[11px] uppercase tracking-[0.1em] text-muted-zinc">
          Public posts only
        </p>
      </div>

      <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted-zinc">
        A fresh read of{" "}
        <span className="font-semibold text-pure-white">@{handle}</span> costs
        six gems and takes about a minute. Once it is read, this profile opens
        free for everyone for seven days — no gems, no new vendor calls.
      </p>

      {needsSignIn ? (
        <div className="mt-5 rounded-xl border border-limelight/25 bg-limelight/[0.04] p-4">
          <p className="text-[13px] font-medium text-pure-white">
            Sign in to read @{handle}
          </p>
          <p className="mt-1 text-[15px] leading-relaxed text-muted-zinc">
            Reads are tied to an account so the gems and the daily allowance
            cannot be spent anonymously.
          </p>
          <SignInButton
            label="Continue with Google"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-limelight px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-limelight/85"
          />
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
                <span aria-hidden="true">Read @{handle} (6 💎)</span>
                <span className="sr-only">Read {handle} for 6 gems</span>
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
              Still reading — a busy account can take up to a minute. Keep this
              page open.
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
