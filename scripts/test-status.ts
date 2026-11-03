/**
 * /api/status has two shapes by design.
 *
 * Anonymous page loads get only the coarse readiness bit, from a cached vendor
 * balance; the operator's detailed provider list requires the cron secret.
 * These tests also pin the ten-minute TTL so an anonymous visitor can never
 * turn a page load into a vendor round trip.
 *
 *   sh scripts/run-test.sh test-status
 */
import test from "node:test";
import assert from "node:assert/strict";

import { STATUS_TTL_MS, resetStatusCache, statusBody, type StatusDeps } from "../lib/status";

const SECRET = "status-test-secret";

function providers() {
  return [
    {
      id: "apify" as const,
      name: "Apify",
      configured: true,
      benched: null,
      cost: { label: "$0.50 / 1,000 results", usdPerCall: 0.0005 },
    },
    {
      id: "youtubeweb" as const,
      name: "YouTube (page)",
      configured: true,
      benched: null,
      cost: { label: "free — no key", usdPerCall: 0 },
    },
    {
      id: "socialcrawl" as const,
      name: "SocialCrawl",
      configured: false,
      benched: "no key",
      cost: { label: "$0.0076 / call", usdPerCall: 0.0076 },
    },
  ];
}

function deps(overrides: Partial<StatusDeps> = {}): StatusDeps {
  return {
    secret: SECRET,
    now: () => 1_000_000,
    paidReady: async () => true,
    providerSummary: providers,
    llmReady: () => true,
    llmLabel: () => "test-model @ example.test",
    ...overrides,
  };
}

test("an anonymous caller gets only ok + instagramReady", async () => {
  resetStatusCache();
  const body = await statusBody(null, deps());

  assert.deepEqual(Object.keys(body).sort(), ["instagramReady", "ok"]);
  assert.equal(body.ok, true);
  assert.equal(body.instagramReady, true);
});

test("a wrong header is treated exactly like an anonymous caller", async () => {
  resetStatusCache();
  const body = await statusBody("not-the-secret", deps());

  assert.deepEqual(Object.keys(body).sort(), ["instagramReady", "ok"]);
});

test("an unset CRON_SECRET never unlocks the detailed shape", async () => {
  resetStatusCache();
  const body = await statusBody("anything", deps({ secret: "" }));

  assert.deepEqual(Object.keys(body).sort(), ["instagramReady", "ok"]);
});

test("the matching header gets the detailed provider list", async () => {
  resetStatusCache();
  const body = await statusBody(SECRET, deps());

  assert.equal(body.ok, true);
  assert.ok("providers" in body);
  assert.deepEqual(
    body.providers.map((p) => p.id),
    ["apify", "youtubeweb", "socialcrawl"],
  );
  assert.equal(body.providers[0].price, "$0.50 / 1,000 results");
  assert.equal(body.providers[0].usdPerCall, 0.0005);
  assert.equal(body.providers[2].benched, "no key");
  assert.equal(body.llm.model, "test-model @ example.test");
  assert.equal(body.discoveryReady, true);
  assert.deepEqual(body.enable, []);
});

test("the vendor balance is asked at most once per ten minutes per process", async () => {
  resetStatusCache();
  let calls = 0;
  let clock = 1_000_000;
  const opts = deps({
    now: () => clock,
    paidReady: async () => {
      calls += 1;
      return true;
    },
  });

  await statusBody(null, opts);
  await statusBody(null, opts);
  await statusBody(SECRET, opts);
  assert.equal(calls, 1, "three requests inside the TTL must share one balance read");

  clock += STATUS_TTL_MS - 1;
  await statusBody(null, opts);
  assert.equal(calls, 1, "the last millisecond is still inside the window");

  clock += 1;
  await statusBody(null, opts);
  assert.equal(calls, 2, "the TTL expiring must trigger a fresh balance read");
});
