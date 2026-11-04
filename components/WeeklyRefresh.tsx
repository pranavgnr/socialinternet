"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import SignInButton from "./SignInButton";

/**
 * Pressing this spends real credits, so it says so and is allowed once a day.
 *
 * The normal path is the Monday job; this button exists for the creator who
 * wants this week's answer now, or whose week came out wrong. A second press is
 * refused by the server, and the refusal is shown rather than swallowed.
 */
export default function WeeklyRefresh({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A 401 means the session expired: show the button, not a dead end. */
  const [needsSignIn, setNeedsSignIn] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      const res = await fetch("/api/weekly", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.status === 401) {
        setNeedsSignIn(true);
        setError(body.error ?? "Sign in to refresh this week.");
        return;
      }
      if (!res.ok || !body.ok) {
        setError(body.error ?? "That did not work. Try again in a moment.");
        return;
      }
      start(() => router.refresh());
    } catch {
      setError("Lost the connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={working}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-panel px-4 text-[13px] font-medium transition hover:border-accent/50 hover:text-text disabled:opacity-50"
      >
        {working ? "Reading your account…" : label}
      </button>
      <p className="text-[11.5px] leading-relaxed text-muted/60">
        This re-reads your public posts — it is a real pull, so it is allowed once a day.
      </p>
      {needsSignIn ? (
        <div className="rounded-xl border border-accent/30 bg-accent/5 px-3.5 py-3.5">
          <p className="text-[15px] leading-relaxed text-muted" role="alert">
            {error ?? "Sign in to refresh this week."}
          </p>
          <SignInButton
            label="Continue with Google"
            className="mt-2.5 inline-flex min-h-[44px] items-center rounded-xl bg-accent px-4 text-[13px] font-semibold text-black transition active:scale-[0.99]"
          />
        </div>
      ) : error ? (
        <p className="text-[15px] leading-relaxed text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
