import { take, tooMany } from "../../../lib/limits";
import {
  isWaitlistFeature,
  normalizeContact,
  saveWaitlistSignup,
  type WaitlistFeature,
} from "../../../lib/waitlist";

/** Bodies are small JSON objects; anything larger is not a real signup. */
export const MAX_WAITLIST_BODY_BYTES = 4 * 1024;
export const WAITLIST_LIMIT = 10;
export const WAITLIST_WINDOW_MS = 60 * 60 * 1000;

function fail(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

/**
 * A public form on the same site only. An absent Origin is allowed for
 * server-to-server and curl; a present Origin must name this host.
 */
export function isSameOrigin(origin: string | null, request: Request): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const forwarded = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0]
      ?.trim();
    const host =
      forwarded ||
      request.headers.get("host") ||
      new URL(request.url).host;
    return parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The proxy's view of the caller, never a value supplied in the body. Only the
 * first forwarded hop is used, and it is truncated so a header cannot grow the
 * limiter's keys without bound.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  return (forwarded || real || "unknown").slice(0, 64);
}

type BodyRead =
  | { body: Record<string, unknown> }
  | { response: Response };

async function readBody(request: Request): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WAITLIST_BODY_BYTES) {
    return { response: fail("That request was too large.", 413) };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: fail("That request could not be read.", 400) };
  }

  if (new TextEncoder().encode(raw).length > MAX_WAITLIST_BODY_BYTES) {
    return { response: fail("That request was too large.", 413) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { response: fail("That request could not be read.", 400) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { response: fail("That request could not be read.", 400) };
  }

  return { body: parsed as Record<string, unknown> };
}

/**
 * POST /api/waitlist  { email?, whatsapp?, handle?, feature, source? }
 *
 * Joining a locked feature. A repeat is a success reported as `duplicate`; a
 * database failure is a friendly retry sentence and a log line with no body
 * contents. The limiter is keyed by the proxy's client IP, not anything the
 * caller can choose.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request)) {
    return fail("Requests from other sites are not allowed.", 403);
  }

  const read = await readBody(request);
  if ("response" in read) return read.response;
  const body = read.body;

  const budget = take(
    `waitlist:${clientIp(request.headers)}`,
    WAITLIST_LIMIT,
    WAITLIST_WINDOW_MS,
  );
  if (!budget.allowed) {
    return tooMany(budget.retryAfter, "That is a lot of waitlist requests.");
  }

  for (const field of ["email", "whatsapp", "handle", "source"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return fail("That request could not be read.", 400);
    }
  }

  if (
    typeof body.feature !== "string" ||
    !isWaitlistFeature(body.feature)
  ) {
    return fail("That waitlist is not open.", 400);
  }

  const contact = normalizeContact({
    email: typeof body.email === "string" ? body.email : undefined,
    whatsapp: typeof body.whatsapp === "string" ? body.whatsapp : undefined,
  });
  if ("error" in contact) return fail(contact.error, 400);

  try {
    const result = await saveWaitlistSignup({
      ...contact,
      handle: typeof body.handle === "string" ? body.handle : undefined,
      feature: body.feature as WaitlistFeature,
      source: typeof body.source === "string" ? body.source : undefined,
    });
    return Response.json({ ok: true, duplicate: result.duplicate });
  } catch (err) {
    // Log a status code only: never the body, an email address or a number.
    const code = (err as { code?: unknown })?.code;
    console.error(
      `[waitlist] save failed (${typeof code === "string" ? code : "unknown"})`,
    );
    return fail(
      "We could not save that just now. Please try again in a minute.",
      503,
    );
  }
}
