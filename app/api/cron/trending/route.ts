import { connection, NextResponse } from "next/server";

import {
  cronSecretOk,
  refreshTrending,
  researchStalest,
} from "@/lib/trending";

export const maxDuration = 800;

/**
 * GET /api/cron/trending?secret=…  (or header `x-cron-secret`)
 *
 * The free half runs every time: rebuild `trending_niches` from the pulls
 * already on disk, which costs nothing. `?refresh=1` adds the paid half —
 * re-research the five stalest rooms through `researchNiche`, whose own
 * readiness and balance guards decide whether each call is affordable. It is
 * off by default so a routine cron cannot quietly spend credits, and the batch
 * stops at the first budget error instead of asking an empty account five times.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Set CRON_SECRET to enable the trending job." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const given =
    req.headers.get("x-cron-secret") ?? url.searchParams.get("secret") ?? "";
  if (!cronSecretOk(given, secret)) {
    return NextResponse.json({ ok: false, error: "Bad secret." }, { status: 401 });
  }

  const refresh = url.searchParams.get("refresh") === "1";

  try {
    let table = await refreshTrending();
    const work = refresh ? await researchStalest(5) : null;

    // New pulls change the ranking, so write the table once more when the paid
    // step actually bought something.
    if (work?.refreshed.length) table = await refreshTrending();

    return NextResponse.json({
      ok: true,
      written: table.written,
      researched: work?.refreshed ?? [],
      failed: work?.failed ?? [],
      stopped: work?.stopped ?? null,
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
