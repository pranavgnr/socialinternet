// Waitlist tests: contact validation, the signup table and the public route,
// all on in-memory PGlite with no network.
//   npm run test:file -- test-waitlist
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/migrate";
import { resetDbForTests, setDbForTests } from "../lib/db";
import type { Queryable } from "../lib/db";
import {
  WAITLIST_FEATURES,
  isWaitlistFeature,
  normalizeContact,
  normalizeWhatsApp,
  saveWaitlistSignup,
} from "../lib/waitlist";
import { POST } from "../app/api/waitlist/route";

// PGlite's own query type is close to but not exactly Queryable; adapt it.
function asQueryable(pg: PGlite): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const res = await pg.query<T>(sql, params as never[]);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      return { rows: one.rows as T[] };
    },
  };
}

async function withFreshDb<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const pg = new PGlite();
  const q = asQueryable(pg);
  setDbForTests(q);
  try {
    await migrate(q);
    return await fn(q);
  } finally {
    resetDbForTests();
    await pg.close();
  }
}

let ipCounter = 0;
/** A fresh limiter key per test, so one test cannot spend another's budget. */
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function post(
  body: unknown,
  opts: { headers?: Record<string, string>; url?: string } = {},
): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(opts.url ?? "http://localhost/api/waitlist", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": freshIp(),
      ...opts.headers,
    },
    body: text,
  });
}

async function json(res: Response): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  return (await res.json()) as { ok: boolean; duplicate?: boolean; error?: string };
}

async function rows(q: Queryable): Promise<{ email: string | null; whatsapp: string | null; handle: string | null; feature: string; source: string | null }[]> {
  const { rows: out } = await q.query<{
    email: string | null;
    whatsapp: string | null;
    handle: string | null;
    feature: string;
    source: string | null;
  }>("SELECT email, whatsapp, handle, feature, source FROM waitlist_signups ORDER BY id");
  return out;
}

// --- contact validation -----------------------------------------------------

test("an empty signup is refused", () => {
  assert.deepEqual(normalizeContact({}), { error: "Enter your email or WhatsApp number." });
  assert.deepEqual(normalizeContact({ email: "  ", whatsapp: "" }), {
    error: "Enter your email or WhatsApp number.",
  });
});

test("an email is trimmed and lowercased", () => {
  assert.deepEqual(normalizeContact({ email: "  Creator@Example.CO.IN  " }), {
    email: "creator@example.co.in",
  });
});

test("invalid emails are refused", () => {
  for (const email of [
    "creator",
    "creator@",
    "@example.com",
    "creator@example",
    "cre ator@example.com",
    "creator@@example.com",
    "creator@example..com",
    "creator@.example.com",
    `${"a".repeat(250)}@example.com`,
  ]) {
    assert.ok("error" in normalizeContact({ email }), `accepted: ${email}`);
  }
});

test("Indian WhatsApp numbers normalise to E.164", () => {
  for (const whatsapp of [
    "98765 43210",
    "+91 98765-43210",
    "09876543210",
    " 9876543210 ",
    "+91 9876543210",
  ]) {
    assert.deepEqual(normalizeContact({ whatsapp }), {
      whatsapp: "+919876543210",
    });
  }
});

test("a non-India number with a plus keeps its country code", () => {
  assert.deepEqual(normalizeContact({ whatsapp: "+1 415 555 0100" }), {
    whatsapp: "+14155550100",
  });
  assert.equal(normalizeWhatsApp("+44 20 7946 0958"), "+442079460958");
});

test("numbers that cannot be E.164 are refused", () => {
  for (const whatsapp of ["12345", "abc", "+1", "+", "919876543210", "0987654321", "+1234"]) {
    assert.ok("error" in normalizeContact({ whatsapp }), `accepted: ${whatsapp}`);
  }
});

test("the feature union is closed", () => {
  for (const feature of WAITLIST_FEATURES) assert.equal(isWaitlistFeature(feature), true);
  assert.equal(isWaitlistFeature("payments"), false);
  assert.equal(isWaitlistFeature(""), false);
  assert.equal(isWaitlistFeature(null), false);
});

// --- persistence ------------------------------------------------------------

test("the same signup twice is one row reported as duplicate", async () => {
  await withFreshDb(async (q) => {
    const first = await saveWaitlistSignup({
      email: "Creator@Example.com",
      feature: "ig-wrapped",
      source: "landing",
    });
    assert.deepEqual(first, { ok: true, duplicate: false });

    const second = await saveWaitlistSignup({
      email: " creator@example.com ",
      feature: "ig-wrapped",
      source: "landing",
    });
    assert.deepEqual(second, { ok: true, duplicate: true });

    const stored = await rows(q);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.email, "creator@example.com");
  });
});

test("the same contact can join two different waitlists", async () => {
  await withFreshDb(async (q) => {
    await saveWaitlistSignup({ email: "creator@example.com", feature: "ig-wrapped" });
    await saveWaitlistSignup({ email: "creator@example.com", feature: "vip" });
    assert.equal((await rows(q)).length, 2);
  });
});

test("HTML in the handle is stored as plain text, capped at 30", async () => {
  await withFreshDb(async (q) => {
    await saveWaitlistSignup({
      email: "creator@example.com",
      handle: "<b>@Priya.Sharma</b>",
      feature: "rate-card",
    });
    await saveWaitlistSignup({
      email: "long@example.com",
      handle: "a".repeat(45),
      feature: "rate-card",
    });

    const [first, second] = await rows(q);
    assert.equal(first!.handle, "priya.sharma");
    assert.equal(second!.handle, "a".repeat(30));
    for (const row of [first!, second!]) {
      assert.equal(row.handle!.includes("<"), false);
      assert.equal(row.handle!.includes(">"), false);
      assert.ok(row.handle!.length <= 30);
    }
  });
});

test("a handle that is not a handle is dropped silently", async () => {
  await withFreshDb(async (q) => {
    await saveWaitlistSignup({
      email: "creator@example.com",
      handle: "<script>alert(1)</script>",
      feature: "comment-to-dm",
    });
    assert.equal((await rows(q))[0]!.handle, null);
  });
});

test("an invalid source is dropped instead of stored raw", async () => {
  await withFreshDb(async (q) => {
    await saveWaitlistSignup({
      email: "creator@example.com",
      feature: "mini-business",
      source: "<img src=x onerror=alert(1)>",
    });
    assert.equal((await rows(q))[0]!.source, null);
  });
});

test("an unknown feature is rejected before a row is written", async () => {
  await withFreshDb(async (q) => {
    await assert.rejects(
      () =>
        saveWaitlistSignup({
          email: "creator@example.com",
          // A runtime value from a request body is not a WaitlistFeature.
          feature: "payments" as never,
        }),
      /feature/i,
    );
    assert.equal((await rows(q)).length, 0);
  });
});

// --- the route --------------------------------------------------------------

test("POST saves a signup and reports it as new", async () => {
  await withFreshDb(async (q) => {
    const res = await POST(
      post({ email: "Creator@Example.com", feature: "shop-dine-stay", source: "vault" }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true, duplicate: false });

    const stored = await rows(q);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.email, "creator@example.com");
    assert.equal(stored[0]!.feature, "shop-dine-stay");
    assert.equal(stored[0]!.source, "vault");
  });
});

test("POST reports a repeat as a duplicate", async () => {
  await withFreshDb(async (q) => {
    const body = { whatsapp: "98765 43210", feature: "vip" };
    assert.equal((await json(await POST(post(body)))).duplicate, false);
    const res = await POST(post({ whatsapp: "+91 98765-43210", feature: "vip" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true, duplicate: true });
    assert.equal((await rows(q)).length, 1);
  });
});

test("POST refuses an empty body and an invalid email with 400", async () => {
  for (const body of [
    {},
    { email: "not-an-email" },
    { whatsapp: "12345" },
  ]) {
    const res = await POST(post(body));
    assert.equal(res.status, 400);
    const out = await json(res);
    assert.equal(out.ok, false);
    assert.ok(out.error && out.error.length > 0);
  }
});

test("POST refuses malformed JSON with 400", async () => {
  const res = await POST(post("{not json"));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).ok, false);
});

test("POST refuses an unknown feature with 400", async () => {
  const res = await POST(post({ email: "creator@example.com", feature: "payments" }));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).ok, false);
});

test("POST refuses a cross-site Origin with 403", async () => {
  await withFreshDb(async (q) => {
    const res = await POST(
      post(
        { email: "creator@example.com", feature: "ig-wrapped" },
        { headers: { origin: "https://evil.example" } },
      ),
    );
    assert.equal(res.status, 403);
    assert.equal((await json(res)).ok, false);
    assert.equal((await rows(q)).length, 0);
  });
});

test("POST accepts a same-origin request", async () => {
  await withFreshDb(async () => {
    const res = await POST(
      post(
        { email: "creator@example.com", feature: "ig-wrapped" },
        { headers: { origin: "http://localhost" } },
      ),
    );
    assert.equal(res.status, 200);
  });
});

test("POST refuses a body over 4 KB", async () => {
  await withFreshDb(async (q) => {
    const res = await POST(
      post({ email: "creator@example.com", feature: "vip", handle: "x".repeat(5000) }),
    );
    assert.equal(res.status, 413);
    assert.equal((await json(res)).ok, false);
    assert.equal((await rows(q)).length, 0);
  });
});

test("the limiter allows 10 requests from one IP and rejects the 11th", async () => {
  await withFreshDb(async (q) => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        post(
          { email: `creator${i}@example.com`, feature: "vip" },
          { headers: { "x-forwarded-for": ip } },
        ),
      );
      assert.equal(res.status, 200, `request ${i + 1} was not allowed`);
    }

    const blocked = await POST(
      post(
        { email: "creator10@example.com", feature: "vip" },
        { headers: { "x-forwarded-for": ip } },
      ),
    );
    assert.equal(blocked.status, 429);
    const out = await json(blocked);
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /Try again/i);
  });
});

test("1,000 signups from one IP write only the allowed ten rows", async () => {
  await withFreshDb(async (q) => {
    const ip = freshIp();
    let allowed = 0;
    for (let i = 0; i < 1000; i++) {
      const res = await POST(
        post(
          { email: `bulk${i}@example.com`, feature: "vip" },
          { headers: { "x-forwarded-for": ip } },
        ),
      );
      if (res.status === 200) {
        allowed += 1;
      } else {
        assert.equal(res.status, 429);
      }
    }
    assert.equal(allowed, 10);
    assert.equal((await rows(q)).length, 10);
  });
});

test("a database failure returns 503 and logs no contact details", async () => {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  setDbForTests({
    async query<T>(): Promise<{ rows: T[] }> {
      throw new Error("connection refused for creator@example.com and +919876543210");
    },
  });
  try {
    const res = await POST(
      post({ email: "creator@example.com", whatsapp: "98765 43210", feature: "vip" }),
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await json(res), {
      ok: false,
      error: "We could not save that just now. Please try again in a minute.",
    });
    const logged = logs.join("\n");
    assert.equal(logged.includes("creator@example.com"), false);
    assert.equal(logged.includes("9876543210"), false);
    assert.equal(logged.includes("connection refused"), false);
  } finally {
    console.error = original;
    resetDbForTests();
  }
});
