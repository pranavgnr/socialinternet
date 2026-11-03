"use client";

import { useId, useState } from "react";

import type { WaitlistFeature } from "@/lib/waitlist";
import WaitlistForm from "./WaitlistForm";

function GoldLock() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * A locked feature card. The feature is visible and one sentence explains it;
 * the only action is the inline waitlist, so nothing can be mistaken for a
 * shipped feature. A gold lock marks the surface as premium rather than broken.
 */
export default function LockedCard({
  feature,
  title,
  blurb,
  source = "vault",
  className = "",
  selected,
  ctaLabel,
  onSelect,
}: {
  feature: WaitlistFeature;
  title: string;
  blurb: string;
  source?: string;
  className?: string;
  /**
   * When `onSelect` is supplied the card no longer owns a form: it picks the
   * feature for one shared form elsewhere on the page. `selected` then marks
   * the card the form is currently requesting.
   */
  selected?: boolean;
  ctaLabel?: string;
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <article
      className={`card flex h-full flex-col p-5 transition ${
        selected ? "ring-1 ring-luxury-gold/60" : ""
      } ${className}`}
      data-feature={feature}
      data-selected={selected ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-luxury-gold">
            {selected ? "Selected" : "Locked"}
          </p>
          <h3 className="mt-2 text-[17px] font-semibold leading-tight text-pure-white">
            {title}
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-zinc">
            {blurb}
          </p>
        </div>
        <span className="shrink-0 rounded-xl border border-luxury-gold/25 bg-luxury-gold/10 p-2.5 text-luxury-gold">
          <span className="sr-only">Locked feature</span>
          <GoldLock />
        </span>
      </div>

      <div className="mt-auto pt-5">
        <button
          type="button"
          aria-expanded={onSelect ? undefined : open}
          aria-controls={onSelect ? undefined : formId}
          aria-pressed={onSelect ? Boolean(selected) : undefined}
          onClick={onSelect ?? (() => setOpen((value) => !value))}
          className={`inline-flex min-h-[34px] items-center gap-2 rounded-full border px-3.5 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
            selected
              ? "border-luxury-gold/70 bg-luxury-gold text-obsidian"
              : "border-luxury-gold/35 bg-luxury-gold/10 text-luxury-gold hover:border-luxury-gold/60 hover:bg-luxury-gold/15"
          }`}
        >
          {onSelect
            ? selected
              ? "Selected"
              : (ctaLabel ?? "Request access")
            : open
              ? "Close"
              : "Join the waitlist"}
        </button>
      </div>

      {!onSelect && open ? (
        <div id={formId} className="mt-4 border-t border-white/10 pt-4">
          <WaitlistForm feature={feature} source={source} />
        </div>
      ) : null}
    </article>
  );
}
