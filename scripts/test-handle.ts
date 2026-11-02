// Handle normalisation: every way a creator types an Instagram handle must land
// on the same canonical value, or the same account is read twice and cached as
// two different creators.
//   npm run test:file -- test-handle
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHandle } from "../lib/handle";

test("accepts an @handle in mixed case", () => {
  assert.equal(normalizeHandle("@Priya.Sharma"), "priya.sharma");
});

test("accepts a full instagram.com URL with a trailing slash", () => {
  assert.equal(
    normalizeHandle("https://www.instagram.com/priya.sharma/"),
    "priya.sharma",
  );
});

test("accepts a full instagram.com URL with a query string", () => {
  assert.equal(
    normalizeHandle("https://www.instagram.com/Name/?hl=en"),
    "name",
  );
});

test("trims surrounding spaces", () => {
  assert.equal(normalizeHandle(" priya "), "priya");
});

test("returns null for empty input", () => {
  assert.equal(normalizeHandle(""), null);
});

test("returns null for spaces inside a handle", () => {
  assert.equal(normalizeHandle("a b"), null);
});

test("returns null when there is no handle left", () => {
  assert.equal(normalizeHandle("@@"), null);
});

test("returns null for more than 30 characters", () => {
  assert.equal(normalizeHandle("a".repeat(31)), null);
});

test("accepts exactly 30 characters", () => {
  assert.equal(normalizeHandle("a".repeat(30)), "a".repeat(30));
});
