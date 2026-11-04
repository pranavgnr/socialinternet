// The retired URLs must keep working as permanent redirects, whatever a
// visitor has in `?q=`. The query arrives decoded from Next, so the target is
// encoded here, once, and never interpolated raw into a Location header.
//
//   sh scripts/run-test.sh test-legacy-routes
import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_ROUTES,
  LEGACY_SEARCH_LIMIT,
  legacyTarget,
} from "../lib/legacyRoutes";

test("the table covers exactly the retired pages", () => {
  assert.deepEqual(
    LEGACY_ROUTES.map((r) => r.source).sort(),
    ["/discover", "/room", "/start"],
  );
});

test("/start goes to the landing page", () => {
  assert.equal(legacyTarget("/start"), "/");
  assert.equal(legacyTarget("/start", "anything"), "/");
});

test("discover and room go to the niche dossier when q is present", () => {
  for (const pathname of ["/discover", "/room"]) {
    assert.equal(
      legacyTarget(pathname, "kannada songs"),
      "/search/niche/kannada%20songs",
    );
  }
});

test("a missing, empty or whitespace-only q goes to the landing page", () => {
  for (const pathname of ["/discover", "/room"]) {
    assert.equal(legacyTarget(pathname), "/");
    assert.equal(legacyTarget(pathname, ""), "/");
    assert.equal(legacyTarget(pathname, "   "), "/");
  }
});

test("Devanagari is percent-encoded, not written raw into the header", () => {
  const target = legacyTarget("/discover", "कन्नड़ गाने");
  assert.equal(target, `/search/niche/${encodeURIComponent("कन्नड़ गाने")}`);
  assert.ok(!/[^\x20-\x7e]/.test(target), "target must be ASCII");
});

test("path traversal never becomes a path segment", () => {
  assert.equal(legacyTarget("/discover", "../"), "/search/niche/..%2F");
  assert.equal(legacyTarget("/room", "/../etc/passwd"), "/search/niche/%2F..%2Fetc%2Fpasswd");
  assert.ok(!legacyTarget("/discover", "../")!.includes("/../"));
});

test("percent signs are escaped exactly once", () => {
  assert.equal(legacyTarget("/discover", "100%"), "/search/niche/100%25");
  // A visitor who typed the literal text "%20" must not have it decoded into a
  // space by the destination route.
  assert.equal(
    legacyTarget("/discover", "kannada%20songs"),
    "/search/niche/kannada%2520songs",
  );
});

test("spaces, punctuation and repeated slashes survive safely", () => {
  assert.equal(
    legacyTarget("/discover", '  lo-fi   "beats"  '),
    "/search/niche/lo-fi%20%20%20%22beats%22",
  );
  assert.equal(legacyTarget("/room", "///"), "/search/niche/%2F%2F%2F");
  assert.equal(
    legacyTarget("/discover", "a\nb"),
    "/search/niche/a%0Ab",
  );
});

test("a very long q is bounded rather than sent as a huge header", () => {
  const long = "x".repeat(5000);
  assert.equal(legacyTarget("/discover", long), "/");
  assert.equal(
    legacyTarget("/discover", "x".repeat(LEGACY_SEARCH_LIMIT)),
    `/search/niche/${"x".repeat(LEGACY_SEARCH_LIMIT)}`,
  );
  assert.equal(legacyTarget("/discover", "x".repeat(LEGACY_SEARCH_LIMIT + 1)), "/");
});

test("unknown paths are left alone", () => {
  assert.equal(legacyTarget("/"), null);
  assert.equal(legacyTarget("/ideas"), null);
  assert.equal(legacyTarget("/search/niche/kannada"), null);
});
