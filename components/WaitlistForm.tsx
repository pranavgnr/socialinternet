"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { WaitlistFeature } from "@/lib/waitlist";

const FALLBACK_ERROR =
  "We could not save that just now. Please try again in a minute.";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "duplicate" }
  | { kind: "error"; message: string };

function messageFor(status: Status): string {
  if (status.kind === "done") return "You're on the list";
  if (status.kind === "duplicate") return "You're already on the list";
  if (status.kind === "error") return status.message;
  return "";
}

/**
 * The inline waitlist form. It posts one email or WhatsApp number and an
 * optional handle, then confirms in place. Server text is never shown; the
 * route's sentences are mapped to the two friendly outcomes here.
 */
export default function WaitlistForm({
  feature,
  source,
  className = "",
  submitLabel = "Join the waitlist",
  contactPlaceholder = "you@example.com or 98765 43210",
  handlePlaceholder = "@yourhandle",
}: {
  feature: WaitlistFeature;
  source?: string;
  className?: string;
  /** wording for the one action; the vault uses the founder's REQUEST arrow */
  submitLabel?: string;
  contactPlaceholder?: string;
  handlePlaceholder?: string;
}) {
  const contactId = useId();
  const handleId = useId();
  const hintId = useId();
  const statusId = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const [contact, setContact] = useState("");
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const sending = status.kind === "sending";
  const message = messageFor(status);

  /**
   * The success sentence is the result of the action, so keyboard and
   * screen-reader users are moved to it instead of being left on a disabled
   * button with the confirmation elsewhere.
   */
  useEffect(() => {
    if (status.kind === "done" || status.kind === "duplicate") {
      statusRef.current?.focus();
    }
  }, [status.kind]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;

    const value = contact.trim();
    if (!value) {
      setStatus({
        kind: "error",
        message: "Enter your email or WhatsApp number.",
      });
      return;
    }

    setStatus({ kind: "sending" });

    const payload: Record<string, string> = {
      feature,
      [value.includes("@") ? "email" : "whatsapp"]: value,
    };
    const trimmedHandle = handle.trim();
    if (trimmedHandle) payload.handle = trimmedHandle;
    if (source) payload.source = source;

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: { ok?: boolean; duplicate?: boolean } = {};
      try {
        data = (await res.json()) as { ok?: boolean; duplicate?: boolean };
      } catch {
        // A non-JSON failure is handled below like any other failure.
      }

      if (res.ok && data.ok) {
        setStatus({ kind: data.duplicate ? "duplicate" : "done" });
        setContact("");
        setHandle("");
        return;
      }
      if (res.status === 400) {
        setStatus({
          kind: "error",
          message: "Check your email or WhatsApp number and try again.",
        });
        return;
      }
      if (res.status === 429) {
        // Retry-after is deliberately ignored: the visitor gets one stable
        // sentence, not a countdown the server may not honour.
        setStatus({
          kind: "error",
          message: "Too many requests right now. Please try again later.",
        });
        return;
      }
      setStatus({ kind: "error", message: FALLBACK_ERROR });
    } catch {
      setStatus({ kind: "error", message: FALLBACK_ERROR });
    }
  }

  return (
    <form onSubmit={onSubmit} className={`space-y-3 ${className}`} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor={contactId}
            className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-zinc"
          >
            Email or WhatsApp
          </label>
          <input
            id={contactId}
            type="text"
            value={contact}
            onChange={(event) => {
              setContact(event.target.value);
              if (status.kind === "error") setStatus({ kind: "idle" });
            }}
            placeholder={contactPlaceholder}
            autoComplete="email"
            inputMode="text"
            spellCheck={false}
            aria-required="true"
            aria-describedby={hintId}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-obsidian/60 px-3 py-2 text-[13px] text-pure-white outline-none transition placeholder:text-muted-zinc/70 focus:border-limelight/60 focus:ring-1 focus:ring-limelight/20"
          />
        </div>

        <div className="min-w-0">
          <label
            htmlFor={handleId}
            className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-zinc"
          >
            Instagram handle{" "}
            <span className="font-normal normal-case tracking-normal text-muted-zinc/70">
              (optional)
            </span>
          </label>
          <input
            id={handleId}
            type="text"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder={handlePlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-obsidian/60 px-3 py-2 text-[13px] text-pure-white outline-none transition placeholder:text-muted-zinc/70 focus:border-limelight/60 focus:ring-1 focus:ring-limelight/20"
          />
        </div>
      </div>

      <p id={hintId} className="text-[11px] leading-relaxed text-muted-zinc">
        We use this only to tell you when it opens.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          className="inline-flex min-h-[36px] items-center rounded-full bg-luxury-gold px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-luxury-gold/85 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? "Sending…" : submitLabel}
        </button>
        <p
          id={statusId}
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live={status.kind === "error" ? "assertive" : "polite"}
          className={`min-h-[1rem] text-[12px] leading-snug ${
            status.kind === "done"
              ? "text-limelight"
              : status.kind === "duplicate"
                ? "text-luxury-gold"
                : status.kind === "error"
                  ? "text-bad"
                  : "text-muted-zinc"
          }`}
        >
          {message}
        </p>
      </div>
    </form>
  );
}
