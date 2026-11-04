/**
 * The memory the studio actually has.
 *
 * A chip is only rendered when its value came from stored data: the viewer's
 * own plan or a stored profile view. A missing handle, niche or competitor
 * count renders nothing rather than an invented placeholder.
 */
export default function MemoryChips({
  handle,
  niche,
  competitors,
}: {
  handle?: string | null;
  niche?: string | null;
  competitors?: number | null;
}) {
  const chips: { key: string; label: string; icon: string }[] = [];

  if (handle) {
    chips.push({ key: "handle", icon: "👤", label: `@${handle}` });
  }
  if (niche) {
    chips.push({ key: "niche", icon: "🎵", label: `Niche: ${niche}` });
  }
  if (typeof competitors === "number" && competitors > 0) {
    chips.push({
      key: "competitors",
      icon: "🏆",
      label: `${competitors} ${competitors === 1 ? "Competitor" : "Competitors"}`,
    });
  }

  return (
    <section aria-label="Active memory loaded" className="mt-4">
      <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-zinc">
        Active memory loaded
      </p>
      {chips.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/10 bg-card px-3 text-[11px] text-pure-white"
            >
              <span aria-hidden="true">{chip.icon}</span>
              <span className="min-w-0 break-words">{chip.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-zinc">
          Nothing loaded yet. Open your profile or a niche search, then come
          back.
        </p>
      )}
    </section>
  );
}
