// Google sign-in and database-backed sessions.
//
// A signed-in visitor carries a `c101s` cookie holding a random 32-byte id.
// Only a SHA-256 hash of that id is ever stored (as `sessions.id`), so a dump
// of the database cannot be replayed as somebody's session. The cookie itself
// decays after 30 days, along with its row.
import { createHash, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { Google } from "arctic";
import { cache } from "react";

import { currentDb, withClient } from "./db";
import type { Queryable } from "./db";
import { COOKIE, SHAPE, secureCookies } from "./session";

export const SESSION_COOKIE = "c101s";
/** The session cookie's lifetime, and the sign-in row's lifetime with it. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Short-lived cookies that hold the OAuth `state` and PKCE verifier. */
export const STATE_COOKIE = "c101g_state";
export const VERIFIER_COOKIE = "c101g_verifier";
/** Ten minutes is plenty for the redirect dance to come back. */
export const AUTH_MAX_AGE = 600;

export interface SessionUser {
  /** The users.id. Never given to the browser — the browser holds the raw id. */
  id: string;
  email: string;
  name: string | null;
  /** The directory id the user's JSON data (plan, ideas, weekly) lives under. */
  legacyAccountId: string | null;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  /**
   * Google's `email_verified` claim. A missing claim is treated as unverified:
   * an address Google has not confirmed must never own an account or inherit a
   * visitor's existing plan.
   */
  emailVerified: boolean;
}

/** The Google OAuth client for this deployment. */
export function googleClient(appUrl: string): Google {
  return new Google(
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
    `${appUrl.replace(/\/+$/, "")}/api/auth/google/callback`,
  );
}

/** The cookie options every auth cookie shares; Secure follows the scheme of the request. */
export async function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: await secureCookies(),
  };
}

/**
 * One new session. 32 random bytes, base64url — 43 characters of unpadded
 * entropy that never touches the database, only its hash does.
 */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the hash is stored, so the raw id is worthless to a database leak. */
function hashSessionId(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url");
}

/**
 * The signed-in user behind a raw session id (read off the cookie), or null
 * when the row is gone or expired. `q` is injectable so tests can run this
 * against PGlite without touching request machinery.
 */
export async function sessionUser(
  sessionId: string,
  q: Queryable = currentDb(),
): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const { rows } = await q.query<{
    id: string;
    email: string | null;
    name: string | null;
    legacy_account_id: string | null;
  }>(
    `SELECT u.id, u.email, u.name, u.legacy_account_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [hashSessionId(sessionId)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email ?? "",
    name: row.name,
    legacyAccountId: row.legacy_account_id,
  };
}

/**
 * Reads the session cookie off the current request. The cookie names the
 * holder of the mapping; the real answer lives in the `sessions` row.
 *
 * Wrapped in React's `cache()` so every caller in one server render — the
 * header chrome, the page — shares a single session-row read. The cache is
 * render-scoped by React and never survives a request. Next renders the
 * production tree twice per HTTP request (HTML and flight payload), so the
 * process still performs two reads per request; deduping across those renders
 * would need a cross-request store, which is deliberately not used.
 * Outside a React server render (node:test, for example) React does not
 * dedupe, so the suites still call the underlying function directly.
 */
export const currentUser = cache(
  async function currentUser(): Promise<SessionUser | null> {
    const raw = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!raw) return null;
    return sessionUser(raw);
  },
);

/**
 * Deletes one session (logout) and, while cleaning up, anything already
 * expired — expired rows are pure litter; the cookie will never show them.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await withClient(async (q) => {
    await q.query("DELETE FROM sessions WHERE id = $1", [hashSessionId(sessionId)]);
    await q.query("DELETE FROM sessions WHERE expires_at < now()");
  });
}

/**
 * Upserts the Google user and mints a fresh session for them.
 *
 * One atomic statement: a first-time insert, and — because `google_sub` is
 * UNIQUE — two concurrent first-time callbacks for the same person land on the
 * ON CONFLICT branch at most once instead of 500ing on the second. The loser
 * keeps the winner's user id (never generates a second row) and picks up the
 * winner's email/name freshness. `legacy_account_id` is deliberately not
 * touched here: it is adopted below, guarded so it is set only when still
 * NULL, and only if the visitor's `c101` cookie was UUID-shaped.
 *
 * `legacyVisitorId` is whatever the visitor's `c101` cookie said at their
 * first-ever sign-in, so their existing JSON plan carries over. A later
 * sign-in with a different visitor cookie must never retarget a directory the
 * account already has.
 */
export async function signInWithGoogleProfile(
  p: GoogleProfile,
  legacyVisitorId?: string,
): Promise<{ userId: string; sessionId: string }> {
  /**
   * Refuse before touching the database. The callback also checks this, but the
   * user row and the session are the irreversible part: an unverified address
   * must never get either.
   */
  if (p.emailVerified !== true) {
    throw new Error("Google account email is not verified");
  }
  return withClient(async (q) => {
    const legacy =
      legacyVisitorId && SHAPE.test(legacyVisitorId) ? legacyVisitorId : null;

    const { rows } = await q.query<{
      id: string;
      legacy_account_id: string | null;
    }>(
      `INSERT INTO users (id, google_sub, email, name, legacy_account_id, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (google_sub) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name
       RETURNING id, legacy_account_id`,
      [randomUUID(), p.sub, p.email, p.name ?? null, legacy],
    );
    const row = rows[0]!;

    // The directory rides the visitor cookie in exactly once: when a racing
    // second callback read it back as still NULL, the WHERE recheck keeps it
    // from overriding whatever the other callback adopted first.
    if (!row.legacy_account_id && legacy) {
      await q.query(
        "UPDATE users SET legacy_account_id = $1 WHERE id = $2 AND legacy_account_id IS NULL",
        [legacy, row.id],
      );
    }

    const sessionId = newSessionId();
    await q.query(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
      [hashSessionId(sessionId), row.id],
    );
    await q.query("DELETE FROM sessions WHERE expires_at < now()");
    return { userId: row.id, sessionId };
  });
}

/**
 * Mints a directory id for a signed-in user who does not have one yet and
 * remembers it on the user row, so later signed-in requests use the same one.
 * The id itself is checked for shape — the caller generates it, but the row is
 * the durable contract.
 */
export async function setSigninAccountDir(
  userId: string,
  accountId: string,
): Promise<void> {
  if (!SHAPE.test(accountId)) {
    throw new Error(`account id is not a UUID: ${accountId}`);
  }
  await currentDb().query(
    "UPDATE users SET legacy_account_id = $1 WHERE id = $2 AND legacy_account_id IS NULL",
    [accountId, userId],
  );
}

/**
 * Constant-time comparison for the OAuth `state` pair. Empty or missing
 * halves never match, so a callback with no cookie or no query cannot pass.
 */
export function verifyState(
  cookieState: string | undefined,
  queryState: string | null | undefined,
): boolean {
  if (!cookieState || !queryState) return false;
  return timingSafeEqual(
    createHash("sha256").update(cookieState).digest(),
    createHash("sha256").update(queryState).digest(),
  );
}

/**
 * The signed-in user's claimed identity, straight out of the ID token payload.
 * The token is verified against Google's key set during the code exchange, so
 * decoding is enough — tampering fails earlier, before this is ever called.
 *
 * `emailVerified` is normalised to a boolean here: Google may omit the claim,
 * and a missing claim must read as "not verified" rather than `undefined`
 * slipping through a truthiness check.
 */
export function decodeIdToken(idToken: string): {
  sub?: string;
  email?: string;
  name?: string;
  emailVerified: boolean;
} {
  const payloadPart = idToken.split(".")[1] ?? "";
  const claims = (() => {
    try {
      return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
        sub?: string;
        email?: string;
        name?: string;
        email_verified?: unknown;
      };
    } catch {
      return {};
    }
  })();
  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    emailVerified: claims.email_verified === true,
  };
}

/**
 * May these decoded claims own an account?
 *
 * A missing `email_verified` is unverified, exactly like `false`: only the
 * literal `true` Google sends for a confirmed address passes.
 */
export function verifiedGoogleClaims(claims: {
  sub?: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}): claims is { sub: string; email: string; name?: string; emailVerified: true } {
  return Boolean(claims.sub && claims.email && claims.emailVerified === true);
}
