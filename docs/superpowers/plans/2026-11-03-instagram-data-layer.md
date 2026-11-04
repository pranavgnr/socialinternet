# Instagram-only Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every niche, competitor, profile and comment in a plan come from Instagram reels via HikerAPI (Apify as fallback), and never from YouTube.

**Architecture:** Keep the provider router in `lib/providers`. Correct the HikerAPI adapter against recorded live responses, make `platform: "instagram"` mandatory on every search/read path, enrich search rows with owner follower counts, and rebuild peer discovery on HikerAPI with stated reasons.

**Tech Stack:** Next.js 16.4.3, TypeScript, `node:test` via `npm run test:file -- <name>`, PGlite not needed.

**Spec:** `docs/superpowers/specs/2026-11-03-instagram-data-layer-design.md`

## Global Constraints

- Instagram reels only: rows are `product_type === "clips"`; platform is always `"instagram"`; no automatic YouTube fallback anywhere in a plan, niche view or competitor list. YouTube code stays dormant, not deleted.
- HikerAPI first for every Instagram call, Apify second. Env: `HIKERAPI_KEY`, `HIKERAPI_USD_PER_CALL` (default 0.02 until the founder reaches the $100 tier), `APIFY_TOKEN`.
- Tests use recorded fixtures under `lib/providers/__fixtures__/hikerapi/`; they never call the network. Live calls are allowed only in Task 1 step 1 (fixture capture, at most 12 calls), Task 1 step 6 (comments debugging, at most 8 calls) and Task 5 (verification script). Total live budget for the whole plan: 90 HikerAPI calls (the founder is topping up). Never print API keys.
- **Cache everything live so the founder can try it:** every live run (fixture capture excepted) is executed with `CREATORS_DATA_DIR=/Users/pranav/reel-engine/data`, so niche and handle results land in the shared cache the preview server reads. Cached niches open free for anyone; cached handle reads refund the charge.
- Fixtures contain no secrets and no personal data beyond public handles already in the probe (`_shravyapawar_`, search results for "kannada songs").
- Never print a number for an account that was not read (existing rule). User-visible strings go through `lib/plain.ts`.
- Run `npx tsc --noEmit` and `npm run build` before each commit; commit after every task. The worktree is `/Users/pranav/.local/share/opencode/worktree/92fd59/creators-101-v1`, branch `creators-101-v1`.
- Read `node_modules/next/dist/docs/` before touching Next APIs.

## Review Focus

1. HikerAPI answers 404, 422, 500 ("Instagram did not respond"), or an empty body: the plan shows an honest message and never crashes or invents rows (Task 1).
2. A reel with `play_count` 0, missing, or a non-clips row in a result list is skipped or zero-safe (Task 1).
3. A private, renamed or nonexistent handle (e.g. `kusha.kapila` returned 404 in the live probe): clear error, no charge beyond the call made (Tasks 1, 2).
4. Search phrases in Hinglish or native script ("कन्नड़ गाने", "kannada songs", "telugu cover songs"): the query is sent as given, not mangled to a hashtag (Task 1).
5. No path can put a YouTube row in a plan, niche view or peer list, even when HikerAPI is down and Apify is out of credit (Task 2): the result is an honest "no Instagram data source available", not YouTube.
6. Owner-profile enrichment and peer reads can never exceed their per-niche / per-plan call caps (Tasks 3, 4).
7. A creator with fewer than 12 reels, or no reels tab content (Task 1).

---

### Task 1: HikerAPI adapter corrected against live fixtures

**Files:**
- Create: `scripts/capture-hikerapi-fixtures.mjs`, `lib/providers/__fixtures__/hikerapi/{user_by_username,user_clips,search_reels,followers_chunk,comments}.json`, `scripts/test-hikerapi.ts`
- Modify: `lib/providers/hikerapi.ts`

**Interfaces:**
- Produces (on the existing `DataProvider` shape, unchanged signatures): `hikerapi.profileReels(handle)`, `hikerapi.searchReels(query)`, `hikerapi.post(url)`, `hikerapi.profile(handle)` returning unified rows that `harvest.normalise` reads; new internal `getWithRetry(path, params)` that retries once, after 800 ms, on HTTP 5xx or a body whose `exc_type` is `InstagramServerError`, and never retries 4xx.

- [ ] **Step 1: Capture fixtures** with `scripts/capture-hikerapi-fixtures.mjs` (reads `HIKERAPI_KEY` from env, run with `node --env-file=.env.local`): one call each for `/v2/user/by/username?username=_shravyapawar_`, `/v2/user/clips?user_id=32334432364`, `/v2/search/reels?query=kannada songs`, `/v1/user/followers/chunk?user_id=32334432364`; save the JSON bodies. Truncate each list to 12 items and strip signed CDN URLs' query strings so no tokens are stored. Commit the fixtures.
- [ ] **Step 2: Write failing tests** in `scripts/test-hikerapi.ts` with an injected `fetch` serving the fixtures: `profileReels("_shravyapawar_")` yields 12 rows, all `platform: "instagram"`, with `views` equal to `play_count`, shares from `reshare_count`, `url` built from `code`, `mediaUrl` from `video_versions[0].url`, `durationSec`; `searchReels("kannada songs")` calls `/v2/search/reels` first with the query unmodified and yields 12 rows; a non-`clips` item is dropped; a reel with missing `play_count` gets `views: 0`; a 500 `InstagramServerError` followed by a 200 returns rows (retry once) and a second 500 throws `ProviderUnavailable` with `exhausted: false`; a 404 throws `ProviderUnavailable` with `exhausted: false` and a message naming the handle; a 402 or 403 marks `exhausted: true`.
- [ ] **Step 3: Run tests.** Expected: FAIL.
- [ ] **Step 4: Implement** in `lib/providers/hikerapi.ts`: `profileReels` resolves the user id then reads `/v2/user/clips` (keep any existing fallback to `/v2/user/medias` only if clips is empty, filtered to clips); `searchReels` calls `/v2/search/reels` with the raw `query`, flattens `reels_serp_modules[].clips[].media`, and only falls back to `/v2/hashtag/medias/top` (existing tag logic) when the search returns zero rows; add `getWithRetry`; keep `usd` accounting per call.
- [ ] **Step 5: Run tests.** Expected: PASS.
- [ ] **Step 6: Fix comments.** The live call `/v1/media/comments/chunk?media_id=<id>` returned HTTP 422. Using at most 8 live calls, find the working parameter and endpoint (candidates: `id`, `media_id` with the numeric pk, `/v2/media/comments`, `/gql/comments`), record one fixture `comments.json`, make `hikerapi.post` read it into `post.ext.top_comments` (`text`, `likes`, `author`, `published_at`), and add a test. State in the report which endpoint and parameter work.
- [ ] **Step 7: Run all HikerAPI tests, `npx tsc --noEmit`, `npm run build`; commit** `fix: hikerapi adapter verified against live responses`.

### Task 2: Instagram-only enforcement

**Files:**
- Modify: `lib/harvest.ts`, `lib/providers/index.ts`, `lib/providers/youtubeweb.ts` (preference only), `lib/plan.ts` (`readOwnAccount`), `lib/niche.ts`, `app/api/niche/route.ts` and any caller found by grep that reads Instagram without `platform`
- Test: `scripts/test-instagram-only.ts`

**Interfaces:**
- Consumes: Task 1's adapter.
- Produces: `searchReelsWithMeta(query)` and every niche/competitor call pass `platform: "instagram"` to `request`; with Instagram vendors benched or unconfigured they throw `Error("No Instagram data source is available right now")` (exact text) instead of falling to another network; router order for Instagram paths is HikerAPI, Apify, SocialCrawl, ScrapeCreators (explicit `preference`, not price alone).

- [ ] **Step 1: Write failing tests** with stub providers: keyword search with only `youtubeweb` configured throws the exact message above and makes no call to it; with HikerAPI benched and Apify configured, Apify's `searchReels` (which throws "no keyword search") is skipped honestly and the error text is the same exact message; with HikerAPI configured it is called first even when Apify's effective price is lower; `readOwnAccount` no longer falls back to YouTube (a nonexistent handle raises the Instagram error and never sets `fellBackFrom`); a niche view built from rows contains no row with `platform !== "instagram"`.
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add `platform: "instagram"` to `searchReelsWithMeta`, `harvestInstagramSearch`, `searchInstagramAccounts` and the niche top-up path; give HikerAPI a `preference` of -3 for Instagram paths; remove the YouTube branch from `readOwnAccount` (leave `pullOwn(..., "youtube")` callable only when `platform` is passed explicitly, which no UI does) and delete `fellBackFrom` use from plan building; `youtubeweb.preference` returns 99 for every path so it can never be first; add a final filter in niche building that drops any row whose platform is not instagram and logs once.
- [ ] **Step 3b: Cache lifetime.** `lib/niche.ts` has a hard-coded `CACHE_TTL_HOURS = 12`; make it `Number(process.env.NICHE_CACHE_HOURS ?? 12)` and do the same for the hard-coded `HANDLE_TTL_HOURS = 12` in `lib/plan.ts` (`HANDLE_CACHE_HOURS`, default 12; `lib/harvest.ts` already reads `HARVEST_CACHE_HOURS`), document `NICHE_CACHE_HOURS` and `HANDLE_CACHE_HOURS` in `.env.example` and `docs/deploy.md`, and add tests that a niche and a handle record aged 100 hours are cached with the variables set to 168 and stale with the defaults.
- [ ] **Step 4: Run tests and the earlier suites that touch these files** (`test-gate`, `test-room`, `test-recommend`, `test-weekly`, `test-trending`, `test-competitor`).
- [ ] **Step 5: `npx tsc --noEmit`, `npm run build`; commit** `fix: Instagram-only data paths, HikerAPI first`.

### Task 3: Owner follower counts and the views-to-followers multiple

**Files:**
- Create: `lib/ownerProfiles.ts`, `scripts/test-owner-profiles.ts`
- Modify: `lib/niche.ts` (call it after a fresh search)

**Interfaces:**
- Produces: `resolveOwnerFollowers(handles: string[], opts?: { max?: number; now?: () => number }): Promise<Map<string, number>>` — reads each handle once through `fetchInstagramProfile`, caches the follower count in `data/_owner_profiles.json` for 7 days (honours `CREATORS_DATA_DIR`), skips handles already cached, stops after `max` fresh reads (default 12), never throws for one handle's failure; and `multiple(views: number, followers: number | undefined): number | null` returning `views / followers` or `null` when followers is missing or 0.

- [ ] **Step 1: Failing tests:** cached handles cost zero reads; `max` caps fresh reads at the cap; one failing handle is omitted and the rest resolve; expiry after 7 days triggers a fresh read; `multiple(812855, 57739)` is about 14.08 and `multiple(10, 0)` is `null`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement.** Use an injected reader for tests.
- [ ] **Step 4: Wire into niche research:** after a fresh keyword search, resolve owners of the reels (unique handles, highest views first), attach `followers` to those `RawReel`s, and let the existing outlier maths use them. The extra calls count toward the niche's credit measurement. Per-niche cap 12.
- [ ] **Step 5: Run tests, `tsc`, `build`; commit** `feat: owner follower counts for search results`.

### Task 4: Competitor discovery v2

**Files:**
- Modify: `lib/peers.ts`, `lib/providers/hikerapi.ts` (add `searchAccounts` and `relatedProfiles` if the live shapes are confirmed), `lib/providers/types.ts` (optional `relatedProfiles?(userId|handle)`)
- Test: `scripts/test-peers-v2.ts`

**Interfaces:**
- Produces: each `PeerAccount` gains `reasons: string[]` (plain words, e.g. "appears in Instagram's similar accounts", "posts reels about 'kannada songs'", "same language", "about your size") and `source: "similar" | "search" | "hashtag" | "owner-of-top-reel"`; `instagramPeers(...)` keeps its signature.
- Selection rule (pure function `rankPeers(candidates, creator)`, unit-tested): drop private accounts, accounts inactive for more than 30 days, accounts outside 0.3x to 3x the creator's followers when at least `PEER_MIN_COHORT` candidates remain inside that band (otherwise widen and label it), accounts in another language (existing `cohort.ts` check); score = source weight (similar 3, search 2, hashtag 2, owner-of-top-reel 1) plus 1 per extra source plus 1 for same language, minus 1 for outside the band; keep at most `PEER_MAX` (default 6); every kept peer has at least one reason.

- [ ] **Step 1: Failing tests** for `rankPeers` with fixture candidates (band filter, widening label, inactive drop, private drop, duplicates merged across sources, cap, every peer has reasons, ties broken by handle for stable output) and for `instagramPeers` with a stub vendor returning related profiles that include a private and a stale account.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Probe the two live shapes** (at most 6 live calls): `/gql/user/related/profiles` (the earlier call sent the wrong id parameter; try `id`, `user_id`) and `/v2/search/accounts?query=` or `/v2/fbsearch/accounts`; record sanitized fixtures; implement the adapter methods and register them on the router (`/instagram/related/profiles`, existing `/instagram/search/accounts`) with HikerAPI first.
- [ ] **Step 4: Implement** `rankPeers` and rewire `instagramPeers` to gather candidates from related profiles, account search for the niche phrase, and the owners of the top reels already pulled for the niche (free, no extra calls).
- [ ] **Step 5: Run tests plus `test-room`, `test-recommend`, `test-competitor`; `tsc`; `build`; commit** `feat: competitor discovery with reasons`.

### Task 5: Live verification and cost report

**Files:**
- Create: `scripts/verify-instagram-live.ts`, `docs/instagram-data-layer.md`

- [ ] **Step 1: Write the script:** `npx tsx`-free like the others (compile with tsc, run with `node --env-file=.env.local`), taking a handle and a niche phrase; it runs `analyseHandle` end to end with `force: true`, then prints: vendor calls per endpoint, USD spent, credits charged at 6 per read, number of peers with their reasons, share of rows with `platform === "instagram"` (must be 100%), count of reels with views, and the first three evidence post URLs. It refuses to run if `HIKERAPI_KEY` is missing and prints a call cap (default 40) it will not exceed.
- [ ] **Step 2: Run it once** for `_shravyapawar_` with niche "kannada songs" (at most 40 live calls), with `CREATORS_DATA_DIR=/Users/pranav/reel-engine/data` and `NICHE_CACHE_HOURS=168`. Then warm the cache for two more niches that Indian creators search (`telugu songs cover`, `daily vlogs india`) by running `researchNiche` (at most 25 more calls) so the founder can open them free from the app. Paste the output into `docs/instagram-data-layer.md` under "Verified on 2026-11-03", with the cost per full plan at the $0.02 and $0.001 rates.
- [ ] **Step 3: Document** env vars, the vendor order, how to read the call/cost ledger, the known gaps (no reach/saves/retention/demographics; bot score is an estimate to be built later), and the Linux note that video reading needs the multimodal step planned separately.
- [ ] **Step 4: `tsc`, `build`; commit** `docs: instagram data layer verified live`.

---

## Self-review

- **Spec coverage:** adapter (Task 1), Instagram-only and vendor order (Task 2), owner followers (Task 3), competitors (Task 4), live verification (Task 5).
- **Deferred by the spec:** multimodal video analysis, bot estimate, demographics, Shambles redesign.
- **Open inputs:** none. HikerAPI has 86 free calls left; the founder is buying more.
