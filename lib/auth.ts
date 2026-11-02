// Google sign-in and database-backed sessions.
//
// A signed-in visitor carries a `c101s` cookie holding a random 32-byte id.
// Only a SHA-256 hash of that id is ever stored (as `sessions.id`), so a dump
// of the database cannot be replayed as somebody's session. The cookie itself
// decays after 30 days, along with its row.
import { createHash, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { Google } from "arctic";

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

/** Reads the session cookie off the current request. The cookie names the
 * holder of the mapping; the real answer lives in the `sessions` row. */
export async function currentUser(): Promise<SessionUser | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return sessionUser(raw);
}

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
 * `legacyVisitorId` is whatever the visitor's `c101` cookie said on FIRST
 * sign-in, so their existing JSON plan carries over. It is adopted only if it
 * is UUID-shaped, and only once — a later sign-in with a different visitor
 * cookie must never retarget an account that already has its directory.
 */
export async function signInWithGoogleProfile(
  p: GoogleProfile,
  legacyVisitorId?: string,
): Promise<{ userId: string; sessionId: string }> {
  return withClient(async (q) => {
    const legacy =
      legacyVisitorId && SHAPE.test(legacyVisitorId) ? legacyVisitorId : null;

    const found = await q.query<{
      id: string;
      legacy_account_id: string | null;
    }>("SELECT id, legacy_account_id FROM users WHERE google_sub = $1", [p.sub]);

    let userId: string;
    const existing = found.rows[0];
    if (existing) {
      userId = existing.id;
      if (!existing.legacy_account_id && legacy) {
        await q.query(
          "UPDATE users SET legacy_account_id = $1 WHERE id = $2 AND legacy_account_id IS NULL",
          [legacy, userId],
        );
      }
      // Google is the source of truth for the profile, so refresh it each time.
      await q.query("UPDATE users SET email = $1, name = $2 WHERE id = $3", [
        p.email,
        p.name ?? null,
        userId,
      ]);
    } else {
      userId = randomUUID();
      await q.query(
        `INSERT INTO users (id, google_sub, email, name, legacy_account_id, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [userId, p.sub, p.email, p.name ?? null, legacy],
      );
    }

    const sessionId = newSessionId();
    await q.query(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
      [hashSessionId(sessionId), userId],
    );
    await q.query("DELETE FROM sessions WHERE expires_at < now()");
    return { userId, sessionId };
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
 */
export function decodeIdToken(idToken: string): {
  sub?: string;
  email?: string;
  name?: string;
} {
  const payloadPart = idToken.split(".")[1] ?? "";
  const claims = (() => {
    try {
      return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
        sub?: string;
        email?: string;
        name?: string;
      };
    } catch {
      return {};
    }
  })();
  return claims;
}
