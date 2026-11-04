// The spoken name for a gem balance. "1 gem" must not become "1 gems".
//   npm run test:file -- test-gems
import test from "node:test";
import assert from "node:assert/strict";

import { gemsLabel } from "../lib/gems";

test("0 gems", () => {
  assert.equal(gemsLabel(0), "0 gems");
});

test("1 gem is singular", () => {
  assert.equal(gemsLabel(1), "1 gem");
});

test("15 gems is plural", () => {
  assert.equal(gemsLabel(15), "15 gems");
});
