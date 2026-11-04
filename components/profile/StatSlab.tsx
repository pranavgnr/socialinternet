import type { ReactNode } from "react";

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
    </svg>
  );
}

/**
 * One vitals slab. The number is the loudest thing in the card and always uses
 * the mono face; a locked slab is gold and never pretends to carry a figure.
 */
export default function StatSlab({
  label,
  tag,
  value,
  detail,
  locked = false,
  className = "",
}: {
  label: string;
  /** a small qualifier beside the label, e.g. "Estimate" */
  tag?: string;
  value: ReactNode;
  detail?: ReactNode;
  locked?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`card flex h-full flex-col p-4 ${
        locked ? "border-luxury-gold/25 bg-luxury-gold/[0.04]" : ""
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <p className="mono text-[11px] font-bold uppercase leading-tight tracking-[0.14em] text-muted-zinc">
            {label}
          </p>
          {tag ? (
            <span className="mono text-[11px] font-bold uppercase leading-tight tracking-[0.12em] text-muted-zinc/70">
              {tag}
            </span>
          ) : null}
        </div>
        {locked ? (
          <span className="shrink-0 text-luxury-gold" aria-hidden="true">
            <GoldLock />
          </span>
        ) : null}
      </div>
      <p
        className={`mono mt-3 text-[26px] font-bold leading-none tracking-tight ${
          locked ? "text-luxury-gold" : "text-limelight"
        }`}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-zinc">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
