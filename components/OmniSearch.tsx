"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { routeFor } from "@/lib/omni";

/**
 * The one search bar: a profile or a niche. Enter (or the arrow) navigates;
 * a refusal is shown inline instead of leaving the page for a 404 or spending
 * a credit on a handle that cannot exist.
 */
export default function OmniSearch() {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = routeFor(value);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    router.push(result.href);
  }

  return (
    <form role="search" onSubmit={onSubmit} className="w-full">
      <label htmlFor={inputId} className="sr-only">
        Search a niche or paste an @handle
      </label>
      <div
        className={`flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition ${
          error
            ? "border-bad/60"
            : "border-white/10 focus-within:border-limelight/60 focus-within:ring-1 focus-within:ring-limelight/20"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-4 w-4 shrink-0 text-muted-zinc"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          placeholder="Search a niche or @handle"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="min-h-[44px] min-w-0 flex-1 bg-transparent py-2 text-[16px] text-pure-white outline-none placeholder:text-muted-zinc"
        />
        <button
          type="submit"
          aria-label="Search"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-limelight text-[18px] font-semibold text-obsidian transition hover:bg-limelight/85"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-[11px] leading-snug text-bad"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
