import { createHash, timingSafeEqual } from "node:crypto";

import { connection, NextResponse } from "next/server";

import { runCanary } from "@/lib/canary";

export const maxDuration = 800;

/**
 * GET /api/cron/canary  (header `x-cron-secret`)
 *
 * One profile read per configured Instagram vendor, written to `vendor_canary`.
 * `?vendor=apify` tests a single vendor. The secret is accepted **only** through
 * the header: unlike the trending route, a query-string secret is not honoured,
 * because this endpoint spends real money at every vendor.
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
    const results = await runCanary(vendor ? { vendor } : {});

    if (vendor && !results.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `No configured Instagram vendor matches "${vendor}".`,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: results.every((result) => result.ok),
      results,
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
