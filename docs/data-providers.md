# Data providers: options, costs, and the recommended stack

Researched 27 Oct 2026. All prices from the vendors' own pages on that date.

## What the app needs

1. Discover a niche: top reels + which accounts to benchmark (currently `search/reels`).
2. Benchmark accounts: recent reels with view counts (`profile/reels`).
3. Own account: the creator's real numbers (reach, plays, saves, shares).
4. Weekly refresh: re-pull the above every 7 days and diff.

Today `lib/harvest.ts` does (1) and (2) through SocialCrawl at 1 credit per page,
~7 credits per niche. (3) is not built at all.

## Option A — SocialCrawl (current)

- Free: 100 credits, one-time.
- Starter £15 / 2,500 credits → £0.0060 per call.
- Growth £49 / 20,000 credits → £0.0025 per call.
- Pro £299 / 150,000 credits → £0.0020 per call.
- One credit = one page. Cache hits cost 0. Credits never expire.
- Niche research (7 credits) = £0.017 on Growth. One creator + 5 competitors = £0.015.
- Strength: 676 endpoints, 69 platforms, one schema.
- Weakness: no recurring free tier after the first 100 credits; £15 minimum before
  a single real user exists.

## Option B — HikerAPI (cheapest for Instagram)

- $1 per 1,000 requests (~£0.00075/call), $0.60 per 1,000 at volume.
- 100 free requests, prepaid balance, never expires, no subscription.
- 100+ Instagram-only endpoints (profiles, reels, hashtags, followers, search).
- A niche costs 7 requests = $0.007 — about 3x cheaper than SocialCrawl Growth.
- Weakness: Instagram only. No TikTok/YouTube/Threads.

## Option C — Apify (best recurring free tier)

- Free plan: $5 of usage every month, recurring, no card. Unused credit does not roll over.
- `apify/instagram-scraper`: $1.50 per 1,000 results on paid plans, $2.70 per 1,000 on
  the free plan. One result = one post, reel, comment, profile or hashtag.
- A niche (~120 results) ≈ $0.032 at free-plan rates → about 15 niches/month free, forever.
- Starter $19/month includes $19 credit and the cheaper rate.
- Strength: proxies and blocking handled; you buy results, not promises.
- Weakness: per-result pricing is the most expensive of the three for deep dives.

## Option D — ScrapeCreators

- $47 one-time / 25,000 credits → $1.88 per 1,000 (~£0.0014/call).
- Free: 100 credits plus a claimable free bucket (vendor lists up to 7,000).
- TikTok-first, 25+ platforms, one-time credits.
- Good backup / TikTok path. Less mature on Instagram depth.

## Option E — EnsembleData

- 50 units/day free, recurring (~1,500/month) — the most generous standing free tier.
- $100/month for 1,500 units/day.
- Multi-platform: TikTok, Instagram, YouTube, Threads, Reddit, X.
- Good for the free tier early on; too pricey once you pass the free allowance.

## Option F — Official APIs (free, sanctioned, the real unlock)

**Instagram API with Instagram Login — the creator's own account.**
Free. The creator taps "connect", authorises once, and we get reach, plays/views,
saves, shares, profile visits, follower history. No Facebook Page needed.
This is the single most valuable data source and it costs nothing, forever.
Constraint: the account must be Business or Creator (most serious creators are).

**Instagram Business Discovery — competitor accounts.**
Free. Returns follower count, media count, and the last ~25 posts with like and
comment counts for other Business/Creator accounts. Rate limit is ~200 calls per
app user per hour. Hard limit: **no video view counts**, so view-based outlier
detection is impossible through it. Likes and comments only.

**YouTube Data API v3.**
Free, 10,000 units/day. channels + playlistItems + videos.list ≈ 3 units per
channel → ~3,000 channel pulls/day. `search.list` costs 100 units and is capped
at 100 calls/day, so never use it in a loop.

**TikTok Display API.** Own account only, free after app review.

## Option G — Self-hosted scraping (instaloader, Playwright)

- $0 in API fees, but needs residential proxies (~$1–3/GB) and constant repair.
- Account/IP bans, breakage every time Instagram ships a change.
- Only sane as a last-resort fallback for a handful of calls per day.

## Legal note

Scraping logged-out public data is not a computer-crime issue in the US
(hiQ v. LinkedIn), and in Jan 2024 the N.D. Cal. granted Bright Data summary
judgment against Meta's breach-of-contract claim for logged-out public scraping
(Meta v. Bright Data, 23-cv-00077). That is favourable but not a guarantee: Meta
still sues, and logged-in scraping is where the contract claim survives.
Practical rule: own-account data via official OAuth, competitor data via a
commercial provider that carries the risk, never store or resell raw personal
data, and keep a provider-neutral interface so any vendor can be swapped.

## Recommended stack

1. **Own profile → official OAuth (free).** Instagram Login + YouTube OAuth.
   Best data, zero marginal cost, no ToS risk. Powers "analyse my profile".
2. **Competitors → one cache per niche, shared by every user in that niche.**
   This is the cost lever, not the vendor. 1,000 creators in 100 niches = 100
   fetches per week, not 1,000.
3. **Uncached pulls → cheapest adapter per platform.** HikerAPI for Instagram,
   official API for YouTube, SocialCrawl for breadth when you need 3+ platforms
   in one call. Apify as the free-tier overflow.
4. **Weekly AI → no new scraping.** Generate from cache, refresh the niche cache
   once a week, diff against last week's plan.

### Cost at 1,000 weekly plans / 100 niches

- Own profiles via OAuth: £0.
- 100 niche refreshes × 7 calls = 700 calls/week.
  - HikerAPI: ~$0.70/week.
  - SocialCrawl Growth: ~£1.7/week.
- LLM: one plan per creator per week, small model.
- Total: comfortably under $20/month. Same workload fetched per-creator without
  caching would be 7,000+ calls/week, i.e. the same order, 10x.

### Starting from £0 today

Apify $5/month + EnsembleData 50 units/day + ScrapeCreators free bucket + the
official APIs together cover development and the first few dozen users without
spending anything. Buy a pack only when real users arrive.

## Build plan

1. `lib/providers/` — one interface (`searchReels`, `profileReels`, `profile`,
   `ownInsights`) with adapters: `socialcrawl`, `hiker`, `apify`, `graph`,
   `youtube`, `cache`. A router picks by platform, cost and availability, and
   every adapter writes to the same cost ledger.
2. Move the niche cache off the filesystem into SQLite/Postgres keyed by
   `niche_slug` + `fetched_at`, TTL 7 days, shared across users.
3. OAuth: Instagram Login (code flow, encrypted token at rest) and YouTube.
4. Weekly job: one cache refresh per niche, then per-user plan generation and
   delivery (Telegram/email).
5. Per-provider and per-user budget caps, so a bad loop cannot drain a balance.
