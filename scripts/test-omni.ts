// OmniSearch routing. One input, two jobs: a profile (@handle or instagram.com
// profile URL) or a niche phrase. The wrong branch spends a credit reading a
// handle that does not exist, so every Review Focus 1 case is pinned here.
//   npm run test:file -- test-omni
import test from "node:test";
import assert from "node:assert/strict";

import { routeFor, kokoHref } from "../lib/omni";

const HANDLE_ERROR = "Paste a profile link or an @handle";

test("@handle routes to the canonical profile", () => {
  assert.deepEqual(routeFor("@Priya.Sharma"), {
    href: "/profile/priya.sharma",
    kind: "profile",
  });
});

test("surrounding whitespace is ignored for an @handle", () => {
  assert.deepEqual(routeFor("  @Priya.Sharma  "), {
    href: "/profile/priya.sharma",
    kind: "profile",
  });
});

test("an instagram.com profile URL routes to the profile", () => {
  assert.deepEqual(routeFor("https://www.instagram.com/priya.sharma/"), {
    href: "/profile/priya.sharma",
    kind: "profile",
  });
});

test("a profile URL with a query string routes to the profile", () => {
  assert.deepEqual(
    routeFor("https://www.instagram.com/priya.sharma/?hl=en"),
    { href: "/profile/priya.sharma", kind: "profile" },
  );
});

test("a scheme-less profile URL routes to the profile", () => {
  assert.deepEqual(routeFor("instagram.com/Name/"), {
    href: "/profile/name",
    kind: "profile",
  });
});

test("a profile URL with a reels tab still routes to the profile", () => {
  assert.deepEqual(routeFor("https://www.instagram.com/Name/reels"), {
    href: "/profile/name",
    kind: "profile",
  });
});

test("a bare handle-shaped word is a niche, not a profile", () => {
  assert.deepEqual(routeFor("priya.sharma"), {
    href: "/search/niche/priya.sharma",
    kind: "niche",
  });
});

test("a phrase with spaces becomes a niche route", () => {
  assert.deepEqual(routeFor("kannada songs"), {
    href: "/search/niche/kannada%20songs",
    kind: "niche",
  });
});

test("Hinglish text becomes a niche route", () => {
  assert.deepEqual(routeFor("telugu music covers"), {
    href: "/search/niche/telugu%20music%20covers",
    kind: "niche",
  });
});

test("Devanagari text becomes a niche route", () => {
  assert.deepEqual(routeFor("कन्नड़ गाने"), {
    href: `/search/niche/${encodeURIComponent("कन्नड़ गाने")}`,
    kind: "niche",
  });
});

test("whitespace inside a niche is collapsed", () => {
  assert.deepEqual(routeFor("  kannada   songs  "), {
    href: "/search/niche/kannada%20songs",
    kind: "niche",
  });
});

test("a one-character input is refused", () => {
  assert.deepEqual(routeFor("a"), { error: "Type at least 2 characters" });
});

test("an empty input is refused", () => {
  assert.deepEqual(routeFor("   "), { error: "Enter a niche or an @handle" });
});

test("300 characters are refused", () => {
  assert.deepEqual(routeFor("a".repeat(300)), {
    error: "Keep it under 120 characters",
  });
});

test("only punctuation is refused", () => {
  assert.deepEqual(routeFor("!!!"), { error: "Enter a niche or an @handle" });
});

test("a post URL is refused with the handle hint", () => {
  assert.deepEqual(routeFor("https://www.instagram.com/p/Cxyz/"), {
    error: HANDLE_ERROR,
  });
});

test("a reel URL is refused with the handle hint", () => {
  assert.deepEqual(routeFor("https://www.instagram.com/reel/Cxyz/"), {
    error: HANDLE_ERROR,
  });
});

test("a reserved instagram route is refused", () => {
  assert.deepEqual(routeFor("https://www.instagram.com/explore/"), {
    error: HANDLE_ERROR,
  });
});

test("an invalid @handle is refused with the handle hint", () => {
  assert.deepEqual(routeFor("@.priya"), { error: HANDLE_ERROR });
});

test("a bare reserved word is still a legal niche phrase", () => {
  assert.deepEqual(routeFor("explore"), {
    href: "/search/niche/explore",
    kind: "niche",
  });
});

test("Koko carries a profile handle into the chat", () => {
  assert.equal(kokoHref("/profile/Priya.Sharma"), "/chat?handle=Priya.Sharma");
});

test("Koko carries a niche query into the chat", () => {
  assert.equal(
    kokoHref("/search/niche/kannada%20songs"),
    "/chat?niche=kannada%20songs",
  );
});

test("Koko decodes and re-encodes a Devanagari niche", () => {
  const encoded = encodeURIComponent("कन्नड़ गाने");
  assert.equal(kokoHref(`/search/niche/${encoded}`), `/chat?niche=${encoded}`);
});

test("Koko opens a blank studio elsewhere", () => {
  assert.equal(kokoHref("/"), "/chat");
  assert.equal(kokoHref("/chat"), "/chat");
  assert.equal(kokoHref("/weekly"), "/chat");
});
