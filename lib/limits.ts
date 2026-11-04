/**
 * Keeps one visitor from spending the whole data budget. Held in memory: on a
 * single machine that is the right size of solution, and a restart is a
 * deliberate act rather than something a stranger can trigger.
 */
const windows = new Map<string, { used: number; resetAt: number }>();

export interface Verdict {
  allowed: boolean;
  /** how long until they can try again, in seconds */
  retryAfter: number;
}

export function take(key: string, limit: number, windowMs: number): Verdict {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now >= entry.resetAt) {
    windows.set(key, { used: 1, resetAt: now + windowMs });
    if (windows.size > 5_000) sweep(now);
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.used >= limit) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.used += 1;
  return { allowed: true, retryAfter: 0 };
}

/**
 * Hand a slot back. A search served from disk costs nothing, so charging it
 * against the daily cap would block someone who is only re-reading a niche they
 * already paid for — the cap is a spend guard, not a usage guard.
 */
export function refund(key: string): void {
  const entry = windows.get(key);
  if (entry && entry.used > 0) entry.used -= 1;
}

/**
 * Hand a slot back only when the run measured no vendor spend.
 *
 * A route's own unit counter is not the spend decision: a niche pull can report
 * zero research credits while still buying owner profiles, and a plan's counter
 * misses its own handle pull and the deep pass. `usdSpent` is the
 * `lifetimeUsd` delta the gem settle uses, so the limiter and the gem can never
 * disagree about whether a read was free.
 */
export function refundSlotIfFree(key: string, usdSpent: number): boolean {
  if (usdSpent !== 0) return false;
  refund(key);
  return true;
}

/** Test hook: clear every window so a suite starts from a known state. */
export function resetLimitsForTests(): void {
  windows.clear();
}

function sweep(now: number) {
  for (const [key, entry] of windows) {
    if (now >= entry.resetAt) windows.delete(key);
  }
}

export function tooMany(retryAfter: number, message: string): Response {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return Response.json(
    {
      ok: false,
      error: `${message} Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
