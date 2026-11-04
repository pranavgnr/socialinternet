import { NextResponse, type NextRequest } from "next/server";

import { legacyTarget } from "@/lib/legacyRoutes";

/**
 * The retired pages answer with a permanent (308) redirect.
 *
 * This is a proxy rather than `redirects()` in `next.config.ts` because the
 * destination depends on `?q=`, and Next decodes query values before matching.
 * A config destination interpolates that decoded string verbatim, so a phrase
 * with spaces, Devanagari or `../` would produce an invalid or unsafe Location
 * header. `legacyTarget` re-encodes it once and bounds its length.
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const target = legacyTarget(pathname, searchParams.get("q"));
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, request.url), 308);
}

export const config = {
  matcher: ["/start", "/discover", "/room"],
};
