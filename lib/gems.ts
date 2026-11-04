/**
 * The screen-reader name for a gem balance. Kept pure so the singular/plural
 * rule is testable without rendering React.
 */
export function gemsLabel(value: number): string {
  return `${value} ${value === 1 ? "gem" : "gems"}`;
}
