import { NextResponse } from "next/server";

import { redactSecrets, runCanary } from "@/lib/canary";
import { runCron } from "@/lib/cron";

export const maxDuration = 800;

/**
 * GET /api/cron/canary  (header `x-cron-secret`)
 *
 * One profile read per usable Instagram vendor, written to `vendor_canary`.
 * Vendors with no key, no balance or a read that would cross `CANARY_MAX_USD`
 * are returned in `skipped` and are not failures. `?vendor=apify` targets a
 * single vendor. The secret is accepted **only** through the header: this
 * endpoint spends real money at every vendor, so a query-string token (which
 * leaks into logs and history) is never honoured.
 */
async function run(req: Request) {
  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor")?.trim() || undefined;

  try {
    const { results, skipped } = await runCanary(vendor ? { vendor } : {});

    if (vendor && !results.length && !skipped.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `No Instagram vendor matches "${vendor}".`,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: results.every((result) => result.ok),
      results,
      skipped,
    });
  } catch (err) {
    console.error(
      "[cron/canary] run failed:",
      redactSecrets((err as Error).message),
    );
    return NextResponse.json(
      { ok: false, error: "Canary run failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return runCron(req, "canary job", () => run(req), { dynamic: true });
}
