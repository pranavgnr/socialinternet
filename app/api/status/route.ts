import { NextResponse } from "next/server";

import { llmLabel, llmReady } from "@/lib/llm";
import { paidReady, providerSummary } from "@/lib/providers";

/**
 * GET /api/status → what the running server actually has configured.
 *
 * env files are read when the process starts, not per request, so a key added to
 * .env.local while the server is up has no effect until it is restarted. This
 * makes that visible in one call instead of inferring it from idea quality.
 * Never returns the key itself.
 */

/**
 * `paidReady()` asks the vendors for a balance, which costs a round trip each.
 * This route is hit on page loads, so the answer is held briefly rather than
 * asked again every time. Long enough to stop the hammering, short enough that a
 * top-up shows up while the owner is still looking at the page.
 */
const BALANCE_TTL_MS = 30_000;
let cached: { at: number; ready: boolean } | null = null;

async function instagramReadyNow(): Promise<boolean> {
  if (cached && Date.now() - cached.at < BALANCE_TTL_MS) return cached.ready;
  const ready = await paidReady(1);
  cached = { at: Date.now(), ready };
  return ready;
}

export async function GET() {
  const providers = providerSummary();

  /**
   * The one question that decides what the whole site can do: can any vendor
   * read an *Instagram* account *right now*?
   *
   * "Has a key" is not the same question, and answering that one instead is how
   * this route reported `instagramReady: true` while the only paid vendor had a
   * balance of zero. The site then looked broken at the moment a handle came
   * back unread, and the real cause — an empty wallet the owner could top up —
   * was nowhere on the page. The balance is part of the answer, so it is asked
   * for rather than assumed.
   */
  const instagramReady = await instagramReadyNow();

  return NextResponse.json({
    ok: true,
    llm: { ready: llmReady(), model: llmLabel() },
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
  });
}
