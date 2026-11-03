import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { accountDir, createStore, type Store } from "./store";

export const COOKIE = "c101";

/** The only visitor ids we will adopt as account directories: bare UUIDs. */
export const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

/** The account directory a signed-in user already owns, or null before one is
 * minted. Pure and synchronous: the shell and the viewer share one shape. */
export function accountForUser(user: {
  legacyAccountId: string | null;
}): Account | null {
  if (!user.legacyAccountId) return null;
  return {
    id: user.legacyAccountId,
    store: createStore(accountDir(user.legacyAccountId)),
    fresh: false,
  };
}

/** The signed-out visitor's account, carried by the `c101` cookie. */
export async function accountForCookie(): Promise<Account | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || !SHAPE.test(raw)) return null;
  return { id: raw, store: createStore(accountDir(raw)), fresh: false };
}

/** The visitor's own data, or null when they have not analysed anything yet.
 *
 * Signed in, the account is the directory id that was stamped on the user's
 * row at first sign-in (or minted on their first paid action). Signed out, it
 * is still the `c101` cookie id — every existing route keeps working.
 *
 * Render-scoped through React's `cache()`: a page and the shell in the same
 * render share one account lookup, and the memo dies with the render. Next's
 * second production render (flight payload) makes its own, by design.
 */
export const currentAccount = cache(
  async function currentAccount(): Promise<Account | null> {
    // A lazy import: auth.ts imports this module's cookie pieces, so a cycle in
    // the other direction must never resolve at load time.
    const { currentUser } = await import("./auth");
    const user = await currentUser();
    if (user) return accountForUser(user);
    return accountForCookie();
  },
);

/**
 * Read-or-create. Used only by the routes that spend money, so an empty
 * directory is never created for someone who just landed on the page.
 *
 * Signed in with no directory yet, one is minted AND written onto the user
 * row, so every later signed-in request resolves to the same directory.
 */
export async function ensureAccount(): Promise<Account> {
  const { currentUser, setSigninAccountDir } = await import("./auth");
  const user = await currentUser();
  if (user) {
    if (user.legacyAccountId) {
      return {
        id: user.legacyAccountId,
        store: createStore(accountDir(user.legacyAccountId)),
        fresh: false,
      };
    }
    const id = randomUUID();
    await setSigninAccountDir(user.id, id);
    return { id, store: createStore(accountDir(id)), fresh: true };
  }
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw && SHAPE.test(raw)) return { id: raw, store: createStore(accountDir(raw)), fresh: false };
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
export async function secureCookies(): Promise<boolean> {
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
