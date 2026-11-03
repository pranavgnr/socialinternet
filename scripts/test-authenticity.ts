/**
 * The authenticity estimate, the follower sample that feeds it, and the cache
 * that keeps the sample from being bought twice.
 *
 * The estimate is a claim about people, so the tests pin the arithmetic: the
 * documented weights produce exact percentages, a sample below 40 says nothing
 * at all, the same rows always produce the same number, and private accounts are
 * not treated as evidence of anything. The sample is a paid call, so its test
 * proves one request per sample, the billed 4xx, and the router capability.
 *
 * No network: `withFetch` swaps `globalThis.fetch` for a stub.
 *
 *   sh scripts/run-test.sh test-authenticity
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_AVATAR_MARKER,
  authSamplePages,
  authenticityCachePath,
  estimateAuthenticity,
  isDefaultAvatar,
  readAuthenticity,
  resolveAuthenticity,
  saveAuthenticity,
  type FollowerSampleRow,
} from "../lib/authenticity";
import { hikerapi } from "../lib/providers/hikerapi";
import { NoDataVendor, request, resetCreditLedger, creditLedger } from "../lib/providers";

const ROOT = process.cwd();
const TMP = mkdtempSync(path.join(os.tmpdir(), "reel-engine-authenticity-"));
process.env.CREATORS_DATA_DIR = TMP;

const FIXTURES = path.join(ROOT, "lib/providers/__fixtures__/hikerapi");

const ENV_KEYS = [
  "CREATORS_DATA_DIR",
  "HIKERAPI_KEY",
  "HIKERAPI_USD_PER_CALL",
  "DATA_PROVIDER",
  "APIFY_TOKEN",
  "SOCIALCRAWL_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "YOUTUBE_WEB",
  "CREDIT_BUDGET_USD",
  "CREDIT_BUDGET",
  "AUTH_SAMPLE_PAGES",
  "AUTH_CACHE_HOURS",
  "GEMINI_API_KEY",
] as const;

const ENV_SNAPSHOT = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
) as Record<string, string | undefined>;

async function withEnv<T>(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      const v = ENV_SNAPSHOT[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withFetch<T>(
  handler: (url: string) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<{ result: T; seen: string[] }> {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    return handler(url);
  }) as typeof fetch;
  try {
    return { result: await fn(), seen };
  } finally {
    globalThis.fetch = real;
  }
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* ---------------------------------------------------------------- rows */

/** A follower who looks like a person: a name, a real photo, a read username. */
function cleanRow(i: number): FollowerSampleRow {
  return {
    username: `person_${i}`,
    full_name: `Person ${i}`,
    is_private: false,
    profile_pic_url: `https://scontent.cdninstagram.com/v/t51/photo-${i}_n.jpg`,
  };
}

/** Six trailing digits and a >0.5 digit share — the classic made-up handle. */
function numericRow(i: number): FollowerSampleRow {
  return { ...cleanRow(i), username: `user${String(100000 + i)}` };
}

/** A legal-looking handle with no name at all. */
function noNameRow(i: number): FollowerSampleRow {
  return { ...cleanRow(i), full_name: "" };
}

/** The same placeholder image Instagram serves to unrelated accounts. */
function defaultAvatarRow(i: number): FollowerSampleRow {
  return {
    ...cleanRow(i),
    profile_pic_url: `https://instagram.feze2-1.fna.fbcdn.net/v/t51.2885-19/${DEFAULT_AVATAR_MARKER}_n.png`,
  };
}

function rows(n: number, make: (i: number) => FollowerSampleRow): FollowerSampleRow[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

/* ----------------------------------------------------------- estimate */

test("no estimate is offered below 40 sampled followers", () => {
  assert.equal(estimateAuthenticity([]), null);
  assert.equal(estimateAuthenticity(rows(1, cleanRow)), null);
  assert.equal(estimateAuthenticity(rows(39, cleanRow)), null);
  assert.ok(estimateAuthenticity(rows(40, cleanRow)), "40 is enough");
});

test("confidence follows the sample size bands", () => {
  const at = (n: number) => estimateAuthenticity(rows(n, cleanRow));
  assert.equal(at(40)?.confidence, "low");
  assert.equal(at(79)?.confidence, "low");
  assert.equal(at(80)?.confidence, "medium");
  assert.equal(at(199)?.confidence, "medium");
  assert.equal(at(200)?.confidence, "high");
  assert.equal(at(400)?.confidence, "high");
});

test("a clean sample is 100% real and a hostile one is 0%", () => {
  assert.equal(estimateAuthenticity(rows(60, cleanRow))?.realPct, 100);
  assert.equal(estimateAuthenticity(rows(60, numericRow))?.realPct, 0);
});

test("the documented weights produce an exact mixed percentage", () => {
  /**
   * 40 rows: 8 make-believe handles (weight 1 each), 8 with no name (0.5 each),
   * 8 on the placeholder avatar (0.5 each), 16 clean. The mean suspicion is
   * (8 + 4 + 4) / 40 = 0.4, so 60% reads as real.
   */
  const sample: FollowerSampleRow[] = [
    ...rows(8, numericRow),
    ...rows(8, noNameRow),
    ...rows(8, defaultAvatarRow),
    ...rows(16, (i) => cleanRow(100 + i)),
  ];
  assert.deepEqual(estimateAuthenticity(sample), {
    realPct: 60,
    sample: 40,
    confidence: "low",
  });
});

test("the estimate is deterministic, even when the rows are reordered", () => {
  const sample: FollowerSampleRow[] = [
    ...rows(10, numericRow),
    ...rows(10, noNameRow),
    ...rows(20, (i) => cleanRow(50 + i)),
  ];
  const first = estimateAuthenticity(sample);
  assert.deepEqual(estimateAuthenticity(sample), first);
  assert.deepEqual(estimateAuthenticity([...sample].reverse()), first);
});

test("private accounts are not penalised by themselves", () => {
  const sample = rows(60, (i) => ({ ...cleanRow(i), is_private: true }));
  assert.equal(estimateAuthenticity(sample)?.realPct, 100);
});

test("the placeholder avatar is the stable image id recorded in the fixture", () => {
  const fixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "followers_chunk.json"), "utf8"),
  ) as { profile_pic_url?: string }[][];

  const counts = new Map<string, number>();
  for (const row of fixture[0] ?? []) {
    const url = row.profile_pic_url;
    if (url) counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  assert.ok(repeated, "the fixture carries profile pictures");
  assert.ok(repeated[1] >= 3, "the placeholder is shared by several accounts");
  assert.equal(isDefaultAvatar(repeated[0]), true);
  assert.match(repeated[0], new RegExp(DEFAULT_AVATAR_MARKER));
  assert.equal(
    isDefaultAvatar("https://scontent.cdninstagram.com/v/t51/real-photo_n.jpg"),
    false,
  );
});

test("a missing picture is not evidence of a fake account", () => {
  // The payload carries a URL in the recorded sample; when it does not, the
  // rule stays quiet rather than treating "not reported" as "no picture".
  const sample = rows(60, (i) => ({ ...cleanRow(i), profile_pic_url: undefined }));
  assert.equal(estimateAuthenticity(sample)?.realPct, 100);
  const flagged = rows(60, (i) => ({ ...cleanRow(i), has_profile_pic: false }));
  assert.equal(estimateAuthenticity(flagged)?.realPct, 100);
});

test("realPct is an integer and never leaves 0..100", () => {
  const sample = [
    ...rows(20, numericRow),
    ...rows(21, noNameRow),
    ...rows(21, (i) => cleanRow(77 + i)),
  ];
  const estimate = estimateAuthenticity(sample);
  assert.ok(estimate);
  assert.equal(Number.isInteger(estimate.realPct), true);
  assert.ok(estimate.realPct >= 0 && estimate.realPct <= 100);
  assert.equal(estimate.sample, 62);
});

/* -------------------------------------------------------------- sample */

test("followersSample reads the recorded chunk and bills one call", async () => {
  await withEnv(
    { HIKERAPI_KEY: "test-key", HIKERAPI_USD_PER_CALL: "0.02" },
    async () => {
      const fixture = JSON.parse(
        readFileSync(path.join(FIXTURES, "followers_chunk.json"), "utf8"),
      ) as unknown;
      const { result, seen } = await withFetch(
        () => respond(fixture),
        () => hikerapi.followersSample("32334432364", 4),
      );

      assert.equal(seen.length, 1, "the recorded response carries no cursor, so one page");
      assert.match(seen[0] ?? "", /\/v1\/user\/followers\/chunk\?user_id=32334432364/);

      const data = result.data as {
        followers: FollowerSampleRow[];
        pagesRead: number;
      };
      assert.equal(data.pagesRead, 1);
      assert.equal(data.followers.length, 12, "the sanitised fixture holds 12 rows");
      assert.deepEqual(data.followers[0], {
        username: "vedaa._7",
        full_name: "Vedasri",
        is_private: true,
        is_verified: false,
        profile_pic_url:
          "https://scontent-dfw5-1.cdninstagram.com/v/t51.82787-19/754587368_18331712227258481_198935214292165251_n.jpg",
      });
      assert.equal(result.usd, 0.02);
      assert.equal(result.units, 1);
    },
  );
});

test("a billed 4xx keeps its money on the error and never retries", async () => {
  await withEnv(
    { HIKERAPI_KEY: "test-key", HIKERAPI_USD_PER_CALL: "0.02" },
    async () => {
      const { seen } = await withFetch(
        () => respond({ detail: "Not found" }, 404),
        async () => {
          await assert.rejects(
            () => hikerapi.followersSample("32334432364", 4),
            (err: unknown) => {
              assert.ok(err instanceof Error);
              const e = err as { name?: string; billedUsd?: number };
              assert.equal(e.name, "ProviderUnavailable");
              assert.equal(e.billedUsd, 0.02, "a 404 is billed");
              return true;
            },
          );
          return null;
        },
      );
      assert.equal(seen.length, 1, "a 4xx is never retried");
    },
  );
});

test("a non-numeric user id is refused before any call is made", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { seen } = await withFetch(
      () => respond({}),
      async () => {
        await assert.rejects(
          () => hikerapi.followersSample("../../etc/passwd", 4),
          /user id/i,
        );
        return null;
      },
    );
    assert.equal(seen.length, 0);
  });
});

test("pages reads the cap from the environment and sanitises it", async () => {
  await withEnv({ AUTH_SAMPLE_PAGES: undefined }, async () => {
    assert.equal(authSamplePages(), 4);
  });
  await withEnv({ AUTH_SAMPLE_PAGES: "2" }, async () => {
    assert.equal(authSamplePages(), 2);
  });
  await withEnv({ AUTH_SAMPLE_PAGES: "0" }, async () => {
    assert.equal(authSamplePages(), 4);
  });
  await withEnv({ AUTH_SAMPLE_PAGES: "banana" }, async () => {
    assert.equal(authSamplePages(), 4);
  });
  await withEnv({ AUTH_SAMPLE_PAGES: "1000" }, async () => {
    assert.ok(authSamplePages() <= 20, "the cap is bounded");
  });
});

test("the sample is a router capability: HikerAPI serves it, nothing else pretends to", async () => {
  await withEnv(
    {
      HIKERAPI_KEY: "test-key",
      HIKERAPI_USD_PER_CALL: "0.02",
      APIFY_TOKEN: undefined,
      SOCIALCRAWL_API_KEY: undefined,
      SCRAPECREATORS_API_KEY: undefined,
      DATA_PROVIDER: undefined,
      CREDIT_BUDGET_USD: "100",
    },
    async () => {
      resetCreditLedger();
      const fixture = JSON.parse(
        readFileSync(path.join(FIXTURES, "followers_chunk.json"), "utf8"),
      ) as unknown;
      const { result } = await withFetch(
        () => respond(fixture),
        () =>
          request({
            path: "/instagram/followers/sample",
            userId: "32334432364",
            pages: "1",
            platform: "instagram",
          }),
      );
      const data = result.data as { followers: FollowerSampleRow[] };
      assert.equal(data.followers.length, 12);
      assert.equal(result.provider, "hikerapi");
      assert.equal(creditLedger().lifetimeUsd, 0.02);
    },
  );
});

test("with no capable vendor the router refuses honestly", async () => {
  await withEnv(
    {
      HIKERAPI_KEY: undefined,
      APIFY_TOKEN: "test-apify",
      SOCIALCRAWL_API_KEY: undefined,
      SCRAPECREATORS_API_KEY: undefined,
      YOUTUBE_WEB: "0",
      DATA_PROVIDER: undefined,
    },
    async () => {
      const { seen } = await withFetch(
        () => respond({}),
        async () => {
          await assert.rejects(
            () =>
              request({
                path: "/instagram/followers/sample",
                userId: "32334432364",
                pages: "1",
                platform: "instagram",
              }),
            (err: unknown) => {
              assert.ok(err instanceof NoDataVendor);
              assert.match((err as Error).message, /follower/i);
              return true;
            },
          );
          return null;
        },
      );
      assert.equal(seen.length, 0);
    },
  );
});

/* --------------------------------------------------------------- cache */

test("the cache lives beside the other data and expires after seven days", async () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  const estimate = { realPct: 71, sample: 60, confidence: "medium" as const };

  await saveAuthenticity("Fixtures_Handle", estimate, now);
  assert.ok(authenticityCachePath().startsWith(TMP));
  assert.ok(authenticityCachePath().endsWith("authenticity.json"));

  assert.deepEqual(await readAuthenticity("fixtures_handle", now + 6 * 864e5), estimate);
  assert.equal(await readAuthenticity("fixtures_handle", now + 8 * 864e5), null);
  assert.equal(await readAuthenticity("someone_else", now), null);

  const raw = readFileSync(authenticityCachePath(), "utf8");
  assert.ok(JSON.parse(raw), "the file is valid JSON");
  assert.deepEqual(
    readdirSync(TMP).filter((f) => f.endsWith(".tmp")),
    [],
    "no temp file is left behind",
  );
});

test("a hostile handle is just a key, never a prototype", async () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  const estimate = { realPct: 50, sample: 40, confidence: "low" as const };

  await saveAuthenticity("__proto__", estimate, now);
  await saveAuthenticity("constructor", { ...estimate, realPct: 42 }, now);

  assert.deepEqual(await readAuthenticity("__proto__", now), estimate);
  assert.deepEqual(await readAuthenticity("constructor", now), {
    ...estimate,
    realPct: 42,
  });
  assert.equal(({} as Record<string, unknown>).realPct, undefined);
});

test("a corrupt cache reads as empty, never as a crash", async () => {
  writeFileSync(authenticityCachePath(), "{ not json");
  assert.equal(await readAuthenticity("anyone", Date.now()), null);
});

/* ----------------------------------------------------------- resolution */

test("the estimate is not bought for a small or private account", async () => {
  let sampled = 0;
  const deps = {
    sample: async () => {
      sampled += 1;
      return rows(60, cleanRow);
    },
    account: async () => ({ pk: "42", isPrivate: false }),
  };

  const small = await resolveAuthenticity(
    "small_account",
    { followers: 999 },
    deps,
  );
  assert.equal(small, null);

  const privateAccount = await resolveAuthenticity(
    "private_account",
    { followers: 5000, isPrivate: true },
    deps,
  );
  assert.equal(privateAccount, null);
  assert.equal(sampled, 0, "no paid sample for an account we will not estimate");
});

test("a cached estimate costs no sample", async () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  await saveAuthenticity(
    "cached_account",
    { realPct: 88, sample: 60, confidence: "low" },
    now,
  );
  let sampled = 0;
  const estimate = await resolveAuthenticity(
    "cached_account",
    { followers: 5000 },
    {
      now: () => now + 864e5,
      account: async () => ({ pk: "42", isPrivate: false }),
      sample: async () => {
        sampled += 1;
        return rows(60, cleanRow);
      },
    },
  );
  assert.equal(estimate?.realPct, 88);
  assert.equal(sampled, 0);
});

test("a successful sample is estimated and cached", async () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  let sampledWith: { userId: string; pages: number } | null = null;
  const estimate = await resolveAuthenticity(
    "readable_account",
    { followers: 5000 },
    {
      now: () => now,
      pages: 3,
      account: async () => ({ pk: "32334432364", isPrivate: false }),
      sample: async (userId, pages) => {
        sampledWith = { userId, pages };
        return rows(60, cleanRow);
      },
    },
  );
  assert.deepEqual(estimate, { realPct: 100, sample: 60, confidence: "low" });
  assert.deepEqual(sampledWith, { userId: "32334432364", pages: 3 });
  assert.deepEqual(await readAuthenticity("readable_account", now), estimate);
});

test("a sample too small to estimate is not cached as a result", async () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  const estimate = await resolveAuthenticity(
    "only_25",
    { followers: 5000 },
    {
      now: () => now,
      account: async () => ({ pk: "42", isPrivate: false }),
      sample: async () => rows(25, cleanRow),
    },
  );
  assert.equal(estimate, null);
  assert.equal(await readAuthenticity("only_25", now), null);
});

test("a failed sample or an unknown id never fails the caller", async () => {
  const boom = await resolveAuthenticity(
    "vendor_down",
    { followers: 5000 },
    {
      account: async () => ({ pk: "42", isPrivate: false }),
      sample: async () => {
        throw new Error("vendor died");
      },
    },
  );
  assert.equal(boom, null);

  const noPk = await resolveAuthenticity(
    "no_pk",
    { followers: 5000 },
    {
      account: async () => ({}),
      sample: async () => rows(60, cleanRow),
    },
  );
  assert.equal(noPk, null);

  const noAccount = await resolveAuthenticity(
    "account_unreadable",
    { followers: 5000 },
    {
      account: async () => {
        throw new Error("404");
      },
      sample: async () => rows(60, cleanRow),
    },
  );
  assert.equal(noAccount, null);
});

test("a known pk and a known public flag skip the account lookup", async () => {
  let lookups = 0;
  const estimate = await resolveAuthenticity(
    "pk_known",
    { followers: 5000, pk: "99", isPrivate: false },
    {
      account: async () => {
        lookups += 1;
        return {};
      },
      sample: async (userId) => {
        assert.equal(userId, "99");
        return rows(40, cleanRow);
      },
    },
  );
  assert.equal(estimate?.sample, 40);
  assert.equal(lookups, 0);
});

test.after(() => {
  rmSync(TMP, { recursive: true, force: true });
});
