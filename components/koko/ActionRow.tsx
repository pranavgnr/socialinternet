"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import WaitlistForm from "../WaitlistForm";
import { normalizeHandle } from "@/lib/handle";
import type { KokoAction, KokoActionId } from "@/lib/kokoActions";

function GoldLock() {
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
      <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The four one-tap actions.
 *
 * Three cost one gem and send an action to the server, which builds the prompt
 * from stored data. Deep-Spy is a free link: the competitor profile itself is
 * where the paid read lives. The rate card is visibly locked and only opens the
 * inline waitlist — it can never spend.
 */
export default function ActionRow({
  actions,
  busy,
  onAction,
  deepSpyHandle,
}: {
  actions: readonly KokoAction[];
  busy: boolean;
  onAction: (id: KokoActionId) => void;
  /** A competitor already loaded from the plan; makes Deep-Spy one tap. */
  deepSpyHandle?: string | null;
}) {
  const router = useRouter();
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [spyOpen, setSpyOpen] = useState(false);
  const [spyHandle, setSpyHandle] = useState("");
  const [spyError, setSpyError] = useState<string | null>(null);
  const formId = useId();

  const openProfile = (raw: string) => {
    const handle = normalizeHandle(raw);
    if (!handle) {
      setSpyError("Enter a valid Instagram handle.");
      return;
    }
    setSpyError(null);
    router.push(`/profile/${encodeURIComponent(handle)}`);
  };

  return (
    <section aria-label="One-tap actions" className="mt-4">
      <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-zinc">
        One-tap actions · 1 💎 each
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) => {
          if (action.id === "rate-card") {
            return (
              <button
                key={action.id}
                type="button"
                aria-expanded={waitlistOpen}
                aria-controls={formId}
                onClick={() => setWaitlistOpen((open) => !open)}
                className="inline-flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg border border-luxury-gold/35 bg-luxury-gold/10 px-3 text-left text-[11px] font-semibold text-luxury-gold transition hover:border-luxury-gold/60 hover:bg-luxury-gold/15"
              >
                <GoldLock />
                <span className="min-w-0 break-words">{action.label}</span>
              </button>
            );
          }

          if (action.id === "deep-spy") {
            const known = deepSpyHandle ? normalizeHandle(deepSpyHandle) : null;
            return known ? (
              <Link
                key={action.id}
                href={`/profile/${encodeURIComponent(known)}`}
                aria-label={`Deep-spy on @${known}; opens their profile for free`}
                className="inline-flex min-h-[44px] min-w-0 items-center gap-1.5 rounded-lg border border-white/10 bg-card px-3 text-[11px] font-semibold text-pure-white transition hover:border-limelight/50"
              >
                <span className="min-w-0 break-words">
                  Deep-Spy on @{known}
                </span>
                <span aria-hidden="true" className="text-limelight">
                  →
                </span>
              </Link>
            ) : (
              <button
                key={action.id}
                type="button"
                aria-expanded={spyOpen}
                onClick={() => setSpyOpen((open) => !open)}
                disabled={busy}
                className="inline-flex min-h-[44px] min-w-0 items-center rounded-lg border border-white/10 bg-card px-3 text-[11px] font-semibold text-pure-white transition hover:border-limelight/50 disabled:opacity-60"
              >
                {action.label}
              </button>
            );
          }

          return (
            <button
              key={action.id}
              type="button"
              disabled={busy}
              onClick={() => onAction(action.id)}
              className="inline-flex min-h-[44px] min-w-0 items-center rounded-lg border border-white/10 bg-card px-3 text-left text-[11px] font-semibold text-pure-white transition hover:border-limelight/50 hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="min-w-0 break-words">{action.label}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-zinc">
        Opening a competitor profile is free. A fresh read there costs 6 💎 and
        is shown before it is charged.
      </p>

      {spyOpen ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            openProfile(spyHandle);
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-zinc">
              Competitor handle
            </span>
            <input
              value={spyHandle}
              onChange={(event) => {
                setSpyHandle(event.target.value);
                if (spyError) setSpyError(null);
              }}
              placeholder="@competitor"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-obsidian/60 px-3 py-2.5 text-[16px] text-pure-white outline-none placeholder:text-muted-zinc/70 focus:border-limelight/60"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center rounded-lg bg-limelight px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian transition hover:bg-limelight/85"
          >
            Open profile
          </button>
        </form>
      ) : null}

      {spyError ? (
        <p role="alert" className="mt-1.5 text-[11.5px] text-bad">
          {spyError}
        </p>
      ) : null}

      {waitlistOpen ? (
        <div id={formId} className="card mt-3 p-4">
          <p className="text-[15px] leading-relaxed text-muted-zinc">
            The rate card is still locked. Join the waitlist and we will tell you
            when it opens.
          </p>
          <WaitlistForm
            feature="rate-card"
            source="koko-studio"
            className="mt-3"
          />
        </div>
      ) : null}
    </section>
  );
}
