import { NextResponse } from "next/server";

import { llmLabel, llmReady } from "@/lib/llm";

/**
 * GET /api/status → what the running server actually has configured.
 *
 * env files are read when the process starts, not per request, so a key added to
 * .env.local while the server is up has no effect until it is restarted. This
 * makes that visible in one call instead of inferring it from idea quality.
 * Never returns the key itself.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    llm: { ready: llmReady(), model: llmLabel() },
  });
}
