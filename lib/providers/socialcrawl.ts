/**
 * SocialCrawl adapter — the incumbent.
 *
 * Unchanged behaviour from the original `socialcrawl()` helper: one `x-api-key`
 * call, spend read from the response's own `credits_used` rather than a price
 * table, so vendor cache hits and refunds are accounted honestly. The only
 * difference is the return shape, so the router can treat every vendor alike.
 *
 * Cost: ~$7.60 / 1,000 calls (£15 per 2,500 credits).
 */
import {
  ProviderUnavailable,
  type DataProvider,
  type PullResult,
  type ProviderBalance,
} from "./types";

const BASE = "https://www.socialcrawl.dev/v1";

/** List price, USD per call. £15 / 2,500 credits ≈ $0.0076 per call. */
const USD_PER_CALL = 0.0076;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
};

const key = () => process.env.SOCIALCRAWL_API_KEY;

export async function call(
  path: string,
  params: Record<string, string> = {},
): Promise<PullResult> {
  const apiKey = key();
  if (!apiKey) {
    throw new ProviderUnavailable("socialcrawl", "SOCIALCRAWL_API_KEY missing", true);
  }

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(45_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const units = num(json.credits_used);
  const remaining = typeof json.credits_remaining === "number"
    ? json.credits_remaining
    : null;

  if (!res.ok || json.success === false) {
    const err = obj(json.error);
    const message = String(err.message ?? err.type ?? `HTTP ${res.status}`);
    // 402 / insufficient credits means "this vendor is spent — try another".
    const exhausted =
      res.status === 402 ||
      /insufficient|credit/i.test(message) ||
      (typeof json.credits_remaining === "number" && json.credits_remaining < 1);
    throw new ProviderUnavailable("socialcrawl", message, exhausted);
  }

  return {
    data: obj(json.data ?? json),
    usd: units * USD_PER_CALL,
    units,
    remaining,
  };
}

export const socialcrawl: DataProvider = {
  id: "socialcrawl",
  name: "SocialCrawl",
  cost: { usdPerCall: USD_PER_CALL, label: "$7.60 / 1,000 calls" },
  configured: () => Boolean(key()),

  profileReels: (handle) => call("/instagram/profile/reels", { handle }),

  searchReels: (query, opts) =>
    call("/instagram/search/reels", {
      query,
      /**
       * Free on this vendor, and the reason the subject gate has a second
       * reader at all: without `score` a fresh page leaves ~40% of its rows
       * judged `null`, and those rows are then decided by a word bag.
       */
      ...(opts?.relevance ? { relevance: opts.relevance } : {}),
      ...(opts?.relevanceThreshold !== undefined
        ? { relevance_threshold: String(opts.relevanceThreshold) }
        : {}),
    }),

  post: (url) => call("/instagram/post", { url }),

  profile: (handle) =>
    call("/instagram/profile", { handle: handle.replace(/^@/, "") }),

  async balance(): Promise<ProviderBalance> {
    const apiKey = key();
    if (!apiKey) {
      return { remaining: null, unit: "credits", usdSpent: 0, ok: false, error: "no key" };
    }
    try {
      const res = await fetch(`${BASE}/credits/balance`, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const data = obj(json.data ?? json);
      const remaining = num(
        data.balance ?? data.credits ?? data.remaining ?? json.balance,
      );
      return {
        remaining,
        unit: "credits",
        usdSpent: 0,
        ok: true,
      };
    } catch (err) {
      return {
        remaining: null,
        unit: "credits",
        usdSpent: 0,
        ok: false,
        error: (err as Error).message,
      };
    }
  },
};
