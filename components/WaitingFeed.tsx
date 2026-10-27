"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The plan is written before the idea feed, so someone can reach this page in
 * the gap. Refreshing quietly is honest: the work is genuinely in progress
 * server-side, and the page fills in without them doing anything.
 *
 * It stops after ~45 seconds rather than spinning forever, so a build that
 * actually failed ends in a sentence instead of a permanent "one moment".
 */
export default function WaitingFeed() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (seconds >= 45) return;
    if (seconds % 4 !== 0 || seconds === 0) return;
    router.refresh();
  }, [seconds, router]);

  const givenUp = seconds >= 45;

  return (
    <div className="card px-4 py-10 text-center">
      <p className="text-[14px] font-medium">
        {givenUp ? "Still writing them." : "Writing your posts…"}
      </p>
      <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted">
        {givenUp
          ? "This is taking longer than usual. Reload in a minute — your plan is already saved, so nothing is lost."
          : "Your plan is ready. These are built from the posts it already read, so keep this page open for a moment."}
      </p>
      {givenUp ? (
        <button
          onClick={() => router.refresh()}
          className="mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-black"
        >
          Check again
        </button>
      ) : null}
    </div>
  );
}
