/**
 * Credits, everywhere, as gems. The amount is unchanged; only the symbol is.
 * The emoji is marked decorative and the wrapper carries the accessible text,
 * so a screen reader hears "6 gems" rather than the emoji's name.
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
      className={`mono inline-flex items-center gap-1 tabular-nums ${className}`}
      aria-label={`${value} ${value === 1 ? "gem" : "gems"}`}
    >
      <span aria-hidden="true">💎</span>
      <span aria-hidden="true">{value}</span>
    </span>
  );
}
