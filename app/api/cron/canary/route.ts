import { createHash, timingSafeEqual } from "node:crypto";

import { connection, NextResponse } from "next/server";

import { runCanary } from "@/lib/canary";

export const maxDuration = 800;

/**
 * GET /api/cron/canary  (header `x-cron-secret`)
 *
 * One profile read per usable Instagram vendor, written to `vendor_canary`.
 * Vendors with no key, no balance or a read that would cross `CANARY_MAX_USD`
 * are returned in `skipped` and are not failures. `?vendor=apify` targets a
 * single vendor. The secret is accepted **only** through the header: unlike the
 * trending route, a query-string secret is not honoured, because this endpoint
 * spends real money at every vendor.
 */
function secretOk(given: string, secret: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Set CRON_SECRET to enable the canary job." },
      { status: 503 },
    );
  }

  const given = req.headers.get("x-cron-secret") ?? "";
  if (!secretOk(given, secret)) {
    return NextResponse.json({ ok: false, error: "Bad secret." }, { status: 401 });
  }

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
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  await connection();
  return run(req);
}
