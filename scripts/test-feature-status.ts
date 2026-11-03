// One source of truth for whether a pillar is live, coming or planned.
//   npm run test:file -- test-feature-status
import test from "node:test";
import assert from "node:assert/strict";

import { FEATURE_STATUS, statusLabel } from "../lib/featureStatus";

test("statusLabel speaks the launch copy for every status", () => {
  assert.equal(statusLabel("live"), "Live now");
  assert.equal(statusLabel("soon"), "Coming soon");
  assert.equal(statusLabel("planned"), "Planned · wave 2");
});

test("every pillar has a status", () => {
  assert.deepEqual(Object.keys(FEATURE_STATUS).sort(), [
    "audit",
    "competitor-intel",
    "lifestyle-vip",
  ]);
  for (const status of Object.values(FEATURE_STATUS)) {
    assert.ok(["live", "soon", "planned"].includes(status));
    assert.ok(statusLabel(status).length > 0);
  }
});
