import { NextResponse } from "next/server";

import { statusBody } from "@/lib/status";

/**
 * GET /api/status → what the running server actually has configured.
 *
 * env files are read when the process starts, not per request, so a key added to
 * .env.local while the server is up has no effect until it is restarted. This
 * makes that visible in one call instead of inferring it from idea quality.
 * Never returns the key itself.
 *
 * Anonymous page loads get only `{ ok, instagramReady }`, served from a balance
 * cached for ten minutes. The detailed provider list is operator detail and
 * requires the `x-cron-secret` header to match `CRON_SECRET`.
 */
export async function GET(req: Request) {
  return NextResponse.json(await statusBody(req.headers.get("x-cron-secret")));
}
