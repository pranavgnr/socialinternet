/**
 * Competitor discovery v2: ranking, reasons and the three free-ish sources.
 *
 * The selection rule is the product decision, so it is a pure function and
 * every branch is pinned here: privacy, staleness, the size band and its
 * widening, the language conflict, duplicate accounts found twice, the cap and
 * the stable tie-break. `instagramPeers` is then tested with injected vendors so
 * a failing source is proven not to take the others down, and no test touches
 * the network.
 *
 *   sh scripts/run-test.sh test-peers-v2
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  instagramPeers,
  rankPeers,
  type PeerCandidate,
} from "../lib/peers";
import type { RawReel } from "../lib/types";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const DAY = 86_400_000;
const FIXTURES = path.join(process.cwd(), "lib/providers/__fixtures__/hikerapi");

type Json = Record<string, unknown>;

function candidate(handle: string, overrides: Partial<PeerCandidate> = {}): PeerCandidate {
  return { handle, sources: ["search"], ...overrides };
}

function reel(account: string, views: number, followers?: number): RawReel {
  return {
    id: `${account}-1`,
    platform: "instagram",
    account,
    followers,
    url: `https://www.instagram.com/reel/${account}1/`,
    caption: "kannada song cover",
    postedAt: "2026-11-01T00:00:00.000Z",
    views,
    likes: 100,
    comments: 3,
  };
}

/* ------------------------------------------------------------------ *
 * rankPeers: the selection rule
 * ------------------------------------------------------------------ */

test("drops accounts outside 0.3x–3x when at least PEER_MIN_COHORT remain inside", () => {
  const ranking = rankPeers(
    [
      candidate("small_inside", { followers: 3_500 }),
      candidate("middle_inside", { followers: 8_000 }),
      candidate("large_inside", { followers: 25_000 }),
      candidate("way_too_big", { followers: 100_000 }),
    ],
    { followers: 10_000 },
    { now: NOW, minCohort: 3 },
  );

  assert.equal(ranking.widened, false);
  assert.deepEqual(
    ranking.peers.map((p) => p.handle),
    ["large_inside", "middle_inside", "small_inside"],
  );
  assert.ok(
    ranking.peers.every((p) => p.inBand),
    "every kept account is inside the band",
  );
  assert.match(ranking.basis, /about your size/);
});

test("widens the band and labels it when fewer than PEER_MIN_COHORT are inside", () => {
  const ranking = rankPeers(
    [
      candidate("a_inside", { followers: 5_000 }),
      candidate("b_inside", { followers: 20_000 }),
      candidate("c_way_big", { followers: 100_000 }),
      candidate("d_way_small", { followers: 1_000 }),
    ],
    { followers: 10_000 },
    { now: NOW, minCohort: 3 },
  );

  assert.equal(ranking.widened, true);
  assert.equal(ranking.sizeMatched, false);
  assert.deepEqual(
    ranking.peers.map((p) => p.handle).sort(),
    ["a_inside", "b_inside", "c_way_big", "d_way_small"],
  );
  assert.match(ranking.basis, /widened/i);
  assert.match(ranking.basis, /not a size-matched cohort/i);
});

test("drops a private account", () => {
  const ranking = rankPeers(
    [candidate("open", { followers: 10_000 }), candidate("closed", { followers: 10_000, private: true })],
    { followers: 10_000 },
    { now: NOW, minCohort: 3 },
  );
  assert.deepEqual(ranking.peers.map((p) => p.handle), ["open"]);
  assert.ok(ranking.dropped.some((d) => d.handle === "closed"));
});

test("drops an account inactive for more than 30 days, keeps one under it", () => {
  const ranking = rankPeers(
    [
      candidate("recent", { followers: 10_000, lastActiveAt: NOW - 29 * DAY }),
      candidate("stale", { followers: 10_000, lastActiveAt: NOW - 31 * DAY }),
    ],
    { followers: 10_000 },
    { now: NOW, minCohort: 3 },
  );
  assert.deepEqual(ranking.peers.map((p) => p.handle), ["recent"]);
});

test("an account with no activity date is kept: absence of evidence is not staleness", () => {
  const ranking = rankPeers([candidate("unknown_activity")], {}, { now: NOW });
  assert.deepEqual(ranking.peers.map((p) => p.handle), ["unknown_activity"]);
});

test("merges one account found by two sources, adds a reason for each, and scores both", () => {
  const ranking = rankPeers(
    [
      candidate("Search_Good", {
        followers: 12_000,
        sources: ["search"],
        query: "kannada songs",
      }),
      candidate("@search_good", {
        followers: 12_000,
        sources: ["similar"],
      }),
    ],
    { followers: 10_000, query: "kannada songs" },
    { now: NOW, minCohort: 3 },
  );

  assert.equal(ranking.peers.length, 1, "one account, not two rows");
  const peer = ranking.peers[0];
  assert.deepEqual(peer.sources.sort(), ["search", "similar"]);
  assert.equal(peer.source, "similar", "the strongest source names the account");
  assert.equal(peer.score, 4, "similar 3 + one extra source 1");
  assert.match(peer.reasons.join(" | "), /similar accounts/);
  assert.match(peer.reasons.join(" | "), /kannada songs/);
});

test("keeps at most the cap", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    candidate(`account_${i}`, { followers: 10_000 }),
  );
  const ranking = rankPeers(many, { followers: 10_000 }, { now: NOW, max: 3, minCohort: 3 });
  assert.equal(ranking.peers.length, 3);
});

test("every kept peer has at least one plain reason", () => {
  const ranking = rankPeers(
    [
      candidate("a"),
      candidate("b", { sources: ["owner-of-top-reel"] }),
      candidate("c", { sources: ["hashtag"], hashtag: "kannadasongs" }),
    ],
    {},
    { now: NOW },
  );
  for (const peer of ranking.peers) {
    assert.ok(peer.reasons.length >= 1, `${peer.handle} must say why it is here`);
    for (const reason of peer.reasons) {
      assert.equal(typeof reason, "string");
      assert.ok(reason.trim().length > 0);
    }
  }
});

test("ties break on the handle for stable output", () => {
  const ranking = rankPeers(
    [candidate("zeta", { followers: 10_000 }), candidate("Alpha", { followers: 10_000 })],
    { followers: 10_000 },
    { now: NOW, minCohort: 3 },
  );
  assert.deepEqual(ranking.peers.map((p) => p.handle.toLowerCase()), ["alpha", "zeta"]);
});

test("drops another language only when the data says so, and rewards the same one", () => {
  const ranking = rankPeers(
    [
      candidate("kannada_account", { languages: ["kn"], followers: 10_000 }),
      candidate("telugu_account", { languages: ["te"], followers: 10_000 }),
      candidate("unlabelled", { followers: 10_000 }),
    ],
    { followers: 10_000, language: "kn" },
    { now: NOW, minCohort: 3 },
  );

  const kept = ranking.peers.map((p) => p.handle);
  assert.ok(kept.includes("kannada_account"));
  assert.ok(kept.includes("unlabelled"));
  assert.ok(!kept.includes("telugu_account"));
  const kn = ranking.peers.find((p) => p.handle === "kannada_account")!;
  assert.ok(kn.reasons.includes("same language"));
  const unknown = ranking.peers.find((p) => p.handle === "unlabelled")!;
  assert.ok(!unknown.reasons.includes("same language"));
});

test("without a creator follower count there is no band and no size claim", () => {
  const ranking = rankPeers([candidate("peer", { followers: 9_000 })], {});
  assert.equal(ranking.band, undefined);
  assert.equal(ranking.sizeMatched, false);
  assert.match(ranking.basis, /size is unknown/i);
  assert.ok(!ranking.peers[0].reasons.some((r) => /about your size/.test(r)));
});

/* ------------------------------------------------------------------ *
 * instagramPeers: source gathering, failure isolation and the cap
 * ------------------------------------------------------------------ */

test("instagramPeers merges similar, search and top-reel owners and drops private/stale rows", async () => {
  const relatedCalls: string[] = [];
  const searchCalls: string[] = [];
  const reads: string[] = [];

  const result = await instagramPeers({
    handle: "me",
    followers: 10_000,
    query: "kannada songs",
    reels: [reel("owner_good", 500_000, 20_000), reel("me", 999_000, 10_000)],
    deps: {
      now: () => NOW,
      related: async (handle) => {
        relatedCalls.push(handle);
        return [
          candidate("similar_good", { followers: 12_000, sources: ["similar"], lastActiveAt: NOW - 2 * DAY }),
          candidate("similar_private", { private: true, sources: ["similar"] }),
          candidate("similar_stale", {
            followers: 9_000,
            sources: ["similar"],
            lastActiveAt: NOW - 40 * DAY,
          }),
        ];
      },
      search: async (query) => {
        searchCalls.push(query);
        return [
          candidate("search_good", {
            followers: 11_000,
            sources: ["search"],
            query,
            lastActiveAt: NOW - DAY,
          }),
          // the same account as a similar one, so it must merge rather than double
          candidate("similar_good", { followers: 12_000, sources: ["search"], query }),
        ];
      },
      followers: async () => new Map(),
      readAccount: async (handle) => {
        reads.push(handle);
        return [reel(handle, 5_000)];
      },
    },
  });

  assert.equal(relatedCalls.length, 1, "one similar-accounts call per plan");
  assert.equal(searchCalls.length, 1, "one phrase search per plan");
  assert.equal(searchCalls[0], "kannada songs");

  const handles = result.accounts.map((a) => a.handle).sort();
  assert.deepEqual(handles, ["owner_good", "search_good", "similar_good"]);
  assert.ok(!handles.includes("similar_private"));
  assert.ok(!handles.includes("similar_stale"));
  assert.ok(!handles.includes("me"), "the creator is never their own peer");

  assert.equal(result.sizeMatched, true, "three accounts landed inside the band");
  assert.deepEqual(result.band, { low: 3_000, high: 30_000 });
  assert.match(result.basis, /about your size/);

  for (const account of result.accounts) {
    assert.ok(account.reasons.length >= 1, `@${account.handle} must have a reason`);
    assert.ok(["similar", "search", "hashtag", "owner-of-top-reel"].includes(account.source));
  }
  assert.deepEqual(reads.sort(), ["owner_good", "search_good", "similar_good"]);

  const merged = result.accounts.find((a) => a.handle === "similar_good")!;
  assert.equal(merged.source, "similar");
  assert.match(merged.reasons.join(" | "), /similar accounts/);
  assert.match(merged.reasons.join(" | "), /kannada songs/);
  assert.equal(merged.via, "related", "the legacy field stays meaningful");
});

test("a failing similar-accounts source does not take the others down", async () => {
  let searchCalls = 0;
  const result = await instagramPeers({
    handle: "me",
    followers: 10_000,
    query: "kannada songs",
    deps: {
      now: () => NOW,
      related: async () => {
        throw new Error("similar accounts are down");
      },
      search: async () => {
        searchCalls += 1;
        return [
          candidate("one", { followers: 8_000, sources: ["search"], query: "kannada songs" }),
          candidate("two", { followers: 9_000, sources: ["search"], query: "kannada songs" }),
          candidate("three", { followers: 10_000, sources: ["search"], query: "kannada songs" }),
        ];
      },
      followers: async () => new Map(),
      readAccount: async (handle) => [reel(handle, 5_000)],
    },
  });

  assert.equal(searchCalls, 1);
  assert.equal(result.accounts.length, 3);
  assert.ok(
    result.errors.some((e) => /similar accounts are down/.test(e)),
    "the failed source is reported, not hidden",
  );
  assert.equal(result.sizeMatched, true);
});

test("a thin account search is not retried word by word (the discovery cap is two calls)", async () => {
  const queries: string[] = [];
  await instagramPeers({
    handle: "me",
    followers: 10_000,
    query: "kannada songs",
    deps: {
      now: () => NOW,
      related: async () => [],
      search: async (query) => {
        queries.push(query);
        return [candidate("only_one", { followers: 9_000, sources: ["search"], query })];
      },
      followers: async () => new Map(),
      readAccount: async (handle) => [reel(handle, 5_000)],
    },
  });

  assert.deepEqual(queries, ["kannada songs"]);
});

/* ------------------------------------------------------------------ *
 * HikerAPI adapter: search accounts works, similar accounts refuse honestly
 * ------------------------------------------------------------------ */

function fixture(name: string): Json {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as Json;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch<T>(
  handler: (url: string) => Response | Promise<Response>,
  work: () => Promise<T>,
): Promise<{ result: T; seen: string[] }> {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    return handler(url);
  }) as typeof fetch;
  try {
    return { result: await work(), seen };
  } finally {
    globalThis.fetch = real;
  }
}

async function withEnv<T>(
  env: Record<string, string | undefined>,
  work: () => Promise<T>,
): Promise<T> {
  const keys = [
    "HIKERAPI_KEY",
    "HIKERAPI_USD_PER_CALL",
    "APIFY_TOKEN",
    "SCRAPECREATORS_API_KEY",
    "SOCIALCRAWL_API_KEY",
    "YOUTUBE_WEB",
    "DATA_PROVIDER",
    "CREDIT_BUDGET_USD",
  ] as const;
  const snap = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await work();
  } finally {
    for (const k of keys) {
      if (snap[k] === undefined) delete process.env[k];
      else process.env[k] = snap[k];
    }
  }
}

test("hikerapi.searchAccounts parses /v2/search/accounts and keeps activity, not fake follower counts", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { result, seen } = await withFetch(
      (url) => {
        const u = new URL(url);
        assert.equal(u.pathname, "/v2/search/accounts");
        assert.equal(u.searchParams.get("query"), "kannada songs");
        return response(fixture("search_accounts"));
      },
      () => hikerapi.searchAccounts!("kannada songs"),
    );

    assert.equal(seen.length, 1);
    const users = result.data.users as Json[];
    assert.equal(users.length, 8);
    assert.equal(users[0].username, "kannada.songs_status");
    assert.equal(users[0].private, false);
    const active = users.find((u) => u.username === "kannada_songs_rr")!;
    assert.equal(active.lastActiveAt, 1_793_640_738_000);
    assert.ok(
      users.every((u) => u.followers === undefined),
      "this endpoint does not carry a follower count; do not invent one",
    );
    assert.equal(result.units, 1);
  });
});

test("hikerapi.relatedProfiles refuses cleanly, with unsupported:true and no request", async () => {
  await withEnv({ HIKERAPI_KEY: "test-key" }, async () => {
    const { ProviderUnavailable } = await import("../lib/providers/types");
    const { hikerapi } = await import("../lib/providers/hikerapi");
    const { seen } = await withFetch(
      () => {
        throw new Error("this endpoint is known broken and must not be called");
      },
      async () => {
        await assert.rejects(
          () => hikerapi.relatedProfiles!("someone"),
          (err: unknown) => {
            assert.ok(err instanceof ProviderUnavailable);
            assert.equal(err.unsupported, true, "a capability gap, not a failed request");
            assert.equal(err.exhausted, false);
            return true;
          },
        );
      },
    );
    assert.equal(seen.length, 0, "refusing must cost nothing");
  });
});

test("apify.relatedProfiles returns Instagram's similar accounts from the profile payload", async () => {
  const { apify } = await import("../lib/providers/apify");
  const real = apify.profile;
  apify.profile = async () => ({
    data: { user: { related: ["nasa", "oceana"] } },
    usd: 0,
    units: 1,
    remaining: null,
  });
  try {
    const result = await apify.relatedProfiles!("natgeotravel");
    assert.deepEqual(result.data.related, ["nasa", "oceana"]);
  } finally {
    apify.profile = real;
  }
});

test("the router refuses the related path honestly when only HikerAPI is configured", async () => {
  await withEnv(
    {
      HIKERAPI_KEY: "test-key",
      APIFY_TOKEN: undefined,
      SCRAPECREATORS_API_KEY: undefined,
      SOCIALCRAWL_API_KEY: undefined,
      YOUTUBE_WEB: "0",
      DATA_PROVIDER: undefined,
      CREDIT_BUDGET_USD: "100",
    },
    async () => {
      const { request, resetCreditLedger, NoDataVendor } = await import("../lib/providers");
      resetCreditLedger();
      const { seen } = await withFetch(
        () => {
          throw new Error("a refusal must not make a request");
        },
        async () => {
          await assert.rejects(
            () =>
              request({
                path: "/instagram/related/profiles",
                handle: "someone",
                platform: "instagram",
              }),
            (err: unknown) => {
              assert.ok(err instanceof NoDataVendor);
              assert.match((err as Error).message, /similar accounts/);
              return true;
            },
          );
        },
      );
      assert.equal(seen.length, 0);
    },
  );
});
