# The Instagram data layer

Status: live-verified on **2026-11-03**. This page records what one real plan
bought, what it cost, how to read the ledger, and what is still missing.

The rule the layer enforces: every niche, competitor, profile and comment comes
from Instagram Reels. HikerAPI answers first, Apify second. YouTube code is kept
dormant and is not reachable from a plan, a room or a competitor list.

Pricing research lives in [`data-providers.md`](./data-providers.md).

---

## Vendor order

For every Instagram path the router asks vendors in this order:

1. **HikerAPI** — primary for profiles, reels, keyword search, account search,
   posts and comments.
2. **Apify** (`apify/instagram-scraper`) — fallback. It has no keyword search,
   so it is skipped honestly for that one capability.
3. **SocialCrawl** — legacy fallback, only if configured.
4. **ScrapeCreators** — last-resort capability, not a keyword-search vendor.

The filter is a platform filter, not a hint: a caller that asks for Instagram
only ever gets vendors that read Instagram. When no Instagram vendor can answer,
the user sees exactly `No Instagram data source is available right now`; there
is no YouTube fallback. The free YouTube reader is deliberately sorted last for
every path and can only be read when a caller names `platform: "youtube"`.

`CREDIT_BUDGET_USD` is a hard per-run money ceiling. `CREDIT_BUDGET` is the
legacy SocialCrawl unit ceiling and only applies to that vendor.

---

## What one fresh plan buys

A cold plan for a creator with no cache is roughly:

| Step | Logical calls | HikerAPI HTTP calls |
|---|---:|---:|
| Own account: `/v2/user/by/username` + `/v2/user/clips` | 1 | 2 |
| Own profile (bio, category, follower count) | 1 | 1 |
| Niche keyword search `/v2/search/reels` | 1 | 1 |
| Enrich up to 6 accounts with `/v2/user/by/username` + `/v2/user/clips` | 6 | 12 |
| Owner follower counts for search rows not already sized (cap `OWNER_PROFILE_MAX`, default 12; cached for 7 days) | up to 12 | up to 12 |
| Post reads for the language check (`/v2/media/info/by/code` + `/v2/media/comments`) | up to 4 | 8 |
| **Measured on 2026-11-03** | | **29 before the comments fix; 33 with it** |

The 29-call measurement was taken before the follow-up comments fix: four post
reads bought four media-info pages and zero comments. Once comments work, each
post read is two calls again, so the same plan is **33 calls** (29 + 4).

Enrichment, owner sizes and post reads are the steps that make the plan useful:
a keyword search names the owner of every row but never gives its follower
count, and one search row per account cannot produce a median. The counts are
capped so one plan cannot drain the balance.

Peer discovery is a separate module (`lib/peers.ts`). It spends at most one
similar-accounts pull, one phrase search, up to `PEER_LOOKUP_MAX` size reads
and up to `PEER_MAX` account reads. See “Peer discovery” below for its current
status and its cost.

---

## Verified on 2026-11-03

Command (the script is compiled with `tsc`, like the other tagged scripts):

```bash
npx tsc scripts/verify-instagram-live.ts --module commonjs --target es2022 \
  --moduleResolution node --outDir .tmp-build --skipLibCheck \
  --esModuleInterop --lib es2022,dom --types node

CREATORS_DATA_DIR=/Users/pranav/reel-engine/data \
NICHE_CACHE_HOURS=168 HANDLE_CACHE_HOURS=168 \
node --env-file=.env.local .tmp-build/scripts/verify-instagram-live.js \
  _shravyapawar_ "kannada songs" --cap 40
```

`_shravyapawar_` is a Kannada singer with 57,740 followers. The run was forced
(`force: true`), so nothing was served from the handle or niche cache.

### What the run showed

| Measure | Result |
|---|---|
| Platform share | **28/28 plan rows are `instagram` (100%)** — 83/83 rows in the cached niche pull and 12/12 in the handle pull are Instagram too |
| Reels with views | 28/28 rows in the plan; 83/83 in the niche cache; 12/12 in the handle pull |
| Cohort | 5 accounts, all Instagram, `sizeMatched: false` (“not enough close to your size to call a cohort”) |
| Niche fit | `mixed` — 7 of 12 accounts were in a different space and were left out of the benchmark |
| Peers (Task 4 module) | 3, all `source: search`; reasons: “posts reels about 'kannada songs'”; no sizes were returned, so no size band |
| Evidence | `https://www.instagram.com/reel/DQBw9CVk7C4/`, `.../DeHdvHeoa4S/`, `.../De-xMhUTAnS/` (query strings stripped) |
| Calls charged to the user | **6 credits** (`COSTS.handle`) |

### What it cost

The plan portion of the live run was **29 HikerAPI HTTP calls** and **4 Apify
actor runs / 4 results**. The 29 calls split as 17 profile lookups, 7 clips
pages, 1 keyword search and 4 post reads. This split is reconstructed from the
endpoint tally at the cap stop minus the peer module's own measured run: the
plan completed before the cap stopped the first peer read, and the clips count
(8) is the plan's 7 plus exactly one peer page. The four post reads bought no
comments because of the wrapper bug described below.

The live measurement was 29 calls because comments were skipped; the comments
fix adds four calls (one per post read), so the economics below use the final
33-call plan.

| Vendor | Plan calls | USD at the $0.02 Start rate | USD at the $0.001 rate |
|---|---:|---:|---:|
| HikerAPI, comments working | **33** | **$0.66** | **$0.033** |
| Apify | 4 results | $0.0108 real, **$0.00 charged** inside the $5 monthly free tier | same |
| **Cash cost** | | **$0.66** | **$0.033** |

A full plan is priced at **6 credits**, which is roughly **$0.06 of notional
value** at the product's “1 credit ≈ $0.01” calibration. The computation is
`$0.66 ÷ $0.06 = 11x` at the Start rate; at the $0.001 tier,
`$0.033 ÷ $0.06 ≈ 0.55x` (about half). This is the single most important number
on this page: the HikerAPI Start rate is fine for verification, but a busy app
needs the $0.001 tier (a $100 balance) or a higher credit price before the
economics work.

The live run hit the 40-call cap while the script was exercising the separate
peer module, *after* the plan had completed. The cap stopped the next request
before it was sent. The plan's numbers above are unaffected; the peer module was
then measured on its own from the cached plan (see below).

### Peers (Task 4 module), measured from the cached plan

The plan path only calls `instagramPeers` when it has to rebuild a non-Instagram
room; an Instagram-only search never triggers that rebuild. To verify the module
live, the script calls it directly with the rows the niche already bought. No
plan call is repeated:

```bash
... --cached --cap 15
```

Result: **3 peers**, all `source: search`, no size band (`sizeMatched: false`),
cost **$0.20** (10 HikerAPI calls: 1 account search, 6 profile reads, 3 clips
pages; plus 1 Apify run for similar accounts). Every peer had at least one
reason: `posts reels about 'kannada songs'`. The three handles returned no
follower count, so the reasons could not include “about your size”.

Why the similar-accounts source contributed nothing:

- HikerAPI's `/gql/user/related/profiles` returned HTTP 500 on every probe.
- The addendum probe of `/v2/user/suggested/profiles?user_id=32334432364`
  returned **HTTP 403 `InvalidTargetUser` — “Not eligible for chaining.”**
  The same endpoint with `id=` instead returned HTTP 422 saying `user_id` is
  required. No usable account rows came back, so HikerAPI keeps its clean
  `unsupported` refusal and the router falls through to Apify.
- Apify's profile details payload for this creator had no `relatedProfiles`
  list, so that source reported “no similar accounts in its profile payload”.

The cohort still builds from account search and top-reel owners; it is honest
about the missing sizes rather than inventing them.

### Cache warmed for the founder

Two more Indian-creator niches were researched live and written to the shared
data directory with `NICHE_CACHE_HOURS=168`. The enrichment caps were lowered
for the warm-only runs (`ENRICH_ACCOUNTS=3`, `OWNER_PROFILE_MAX=4`,
`LANG_COMMENT_MAX=0`) to stay inside the 25-call warming budget:

| Niche | File reels | File accounts | File platform | File with views | Recorded warm/plan output | HikerAPI calls |
|---|---:|---:|---|---:|---|---:|
| `kannada songs` (from the plan) | 83 | 12 | 83/83 Instagram | 83/83 | 28 plan rows (cohort-pruned) | 29 (plan) |
| `telugu songs cover` | 47 | 15 | 47/47 Instagram | 47/47 | 21 rows / 11 accounts | 11 |
| `daily vlogs india` | 43 | 12 | 43/43 Instagram | 43/43 | 38 rows / 12 accounts | 11 |

The two sets of counts describe two different views, not two runs. The files
were written by the recorded runs and were **not** rewritten later: their
mtimes (`04:38:21` and `04:38:47` IST) match their `fetchedAt` values
(`23:08:21Z` and `23:08:47Z`). `researchNiche` writes the raw payload to disk,
then `shape()` applies the language gate and de-duplication to the view it
returns; the warm output prints that shaped view. The file holds the raw rows
(47/15 and 43/12); the output holds the shaped view (21/11 and 38/12). Both are
100% Instagram.

Files written to `/Users/pranav/reel-engine/data` (ages at the time of writing):

- `niches/kannada-songs.json` — 2026-11-03 04:33, 222,480 bytes
- `niches/telugu-songs-cover.json` — 2026-11-03 04:38, 115,865 bytes
- `niches/daily-vlogs-india.json` — 2026-11-03 04:38, 115,293 bytes
- `handles/_shravyapawar_.json` — 2026-11-03 04:33, 27,083 bytes
- `_owner_profiles.json` — 2026-11-03 04:38, 2,216 bytes

`GET http://localhost:3000/api/trending` (which reads the shared data) now lists
all three: `daily-vlogs-india` at rank 5, `kannada-songs` at rank 12 and
`telugu-songs-cover` at rank 14. The preview server also confirms all three are
cache hits: `GET /api/niche?q=<phrase>` returned `cached: true` with an age
under 0.2 hours for each. The trending table is refreshed from the cache; if a
freshly warmed room is missing, the table has not been refreshed yet — the room
itself is already openable from the room route, which reads the cache directly.

### Live calls used by this task

The whole task used **69 vendor HTTP requests** (2 addendum probes + 35 in the
handle run + 10 in the cached peer replay + 11 + 11 in the two warm runs). One
of the two addendum probes was a free 422 validation error. HikerAPI's wallet
went from 80 to 13 requests over the task (the balance endpoint updates with a
small lag, so its delta can differ from the guard count by one or two); every
live run stayed inside its printed cap. No key or signed URL was printed.

### Full output

These outputs were recorded before the comments fix, so they show the 29-call
plan and no comments call. The current script also prints two lines after the
evidence URLs and before the peer section; in the final comments-working form
they are:

```text
plan completed: hikerapi 33 calls · apify 4 runs · hikerapi cost $0.6600 at $0.020/call
credits a user would be charged: 6
```

The first-run block below predates those lines, so it goes straight from the
evidence URLs to the cap stop. The follow-up section records what changed.

First run (fresh plan, cap 40). It stopped at the cap while starting a peer
read, after the plan had been printed:

```text
=== Live verification — one full plan ===
handle: @_shravyapawar_
niche: "kannada songs" (forced fresh read)
data dir: /Users/pranav/reel-engine/data
cache: NICHE_CACHE_HOURS=168 HANDLE_CACHE_HOURS=168
hikerapi rate: $0.020 per call
call cap: 40 (the script refuses to cross it)
hikerapi calls left before: 80

--- plan ---
platform: instagram
own: 12 reels · 57740 followers · niche source "user"
cohort: 5 accounts · platform instagram · sizeMatched false · basis "everyone in this space (5 accounts) — not enough close to your size to call a cohort"
platform share: 28/28 rows are instagram (100.0%) PASS
rows with views: 28/28
niche fit: mixed (7 of 12 accounts were in a different space and were left out of the benchmark.)
first three evidence post URLs:
  https://www.instagram.com/reel/DQBw9CVk7C4/
  https://www.instagram.com/reel/DeHdvHeoa4S/
  https://www.instagram.com/reel/De-xMhUTAnS/

STOP: live call cap reached before hikerapi /v2/user/by/username.
calls used: 40 (cap 40). No further vendor request was sent.
by vendor: {"hikerapi":35,"apify":5}
by endpoint: {"/v2/user/by/username":21,"/v2/user/clips":8,"/v2/search/reels":1,"/v2/media/info/by/code":4,"/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items":5,"/v2/search/accounts":1}
```

The cached replay (0 plan calls) completed the plan report and the separate
peer read:

```text
--- plan ---
platform: instagram
own: 12 reels · 57740 followers · niche source "user"
cohort: 5 accounts · platform instagram · sizeMatched false · basis "everyone in this space (5 accounts) — not enough close to your size to call a cohort"
platform share: 28/28 rows are instagram (100.0%) PASS
rows with views: 28/28
niche fit: mixed (7 of 12 accounts were in a different space and were left out of the benchmark.)
first three evidence post URLs:
  https://www.instagram.com/reel/DQBw9CVk7C4/
  https://www.instagram.com/reel/DeHdvHeoa4S/
  https://www.instagram.com/reel/De-xMhUTAnS/

plan completed: hikerapi 0 calls · apify 0 runs · hikerapi cost $0.0000 at $0.020/call
credits a user would be charged: 6

--- peers (Task 4 module, live) ---
peers: 3 · sizeMatched false · cost $0.2000 · basis "Instagram accounts in your space, but only 0 near your size (58k followers) — too few to call a cohort"
  @___music__kannada · source=search · followers=? · reels=12 · median views=4344
    reasons: posts reels about 'kannada songs'
  @__kannada__songs · source=search · followers=? · reels=9 · median views=301
    reasons: posts reels about 'kannada songs'
  @_kannada_songs · source=search · followers=? · reels=7 · median views=1486
    reasons: posts reels about 'kannada songs'
  source errors: Instagram similar accounts: every data vendor failed: @_shravyapawar_ has no similar accounts in its profile payload

--- vendor requests counted by the cap guard ---
total: 11
by vendor: {"apify":1,"hikerapi":10}
by endpoint: {"/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items":1,"/v2/search/accounts":1,"/v2/user/by/username":6,"/v2/user/clips":3}
hikerapi calls used (balance delta): 8

--- vendor ledger (creditLedger) ---
logical calls in the last segment: 7
vendor units in the last segment: 10
by endpoint: {"/instagram/search/accounts":1,"/instagram/profile":3,"/instagram/profile/reels":6}
by vendor:   {"hikerapi":10}
USD, whole run (lifetimeUsd delta): $0.2000
vendor units, whole run (lifetimeSpent delta): 10

whole verification: hikerapi 10 calls · apify 1 runs
hikerapi cost at $0.020/call: $0.2000 (10 calls)
hikerapi cost at $0.001/call: $0.0100 (10 calls)
```

Warm runs:

```text
--- niche ---
query: "telugu songs cover"
cached: false · fetchedAt: 2026-11-02T23:08:21.535Z
rows: 21 · accounts: 11 · platform instagram: 21/21 (100.0%)
credits the user would be charged: 6
errors: watched 8 of 19 reels whose caption and tags did not settle it: 8 were another language, 0 confirmed, 11 still unconfirmed

--- vendor requests counted by the cap guard ---
total: 11
by vendor: {"hikerapi":11}
by endpoint: {"/v2/search/reels":1,"/v2/user/by/username":7,"/v2/user/clips":3}
```

```text
--- niche ---
query: "daily vlogs india"
cached: false · fetchedAt: 2026-11-02T23:08:47.512Z
rows: 38 · accounts: 12 · platform instagram: 38/38 (100.0%)
credits the user would be charged: 6
errors: none

--- vendor requests counted by the cap guard ---
total: 11
by vendor: {"hikerapi":11}
by endpoint: {"/v2/search/reels":1,"/v2/user/by/username":7,"/v2/user/clips":3}
```

(The on-disk files hold the raw pull — 47 and 43 rows; the warm output prints
the shaped view after the language gate — 21 and 38 rows. Both are 100%
Instagram. The files were not rewritten by a later run; their mtimes match the
recorded `fetchedAt` values.)

---

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `HIKERAPI_KEY` | — | HikerAPI access key. Required for any Instagram read. The verification script refuses to run without it. |
| `HIKERAPI_USD_PER_CALL` | `0.02` | Dollar cost recorded per billable HikerAPI call. Set to `0.001` once the account reaches the $100 tier. |
| `HIKERAPI_COMMENTS` | on | `0` disables the second call that reads comments for a post. |
| `NICHE_CACHE_HOURS` | `12` | How long a niche pull is served from disk. Set to `168` for a week. |
| `HANDLE_CACHE_HOURS` | `12` | How long a handle read is served from disk. Set to `168` for a week. |
| `OWNER_CACHE_HOURS` | `168` | How long a follower count in `_owner_profiles.json` is trusted. |
| `OWNER_PROFILE_MAX` | `12` | Fresh profile reads for owner follower counts per niche search. |
| `PEER_MAX` | `6` | Maximum peers kept per plan. |
| `PEER_LOOKUP_MAX` | `6` | Fresh follower reads while discovering peers. |
| `APIFY_TOKEN` | — | Apify fallback token. |
| `CREATORS_DATA_DIR` | `./data` | Root for niches, handles and `_owner_profiles.json`. Set this to one shared directory so the app and a worker read the same cache. |

`DEBUG_PEERS=1` prints the peer rebuild decisions to stderr. `CREDIT_BUDGET_USD`
(default `1`) is the hard per-run money ceiling; `CREDIT_BUDGET` remains the
legacy SocialCrawl unit ceiling.

---

## Reading the call and cost ledger

`creditLedger()` in `lib/providers/index.ts` is the single source of truth:

- `calls` — logical router calls in the current segment (one per `request()`,
  not one per HTTP request).
- `spent` — vendor units in the current segment. For HikerAPI one unit is one
  HTTP call; for Apify one unit is one billed result.
- `usd` — real money in the current segment.
- `lifetimeUsd` / `lifetimeSpent` — never reset. **Use a before/after delta for
  a whole run.** `researchNiche` resets the segment counters in the middle of a
  plan, so the final `byEndpoint` / `byVendor` map covers only the niche
  portion, not the handle pull that came before it.
- `byEndpoint` — units per logical path (`/instagram/profile/reels`, …).
- `byVendor` — units per vendor (`hikerapi`, `apify`, …).
- `servedBy` — logical calls answered per vendor.

A billed failure (HikerAPI 400/403/404) adds one unit and its USD to the
ledger, even though it did not return data. A 5xx is retried once and is not
billed. `CREDIT_BUDGET_USD` refuses a call locally before it crosses the run's
money ceiling.

The verification script adds a second, independent count: a `fetch` guard that
tallies every vendor HTTP request for the whole run (excluding the free
`/sys/balance` probe) and aborts before the request that would cross `--cap`.
That is why the script can print a guard count and the wallet delta side by
side; small differences are retries and the balance endpoint's update lag.

---

## What the founder can open in the app

With `CREATORS_DATA_DIR=/Users/pranav/reel-engine/data` and the cache warm:

- **Rooms:** `kannada songs`, `telugu songs cover` and `daily vlogs india` all
  open from disk for free. The files were written under `NICHE_CACHE_HOURS=168`;
  the running preview at the time of writing still had its old 12-hour TTL
  loaded, so restart it with the current `.env.local` to keep them warm for a
  week. They are visible in `GET /api/trending` and from the landing-page
  bubbles.
- **The handle:** `_shravyapawar_` opens from the handle cache for free
  (`HANDLE_CACHE_HOURS=168`). The plan route refunds the 6-credit charge when
  the measured vendor spend is zero.
- **A cold creator or niche** buys the calls above; the user is charged 6
  credits for a handle plan and 6 for a fresh niche.

The preview server must be restarted after this change for one reason: the
handle directory now honours `CREATORS_DATA_DIR` (see “Fixes found during
verification”). A server started before the fix still reads
`<worktree>/data/handles`; the niche cache already honoured the variable and
needs no restart.

---

## Comments fix (follow-up, 2026-11-03)

The live verification found the bug: `/v2/media/info/by/code` answers
`{status, media_or_ad: {...}}`, but `post()` looked only for `data.media`. It
treated the wrapper as the post, so `media.id` was always missing and every
post read skipped comments silently. Four post reads in the measured plan
bought four media-info pages and zero comments.

The fix:

- `mediaOf()` unwraps `media_or_ad`, `media`, `response.*` and `items[].media`
  before mapping the post.
- If a payload still has no valid `media.id`, `lib/instagramId.ts` decodes the
  shortcode (`pkFromShortcode`) to the exact pk with BigInt and combines it
  with `user.pk` (or `user.id`) to form `<pk>_<ownerPk>`. The parsed `pk`
  number is never used — above 2^53 it is already rounded.
- A post read that still cannot form an id now logs **one** redacted warning
  per run and skips comments; it no longer fails silently.

Live evidence (3 HikerAPI calls):

- `GET /v2/media/info/by/code?code=DQBw9CVk7C4` → HTTP 200, top-level keys
  `media_or_ad`, `status`; the media has a valid string `id` and a safe
  `user.pk` (32334432364).
- Computed id: `3747491665579061432_32334432364` (shortcode decoded, not the
  rounded `pk`).
- `GET /v2/media/comments?id=3747491665579061432_32334432364` → HTTP 200,
  **14 comments**, field names `response.comments[]` with `text`,
  `comment_like_count`, `created_at`, `user.username`.

Tests: `pkFromShortcode` is checked against every clip in the live
`user_clips.json` (`pkFromShortcode(code) === id.split("_")[0]`), the live
`media_or_ad` wrapper, the shortcode fallback, the one-warning degraded path,
and a sanitized three-comment fixture (`comments_live.json`). A sanitized
`media_info.json` records the live wrapper. `test-hikerapi` is 22/22.

Effect on the plan bill: a post read is two calls again. The measured 29-call
plan becomes **33 calls**: +4 comment calls, **$0.66** at $0.02 or **$0.033**
at $0.001.

## Known gaps

1. **No reach, saves, retention or audience demographics.** HikerAPI exposes
   views, likes, comments, shares, duration, audio and captions. Reach and
   saves need the creator's own Instagram OAuth connection; demographics need
   the audience API. Neither is in this layer.
2. **Bot/authenticity score is not built.** Any future score is an estimate and
   a separate piece of work; nothing in a plan should imply it exists today.
3. **Video reading is local and separate.** Hook/transcript/OCR analysis uses
   the local media tools and is not part of a normal plan. It is disabled in
   this verification. On Linux it needs `ffmpeg`/`ffprobe` and the multimodal
   (speech/vision) step planned separately; without them the deep pass is
   skipped and the plan says so.
4. **Comments now work live (follow-up fix).** The measured 29-call plan
   predates the fix: it made 4 post reads and **zero** comments calls because
   `post()` did not unwrap the live `{status, media_or_ad}` envelope. The live
   follow-up returned 14 comments for
   `id=3747491665579061432_32334432364`; a post read is two calls again and the
   projected plan is 33 calls. The full plan was not re-run end-to-end (live
   budget), so the +4 calls are a measured unit cost, not a second whole-plan
   measurement.
5. **Similar accounts are effectively unavailable.** HikerAPI's
   `/gql/user/related/profiles` answers 500; the addendum probe of
   `/v2/user/suggested/profiles` answers 403 “Not eligible for chaining”
   (`user_id`) or 422 “user_id required” (`id`). Apify's details payload carries
   the list when Instagram returns it, but it was empty for `_shravyapawar_`.
   Peer discovery therefore leans on account search and top-reel owners.
6. **Peer sizes can be unknown.** The three live peers came back without a
   follower count, so the selector could not band them by size and every reason
   was the phrase match alone. The module is honest (`sizeMatched: false`,
   “0 near your size”), but the peer list is weaker than the design intends.
7. **The plan path does not use Task 4 peers.** `analyseHandle` only calls
   `instagramPeers` when it has to rebuild a non-Instagram room. With
   Instagram-only search that rebuild never fires, so the plan's cohort is the
   niche accounts (`research.accounts`), not the `PeerAccount` list with
   `reasons`. The verification script calls the module directly to prove it
   works; wiring its reasons into every plan is follow-up work.
8. **The 6-credit price is below cost at the HikerAPI Start rate**: the final
   33-call plan costs **$0.66** against **$0.06** of notional value
   (`$0.66 ÷ $0.06 = 11x`). Move to the $0.001 tier or reprice before scaling.
9. **All caches share one root now.** Live verification found that handles
   ignored `CREATORS_DATA_DIR`, so a run from a worktree wrote to the wrong
   directory while the shared preview read another. Every cache now resolves
   through `lib/dataDir.ts`: niches, handles, raw pulls, the post/enrichment
   cache, media downloads, the hook and intent caches, the owner cache, the
   Apify/YouTube usage ledgers and the YouTube subscriber cache. The test
   `test-data-dir` covers both the `CREATORS_DATA_DIR` and `./data` cases.
   **Handle files written under `./data` before this fix are ignored once
   `CREATORS_DATA_DIR` is set.** Copy them once if they are worth keeping:
   `cp data/handles/*.json /Users/pranav/reel-engine/data/handles/`
   (or `${CREATORS_DATA_DIR}/handles/`). The same applies to any other warm
   cache written under the old `./data`; otherwise let it rebuild. Restart the
   preview server so it loads the new paths.
10. **Comments and the post cache.** `comments_live.json` is a sanitized
    three-comment fixture; the live response returned 14. The full plan was not
    re-run after the comments fix (live budget), so the 33-call figure is the
    measured 29 plus four measured comment calls.

---

## Running the verification yourself

```bash
# one fresh plan, hard cap 40 live vendor calls
CREATORS_DATA_DIR=/Users/pranav/reel-engine/data \
NICHE_CACHE_HOURS=168 HANDLE_CACHE_HOURS=168 \
node --env-file=.env.local .tmp-build/scripts/verify-instagram-live.js \
  <handle> "<niche phrase>" --cap 40

# warm one niche for the app, cap 12
... verify-instagram-live.js --warm "<niche phrase>" --cap 12

# render a plan that is already cached without re-buying it
... verify-instagram-live.js <handle> "<niche phrase>" --cached --cap 15
```

The script refuses to start without `HIKERAPI_KEY`, prints the cap before the
first call, and exits 3 without sending the request that would cross it. It
never prints a key, a token or a signed URL.
