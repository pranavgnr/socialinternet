"use client";

import { useEffect, useRef, useState } from "react";

import SignInButton from "./SignInButton";
import { normalizeHandle } from "@/lib/handle";
import { plain } from "@/lib/plain";

const STAGES = [
  "Reading your latest reels…",
  "Working out what you post about…",
  "Finding what works for accounts your size…",
  "Comparing you with them…",
  "Writing your plan…",
];

/**
 * A 401 sends the visitor through Google and back to `/` with a fresh page.
 * There is no return URL (that would be an open-redirect surface), so the one
 * thing worth keeping — the handle they already typed — rides in session
 * storage for this tab only.
 */
const PENDING_KEY = "c101:pendingHandle";

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
  signedIn = false,
}: {
  /** set when the visitor picked a space on the discover page */
  initialNiche?: string;
  /** whether the page already sees a signed-in visitor */
  signedIn?: boolean;
}) {
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState(initialNiche ?? "");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A 401 is not an error to apologise for: it needs a way forward. */
  const [needsSignIn, setNeedsSignIn] = useState(false);
  /** The handle recovered after sign-in, shown as a reminder, never auto-read. */
  const [resumed, setResumed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    /**
     * The handle typed before a 401 is still here when Google sends the visitor
     * back. Fill the field and drop the key immediately: a later visit must not
     * resurrect an old handle. Only a signed-in visitor gets the note, and
     * nothing is submitted — a page load must never spend a credit.
     *
     * sessionStorage can be unavailable (privacy mode, blocked storage). A
     * lost prefill is not worth taking the form down for.
     */
    try {
      const saved = window.sessionStorage.getItem(PENDING_KEY);
      if (saved) {
        window.sessionStorage.removeItem(PENDING_KEY);
        const pending = JSON.parse(saved) as {
          handle?: unknown;
          niche?: unknown;
        };
        const savedHandle =
          typeof pending.handle === "string"
            ? normalizeHandle(pending.handle)
            : null;
        if (savedHandle) {
          setHandle(savedHandle);
          if (typeof pending.niche === "string" && pending.niche.trim()) {
            setNiche(pending.niche.trim());
          }
          if (signedIn) setResumed(savedHandle);
        }
      }
    } catch {
      // No storage, no prefill; the form still works.
    }

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [signedIn]);

  /**
   * Reading an account that is not cached takes the better part of a minute.
   * The ceiling is generous but finite: a request that never answers must end in
   * a sentence the visitor can act on, never in a button stuck on "Working…".
   */
  const TIMEOUT_MS = 150_000;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = normalizeHandle(handle);
    if (!clean) {
      setError("That does not look like an Instagram handle. Try @yourname.");
      setNeedsSignIn(false);
      return;
    }

    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
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

      /**
       * A plan belongs to a signed-in account. A 401 is therefore the normal
       * first response for a new visitor, not a failure: show the Google
       * button and keep the handle they typed. A 402 (out of credits) shows
       * the server's sentence about the balance and reset time, with no
       * sign-in button to press, because signing in again would not help.
       */
      if (res.status === 401) {
        /**
         * Keep the handle (and the chosen space) for the trip through Google.
         * No return-URL parameter: the OAuth route stays untouched, so there is
         * no redirect target an attacker could steer.
         */
        try {
          const pending: { handle: string; niche?: string } = { handle: clean };
          if (niche.trim()) pending.niche = niche.trim();
          window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        } catch {
          // Storage blocked: sign-in still works, the handle just is not kept.
        }
        setNeedsSignIn(true);
        setError(plain(json.error ?? "Sign in to read your account."));
        return;
      }
      if (!res.ok || !json.ok) {
        throw new Error(
          plain(json.error ?? "That did not work. Try again in a moment."),
        );
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
          : plain(
              (err as Error).message ||
                "That did not work. Try again in a moment.",
            ),
      );
    } finally {
      clearTimeout(killer);
      clearTimeout(slowTimer);
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-7">
      <section>
        <form onSubmit={submit}>
          <label
            htmlFor="handle-input"
            className="block text-[13px] font-medium text-text"
          >
            Connect your Instagram
          </label>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted/70">
            Reads public posts only. Nothing is posted for you.
          </p>

          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-panel px-3 focus-within:border-accent/60">
              <span className="text-[15px] text-muted">@</span>
              <input
                id="handle-input"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="yourhandle"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
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
            Free · sign in with Google to read your account
          </p>

          {resumed ? (
            <p className="mt-2.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-[12px] leading-relaxed text-text">
              You&apos;re signed in. Press the button to read @{plain(resumed)}.
            </p>
          ) : null}

          {niche ? (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[11.5px] text-text">
                <span className="truncate">In &ldquo;{plain(niche)}&rdquo;</span>
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

        {needsSignIn ? (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 px-3.5 py-3.5">
            <p className="text-[13px] font-medium text-text">
              Sign in to read your account
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Your plan is built from your own public posts. Sign in with Google
              to continue.
            </p>
            {error ? (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted/70">
                {error}
              </p>
            ) : null}
            <SignInButton
              label="Continue with Google"
              className="mt-3 inline-flex min-h-[36px] items-center rounded-xl bg-accent px-4 text-[13px] font-semibold text-black transition active:scale-[0.99]"
            />
          </div>
        ) : error ? (
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
