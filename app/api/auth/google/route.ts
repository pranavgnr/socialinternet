// GET /api/auth/google — begins Google sign-in.
//
// Hands the browser the Google consent URL with a random `state` (which
// Google echoes back, so we know the callback is ours) and a PKCE code
// verifier (which never leaves the server, so a stolen redirect cannot be
// replayed). Both ride in ten-minute httpOnly cookies that the callback eats.
import { generateCodeVerifier, generateState } from "arctic";
import { NextResponse } from "next/server";

import {
  AUTH_MAX_AGE,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  authCookieOptions,
  googleClient,
} from "@/lib/auth";

// The scopes that yield an ID token with an email, so one pull from Google is
// all sign-in ever costs. `openid` is what makes the response an ID token.
const SCOPES = ["openid", "email", "profile"];

export async function GET() {
  const appUrl = process.env.APP_URL;
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !appUrl
  ) {
    // A clear answer beats a 500 with a stack trace for a missing env var.
    return NextResponse.json(
      {
        ok: false,
        error:
          "Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL.",
      },
      { status: 503 },
    );
  }

  const state = generateState();
  const verifier = generateCodeVerifier();
  const consent = googleClient(appUrl).createAuthorizationURL(
    state,
    verifier,
    SCOPES,
  );

  const res = NextResponse.redirect(consent.toString());
  const opts = await authCookieOptions(AUTH_MAX_AGE);
  res.cookies.set(STATE_COOKIE, state, opts);
  res.cookies.set(VERIFIER_COOKIE, verifier, opts);
  return res;
}
