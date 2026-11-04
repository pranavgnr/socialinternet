"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import Gems from "../Gems";
import SignInButton from "../SignInButton";
import { PENDING_HANDLE_KEY } from "@/lib/pendingHandle";
import ActionRow from "./ActionRow";
import CardMessage from "./CardMessage";
import KokoAvatar from "./KokoAvatar";
import MemoryChips from "./MemoryChips";
import { KOKO_ACTIONS, type KokoActionId } from "@/lib/kokoActions";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  ok?: boolean;
  reply?: string;
  refused?: boolean;
  balance?: number;
  error?: string;
  link?: string;
}

export interface ScriptPrompt {
  idea: number;
  handle: string;
  label: string;
  concept: string;
}

/**
 * The Koko studio.
 *
 * The server page supplies what is actually loaded; this component only sends
 * messages and actions. Actions build their prompt on the server, so tapping one
 * cannot smuggle text into the model. The script link from a profile arrives as
 * a confirmation card and is never sent on page load — no auto-spend.
 */
export default function KokoStudio({
  backHref,
  signedIn,
  handle,
  niche,
  nicheLoaded,
  competitors,
  credits: initialCredits,
  intro,
  deepSpyHandle,
  script,
}: {
  backHref: string;
  signedIn: boolean;
  handle: string | null;
  niche: string | null;
  nicheLoaded: boolean;
  competitors: number;
  credits: number | null;
  intro: string;
  deepSpyHandle: string | null;
  script: ScriptPrompt | null;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [credits, setCredits] = useState<number | null>(initialCredits);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [scriptPending, setScriptPending] = useState(Boolean(script));
  const [live, setLive] = useState("");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const showSignIn = !signedIn || needsSignIn;

  /** Keep the handle/niche for the return from Google, as the other flows do. */
  const remember = () => {
    try {
      window.sessionStorage.setItem(
        PENDING_HANDLE_KEY,
        JSON.stringify({ handle: handle ?? undefined, niche: niche ?? undefined }),
      );
    } catch {
      // Storage blocked: sign-in still works, the context is just not kept.
    }
  };

  useEffect(() => {
    if (signedIn) return;
    remember();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, handle, niche]);

  useEffect(() => {
    if (turns.length === 0) return;
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, busy]);

  async function post(payload: Record<string, unknown>, userLine: string) {
    if (busy) return;

    const prior = turns;
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    setMessage("");
    setTurns([...prior, { role: "user", content: userLine }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as ChatResponse;

      if (typeof body.balance === "number") setCredits(body.balance);

      if (res.status === 401) {
        setTurns(prior);
        setNeedsSignIn(true);
        remember();
        return;
      }

      if (res.status === 402) {
        setTurns(prior);
        setError(
          body.error ??
            "You do not have enough gems for a message today. The free pool resets after midnight IST.",
        );
        return;
      }

      if (!res.ok || !body.ok || typeof body.reply !== "string") {
        setTurns(prior);
        setError(
          res.status === 503
            ? "Koko is not switched on yet. Try again later."
            : res.status === 400
              ? "That message could not be sent. Try a shorter one."
              : "That did not work. You were not charged.",
        );
        return;
      }

      setTurns([
        ...prior,
        { role: "user", content: userLine },
        { role: "assistant", content: body.reply },
      ]);
      setLive(body.reply);
    } catch {
      setTurns(prior);
      setError("Lost the connection. Try again.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function sendMessage() {
    const text = message.trim();
    if (!text) return;
    void post(
      {
        message: text,
        handle: handle ?? undefined,
        niche: niche ?? undefined,
      },
      text,
    );
  }

  function runAction(id: KokoActionId) {
    const action = KOKO_ACTIONS.find((item) => item.id === id);
    if (!action || action.locked) return;
    void post(
      {
        action: id,
        handle: handle ?? undefined,
        niche: niche ?? undefined,
      },
      action.label,
    );
  }

  function sendScript() {
    if (!script) return;
    setScriptPending(false);
    void post(
      { action: "script", idea: script.idea, handle: script.handle },
      script.label,
    );
  }

  return (
    <section className="mx-auto w-full min-w-0 max-w-3xl pb-24 sm:pb-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            prefetch={false}
            aria-label="Back"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-white/10 px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-pure-white transition hover:border-white/25 hover:bg-white/5"
          >
            <span aria-hidden="true">←</span> Back
          </Link>
          <KokoAvatar className="h-9 w-9" />
          <div className="min-w-0">
            <h1 className="min-w-0 text-[15px] font-extrabold uppercase leading-tight tracking-[-0.02em] text-pure-white sm:text-[19px]">
              <span className="text-limelight">Koko</span> AI Command Studio
            </h1>
            <p className="mono text-[11px] uppercase tracking-[0.12em] text-muted-zinc">
              <span className="text-limelight" aria-hidden="true">
                ●
              </span>{" "}
              Online · AI Director
            </p>
          </div>
        </div>

        <div className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/10 bg-card px-3">
          {credits === null ? (
            <span className="mono text-[11px] text-muted-zinc">
              <span aria-hidden="true">💎</span> —<span className="sr-only"> gem balance unknown</span>
            </span>
          ) : (
            <Gems value={credits} className="text-[11px] text-pure-white" />
          )}
        </div>
      </header>

      <MemoryChips
        handle={handle}
        niche={nicheLoaded ? niche : null}
        competitors={competitors}
      />

      {showSignIn ? (
        <div className="card mt-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <KokoAvatar className="h-10 w-10" />
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-pure-white">
                Sign in to work with Koko
              </h2>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-zinc">
                Koko answers only from the account or niche that was read. Sign
                in so the gems and the thread belong to you
                {handle ? `, then @${handle} is kept for this tab` : ""}.
              </p>
              <SignInButton
                label="Continue with Google"
                className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-limelight px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-limelight/85"
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <CardMessage markdown={intro} label="Koko" />
          </div>

          <ActionRow
            actions={KOKO_ACTIONS}
            busy={busy}
            onAction={runAction}
            deepSpyHandle={deepSpyHandle}
          />

          {script && scriptPending ? (
            <div className="card mt-4 p-4 sm:p-5">
              <p className="mono text-[11px] font-bold uppercase tracking-[0.16em] text-limelight">
                One tap · 1 💎
              </p>
              <h2 className="mt-1.5 text-[15px] font-semibold text-pure-white">
                Script this idea
              </h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted-zinc">
                {script.concept
                  ? `“${script.concept}”`
                  : "The stored concept for this idea is empty."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={sendScript}
                  disabled={busy}
                  className="inline-flex min-h-[44px] items-center rounded-lg bg-limelight px-3.5 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-limelight/85 disabled:opacity-60"
                >
                  Script this idea (1 💎)
                </button>
                <button
                  type="button"
                  onClick={() => setScriptPending(false)}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-white/10 px-3.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-zinc transition hover:text-pure-white"
                >
                  Not now
                </button>
              </div>
            </div>
          ) : null}

          <div
            aria-label="Conversation"
            className="mt-5 min-w-0 space-y-3"
          >
            {turns.map((turn, index) =>
              turn.role === "user" ? (
                <div key={`u-${index}`} className="flex justify-end">
                  <p className="max-w-[88%] min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-limelight/20 bg-limelight/[0.08] px-3.5 py-2.5 text-[15px] leading-relaxed text-pure-white [overflow-wrap:anywhere]">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <CardMessage key={`a-${index}`} markdown={turn.content} />
              ),
            )}
            {busy ? (
              <p role="status" className="text-[12px] text-muted-zinc">
                Koko is reading what is loaded…
              </p>
            ) : null}
            <div ref={endRef} />
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {live}
          </p>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-bad/40 bg-bad/5 px-3.5 py-3 text-[15px] leading-relaxed text-bad"
            >
              {error}
            </p>
          ) : null}

          <form
            className="card mt-4 p-3 sm:p-4"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <label htmlFor="koko-message" className="sr-only">
              Ask Koko
            </label>
            <textarea
              id="koko-message"
              ref={inputRef}
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 600))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              rows={2}
              maxLength={600}
              onFocus={(event) =>
                event.currentTarget.scrollIntoView({ block: "center" })
              }
              disabled={busy}
              placeholder="Ask Koko anything about your niche, competitors, scripts, or rates..."
              className="min-h-[52px] w-full resize-y rounded-lg border border-white/10 bg-obsidian/60 px-3 py-2.5 text-[16px] leading-relaxed text-pure-white outline-none placeholder:text-muted-zinc/70 focus:border-limelight/60 focus:ring-1 focus:ring-limelight/20 disabled:opacity-60"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="mono text-[11px] text-muted-zinc">
                {message.length}/600 · Enter sends · Shift+Enter for a new line
              </p>
              <button
                type="submit"
                disabled={busy || !message.trim()}
                className="inline-flex min-h-[44px] items-center rounded-lg bg-limelight px-4 text-[11px] font-bold uppercase tracking-[0.12em] text-obsidian transition hover:bg-limelight/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
