/**
 * The one gate every secret-triggered job goes through.
 *
 * The rule is the same at each route: an unset `CRON_SECRET` refuses with 503
 * (a misconfigured deployment must not become an open endpoint), a wrong secret
 * refuses with 401, and the secret is accepted **only** through the
 * `x-cron-secret` header. A query-string token is not honoured — it leaks into
 * access logs, shell history and Referer headers.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { connection, NextResponse } from "next/server";

/**
 * Compare the cron secret without leaking its length or a matching prefix.
 *
 * Hashing both sides first keeps `timingSafeEqual` on equal-length buffers, so
 * the comparison costs the same whether the guess is one byte or a thousand.
 */
export function cronSecretOk(given: string, secret: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * The refusal for a cron request, or null when the caller may run the job.
 *
 * `job` names the deployment job in the 503, so an operator who forgot the
 * variable learns which route they are looking at.
 */
export function cronDenied(req: Request, job: string): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: `Set CRON_SECRET to enable the ${job}.` },
      { status: 503 },
    );
  }

  const given = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecretOk(given, secret)) {
    return NextResponse.json({ ok: false, error: "Bad secret." }, { status: 401 });
  }
  return null;
}

/**
 * Authenticate, then optionally opt into dynamic rendering, then run.
 *
 * `connection()` must come **after** the secret check: it is what tells Next a
 * route is request-bound, and calling it first would make an unauthenticated
 * request pay for rendering work before it is refused. It is skipped entirely
 * in tests (`dynamic: false`), where there is no request store to attach to.
 */
export async function runCron(
  req: Request,
  job: string,
  work: () => Promise<Response>,
  opts: { dynamic?: boolean } = {},
): Promise<Response> {
  const denied = cronDenied(req, job);
  if (denied) return denied;
  if (opts.dynamic) await connection();
  return work();
}
