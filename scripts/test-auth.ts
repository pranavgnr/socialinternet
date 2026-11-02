// Google sign-in and session tests: runs entirely on in-memory PGlite.
//   npm run test:file -- test-auth
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/migrate";
import { closeDb, setDbForTests, resetDbForTests } from "../lib/db";
import type { Queryable } from "../lib/db";
import {
  deleteSession,
  sessionUser,
  setSigninAccountDir,
  signInWithGoogleProfile,
  verifyState,
} from "../lib/auth";

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
    await pg.close();
  }
}

// verifyState never sees a real secret in this suite, but the contract it must
// keep is: empty, missing and mismatched pairs are refused; equal pairs pass.
test("verifyState refuses missing and empty halves", () => {
  assert.equal(verifyState(undefined, undefined), false);
  assert.equal(verifyState(undefined, "s"), false);
  assert.equal(verifyState("s", undefined), false);
  assert.equal(verifyState("", ""), false);
  assert.equal(verifyState("", "s"), false);
  assert.equal(verifyState("s", ""), false);
});

test("verifyState accepts equal values and rejects unequal ones", () => {
  assert.equal(verifyState("abc123", "abc123"), true);
  assert.equal(verifyState("abc123", "abc124"), false);
  assert.equal(verifyState("abc123", "abc1234"), false); // prefix games change length
});

test("signInWithGoogleProfile: same sub, same user, new session each time", async () => {
  await withFreshDb(async (q) => {
    const first = await signInWithGoogleProfile({
      sub: "google-sub-1",
      email: "creator@example.com",
      name: "Creator One",
    });
    const second = await signInWithGoogleProfile({
      sub: "google-sub-1",
      email: "creator@example.com",
      name: "Creator One",
    });

    assert.equal(first.userId, second.userId);
    assert.notEqual(first.sessionId, second.sessionId);
    assert.equal(first.sessionId.length, 43); // 32 random bytes, base64url

    const { rows: sessionRows } = await q.query<{ user_id: string }>(
      "SELECT user_id FROM sessions ORDER BY expires_at DESC"
    );
    assert.equal(sessionRows.length, 2);
    for (const row of sessionRows) assert.equal(row.user_id, first.userId);

    const { rows: userRows } = await q.query<{ google_sub: string }>(
      "SELECT google_sub FROM users"
    );
    assert.equal(userRows.length, 1); // upserted, never duplicated
  });
});

test("a profile update on re-sign-in rewrites email and name", async () => {
  await withFreshDb(async () => {
    await signInWithGoogleProfile({
      sub: "google-sub-1",
      email: "old@example.com",
      name: "Old Name",
    });
    const second = await signInWithGoogleProfile({
      sub: "google-sub-1",
      email: "new@example.com",
      name: "New Name",
    });
    const user = await sessionUser(second.sessionId);
    assert.ok(user);
    assert.equal(user.email, "new@example.com");
    assert.equal(user.name, "New Name");
  });
});

test("two parallel first-time sign-ins for one sub share a user, not a 500", async () => {
  await withFreshDb(async (q) => {
    const visitorA = randomUUID();
    const visitorB = randomUUID();

    // The race the review found: two callbacks for the same never-seen
    // google_sub land at once — the SELECT-then-INSERT 500ed on one of them.
    const [a, b] = await Promise.all([
      signInWithGoogleProfile(
        { sub: "google-sub-race", email: "race@example.com", name: "Race A" },
        visitorA
      ),
      signInWithGoogleProfile(
        { sub: "google-sub-race", email: "race@example.com", name: "Race B" },
        visitorB
      ),
    ]);

    // Same user, two private sessions.
    assert.equal(a.userId, b.userId);
    assert.notEqual(a.sessionId, b.sessionId);

    const { rows: userRows } = await q.query<{ id: string; sub: string }>(
      "SELECT id, google_sub AS sub FROM users WHERE google_sub = $1",
      ["google-sub-race"]
    );
    assert.equal(userRows.length, 1); // exactly one users row
    assert.equal(userRows[0]!.id, a.userId); // and it is the one both got

    // The legacy id settles on exactly the one adopted visitor id — never a
    // merge, never a retarget, never null.
    const { rows: legacyRows } = await q.query<{ legacy_account_id: string | null }>(
      "SELECT legacy_account_id FROM users WHERE id = $1",
      [a.userId]
    );
    const dir = legacyRows[0]!.legacy_account_id;
    assert.ok(
      dir === visitorA || dir === visitorB,
      `legacy id must be one of the two racing visitor cookies, got ${dir}`
    );
  });
});

test("the visitor's legacy account carries over on first sign-in only", async () => {
  await withFreshDb(async (q) => {
    const visitor = randomUUID();
    const later = randomUUID(); // a second visitor id seen on later sign-ins

    const { userId } = await signInWithGoogleProfile(
      { sub: "google-sub-1", email: "creator@example.com" },
      visitor
    );
    const { rows: first } = await q.query<{ legacy_account_id: string | null }>(
      "SELECT legacy_account_id FROM users WHERE id = $1",
      [userId]
    );
    assert.equal(first[0]!.legacy_account_id, visitor);

    // A second sign-in never retargets the directory, even with a new cookie.
    await signInWithGoogleProfile(
      { sub: "google-sub-1", email: "creator@example.com" },
      later
    );
    const { rows: second } = await q.query<{ legacy_account_id: string | null }>(
      "SELECT legacy_account_id FROM users WHERE id = $1",
      [userId]
    );
    assert.equal(second[0]!.legacy_account_id, visitor);
  });
});

test("a visitor cookie that is not UUID-shaped is never adopted", async () => {
  await withFreshDb(async (q) => {
    const { userId } = await signInWithGoogleProfile(
      { sub: "google-sub-1", email: "creator@example.com" },
      "not-a-uuid"
    );
    const { rows } = await q.query<{ legacy_account_id: string | null }>(
      "SELECT legacy_account_id FROM users WHERE id = $1",
      [userId]
    );
    assert.equal(rows[0]!.legacy_account_id, null);
  });
});

test("setSigninAccountDir mints a directory for a signed-in user, once", async () => {
  await withFreshDb(async (q) => {
    const { userId } = await signInWithGoogleProfile({
      sub: "google-sub-1",
      email: "creator@example.com",
    });
    const { rows: before } = await q.query<{ legacy_account_id: string | null }>(
      "SELECT legacy_account_id FROM users WHERE id = $1",
      [userId]
    );
    assert.equal(before[0]!.legacy_account_id, null);

    const minted = randomUUID();
    await setSigninAccountDir(userId, minted);
    await setSigninAccountDir(userId, randomUUID()); // an old row must not move

    const { rows } = await q.query<{ legacy_account_id: string | null }>(
      "SELECT legacy_account_id FROM users WHERE id = $1",
      [userId]
    );
    assert.equal(rows[0]!.legacy_account_id, minted);
  });
});

test("sessionUser resolves a live session and refuses an expired one", async () => {
  await withFreshDb(async (q) => {
    const { sessionId, userId } = await signInWithGoogleProfile({
      sub: "google-sub-1",
      email: "creator@example.com",
      name: "Creator One",
    });

    const live = await sessionUser(sessionId);
    assert.ok(live);
    assert.equal(live.id, userId);
    assert.equal(live.email, "creator@example.com");
    assert.equal(live.name, "Creator One");

    // Expire it manually, as time would.
    await q.query(
      "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [userId]
    );
    assert.equal(await sessionUser(sessionId), null);

    // A random id resolves to nobody.
    assert.equal(await sessionUser("aside-from-everything-else-1234567890ab"), null);
    assert.equal(await sessionUser(""), null);
  });
});

test("deleteSession removes the row so the id can never be replayed", async () => {
  await withFreshDb(async () => {
    const { sessionId } = await signInWithGoogleProfile({
      sub: "google-sub-1",
      email: "creator@example.com",
    });
    assert.ok(await sessionUser(sessionId));
    await deleteSession(sessionId);
    assert.equal(await sessionUser(sessionId), null);
  });
});

// Needs no database: confirms closeDb also resolves after the pool-free run.
test("closeDb is a no-op in this suite", async () => {
  await closeDb();
});

test.after(() => {
  resetDbForTests();
});
