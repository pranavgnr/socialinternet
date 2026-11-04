/**
 * The body of GET /api/status.
 *
 * `paidReady()` asks every funded vendor for a balance, which is a real round
 * trip per vendor. The page is loaded by anonymous visitors, so the answer is
 * cached per process and anonymous callers only learn the coarse "can this site
 * read Instagram right now" bit. The detailed list — ids, prices, bench
 * reasons, what to set — is operator detail and is returned only to a caller
 * holding `CRON_SECRET`.
 */
import { cronSecretOk } from "./cron";
import { llmLabel, llmReady } from "./llm";
import { paidReady, providerSummary } from "./providers";

/**
 * Ten minutes. Long enough that ordinary page traffic never reaches a vendor,
 * short enough that an owner who tops up sees it while the page is open.
 */
export const STATUS_TTL_MS = 10 * 60 * 1000;

let cached: { at: number; ready: boolean } | null = null;

/** Test hook: forget the cached balance between cases. */
export function resetStatusCache(): void {
  cached = null;
}

export interface StatusDeps {
  now?: () => number;
  paidReady?: (units: number) => Promise<boolean>;
  providerSummary?: () => ReturnType<typeof providerSummary>;
  llmReady?: () => boolean;
  llmLabel?: () => string;
  /** Defaults to `process.env.CRON_SECRET`; an explicit value wins in tests. */
  secret?: string;
}

/** The coarse answer an anonymous visitor is allowed to see. */
export interface PublicStatus {
  ok: true;
  instagramReady: boolean;
}

export interface DetailedStatus extends PublicStatus {
  llm: { ready: boolean; model: string };
  providers: {
    id: string;
    name: string;
    configured: boolean;
    benched: string | null;
    price: string;
    usdPerCall: number;
  }[];
  discoveryReady: boolean;
  enable: string[];
}

/**
 * Build the body for one request. `givenSecret` is the `x-cron-secret` header
 * exactly as received (null when absent); it is never read from the query.
 */
export async function statusBody(
  givenSecret: string | null,
  deps: StatusDeps = {},
): Promise<PublicStatus | DetailedStatus> {
  const now = deps.now?.() ?? Date.now();
  const paid = deps.paidReady ?? paidReady;
  if (!cached || now - cached.at >= STATUS_TTL_MS) {
    cached = { at: now, ready: await paid(1) };
  }
  const instagramReady = cached.ready;

  const secret = deps.secret ?? process.env.CRON_SECRET;
  if (!secret || !cronSecretOk(givenSecret ?? "", secret)) {
    return { ok: true, instagramReady };
  }

  const providers = (deps.providerSummary ?? providerSummary)();
  return {
    ok: true,
    llm: {
      ready: (deps.llmReady ?? llmReady)(),
      model: (deps.llmLabel ?? llmLabel)(),
    },
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      configured: p.configured,
      benched: p.benched,
      /** what one call costs, in the vendor's own words */
      price: p.cost.label,
      usdPerCall: p.cost.usdPerCall,
    })),
    /**
     * Instagram reads need a funded key; discovery does not. Both are reported
     * so the page can explain a handle that came back as "we could not read you"
     * without blaming the user's handle.
     */
    instagramReady,
    discoveryReady: providers.some(
      (p) => p.configured && !p.benched && p.cost.usdPerCall === 0,
    ),
    /**
     * What to set to turn the paid path on, cheapest first.
     *
     * Apify leads because $5 is free every month, so the first Instagram read
     * costs nothing at all; ScrapeCreators is next at a quarter of SocialCrawl's
     * rate. All three are wired and ranked by the provider router — the only
     * thing missing is the key.
     */
    enable: instagramReady
      ? []
      : [
          "APIFY_TOKEN — apify.com, $0.50 / 1,000 results with $5 free every month",
          "SCRAPECREATORS_API_KEY — scrapecreators.com, $1.88 / 1,000 requests",
          "HIKERAPI_KEY — hikerapi.com, billed per call",
          "SOCIALCRAWL_API_KEY — socialcrawl.dev, $7.60 / 1,000 calls",
        ],
  };
}
