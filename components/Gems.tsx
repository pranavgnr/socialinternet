import { gemsLabel } from "@/lib/gems";

/**
 * Credits, everywhere, as gems. The amount is unchanged; only the symbol is.
 * The wrapper carries role="img" and the spoken label, while the emoji and the
 * number stay visible but decorative. A bare span with aria-label would be
 * pruned from the accessibility tree, so the role is what makes it readable.
 */
export default function Gems({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={gemsLabel(value)}
      className={`mono inline-flex items-center gap-1 tabular-nums ${className}`}
    >
      <span aria-hidden="true">💎</span>
      <span aria-hidden="true">{value}</span>
    </span>
  );
}
