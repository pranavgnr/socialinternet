// Credit prices, in whole credits (1 credit ≈ $0.01, from measured vendor
// cost: niche ≈ $0.06, handle ≈ $0.055). Every value can be overridden by env
// so prices can move without touching code; a malformed value falls back to
// the default rather than zeroing out the pool.

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const COSTS = {
  // A fresh niche research pull. Cached reads cost 0 and skip spend entirely.
  niche: intFromEnv("CREDIT_COST_NICHE", 6),
  // A fresh handle (profile + competitors) pull.
  handle: intFromEnv("CREDIT_COST_HANDLE", 6),
  // One chat message.
  chat: intFromEnv("CREDIT_COST_CHAT", 1),
  // The daily free pool, granted lazily to every user and reset each IST
  // midnight — it never accumulates, so it is not stored in the ledger.
  dailyFree: intFromEnv("CREDIT_DAILY_FREE", 15),
};
