/**
 * HikerAPI adapter against recorded live responses.
 *
 * Every payload this test reads came from a real HikerAPI call on 2026-11-03
 * (see `scripts/capture-hikerapi-fixtures.mjs`). The adapter had never been
 * exercised against a live key, so these fixtures are the contract: if the
 * adapter drifts from the shapes below, a paid pull would silently map the
 * wrong fields and the plan would show zeros.
 *
 * No network: `withFetch` swaps `globalThis.fetch` for a stub that serves the
 * fixtures, and every test asserts the endpoint it asked for.
 *
 *   sh scripts/run-test.sh test-hikerapi
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { pkFromShortcode } from "../lib/instagramId";
import { ProviderUnavailable } from "../lib/providers/types";

const FIXTURES = path.join(
  process.cwd(),
  "lib/providers/__fixtures__/hikerapi",
);

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as Json;
}

/** A deep copy, so a test can mutate one row without touching the others. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Swap global fetch for a stub and hand back the URLs it saw.
 *
 * The adapter deliberately keeps its public signatures (`profileReels(handle)`,
 * …), so the injected fetch is the seam: nothing in the tests can reach the
 * network.
 */
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

/** Run with a throwaway key and (optionally) comments enabled. */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [
    "HIKERAPI_KEY",
    "HIKERAPI_COMMENTS",
    "HIKERAPI_USD_PER_CALL",
    "SCRAPECREATORS_API_KEY",
    "SCRAPECREATORS_USD_PER_CALL",
    "APIFY_TOKEN",
    "SOCIALCRAWL_API_KEY",
    "DATA_PROVIDER",
    "CREDIT_BUDGET_USD",
    "YOUTUBE_WEB",
  ] as const;
  const snap = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (snap[k] === undefined) delete process.env[k];
      else process.env[k] = snap[k];
    }
  }
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

function rowsOf(result: { data: Record<string, unknown> }): Json[] {
  return (result.data.items ?? []) as Json[];
}

function postOf(row: Json): Json {
  return (row.post ?? {}) as Json;
}

function engagementOf(row: Json): Json {
  return (postOf(row).engagement ?? {}) as Json;
}

function contentOf(row: Json): Json {
  return (postOf(row).content ?? {}) as Json;
}

/** The first reel in `user_clips.json`, the row every profile assertion uses. */
function firstClipMedia(): Json {
  const clips = fixture("user_clips");
  const response = clips.response as Json;
  const items = response.items as Json[];
  return (items[0].media ?? {}) as Json;
}

test("profileReels reads /v2/user/clips and maps every field the harvester uses", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key", HIKERAPI_USD_PER_CALL: undefined }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result, seen } = await withFetch(
      (url) => {
        if (pathOf(url) === "/v2/user/by/username") return respond(fixture("user_by_username"));
        if (pathOf(url) === "/v2/user/clips") return respond(fixture("user_clips"));
        throw new Error(`unexpected request: ${url}`);
      },
      () => hikerapi.profileReels("_shravyapawar_"),
    );

    assert.deepEqual(seen.map(pathOf), ["/v2/user/by/username", "/v2/user/clips"]);
    assert.equal(new URL(seen[0]).searchParams.get("username"), "_shravyapawar_");
    assert.equal(new URL(seen[1]).searchParams.get("user_id"), "32334432364");

    const rows = rowsOf(result);
    assert.equal(rows.length, 12);
    for (const row of rows) {
      assert.equal(row.platform, "instagram");
    }

    const media = firstClipMedia();
    const row = rows[0];
    assert.equal(engagementOf(row).views, media.play_count);
    assert.equal(engagementOf(row).shares, media.reshare_count);
    assert.equal(engagementOf(row).likes, media.like_count);
    assert.equal(engagementOf(row).comments, media.comment_count);
    assert.equal(postOf(row).id, media.code);
    assert.equal(postOf(row).url, `https://www.instagram.com/reel/${String(media.code)}/`);
    assert.equal(contentOf(row).duration_seconds, media.video_duration);

    const videoVersions = media.video_versions as Json[];
    assert.equal((contentOf(row).media_urls as string[])[0], videoVersions[0].url);

    // The profile call, not the reel payload (where follower_count is null),
    // is where the real follower count comes from.
    const author = postOf(row).author as Json;
    assert.equal(author.username, "_shravyapawar_");
    assert.equal(author.followers, 57739);

    assert.equal(result.units, 2);
    assert.equal(result.usd, 0.04);
  });
});

test("profileReels returns what exists when a creator has fewer than 12 reels", async () => {
  const short = clone(fixture("user_clips"));
  const response = short.response as Json;
  response.items = (response.items as Json[]).slice(0, 5);

  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result } = await withFetch(
      (url) => {
        if (pathOf(url) === "/v2/user/by/username") return respond(fixture("user_by_username"));
        if (pathOf(url) === "/v2/user/clips") return respond(short);
        throw new Error(`unexpected request: ${url}`);
      },
      () => hikerapi.profileReels("_shravyapawar_"),
    );
    assert.equal(rowsOf(result).length, 5);
  });
});

test("profileReels falls back to the media tab, filtered to clips, when the clips tab is empty", async () => {
  const clip = clone(firstClipMedia());
  const photo = clone(firstClipMedia());
  photo.product_type = "feed";
  photo.code = "PHOTO123";

  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result, seen } = await withFetch(
      (url) => {
        const pathname = pathOf(url);
        if (pathname === "/v2/user/by/username") return respond(fixture("user_by_username"));
        if (pathname === "/v2/user/clips") {
          return respond({ response: { items: [], paging_info: { more_available: false } } });
        }
        if (pathname === "/v2/user/medias") {
          return respond({ response: { items: [{ media: clip }, { media: photo }] } });
        }
        throw new Error(`unexpected request: ${url}`);
      },
      () => hikerapi.profileReels("_shravyapawar_"),
    );

    assert.deepEqual(seen.map(pathOf), [
      "/v2/user/by/username",
      "/v2/user/clips",
      "/v2/user/medias",
    ]);
    assert.equal(rowsOf(result).length, 1);
    assert.equal(postOf(rowsOf(result)[0]).id, clip.code);
    assert.equal(result.units, 3);
  });
});

test("searchReels calls /v2/search/reels with the phrase unmodified", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result, seen } = await withFetch(
      (url) => {
        const u = new URL(url);
        assert.equal(u.pathname, "/v2/search/reels");
        assert.equal(u.searchParams.get("query"), "kannada songs");
        return respond(fixture("search_reels"));
      },
      () => hikerapi.searchReels("kannada songs"),
    );

    assert.equal(seen.length, 1, "a working search must not fall back to hashtags");
    const rows = rowsOf(result);
    assert.equal(rows.length, 12);
    assert.equal(rows[0].platform, "instagram");
    assert.equal(result.units, 1);
    assert.equal(result.usd, 0.02);
  });
});

test("searchReels keeps non-Latin phrases as typed and never turns them into a tag first", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { seen } = await withFetch(
      (url) => {
        assert.equal(pathOf(url), "/v2/search/reels");
        assert.equal(new URL(url).searchParams.get("query"), "कन्नड़ गाने");
        return respond({ reels_serp_modules: [], has_more: false, page_index: 0 });
      },
      () => hikerapi.searchReels("कन्नड़ गाने"),
    );
    assert.equal(seen.length, 1, "an empty search must not throw for having no Latin characters");
  });
});

test("searchReels drops anything that is not a clip", async () => {
  const mixed = clone(fixture("search_reels"));
  const modules = mixed.reels_serp_modules as Json[];
  const clips = modules[0].clips as Json[];
  (clips[0].media as Json).product_type = "video";

  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result } = await withFetch(
      () => respond(mixed),
      () => hikerapi.searchReels("kannada songs"),
    );
    assert.equal(rowsOf(result).length, 11);
    assert.ok(
      rowsOf(result).every((r) => postOf(r).id !== (clips[0].media as Json).code),
    );
  });
});

test("a reel with no play_count is zero-safe, not NaN or ig_play_count", async () => {
  const mixed = clone(fixture("search_reels"));
  const modules = mixed.reels_serp_modules as Json[];
  const clips = modules[0].clips as Json[];
  const media = clips[0].media as Json;
  const code = media.code;
  // `ig_play_count` is still present on the live row: play_count is the field
  // the product reads, and a missing one must read as "no views known" (0).
  delete media.play_count;

  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result } = await withFetch(
      () => respond(mixed),
      () => hikerapi.searchReels("kannada songs"),
    );
    const row = rowsOf(result).find((r) => postOf(r).id === code);
    assert.ok(row, "the zero-view reel must still be returned");
    assert.equal(engagementOf(row).views, 0);
  });
});

test("view_count is not a views fallback: no play_count means views 0", async () => {
  const mixed = clone(fixture("search_reels"));
  const modules = mixed.reels_serp_modules as Json[];
  const media = (modules[0].clips as Json[])[0].media as Json;
  const code = media.code;
  delete media.play_count;
  media.view_count = 999;
  media.ig_play_count = 888;

  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result } = await withFetch(
      () => respond(mixed),
      () => hikerapi.searchReels("kannada songs"),
    );
    const row = rowsOf(result).find((r) => postOf(r).id === code);
    assert.ok(row);
    assert.equal(
      engagementOf(row).views,
      0,
      "views must come from play_count only, even when view_count exists",
    );
  });
});

test("a transient 500 (InstagramServerError) is retried once", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi, setRetrySleepForTests } = await import(
      "../lib/providers/hikerapi"
    );
    const sleeps: number[] = [];
    setRetrySleepForTests(async (ms) => {
      sleeps.push(ms);
    });
    try {
      let usernameCalls = 0;
      const { result, seen } = await withFetch(
        (url) => {
          if (pathOf(url) === "/v2/user/by/username") {
            usernameCalls += 1;
            if (usernameCalls === 1) {
              return respond(
                { detail: "Instagram did not respond", exc_type: "InstagramServerError" },
                500,
              );
            }
            return respond(fixture("user_by_username"));
          }
          if (pathOf(url) === "/v2/user/clips") return respond(fixture("user_clips"));
          throw new Error(`unexpected request: ${url}`);
        },
        () => hikerapi.profileReels("_shravyapawar_"),
      );
      assert.equal(usernameCalls, 2, "the 500 must be retried exactly once");
      assert.deepEqual(sleeps, [800], "the retry pauses 800 ms once");
      assert.equal(seen.length, 3);
      assert.equal(rowsOf(result).length, 12);
    } finally {
      setRetrySleepForTests();
    }
  });
});

test("a second 500 throws ProviderUnavailable with exhausted: false", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi, setRetrySleepForTests } = await import(
      "../lib/providers/hikerapi"
    );
    setRetrySleepForTests(async () => {});
    try {
      let calls = 0;
      const { seen } = await withFetch(
        () => {
          calls += 1;
          return respond(
            { detail: "Instagram did not respond", exc_type: "InstagramServerError" },
            500,
          );
        },
        async () => {
          await assert.rejects(
            () => hikerapi.profileReels("_shravyapawar_"),
            (err: unknown) => {
              assert.ok(err instanceof ProviderUnavailable);
              assert.equal(err.exhausted, false);
              assert.equal(err.billedUsd, undefined, "a 5xx is not billable");
              return true;
            },
          );
        },
      );
      assert.equal(calls, 2, "one retry, then an honest failure");
      assert.equal(seen.length, 2);
    } finally {
      setRetrySleepForTests();
    }
  });
});

test("a 422 is never retried", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    let calls = 0;
    await withFetch(
      () => {
        calls += 1;
        return respond({ detail: "Unprocessable Entity", exc_type: "ValidationError" }, 422);
      },
      async () => {
        await assert.rejects(
          () => hikerapi.profileReels("_shravyapawar_"),
          (err: unknown) => {
            assert.ok(err instanceof ProviderUnavailable);
            assert.equal(err.exhausted, false);
            assert.equal(err.billedUsd, undefined, "a 422 validation error is not billable");
            return true;
          },
        );
      },
    );
    assert.equal(calls, 1, "4xx must never be retried");
  });
});

test("a 404 names the handle, is not retried and is not 'exhausted'", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    let calls = 0;
    await withFetch(
      () => {
        calls += 1;
        return respond({ detail: "Not found", exc_type: "NotFoundException" }, 404);
      },
      async () => {
        await assert.rejects(
          () => hikerapi.profileReels("kusha.kapila"),
          (err: unknown) => {
            assert.ok(err instanceof ProviderUnavailable);
            assert.equal(err.exhausted, false);
            assert.match(err.message, /kusha\.kapila/);
            assert.equal(err.billedUsd, 0.02, "HikerAPI bills a 404");
            return true;
          },
        );
      },
    );
    assert.equal(calls, 1, "4xx must never be retried");
  });
});

test("402 and 403 mark the vendor exhausted", async () => {
  for (const status of [402, 403]) {
    await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
      const { hikerapi } = await import("../lib/providers/hikerapi");
      let calls = 0;
      await withFetch(
        () => {
          calls += 1;
          return respond({ detail: "not enough credits", exc_type: "PaymentRequired" }, status);
        },
        async () => {
          await assert.rejects(
            () => hikerapi.profileReels("_shravyapawar_"),
            (err: unknown) => {
              assert.ok(err instanceof ProviderUnavailable);
              assert.equal(err.exhausted, true, `HTTP ${status} means the balance is gone`);
              assert.equal(
                err.billedUsd,
                status === 403 ? 0.02 : undefined,
                status === 403 ? "HikerAPI bills a 403" : "a 402 payment wall is not a billed response",
              );
              return true;
            },
          );
        },
      );
      assert.equal(calls, 1, "402/403 must never be retried");
    });
  }
});

test("a 400 sets billedUsd (HikerAPI bills it)", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key", HIKERAPI_USD_PER_CALL: undefined }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    await withFetch(
      () => respond({ detail: "bad request" }, 400),
      async () => {
        await assert.rejects(
          () => hikerapi.profile("someone"),
          (err: unknown) => {
            assert.ok(err instanceof ProviderUnavailable);
            assert.equal(err.billedUsd, 0.02, "HikerAPI bills a 400");
            return true;
          },
        );
      },
    );
  });
});

test("a billed 404 fails over and both calls reach the ledger", async () => {
  await withEnv(
    {
      HIKERAPI_KEY: "test-key",
      HIKERAPI_USD_PER_CALL: "0.02",
      SCRAPECREATORS_API_KEY: "test-scrapecreators",
      SCRAPECREATORS_USD_PER_CALL: "0.00188",
      APIFY_TOKEN: undefined,
      SOCIALCRAWL_API_KEY: undefined,
      DATA_PROVIDER: undefined,
      CREDIT_BUDGET_USD: "100",
    },
    async () => {
      const { resetCreditLedger, creditLedger, request } = await import(
        "../lib/providers"
      );
      resetCreditLedger();

      const { result } = await withFetch(
        (url) => {
          if (pathOf(url) === "/v2/user/by/username") {
            return respond({ detail: "Not found", exc_type: "NotFoundException" }, 404);
          }
          if (
            url.includes("api.scrapecreators.com") &&
            pathOf(url) === "/v1/instagram/profile"
          ) {
            return respond({
              success: true,
              credits_charged: 1,
              credits_remaining: 100,
              data: {
                user: { username: "someone", edge_followed_by: { count: 1234 } },
              },
            });
          }
          throw new Error(`unexpected request: ${url}`);
        },
        () =>
          request({
            path: "/instagram/profile",
            handle: "someone",
            platform: "instagram",
          }),
      );

      assert.equal(result.provider, "scrapecreators", "the second vendor answered");
      const user = ((result.data as Json).user ?? {}) as Json;
      assert.equal(user.followers, 1234);

      const ledger = creditLedger();
      assert.equal(ledger.calls, 2, "the billed failure and the success both count");
      assert.equal(ledger.spent, 2, "one unit per billed call");
      assert.equal(ledger.lifetimeSpent >= 2, true);
      assert.equal(ledger.byVendor.hikerapi, 1, "the failed vendor is not invisible");
      assert.equal(ledger.byVendor.scrapecreators, 1);
      assert.ok(
        Math.abs(ledger.usd - (0.02 + 0.00188)) < 1e-9,
        `expected the summed usd, got ${ledger.usd}`,
      );
    },
  );
});

test("a 5xx adds nothing to the ledger", async () => {
  await withEnv(
    {
      HIKERAPI_KEY: "test-key",
      SCRAPECREATORS_API_KEY: undefined,
      APIFY_TOKEN: undefined,
      SOCIALCRAWL_API_KEY: undefined,
      DATA_PROVIDER: undefined,
      CREDIT_BUDGET_USD: "100",
    },
    async () => {
      const { resetCreditLedger, creditLedger, request } = await import(
        "../lib/providers"
      );
      const { setRetrySleepForTests } = await import("../lib/providers/hikerapi");
      resetCreditLedger();
      setRetrySleepForTests(async () => {});
      try {
        await assert.rejects(
          () =>
            withFetch(
              () =>
                respond(
                  { detail: "Instagram did not respond", exc_type: "InstagramServerError" },
                  500,
                ),
              () =>
                request({
                  path: "/instagram/profile",
                  handle: "someone",
                  platform: "instagram",
                }),
            ),
          (err: unknown) => err instanceof Error,
        );
      } finally {
        setRetrySleepForTests();
      }

      const ledger = creditLedger();
      assert.equal(ledger.calls, 0, "an unbilled failure is not a call");
      assert.equal(ledger.spent, 0);
      assert.equal(ledger.usd, 0);
    },
  );
});

test("post reads comments from /v2/media/comments?id= into post.ext.top_comments by default", async () => {
  const media = clone(firstClipMedia());
  const comments = fixture("comments");

  await withEnv(
    { HIKERAPI_KEY: "test-key" },
    async () => {
      const { hikerapi } = await import("../lib/providers/hikerapi");
      const { result, seen } = await withFetch(
        (url) => {
          const u = new URL(url);
          if (u.pathname === "/v2/media/info/by/code") {
            assert.equal(u.searchParams.get("code"), "DQBw9CVk7C4");
            return respond({ status: "ok", media });
          }
          if (u.pathname === "/v2/media/comments") {
            // Verified live: the parameter is `id`, and it is the media id
            // (`<pk>_<owner>`), not the shortcode. `media_id` is a 422.
            assert.equal(u.searchParams.get("id"), media.id);
            return respond(comments);
          }
          throw new Error(`unexpected request: ${url}`);
        },
        () => hikerapi.post("https://www.instagram.com/reel/DQBw9CVk7C4/"),
      );

      assert.deepEqual(seen.map(pathOf), [
        "/v2/media/info/by/code",
        "/v2/media/comments",
      ]);

      const post = postOf(result.data as Json);
      const ext = (post.ext ?? {}) as { top_comments?: Json[] };
      assert.equal(ext.top_comments?.length, 12);

      const first = ext.top_comments?.[0] ?? {};
      assert.equal(first.text, "Chords : Em C G D");
      assert.equal(first.likes, 875);
      assert.equal(first.author, "_shravyapawar_");
      assert.equal(first.published_at, 1761149436);
      assert.equal(result.units, 2);
      assert.equal(result.usd, 0.04);
    },
  );
});

test("pkFromShortcode recovers the exact pk from every live clip shortcode", () => {
  const clips = fixture("user_clips");
  const items = (clips.response as Json).items as Json[];

  assert.equal(items.length, 12, "the fixture must carry all twelve live clips");
  for (const item of items) {
    const media = item.media as Json;
    const code = String(media.code);
    const id = String(media.id);
    assert.equal(
      pkFromShortcode(code),
      id.split("_")[0],
      `shortcode ${code} must decode to the pk in ${id}`,
    );
  }

  // A pasted slash and surrounding space are tolerated; an invalid character
  // is not, because a wrong id would buy a 422 instead of comments.
  assert.equal(pkFromShortcode(" /DQBw9CVk7C4/ "), "3747491665579061432");
  assert.throws(() => pkFromShortcode("DQBw9CVk7C4!"), /invalid character/);

  // Empty input is not "pk 0": it is a caller bug, and returning a plausible
  // id would buy a 422 instead of comments.
  assert.throws(() => pkFromShortcode(""), /empty/);
  assert.throws(() => pkFromShortcode("///"), /empty/);

  // Length is not a limit: 20 base-64 digits are fine, and all-zero digits
  // are exactly zero. `=` is padding, not part of Instagram's alphabet.
  assert.equal(pkFromShortcode("AAAAAAAAAAAAAAAAAAAA"), "0");
  assert.match(pkFromShortcode("____________________"), /^\d+$/);
  assert.throws(() => pkFromShortcode("DQBw9CVk7C4="), /invalid character/);
});

test("post unwraps the live media_or_ad envelope and buys the three-comment fixture", async () => {
  const payload = clone(fixture("media_info"));
  const media = payload.media_or_ad as Json;
  const comments = fixture("comments_live");

  await withEnv(
    { HIKERAPI_KEY: "test-key" },
    async () => {
      const { hikerapi } = await import("../lib/providers/hikerapi");
      const { result, seen } = await withFetch(
        (url) => {
          const u = new URL(url);
          if (u.pathname === "/v2/media/info/by/code") {
            assert.equal(u.searchParams.get("code"), "DQBw9CVk7C4");
            // The live shape is {status, media_or_ad}, not {media}.
            return respond(payload);
          }
          if (u.pathname === "/v2/media/comments") {
            assert.equal(u.searchParams.get("id"), media.id);
            return respond(comments);
          }
          throw new Error(`unexpected request: ${url}`);
        },
        () => hikerapi.post("https://www.instagram.com/reel/DQBw9CVk7C4/"),
      );

      assert.deepEqual(seen.map(pathOf), [
        "/v2/media/info/by/code",
        "/v2/media/comments",
      ]);
      const post = postOf(result.data as Json);
      const ext = (post.ext ?? {}) as { top_comments?: Json[] };
      assert.equal(ext.top_comments?.length, 3);
      assert.equal(ext.top_comments?.[0]?.text, "Chords : Em C G D");
      assert.equal(ext.top_comments?.[0]?.likes, 875);
      assert.equal(ext.top_comments?.[0]?.author, "commenter_1");
      assert.equal(ext.top_comments?.[0]?.published_at, 1761149436);
      assert.equal(result.units, 2);
      assert.equal(result.usd, 0.04);
    },
  );
});

test("HIKERAPI_COMMENTS=0 turns the comments call off", async () => {
  const media = clone(firstClipMedia());

  await withEnv(
    { HIKERAPI_KEY: "test-key", HIKERAPI_COMMENTS: "0" },
    async () => {
      const { hikerapi } = await import("../lib/providers/hikerapi");
      const { result, seen } = await withFetch(
        (url) => {
          const u = new URL(url);
          if (u.pathname === "/v2/media/info/by/code") {
            return respond({ status: "ok", media });
          }
          throw new Error(`unexpected request: ${url}`);
        },
        () => hikerapi.post("https://www.instagram.com/reel/DQBw9CVk7C4/"),
      );

      assert.deepEqual(seen.map(pathOf), ["/v2/media/info/by/code"]);
      const post = postOf(result.data as Json);
      assert.equal((post.ext as Json | undefined)?.top_comments, undefined);
      assert.equal(result.units, 1);
      assert.equal(result.usd, 0.02);
    },
  );
});

test("post rebuilds the comments id from the shortcode when media.id is missing", async () => {
  const media = clone(firstClipMedia());
  delete media.id;
  const user = media.user as Json;
  const expected = `${pkFromShortcode(String(media.code))}_${String(user.pk)}`;

  // The fixture's pk number is already rounded above 2^53. If that value were
  // used the id would be wrong, so prove the decoded shortcode is different.
  assert.ok(media.pk, "the fixture must still carry the rounded pk");
  assert.notEqual(
    expected.split("_")[0],
    String(media.pk),
    "the parsed pk number must never be used to build the comments id",
  );

  await withEnv(
    { HIKERAPI_KEY: "test-key" },
    async () => {
      const { hikerapi } = await import("../lib/providers/hikerapi");
      const { result, seen } = await withFetch(
        (url) => {
          const u = new URL(url);
          if (u.pathname === "/v2/media/info/by/code") {
            return respond({ status: "ok", media });
          }
          if (u.pathname === "/v2/media/comments") {
            assert.equal(u.searchParams.get("id"), expected);
            return respond(fixture("comments"));
          }
          throw new Error(`unexpected request: ${url}`);
        },
        () => hikerapi.post("https://www.instagram.com/reel/DQBw9CVk7C4/"),
      );

      assert.deepEqual(seen.map(pathOf), [
        "/v2/media/info/by/code",
        "/v2/media/comments",
      ]);
      const post = postOf(result.data as Json);
      const ext = (post.ext ?? {}) as { top_comments?: Json[] };
      assert.equal(ext.top_comments?.length, 12);
      assert.equal(result.units, 2);
      assert.equal(result.usd, 0.04);
    },
  );
});

test("post warns once and skips comments when no id can be formed", async () => {
  const media = clone(firstClipMedia());
  delete media.id;
  delete media.user;
  delete media.owner;

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (message: unknown) => warnings.push(String(message));
  try {
    await withEnv(
      { HIKERAPI_KEY: "test-key" },
      async () => {
        const { hikerapi } = await import("../lib/providers/hikerapi");
        const { result, seen } = await withFetch(
          (url) => {
            const u = new URL(url);
            if (u.pathname === "/v2/media/info/by/code") {
              return respond({ status: "ok", media });
            }
            throw new Error(`unexpected request: ${url}`);
          },
          () => hikerapi.post("https://www.instagram.com/reel/DQBw9CVk7C4/"),
        );

        assert.deepEqual(seen.map(pathOf), ["/v2/media/info/by/code"]);
        const post = postOf(result.data as Json);
        assert.equal((post.ext as Json | undefined)?.top_comments, undefined);
        assert.equal(result.units, 1);
      },
    );
  } finally {
    console.warn = realWarn;
  }

  assert.equal(warnings.length, 1, "the degraded read warns once per run");
  assert.match(warnings[0], /no usable media id/);
});
