import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { COOKIE, COOKIE_OPTIONS } from "@/lib/session";
import { accountDir } from "@/lib/store";

/**
 * The demo is a finished, real account kept outside data/accounts: a plan, a
 * decoded space, and a full week of ideas. It exists so the product can be
 * judged without spending a single credit — a live analysis costs credits the
 * moment a handle is submitted.
 */
const SOURCE = path.join(process.cwd(), "data", "demo");

/**
 * A visitor arriving here gets their own copy of the demo account rather than
 * the demo account itself. The copy is what the cookie points at, so exploring
 * — including submitting another handle, which overwrites that account's plan
 * — can never damage the master. The master is the only thing that has to
 * survive.
 *
 * GET carries no Origin header, so the scheme is read from the proxy header and
 * then the request URL. When neither says https the cookie is left non-Secure:
 * a non-Secure cookie still works over https, while a Secure one is silently
 * dropped over plain http and the demo would look broken on a phone.
 */
function secureFor(request: Request): boolean {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit === "0") return false;
  if (explicit === "1") return true;

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";

  return new URL(request.url).protocol === "https:";
}

/**
 * Redirect back to the host the browser actually used. request.url can carry
 * the bind address (0.0.0.0 or localhost) instead of the name in the address
 * bar, and following that would strand a phone on a host it cannot reach.
 */
function backTo(request: Request, target: string): URL {
  const host = request.headers.get("host");
  if (!host) return new URL(target, request.url);

  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    (new URL(request.url).protocol === "https:" ? "https" : "http");

  return new URL(target, `${proto}://${host}`);
}

export async function GET(request: Request) {
  const id = randomUUID();

  try {
    await fs.cp(SOURCE, accountDir(id), { recursive: true });
  } catch {
    // No demo data on disk: send them to the form rather than a dead link.
    return NextResponse.redirect(backTo(request, "/"));
  }

  const res = NextResponse.redirect(backTo(request, "/"));
  res.cookies.set(COOKIE, id, {
    httpOnly: COOKIE_OPTIONS.httpOnly,
    sameSite: COOKIE_OPTIONS.sameSite,
    path: COOKIE_OPTIONS.path,
    maxAge: COOKIE_OPTIONS.maxAge,
    secure: secureFor(request),
  });
  return res;
}
