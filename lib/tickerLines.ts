/**
 * The questions the hero ticker flips through.
 *
 * Every line is a first-person creator question in the founder's voice:
 * premium, direct, no slang. The first two are the founder's own; the rest
 * follow the same shape so the rotation never changes register.
 */
export const TICKER_LINES = [
  "Why did my latest Reel get stuck at 1,200 views?",
  "How do I unlock the VIP creator lifestyle?",
  "Why did my hook lose viewers before the third second?",
  "What should I post next to beat my last Reel?",
] as const;

/**
 * The next index in the rotation, wrapping at the end.
 *
 * With no lines there is nothing to advance to, so the answer is always 0 —
 * never NaN, which would make the first render read `undefined`. A negative
 * current index is normalised rather than trusted, so a bad state can recover.
 */
export function nextIndex(current: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  if (!Number.isFinite(current)) return 0;

  const size = Math.floor(length);
  const index = Math.floor(current);
  const normalised = ((index % size) + size) % size;
  return (normalised + 1) % size;
}

export interface TickerStateInput {
  /** the visitor asked the operating system for less motion */
  reducedMotion: boolean;
  /** the document is hidden, so no one is looking at the rotation */
  hidden: boolean;
}

export interface TickerState {
  rotate: boolean;
}

/**
 * Whether the ticker may animate right now. Reduced motion wins over
 * everything: a visitor who asked for stillness sees one static line. A hidden
 * tab is the second pause — flipping in the background only burns work and
 * would make the first visible frame arbitrary.
 */
export function tickerState({
  reducedMotion,
  hidden,
}: TickerStateInput): TickerState {
  return { rotate: !reducedMotion && !hidden };
}
