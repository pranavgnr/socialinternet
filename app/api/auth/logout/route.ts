// POST /api/auth/logout — ends the session.
//
// POST only, because a sign-out must never be triggered by a GET (a crawler,
// a prefetch or a link preview would be able to log people out). The session
// row is deleted — not expired — so the id can never be replayed, and the
// cookie is emptied with a zero max-age so it disappears from the browser.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  authCookieOptions,
  deleteSession,
} from "@/lib/auth";

export async function POST() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    await deleteSession(raw);
  }
  store.set(SESSION_COOKIE, "", await authCookieOptions(0));
  return NextResponse.json({ ok: true });
}
