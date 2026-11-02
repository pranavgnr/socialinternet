/**
 * Owner follower counts for search results.
 *
 * `/v2/search/reels` rows name the account but carry no follower count, so the
 * views-to-followers multiple could not be computed from a search alone. These
 * tests pin the cache and the caps that make reading those profiles affordable:
 * a cached handle costs no read, the per-call cap is a hard ceiling, a dead
 * handle is remembered for a day instead of retried on every search, and the
 * reads show up in the niche's credit ledger so the route cannot refund a pull
 * that spent money.
 *
 * No network: the resolver takes an injected reader, and the one niche-wiring
 * test stubs `globalThis.fetch` with the recorded HikerAPI fixtures.
 *
 *   sh scripts/run-test.sh test-owner-profiles
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const TMP = mkdtempSync(path.join(os.tmpdir(), "reel-engine-owner-profiles-"));
const CACHE = path.join(TMP, "_owner_profiles.json");

process.env.CREATORS_DATA_DIR = TMP;
/**
 * The niche-wiring test runs the real `researchNiche`; switch off the video and
 * comment witnesses so the only spend is the search and the owner profile
 * reads this task adds. Both constants are read when `lib/niche.ts` is first
 * imported, so they have to be set before that import — each test imports
 * lazily.
 */
process.env.LANG_VERIFY_MAX = "0";
process.env.LANG_COMMENT_MAX = "0";

const FIXTURES = path.join(ROOT, "lib/providers/__fixtures__/hikerapi");
type Json = Record<string, unknown>;

const ENV_KEYS = [
  "CREATORS_DATA_DIR",
  "OWNER_CACHE_HOURS",
  "OWNER_PROFILE_MAX",
  "HIKERAPI_KEY",
  "HIKERAPI_USD_PER_CALL",
  "APIFY_TOKEN",
  "SOCIALCRAWL_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "YOUTUBE_WEB",
  "DATA_PROVIDER",
  "CREDIT_BUDGET",
  "CREDIT_BUDGET_USD",
  "NICHE_CACHE_HOURS",
  "LANG_VERIFY_MAX",
  "LANG_COMMENT_MAX",
] as const;

const ENV_SNAPSHOT = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ENV_SNAPSHOT[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function writeCache(entries: Record<string, { followers: number | null; fetchedAt: string }>): void {
  writeFileSync(CACHE, JSON.stringify(entries), "utf8");
}

function readCache(): Record<string, { followers: number | null; fetchedAt: string }> {
  return JSON.parse(readFileSync(CACHE, "utf8")) as Record<
    string,
    { followers: number | null; fetchedAt: string }
  >;
}

/** A call that wrote nothing leaves no file; that is a pass, not an error. */
function readCacheSafe(): Record<string, { followers: number | null; fetchedAt: string }> {
  try {
    return readCache();
  } catch {
    return {};
  }
}

function clearCache(): void {
  rmSync(CACHE, { force: true });
}

function handler(name: string): Json {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as Json;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch<T>(
  fn: (url: string) => Response | Promise<Response>,
  work: () => Promise<T>,
): Promise<{ value: T; seen: string[] }> {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    return fn(url);
  }) as typeof fetch;
  try {
    return { value: await work(), seen };
  } finally {
    globalThis.fetch = real;
  }
}

test.after(() => {
  restoreEnv();
  process.chdir(ROOT);
  rmSync(TMP, { recursive: true, force: true });
});

test("a cached handle costs zero reads and still resolves", async () => {
  clearCache();
  writeCache({
    alpha: { followers: 1_000, fetchedAt: iso(NOW) },
    beta: { followers: 2_000, fetchedAt: iso(NOW - 6 * DAY) },
  });
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  const reads: string[] = [];
  const map = await resolveOwnerFollowers(["Alpha", "@beta"], {
    now: () => NOW,
    read: async (h) => {
      reads.push(h);
      return { followers: 1 };
    },
  });

  assert.equal(reads.length, 0, "a fresh cache entry must not buy the profile again");
  assert.equal(map.get("alpha"), 1_000);
  assert.equal(map.get("beta"), 2_000);
});

test("a cache with more handles than the cap still costs zero reads", async () => {
  clearCache();
  const entries: Record<string, { followers: number; fetchedAt: string }> = {};
  for (let i = 0; i < 20; i++) entries[`cached${i}`] = { followers: i + 1, fetchedAt: iso(NOW) };
  writeCache(entries);
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  let reads = 0;
  const map = await resolveOwnerFollowers(
    Object.keys(entries),
    { now: () => NOW, max: 1, read: async () => { reads += 1; return { followers: 9 }; } },
  );

  assert.equal(reads, 0, "the cap limits fresh reads, not cache lookups");
  assert.equal(map.size, 20, "every cached handle resolves");
});

test("max caps fresh reads at the cap, in the order given", async () => {
  clearCache();
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  const reads: string[] = [];
  const map = await resolveOwnerFollowers(
    ["h1", "h2", "h3", "h4", "h5"],
    {
      max: 2,
      now: () => NOW,
      read: async (h) => {
        reads.push(h);
        return { followers: 100 };
      },
    },
  );

  assert.deepEqual(reads, ["h1", "h2"], "fresh reads stop at the cap");
  assert.equal(map.size, 2);
  assert.equal(readCache().h3, undefined, "an unread handle must not be cached");
});

test("one failing handle is omitted and a dead handle is remembered for a day", async () => {
  clearCache();
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  const reads: string[] = [];
  const reader = async (h: string) => {
    reads.push(h);
    if (h === "private_one") throw new Error("account is private");
    return { followers: h === "ok_one" ? 5_000 : 7_000 };
  };

  const first = await resolveOwnerFollowers(["ok_one", "private_one", "ok_two"], {
    now: () => NOW,
    read: reader,
  });
  assert.equal(first.get("ok_one"), 5_000);
  assert.equal(first.get("ok_two"), 7_000);
  assert.equal(first.has("private_one"), false, "a failed handle yields no number");
  assert.equal(reads.length, 3, "one failure does not stop the others");
  assert.deepEqual(
    readCache().private_one,
    { followers: null, fetchedAt: iso(NOW) },
    "the dead handle is remembered, not retried on every search",
  );

  reads.length = 0;
  const second = await resolveOwnerFollowers(["ok_one", "private_one", "ok_two"], {
    now: () => NOW + HOUR,
    read: reader,
  });
  assert.equal(reads.length, 0, "nothing was re-read inside the cache windows");
  assert.equal(second.size, 2);
});

test("a negative cache entry expires after 24 hours", async () => {
  clearCache();
  writeCache({ maybe_back: { followers: null, fetchedAt: iso(NOW - 25 * HOUR) } });
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  let reads = 0;
  const map = await resolveOwnerFollowers(["maybe_back"], {
    now: () => NOW,
    read: async () => {
      reads += 1;
      return { followers: 42 };
    },
  });

  assert.equal(reads, 1, "a stale negative entry is retried");
  assert.equal(map.get("maybe_back"), 42);
});

test("an entry older than 7 days triggers a fresh read", async () => {
  clearCache();
  writeCache({ aging: { followers: 10, fetchedAt: iso(NOW - 8 * DAY) } });
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  let reads = 0;
  const map = await resolveOwnerFollowers(["aging"], {
    now: () => NOW,
    read: async () => {
      reads += 1;
      return { followers: 99 };
    },
  });

  assert.equal(reads, 1, "a week is the lifetime of a positive entry");
  assert.equal(map.get("aging"), 99);
  assert.deepEqual(readCache().aging, { followers: 99, fetchedAt: iso(NOW) });
});

test("a corrupt cache file is treated as empty and rewritten", async () => {
  clearCache();
  writeFileSync(CACHE, "{ this is not json", "utf8");
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  let reads = 0;
  const map = await resolveOwnerFollowers(["fresh_one"], {
    now: () => NOW,
    read: async () => {
      reads += 1;
      return { followers: 123 };
    },
  });

  assert.equal(reads, 1, "a broken cache must not stop the read");
  assert.equal(map.get("fresh_one"), 123);
  assert.deepEqual(readCache().fresh_one, { followers: 123, fetchedAt: iso(NOW) });
});

test("uppercase, @ prefix and duplicate handles normalise to one read", async () => {
  clearCache();
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  const reads: string[] = [];
  const map = await resolveOwnerFollowers(["@Same.Handle", "same.handle", "SAME.HANDLE"], {
    now: () => NOW,
    read: async (h) => {
      reads.push(h);
      return { followers: 321 };
    },
  });

  assert.deepEqual(reads, ["same.handle"], "one owner, one read");
  assert.deepEqual([...map.entries()], [["same.handle", 321]]);
});

test("OWNER_CACHE_HOURS widens or narrows the positive cache lifetime", async () => {
  clearCache();
  writeCache({ two_hours_old: { followers: 50, fetchedAt: iso(NOW - 2 * HOUR) } });
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  let reads = 0;
  const reader = async () => {
    reads += 1;
    return { followers: 51 };
  };

  process.env.OWNER_CACHE_HOURS = "1";
  const narrowed = await resolveOwnerFollowers(["two_hours_old"], {
    now: () => NOW,
    read: reader,
  });
  assert.equal(reads, 1, "outside a one-hour window the entry is stale");
  assert.equal(narrowed.get("two_hours_old"), 51);

  process.env.OWNER_CACHE_HOURS = "168";
  reads = 0;
  const widened = await resolveOwnerFollowers(["two_hours_old"], {
    now: () => NOW + 2 * HOUR,
    read: reader,
  });
  assert.equal(reads, 0, "inside a week the refreshed entry is trusted");
  assert.equal(widened.get("two_hours_old"), 51);
  delete process.env.OWNER_CACHE_HOURS;
});

test("a vendor-wide failure is not written as a dead handle", async () => {
  clearCache();
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  const reads: string[] = [];
  const map = await resolveOwnerFollowers(["a_real_account", "another_real_account"], {
    now: () => NOW,
    read: async (h) => {
      reads.push(h);
      throw Object.assign(new Error("credit budget reached"), { exhausted: true });
    },
  });

  assert.equal(map.size, 0);
  assert.equal(reads.length, 1, "an exhausted vendor stops the burst instead of trying the rest");
  assert.equal(
    readCacheSafe().a_real_account,
    undefined,
    "one empty wallet must not hide real accounts for 24 hours",
  );
});

test("a handle that returns no follower count is a negative entry, not a zero", async () => {  clearCache();
  const { resolveOwnerFollowers } = await import("../lib/ownerProfiles");

  let reads = 0;
  const map = await resolveOwnerFollowers(["no_size"], {
    now: () => NOW,
    read: async () => {
      reads += 1;
      return null;
    },
  });

  assert.equal(map.has("no_size"), false);
  assert.equal(reads, 1);
  assert.deepEqual(readCache().no_size, { followers: null, fetchedAt: iso(NOW) });
});

test("multiple is views divided by followers, and null when followers are unknown", async () => {
  const { multiple } = await import("../lib/ownerProfiles");

  const m = multiple(812_855, 57_739);
  assert.ok(m !== null);
  assert.ok(Math.abs(m! - 14.078) < 0.01, `expected about 14.08, got ${m}`);
  assert.equal(multiple(10, 0), null, "zero followers has no multiple");
  assert.equal(multiple(10, undefined), null, "an unknown size has no multiple");
  assert.equal(multiple(0, 100), 0);
});

test("intFromEnv rejects nonsense and floors fractions", async () => {
  const { intFromEnv } = await import("../lib/env");
  const name = "OWNER_TEST_INT";

  delete process.env[name];
  assert.equal(intFromEnv(name, 12), 12, "unset");
  process.env[name] = "";
  assert.equal(intFromEnv(name, 12), 12, "empty");
  process.env[name] = "abc";
  assert.equal(intFromEnv(name, 12), 12, "non-numeric");
  process.env[name] = "-3";
  assert.equal(intFromEnv(name, 12), 12, "negative");
  process.env[name] = "0";
  assert.equal(intFromEnv(name, 12), 12, "zero");
  process.env[name] = "12.9";
  assert.equal(intFromEnv(name, 12), 12, "fractional floors");
  process.env[name] = "20";
  assert.equal(intFromEnv(name, 12), 20, "configured");
  process.env[name] = "1e9";
  assert.equal(intFromEnv(name, 12, 100), 100, "clamped to the caller's ceiling");
  delete process.env[name];
});

test("a fresh niche search with 3 owner reads reports spend and attaches sizes", async () => {
  clearCache();
  rmSync(path.join(TMP, "niches"), { recursive: true, force: true });
  for (const key of ["APIFY_TOKEN", "SOCIALCRAWL_API_KEY", "SCRAPECREATORS_API_KEY", "YOUTUBE_WEB"]) {
    delete process.env[key];
  }
  process.env.HIKERAPI_KEY = "test-hiker";
  process.env.HIKERAPI_USD_PER_CALL = "0.02";
  process.env.OWNER_PROFILE_MAX = "3";
  process.env.CREDIT_BUDGET_USD = "100";
  process.env.NICHE_CACHE_HOURS = "12";

  const { resetCreditLedger } = await import("../lib/providers");
  resetCreditLedger();
  const { researchNiche } = await import("../lib/niche");

  const profileCalls: string[] = [];
  const { value, seen } = await withFetch(
    (url) => {
      if (url.includes("/sys/balance")) return response({ balance: 10_000 });
      if (url.includes("/v2/search/reels")) return response(handler("search_reels"));
      if (url.includes("/v2/user/by/username")) {
        profileCalls.push(url);
        return response(handler("user_by_username"));
      }
      throw new Error(`unexpected network call to ${url}`);
    },
    () => researchNiche({ query: "owner follower credit room", enrichMax: 0 }),
  );

  assert.equal(profileCalls.length, 3, "the per-niche cap is three in this run");
  assert.ok(
    seen.filter((u) => u.includes("/v2/search/reels")).length === 1,
    "the search itself is bought once",
  );
  assert.ok(
    value.credits.spent >= 4,
    `the three owner reads must be counted, got spent=${value.credits.spent}`,
  );
  assert.equal(value.credits.calls, 4, "one search plus three profile reads");
  assert.equal(value.cached, false);

  /**
   * Highest views first: the fixture's top three owners are
   * randomclicks.__ (1.98M), thanu_gowda_________ (1.50M) and cineworld.fx
   * (1.29M); the fourth, sukoon____404, is outside the cap.
   */
  const byHandle = new Map((value.payload ?? []).map((r) => [r.account, r.followers]));
  assert.equal(byHandle.get("randomclicks.__"), 57_739);
  assert.equal(byHandle.get("thanu_gowda_________"), 57_739);
  assert.equal(byHandle.get("cineworld.fx"), 57_739);
  assert.equal(byHandle.get("sukoon____404"), undefined, "unread owners carry no number");

  // A cache hit must not buy the owner profiles again.
  profileCalls.length = 0;
  const again = await researchNiche({ query: "owner follower credit room" });
  assert.equal(again.cached, true);
  assert.equal(again.credits.spent, 0);
  assert.equal(profileCalls.length, 0, "a cached niche never resolves owners again");
});
