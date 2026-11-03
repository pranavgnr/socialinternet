# Authenticity estimate — how it works, and how to switch it on

The profile page's **BOT-TO-REAL RATIO** slab is an estimate, not a measurement.
It is built by sampling an account's public follower list and scoring each row;
the page always says how many followers were inspected and how confident that
sample makes it.

## What is live now

- `estimateAuthenticity()` and the 40-row floor, confidence bands and weights are
  implemented and tested (`lib/authenticity.ts`).
- The HikerAPI capability (`/instagram/followers/sample`) and the router path are
  implemented and tested.
- The cache, stored-view schema, slab and page copy are implemented.
- **Follower sampling itself is dormant.** `AUTH_SAMPLE_PAGES` defaults to `0`,
  which means *do not call the vendor at all*: no account lookup, no follower
  page, no spend. `vitals.botToReal` stays `null` and the slab shows
  "Estimate coming" with the explanatory line.
- `FEATURE_STATUS.audit` is therefore still `"soon"`.

## Why it is dormant

`/v1/user/followers/chunk?user_id=` returns about 25 followers per page. The
estimate refuses to publish a number below **40** sampled rows, so one page can
never produce an estimate. Paging needs a cursor from the response's second
element, and the recorded fixture does not carry one: the original sanitizer
dropped every cursor key, so the shape was lost. Turning sampling on without
paging would spend roughly $0.02–0.04 per paid profile read (one profile call
for `pk`/`is_private` plus one follower page) for an estimate that never renders.

## Weights (documented, deterministic)

| Signal | Weight | Notes |
|---|---|---|
| Numeric-heavy username | 1.0 | 6+ trailing digits, or more than half the handle is digits |
| Empty `full_name` | 0.5 | After trimming; many real accounts leave it blank |
| Placeholder avatar | 0.5 | Recognised by the shared image id recorded in the fixture |
| `is_private` | 0 | Private accounts are not bots and are never penalised |

A row's suspicion is the sum, capped at 1. `realPct = round(100 × mean(1 − suspicion))`,
clamped 0..100. Confidence: < 80 rows `low`, < 200 `medium`, else `high`.
A missing `profile_pic_url` is not scored — absence of data is not evidence.

## Steps to enable it (required before flipping the pillar live)

1. **Capture the real cursor shape.** With a paid `HIKERAPI_KEY`, make one live
   call to `/v1/user/followers/chunk?user_id=<a large public account>` (the call
   is already in `scripts/capture-hikerapi-fixtures.mjs`). Capture the full
   response, including the second element.
2. **Sanitise it.** `node scripts/sanitize-hikerapi-fixtures.mjs` now keeps
   cursor **key names** with the value `"[redacted-cursor]"` instead of deleting
   the keys (null cursors stay `null`). Inspect
   `lib/providers/__fixtures__/hikerapi/followers_chunk.json`: the second
   element's key names and nesting are the pagination contract. Commit the
   sanitised fixture; it contains no token.
3. **Implement paging against that exact shape** in
   `hikerapi.followersSample(userId, pages)`. Do not guess the parameter name:
   use the key the capture shows. Add a test with an injected two-page response
   proving the sample reaches ≥ 40 rows and de-duplicates across pages.
4. **Turn it on.** Set `AUTH_SAMPLE_PAGES=4` (the intended production value) in
   the environment and restart. `0` or unset means dormant; a blank, negative or
   non-numeric value also reads as dormant; values above 20 are capped at 20.
5. **Re-verify.** Run the suites, then repeat the stored-view visual check with a
   `botToReal` value. Only then flip `FEATURE_STATUS.audit` to `"live"`.

## Cost and caching

- HikerAPI bills per request ($0.02 at the Start rate; $0.001 once the $100
  balance unlocks Standard). Four pages is at most 4 requests per profile.
- The calls go through the provider router, so they land on the shared ledger
  and the route's measured settle sees them. They are **not** paid for in gems.
- A successful estimate is cached for seven days per handle in
  `<dataRoot()>/authenticity.json` (`AUTH_CACHE_HOURS`, default 168). A sample
  too small to estimate is not cached, so enabling paging later is not blocked
  by an earlier `null`.
