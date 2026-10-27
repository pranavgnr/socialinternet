import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";

import { accountDir, createStore, type Store } from "./store";

export const COOKIE = "c101";

const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 180,
  secure: process.env.NODE_ENV === "production",
};

export interface Account {
  id: string;
  store: Store;
  /** true when this request is the first time we have seen this visitor */
  fresh: boolean;
}

/** The visitor's own data, or null when they have not analysed anything yet. */
export async function currentAccount(): Promise<Account | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || !SHAPE.test(raw)) return null;
  return { id: raw, store: createStore(accountDir(raw)), fresh: false };
}

/**
 * Read-or-create. Used only by the one route that spends money, so an empty
 * directory is never created for someone who just landed on the page.
 */
export async function ensureAccount(): Promise<Account> {
  const existing = await currentAccount();
  if (existing) return existing;
  const id = randomUUID();
  return { id, store: createStore(accountDir(id)), fresh: true };
}

/**
 * Whether the cookie may be marked Secure.
 *
 * A Secure cookie is silently dropped by every browser when the page is served
 * over plain http, and the visitor is then sent back to the form on every single
 * navigation — the plan is saved but unreachable. Reaching this Mac from a phone
 * over Tailscale or the LAN is exactly that case, so the decision follows the
 * scheme the browser actually used rather than the build type.
 */
async function secureCookies(): Promise<boolean> {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit === "0") return false;
  if (explicit === "1") return true;

  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";

  // Browsers send Origin on the POST that creates the account, so it is the
  // most reliable signal available here. GETs never reach this function.
  const origin = h.get("origin");
  if (origin) return origin.startsWith("https://");

  return process.env.NODE_ENV === "production";
}

export async function attachCookie(
  res: Response,
  account: Account,
): Promise<Response> {
  if (!account.fresh) return res;
  const headers = new Headers(res.headers);
  headers.append(
    "set-cookie",
    [
      `${COOKIE}=${account.id}`,
      "Path=/",
      `Max-Age=${COOKIE_OPTIONS.maxAge}`,
      "HttpOnly",
      "SameSite=Lax",
      (await secureCookies()) ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
