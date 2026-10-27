"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/weekly", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
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
        className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-line bg-panel px-4 text-[13px] font-medium transition hover:border-accent/50 hover:text-text disabled:opacity-50"
      >
        {working ? "Reading your account…" : label}
      </button>
      <p className="text-[11.5px] leading-relaxed text-muted/60">
        This re-reads your public posts — it is a real pull, so it is allowed once a day.
      </p>
      {error ? (
        <p className="text-[12.5px] leading-relaxed text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
