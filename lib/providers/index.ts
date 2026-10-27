/**
 * The router: one call site for the whole pipeline, any vendor underneath.
 *
 * Three jobs:
 *
 *  1. **Pick a vendor.** `DATA_PROVIDER` names one ("hikerapi" | "socialcrawl"),
 *     or "auto" picks the cheapest configured vendor. Cheapest-first is the
 *     default because the four calls the pipeline makes are substitutable: the
 *     plan does not care which vendor returned the reels, only that they are
 *     real.
 *
 *  2. **Fail over.** A vendor that is out of credits (402), rate-limited or
 *     down is skipped for the rest of the run, not retried on every call. This
 *     is the specific failure that took the site down when the free tier ran
 *     out: the old code threw on the first 402 and the whole plan died.
 *
 *  3. **Count money, not play-money.** Credits have no cross-vendor meaning, so
 *     the ledger keeps USD alongside units. One plan's real cost is then a
 *     number the owner can check against a vendor invoice.
 */
import { apify } from "./apify";
import { hikerapi } from "./hikerapi";
import { call as socialcrawlCall, socialcrawl } from "./socialcrawl";
import { youtube } from "./youtube";
import { youtubeweb } from "./youtubeweb";
import {
  ProviderUnavailable,
  type DataProvider,
  type ProviderId,
  type PullResult,
} from "./types";

/**
 * Every vendor the router knows about, cheapest-first *at run time*.
 *
 * The order here is deliberately not the order of use: `availableProviders()`
 * sorts by the rate each vendor will actually charge right now. That matters
 * because headline prices lie — HikerAPI advertises $1/1,000 but bills $20/1,000
 * until a $100 balance has been reached once, so "the cheap vendor" is the
 * expensive one for a new account. Sorting on the effective rate means the
 * choice is made by real money, not by marketing.
 */
const ALL: DataProvider[] = [youtubeweb, apify, hikerapi, socialcrawl, youtube];

/** Vendors that failed this run, with the reason, so we stop retrying them. */
const benched = new Map<ProviderId, string>();

export type { ProviderId, DataProvider, PullResult } from "./types";

export interface CreditLedger {
  spent: number;
  remaining: number | null;
  calls: number;
  budget: number;
  byEndpoint: Record<string, number>;
  /** real money spent since process start, USD */
  usd: number;
  /** which vendor served each logical call, for the audit line */
  servedBy: Record<string, number>;
}

const ledger: CreditLedger = {
  spent: 0,
  remaining: null,
  calls: 0,
  budget: Number(process.env.CREDIT_BUDGET ?? process.env.SOCIALCRAWL_CREDIT_BUDGET ?? 40),
  byEndpoint: {},
  usd: 0,
  servedBy: {},
};

export function creditLedger(): CreditLedger {
  return {
    ...ledger,
    byEndpoint: { ...ledger.byEndpoint },
    servedBy: { ...ledger.servedBy },
  };
}

export function resetCreditLedger(): void {
  ledger.spent = 0;
  ledger.calls = 0;
  ledger.byEndpoint = {};
  ledger.usd = 0;
  ledger.servedBy = {};
  benched.clear();
}

/**
 * The vendors that could serve a call right now, best first.
 *
 * `path` is optional but changes the answer substantially: a free keyword
 * search should try YouTube before a paid Instagram vendor, while an Instagram
 * handle should not. Without the path this falls back to pure cost order, which
 * is correct for the UI's "what can I afford" question.
 */
export function availableProviders(path?: string): DataProvider[] {
  const preferred = (process.env.DATA_PROVIDER ?? "auto").toLowerCase();
  /**
   * Sort by the vendor's own preference for this call, then by effective USD.
   * Ties break on id so the order is stable — a vendor flip-flopping between two
   * runs would make the ledger unreadable.
   */
  const configured = ALL.filter((p) => p.configured()).sort((a, b) => {
    const pa = path ? (a.preference?.(path) ?? 0) : 0;
    const pb = path ? (b.preference?.(path) ?? 0) : 0;
    if (pa !== pb) return pa - pb;
    return a.cost.usdPerCall - b.cost.usdPerCall || a.id.localeCompare(b.id);
  });
  const live = configured.filter((p) => !benched.has(p.id));
  if (preferred !== "auto") {
    const hit = live.find((p) => p.id === preferred);
    // Honour an explicit choice, but only as a preference: if it is benched,
    // falling back beats failing the plan.
    if (hit) return [hit, ...live.filter((p) => p.id !== hit.id)];
  }
  return live;
}

export function providerSummary() {
  return ALL.map((p) => ({
    id: p.id,
    name: p.name,
    configured: p.configured(),
    benched: benched.get(p.id) ?? null,
    cost: p.cost,
  }));
}

/**
 * Can a *paid* vendor actually serve `units` calls right now?
 *
 * `checkBalance()` cannot answer this any more, because it reports the active
 * vendor — and the active vendor is now the free one, whose balance is `null`.
 * Reading that null as "fine" is exactly how a run proceeded into eight paid
 * calls with a balance of zero and died on the first 402.
 *
 * Free vendors are excluded on purpose: a channel pull is only cheap if the
 * vendor is free, and the question here is whether the *Instagram* data the
 * pipeline needs has been paid for.
 */
export async function paidReady(units: number): Promise<boolean> {
  const paid = ALL.filter((p) => p.configured() && p.cost.usdPerCall > 0);
  if (!paid.length) return false;

  const balances = await Promise.all(
    paid.map(async (p) => {
      try {
        return await p.balance();
      } catch {
        return { ok: false, remaining: null } as { ok: boolean; remaining: number | null };
      }
    }),
  );

  /**
   * Any paid vendor with enough left will do. A vendor that will not report a
   * balance is treated as ready: the per-call failover handles it, and blocking
   * a run because a vendor is shy about its balance would be worse.
   */
  return balances.some(
    (b) => (b.remaining === null && b.ok) || (typeof b.remaining === "number" && b.remaining >= units),
  );
}

/**
 * Vendors that cost nothing right now.
 *
 * The distinction the site was missing: "can this be served?" is a different
 * question from "has the owner paid?". The free adapter answers the first one
 * with no wallet involved, and the product's discovery step must keep working
 * when the balance is zero — that is the whole reason it exists.
 */
export function freeProviders(path?: string): DataProvider[] {
  return availableProviders(path).filter((p) => p.cost.usdPerCall === 0);
}

export function freeReady(path?: string): boolean {
  return freeProviders(path).length > 0;
}

/**
 * The honest answer to "can I make this call?" — free and paid, separately.
 *
 * Callers use it to *degrade* rather than refuse: a free-only run skips the
 * paid top-ups (cohort baselines, comment reads) and still returns a plan,
 * instead of throwing "we are at capacity" at someone who could have been served
 * for nothing.
 */
export async function readiness(
  path: string,
  units = 1,
): Promise<{ free: boolean; paid: boolean; any: boolean }> {
  const free = freeReady(path);
  const paid = await paidReady(units);
  return { free, paid, any: free || paid };
}

/**
 * Real-money ceiling for one run.
 *
 * Added because the old guard counted vendor *units*, and units stopped being
 * comparable the moment Apify joined: one SocialCrawl credit is one call, while
 * one Apify call is ~24 billable results. A single unit counter would read a
 * perfectly ordinary Apify profile pull as 24 credits and refuse it under a
 * budget of 40, so the "cheap" vendor would look like the expensive one and get
 * skipped. Dollars are the only unit every vendor shares.
 */
const budgetUsd = (): number => Number(process.env.CREDIT_BUDGET_USD ?? 1);

/**
 * Refuse locally when a call would cross either ceiling.
 *
 * The unit budget is kept for SocialCrawl because existing deployments and the
 * audit line speak in credits, but it is only applied to the vendor it was
 * written for. Money gates every vendor.
 */
function assertBudget(provider: DataProvider, expectedCost: number, path: string): void {
  if (provider.id === "socialcrawl" && ledger.spent + expectedCost > ledger.budget) {
    throw new Error(
      `credit budget reached (${ledger.spent}/${ledger.budget}) before ${path}`,
    );
  }

  const estimate =
    provider.id === "socialcrawl"
      ? expectedCost * provider.cost.usdPerCall
      : provider.cost.usdPerCall;
  const ceiling = budgetUsd();
  if (ledger.usd + estimate > ceiling) {
    throw new Error(
      `spend ceiling reached (${ledger.usd.toFixed(3)} of ${ceiling.toFixed(2)}) before ${path}`,
    );
  }
}

export type LogicalCall =
  | { path: "/instagram/profile/reels"; handle: string }
  | { path: "/account/reels"; handle: string; platform: "instagram" | "youtube" }
  | { path: "/instagram/search/reels"; query: string }
  | { path: "/instagram/post"; url: string }
  | { path: "/instagram/profile"; handle: string }
  | { path: string; [k: string]: string };

/**
 * Which platform a vendor actually reads.
 *
 * A YouTube channel called "@cooking" is a different creator from an Instagram
 * account of the same name. Serving one when the caller asked for the other
 * does not just return thin data — it installs a stranger's view baseline as the
 * control group for the whole room. So the platform is a filter here, not a
 * preference: a caller that names one only ever sees vendors that read it.
 */
function readsPlatform(p: DataProvider, platform: string): boolean {
  const isYoutube = p.id === "youtubeweb" || p.id === "youtube";
  return platform === "youtube" ? isYoutube : !isYoutube;
}

/**
 * Run one logical call against the cheapest healthy vendor, failing over.
 *
 * `expectedCost` is the old credit figure and is kept only so the budget guard
 * behaves as before (it is a local ceiling in vendor units, not a price).
 */
export async function request(
  call: LogicalCall,
  expectedCost = 1,
): Promise<PullResult> {
  const { path, ...params } = call;
  /** `platform` rides in the params bag; read defensively across the union. */
  const platform = String(
    (params as unknown as Record<string, unknown>).platform ?? "",
  );
  let providers = availableProviders(path);
  if (platform) {
    providers = providers.filter((p) => readsPlatform(p, platform));
    // Free vendors are gated by their own switches; if filtering left nothing,
    // say so plainly rather than blaming a credit balance the caller can fix.
    if (!providers.length) {
      throw new Error(
        platform === "youtube" && process.env.YOUTUBE_WEB === "0"
          ? "the free YouTube reader is switched off (YOUTUBE_WEB=0)"
          : `no configured vendor reads ${platform} data`,
      );
    }
  }
  if (!providers.length) {
    const why = [...benched.entries()].map(([id, r]) => `${id}: ${r}`).join("; ");
    throw new Error(
      why
        ? `no data vendor available (${why})`
        : "no data vendor configured — set HIKERAPI_KEY or SOCIALCRAWL_API_KEY",
    );
  }

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      assertBudget(provider, expectedCost, path);
      const result = await dispatch(provider, path, params);
      result.provider = provider.id;

      ledger.spent += result.units;
      ledger.calls += 1;
      ledger.usd += result.usd;
      ledger.byEndpoint[path] = (ledger.byEndpoint[path] ?? 0) + result.units;
      ledger.servedBy[provider.id] = (ledger.servedBy[provider.id] ?? 0) + 1;
      if (typeof result.remaining === "number") ledger.remaining = result.remaining;

      return result;
    } catch (err) {
      const e = err as Error;
      lastError = e;

      if (err instanceof ProviderUnavailable) {
        /**
         * Bench the vendor for the rest of the run only when it is *spent* or
         * rejected — not for a per-call miss.
         *
         * The distinction used to be ignored, and it mattered: YouTube has never
         * heard of an Instagram-only handle, so the first benchmark pull benched
         * it for the entire run even though its quota was untouched. `exhausted`
         * is the vendor saying "I cannot serve anything more today", which is
         * the only condition worth remembering.
         */
        if (err.exhausted) benched.set(provider.id, e.message);
        continue;
      }

      // A malformed payload or a 404 for a private handle is not the vendor's
      // fault. Surfacing it is more useful than a silent, confusing failover.
      throw e;
    }
  }

  throw new Error(
    `every data vendor failed: ${lastError?.message ?? "unknown error"}`,
  );
}

async function dispatch(
  provider: DataProvider,
  path: string,
  params: Record<string, string>,
): Promise<PullResult> {
  switch (path) {
    case "/instagram/profile/reels":
    case "/account/reels":
      return provider.profileReels(params.handle ?? "");
    case "/instagram/search/reels":
      return provider.searchReels(params.query ?? "");
    case "/instagram/post":
      return provider.post(params.url ?? "");
    case "/instagram/profile":
      return provider.profile(params.handle ?? "");
    default:
      /**
       * Endpoints outside the shared surface (transcript, comment pages) only
       * exist on SocialCrawl. They are deliberate, rare and expensive, so they
       * are sent straight there rather than being pretended to be portable.
       */
      if (!socialcrawl.configured()) {
        throw new ProviderUnavailable(
          "socialcrawl",
          `${path} needs SOCIALCRAWL_API_KEY`,
          true,
        );
      }
      return socialcrawlCall(path, params);
  }
}

/** Free on every vendor: total units left across configured vendors. */export async function checkBalance(): Promise<{
  balance: number | null;
  byProvider: { id: ProviderId; name: string; remaining: number | null; ok: boolean; error?: string }[];
}> {
  const configured = ALL.filter((p) => p.configured());
  if (!configured.length) return { balance: null, byProvider: [] };

  const results = await Promise.all(
    configured.map(async (p) => {
      const b = await p.balance();
      return {
        id: p.id,
        name: p.name,
        remaining: b.remaining,
        ok: b.ok,
        error: b.error,
      };
    }),
  );

  /**
   * Report the *active* vendor's balance, not a sum. Adding 400 HikerAPI
   * requests to 40 SocialCrawl credits produces a number in no unit at all, and
   * the caller only ever asks one question: can the next call be paid for?
   */
  const active = availableProviders()[0];
  const mine = results.find((r) => r.id === active?.id);
  return {
    balance: mine?.remaining ?? null,
    byProvider: results,
  };
}
