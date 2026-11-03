// The hero ticker's pure half. The flip interval and the reduced-motion rule
// are decided here, not in the component, so the behaviour can be pinned
// without a browser: nextIndex wraps, and tickerState refuses to rotate when
// the visitor asked for less motion or the tab is hidden.
//   npm run test:file -- test-ticker
import test from "node:test";
import assert from "node:assert/strict";

import {
  TICKER_LINES,
  nextIndex,
  tickerState,
} from "../lib/tickerLines";

test("nextIndex advances inside the list", () => {
  assert.equal(nextIndex(0, 4), 1);
  assert.equal(nextIndex(1, 4), 2);
  assert.equal(nextIndex(2, 4), 3);
});

test("nextIndex wraps from the last line to the first", () => {
  assert.equal(nextIndex(3, 4), 0);
});

test("nextIndex with no lines returns 0 instead of NaN", () => {
  assert.equal(nextIndex(0, 0), 0);
  assert.equal(nextIndex(7, 0), 0);
  assert.equal(Number.isNaN(nextIndex(7, 0)), false);
});

test("nextIndex recovers from a negative current index", () => {
  assert.equal(nextIndex(-1, 4), 0);
  assert.equal(nextIndex(-2, 4), 3);
});

test("the ticker has the founder's first two questions, verbatim", () => {
  assert.equal(
    TICKER_LINES[0],
    "Why did my latest Reel get stuck at 1,200 views?",
  );
  assert.equal(
    TICKER_LINES[1],
    "How do I unlock the VIP creator lifestyle?",
  );
});

test("the ticker has at least four lines, all in the same voice", () => {
  assert.ok(TICKER_LINES.length >= 4);
  for (const line of TICKER_LINES) {
    assert.match(line, /\?$/);
    assert.ok(line.trim().length > 20);
  }
  assert.equal(new Set(TICKER_LINES).size, TICKER_LINES.length);
});

test("the ticker rotates when motion is allowed and the tab is visible", () => {
  assert.deepEqual(tickerState({ reducedMotion: false, hidden: false }), {
    rotate: true,
  });
});

test("reduced motion stops the ticker", () => {
  assert.deepEqual(tickerState({ reducedMotion: true, hidden: false }), {
    rotate: false,
  });
});

test("a hidden tab pauses the ticker", () => {
  assert.deepEqual(tickerState({ reducedMotion: false, hidden: true }), {
    rotate: false,
  });
});

test("reduced motion and a hidden tab both stop the ticker", () => {
  assert.deepEqual(tickerState({ reducedMotion: true, hidden: true }), {
    rotate: false,
  });
});
