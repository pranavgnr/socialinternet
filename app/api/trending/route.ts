import { connection, NextResponse } from "next/server";

import { listTrending } from "@/lib/trending";

/**
 * GET /api/trending — the ranked rooms behind the landing-page bubbles.
 *
 * Public and read-only: anyone may see where people are finding room to break
 * out, signed in or not. Everything it serves is already in the database or on
 * disk, so this route never calls a vendor and never spends a credit.
 */
export async function GET() {
  // Bubbles change when the cron refreshes the table, so this is request-time,
  // never a build-time snapshot of whatever was on disk during `next build`.
  await connection();

  try {
    return NextResponse.json({ ok: true, niches: await listTrending() });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        niches: [],
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
