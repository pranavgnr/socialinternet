"use client";

import { useState } from "react";

import SignInButton from "./SignInButton";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const CHIPS = [
  "What should I post next?",
  "Give me a hook for my next reel",
  "Why did my worst reel flop?",
];

interface ChatResponse {
  ok?: boolean;
  reply?: string;
  refused?: boolean;
  balance?: number;
  error?: string;
}

/**
 * The grounded chat under the plan.
 *
 * Suggestions fill the input rather than sending: the creator decides what to
 * ask, and a tap can never spend a credit by accident. Every answer comes from
 * the server's stored history and the analysed account, so nothing here needs
 * to send earlier turns back.
 */
export default function ChatPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const prior = turns;
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    setMessage("");
    setTurns([...prior, { role: "user", content }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: content }),
      });
      const body = (await res.json().catch(() => ({}))) as ChatResponse;

      if (typeof body.balance === "number") setCredits(body.balance);

      if (res.status === 401) {
        setTurns(prior);
        setNeedsSignIn(true);
        setError(body.error ?? "Sign in to chat");
        return;
      }
      if (!res.ok || !body.ok || typeof body.reply !== "string") {
        setTurns(prior);
        setError(body.error ?? "That did not work. Try again in a moment.");
        return;
      }

      setTurns([...prior, { role: "user", content }, {
        role: "assistant",
        content: body.reply,
      }]);
    } catch {
      setTurns(prior);
      setError("Lost the connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">
          Ask about your reels
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Answers use only what we read from your account and this plan. One credit
          per message.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[420px] space-y-3 overflow-y-auto px-4 py-4">
          {turns.length ? (
            turns.map((turn, i) => (
              <div
                key={`${turn.role}-${i}`}
                className={
                  turn.role === "user"
                    ? "ml-8 rounded-xl bg-panel2 px-3 py-2.5"
                    : "mr-8 rounded-xl border border-line/70 px-3 py-2.5"
                }
              >
                <p className="text-[13.5px] leading-relaxed">
                  {turn.content}
                </p>
              </div>
            ))
          ) : (
            <p className="text-[13px] leading-relaxed text-muted">
              Ask what to post, why a reel worked, or how to open the next one.
              The answer comes from your own account — never from the open
              internet.
            </p>
          )}
          {busy ? (
            <p className="text-[12.5px] text-muted/70">Reading your account…</p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(message);
          }}
          className="border-t border-line/70 px-4 py-3"
        >
          <div className="flex gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about your reels…"
              maxLength={600}
              disabled={busy}
              aria-label="Ask about your reels"
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-2.5 text-[14px] outline-none placeholder:text-muted/50 focus-within:border-accent/60 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !message.trim()}
              className="rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted/60">
            {credits === null
              ? "1 credit per message"
              : `${credits} credit${credits === 1 ? "" : "s"} left today`}
          </p>
        </form>
      </div>

      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setMessage(chip)}
              className="rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] text-muted transition hover:border-accent/50 hover:text-text"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}

      {needsSignIn ? (
        <div className="rounded-xl border border-accent/30 bg-accent/5 px-3.5 py-3.5">
          <p className="text-[13px] font-medium">Sign in to chat</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Chat is tied to the account whose reels were analysed.
          </p>
          <SignInButton
            label="Continue with Google"
            className="mt-3 inline-flex min-h-[36px] items-center rounded-xl bg-accent px-4 text-[13px] font-semibold text-black transition active:scale-[0.99]"
          />
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-xl border border-bad/40 bg-bad/5 px-3.5 py-3 text-[13px] leading-relaxed text-bad"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
