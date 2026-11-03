import test from "node:test";
import assert from "node:assert/strict";

import { cronSecretOk, runCron } from "../lib/cron";

/** A cron request with whatever headers the case needs. */
function req(headers: Record<string, string> = {}, query = ""): Request {
  return new Request(`http://127.0.0.1:3000/api/cron/test${query}`, { headers });
}

function withSecret<T>(secret: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  return fn().finally(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
}

test("an unset CRON_SECRET refuses with 503 before any work runs", async () => {
  let called = false;
  const res = await withSecret(undefined, () =>
    runCron(req({ "x-cron-secret": "guessed" }), "test job", async () => {
      called = true;
      return Response.json({ ok: true });
    }),
  );

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: "Set CRON_SECRET to enable the test job.",
  });
  assert.equal(called, false, "the job body must not run without a configured secret");
});

test("a wrong secret refuses with 401 and a matching prefix leaks nothing", async () => {
  let called = false;
  const res = await withSecret("correct-secret", () =>
    runCron(req({ "x-cron-secret": "correct-secreu" }), "test job", async () => {
      called = true;
      return Response.json({ ok: true });
    }),
  );

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: "Bad secret." });
  assert.equal(called, false);
});

test("the right secret proceeds to the job", async () => {
  let called = 0;
  const res = await withSecret("correct-secret", () =>
    runCron(req({ "x-cron-secret": "correct-secret" }), "test job", async () => {
      called += 1;
      return Response.json({ ok: true, ran: true });
    }),
  );

  assert.equal(res.status, 200);
  assert.equal(await res.json().then((body) => body.ran), true);
  assert.equal(called, 1);
});

test("a query-string secret is never accepted — only the header is", async () => {
  let called = false;
  const res = await withSecret("correct-secret", () =>
    runCron(req({}, "?secret=correct-secret"), "test job", async () => {
      called = true;
      return Response.json({ ok: true });
    }),
  );

  assert.equal(res.status, 401);
  assert.equal(called, false);
});

test("cronSecretOk hashes both sides and rejects anything but an exact match", () => {
  assert.equal(cronSecretOk("s3cret", "s3cret"), true);
  assert.equal(cronSecretOk("s3cret", "s3creT"), false);
  assert.equal(cronSecretOk("", "s3cret"), false);
  assert.equal(cronSecretOk("a much longer guess", "short"), false);
});
