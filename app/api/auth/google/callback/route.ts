// GET /api/auth/google/callback — Google sends the visitor back here.
//
// Order matters: the state pair is checked and the dance cookies are deleted
// BEFORE anything touches the database, so a failed or forged callback never
// creates a user row, never mints a session, and never leaves half-negotiated
// OAuth state behind. Only a verified exchange gets to sign someone in.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  authCookieOptions,
  decodeIdToken,
  googleClient,
  signInWithGoogleProfile,
  verifyState,
} from "@/lib/auth";
import { COOKIE } from "@/lib/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appUrl = process.env.APP_URL;

  if (!appUrl || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    // Unconfigured but reachable is a stall, not a sign-in failure.
    return NextResponse.json(
      {
        ok: false,
        error:
          "Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL.",
      },
      { status: 503 },
    );
  }

  const store = await cookies();
  const cookieState = store.get(STATE_COOKIE)?.value;
  const verifier = store.get(VERIFIER_COOKIE)?.value;
  // The dance is over either way: the one-use cookies die with it.
  store.delete(STATE_COOKIE);
  store.delete(VERIFIER_COOKIE);

  const where = `${appUrl.replace(/\/+$/, "")}/`;
  const bounced = `${where}?signin=failed`;
  const code = url.searchParams.get("code");

  // A missing or mismatched state, or no verifier to pair with the code,
  // bounces home untouched — no user row, no session, nothing to replay.
  if (!code || !verifier || !verifyState(cookieState, url.searchParams.get("state"))) {
    return NextResponse.redirect(bounced);
  }

  let claims: ReturnType<typeof decodeIdToken>;
  try {
    const tokens = await googleClient(appUrl).validateAuthorizationCode(code, verifier);
    claims = decodeIdToken(tokens.idToken());
  } catch {
    // A wrong, expired or already-spent code gets exactly one polite bounce.
    return NextResponse.redirect(bounced);
  }
  if (!claims.sub || !claims.email) {
    return NextResponse.redirect(bounced);
  }

  // Whatever visitor identity the browser already had travels into the user
  // row on first sign-in, so their existing JSON plan follows them in.
  const visitorLegacy = store.get(COOKIE)?.value;
  const { sessionId } = await signInWithGoogleProfile(
    { sub: claims.sub, email: claims.email, name: claims.name ?? undefined },
    visitorLegacy,
  );

  const res = NextResponse.redirect(where);
  res.cookies.set(SESSION_COOKIE, sessionId, await authCookieOptions(SESSION_MAX_AGE));
  return res;
}
