/**
 * The limiter slot and the gem must never disagree about whether a read was
 * free.
 *
 * A route refunds its per-user rate-limit slot on a free read, and keeps it
 * when the vendor was actually paid. The decision is the measured
 * `lifetimeUsd` delta — the same value the gem settle uses — not a route's own
 * unit counter, which misses owner reads and the deep pass. These tests pin
 * the seam and the wiring of all three charged routes.
 *
 *   sh scripts/run-test.sh test-slot-refund
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { refundSlotIfFree, resetLimitsForTests, take } from "../lib/limits";

const DAY = 24 * 60 * 60 * 1000;

test("a read that bought something keeps the rate-limit slot", () => {
  resetLimitsForTests();
  const key = "plan:test-paid";

  assert.equal(take(key, 1, DAY).allowed, true);
  assert.equal(refundSlotIfFree(key, 0.02), false);
  assert.equal(
    take(key, 1, DAY).allowed,
    false,
    "a paid read must still count against the daily cap",
  );
});

test("a read the ledger measured as free returns the slot", () => {
  resetLimitsForTests();
  const key = "plan:test-free";

  assert.equal(take(key, 1, DAY).allowed, true);
  assert.equal(refundSlotIfFree(key, 0), true);
  assert.equal(
    take(key, 1, DAY).allowed,
    true,
    "a free re-read must not lock the visitor out of their own work",
  );
});

test("plan, profile and niche all refund on the measured spend, not credits.spent", () => {
  const files = [
    "app/api/plan/route.ts",
    "app/api/profile/route.ts",
    "app/api/niche/route.ts",
  ];

  for (const file of files) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(
      source,
      /refundSlotIfFree\(/,
      `${file} must use the shared measured-spend slot seam`,
    );
    assert.match(
      source,
      /lifetimeUsd/,
      `${file} must measure real vendor money`,
    );
    assert.doesNotMatch(
      source,
      /credits\.spent === 0\)\s*refund\(/,
      `${file} must not refund the slot on the research unit counter`,
    );
  }
});
