"use client";

import { useEffect, useState } from "react";

import { TICKER_LINES, nextIndex, tickerState } from "@/lib/tickerLines";

const FLIP_MS = 3500;

/**
 * The rotating creator question above the headline.
 *
 * Three rules keep it from becoming noise:
 * - it flips every 3.5 s only while the tab is visible;
 * - a visitor who asked for reduced motion gets the first line, static;
 * - while it rotates, the visible line is hidden from screen readers and the
 *   complete list is exposed once as visually hidden text, so assistive tech is
 *   not interrupted every three and a half seconds.
 */
export default function HeroTicker() {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(motion.matches);
    syncMotion();
    motion.addEventListener("change", syncMotion);

    const syncVisibility = () => setHidden(document.visibilityState === "hidden");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);

    return () => {
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  const { rotate } = tickerState({ reducedMotion, hidden });

  useEffect(() => {
    if (!rotate) return;
    const timer = window.setInterval(() => {
      setIndex((current) => nextIndex(current, TICKER_LINES.length));
    }, FLIP_MS);
    return () => window.clearInterval(timer);
  }, [rotate]);

  const line = rotate ? TICKER_LINES[index] : TICKER_LINES[0];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-limelight shadow-[0_0_10px_rgba(204,255,0,0.85)]"
          aria-hidden="true"
        />
        <p className="mono text-[10px] font-bold uppercase tracking-[0.2em] text-limelight">
          The creator question
        </p>
      </div>

      <div className="mt-3 min-h-[4.5rem] sm:min-h-[5.5rem]">
        {rotate ? (
          <>
            <p
              key={index}
              data-ticker-line="true"
              aria-hidden="true"
              className="ticker-line max-w-3xl text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-pure-white sm:text-[32px]"
            >
              {line}
            </p>
            <ul className="sr-only">
              {TICKER_LINES.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </>
        ) : (
          <p
            data-ticker-line="true"
            className="max-w-3xl text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-pure-white sm:text-[32px]"
          >
            {line}
          </p>
        )}
      </div>
    </div>
  );
}
