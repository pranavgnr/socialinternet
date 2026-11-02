# Instagram-only data layer — design

Status: approach chosen by the founder ("A"), 2026-11-03.

## Intent

Every number and every competitor on the site must come from Instagram Reels.
Today an Instagram creator's niche evidence and cohort can come from YouTube,
because the router prefers the free YouTube reader for keyword search and no
Instagram vendor with keyword search is funded. The founder has bought HikerAPI
and Apify credits and wants Instagram, reels only, India first.

## Goals

- Niche search, competitor discovery, profile reads, comments and video links all
  come from Instagram reels; no plan, niche view or competitor list ever contains
  a YouTube row.
- HikerAPI is the primary vendor for everything; Apify is the fallback.
- Competitor targeting that is explainable: why each account was chosen.
- Cost per full plan measured and shown (live verification script).

## Non-goals

- Other platforms (kept dormant in code, not deleted, not reachable from the UI).
- Our own scraper (revisit above ~$300-500/month vendor spend).
- Video analysis with a multimodal model, bot/authenticity estimate, audience
  demographics, the Shambles redesign (separate specs).

## Anti-goals

- Silently serving another network's data under an Instagram label.
- Spending the founder's vendor credits in tests (tests use recorded fixtures).

## Approaches considered

- A. HikerAPI for everything, Apify as backup. **Chosen.** A profile read is two
  calls (about $0.04 at the $0.02 starter rate; about $0.002 at the $0.001 rate),
  cheaper than Apify's $0.065 for the same read.
- B. Split by job (Apify profiles, HikerAPI search). Rejected: two vendors in the
  hot path for a small saving.
- C. A plus an own scraper. Deferred.

## Verified facts (live, 2026-11-03, 14 HikerAPI calls)

- `/v2/user/by/username` returns followers, bio, category, media count.
- `/v2/user/clips?user_id=` returns 12 reels per call with play_count, likes,
  comments, reshare_count, duration, video URL, music, caption.
- `/v2/search/reels?query=` returns 12 real Instagram reels per call
  (`reels_serp_modules[].clips[].media`) with the same fields; no owner
  follower count.
- `/v1/user/followers/chunk?user_id=` returns 25 followers per call.
- Flaky or failing: `/v2/hashtag/medias/top` (empty on a second call),
  `/v1/media/comments/chunk` (HTTP 422, wrong parameter), related profiles
  (HTTP 500 once, "Instagram did not respond").

## Parts

1. HikerAPI adapter corrected against recorded live fixtures: reel search through
   `/v2/search/reels`, hashtag as fallback, comments, retry on transient 5xx.
2. Instagram-only enforcement in the router and the product paths, HikerAPI first.
3. Owner follower counts for search results (cached), so views / followers can be
   computed.
4. Competitor discovery v2 with reasons, filters and a cap.
5. A live verification script that runs one full plan and prints the cost.

## Left to the builder

Fixture format, retry counts, cache location for owner profiles, scoring weights
for competitor ranking (must be explainable and tested).
