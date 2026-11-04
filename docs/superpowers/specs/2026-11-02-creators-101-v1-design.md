# Creators 101 — V1 design

Status: draft for approval. Date: 2026-11-02.

## Intent

Build, for Indian Instagram creators, a free AI analytics and next-reel tool.
The tool is the acquisition hook. The company's moat is distribution: a large
pool of creators on the platform, later monetised through communities, a
venue-barter marketplace with score-based cashback, and a brand-deals pipeline.
V1 only builds the hook, but must not block those later phases.

## Positioning

Creators 101 is an AI-first influencer platform. The tool works for the
influencer: their analytics, drafts and chats are theirs, and brands never see
them. The platform is also fair to brands, who get honest signal and a clean way
to work with creators. Long term it is the bridge between the two, and V1 earns
the creator side of that bridge by being useful for free.

Rules that follow from this:
- Creator-facing copy speaks to the creator's interest, never to a brand's.
- V1 builds nothing brand-facing, but must not make the brand side harder later:
  keep a creator profile record that can become a public media kit, and keep
  per-user data private by default with explicit sharing.
- The score and rate-card features (V1.5 onward) apply the same rules to every
  creator and are explainable to the creator.

## Business goals V1 must serve

- Maximise creators signed up and returning weekly (the distribution moat).
- Capture each creator's handle, niche and size at sign-in. This is the supply
  side the later marketplace needs.
- Keep marginal cost per free user bounded by the daily credit pool.

## Goals

- A creator lands, understands the value in seconds, and reaches a useful
  result (niche view or profile analysis) with almost no friction.
- Creators come back because the tool tells them what to post next.
- Cost per free user stays bounded by a daily credit pool.
- Launch without waiting on Meta App Review.

## Non-goals (V1)

- Real Instagram Login / verified metrics (V1.5, closed beta first).
- Payments / UPI credit packs (V1.5).
- Communities, collab matcher, bot audit (V2).
- Venues, cashback score, brand deals, invoicing (V3).
- The shareable "8x your usual" creator card (rejected by the founder).
- Other platforms or countries.

## Anti-goals

- Burning vendor money on anonymous traffic.
- Printing numbers for an account we did not read (existing product rule).
- A general-purpose chatbot that answers things not backed by data.

## Constraints

- India first; Hinglish and regional-language content must work (the existing
  language gate handles this).
- Public-data reads via scraping vendors; Meta Advanced Access needs App Review
  and Business Verification, so it cannot gate launch.
- The existing engine in `lib/` is the product's core and is kept.

## Approaches considered

- A. Evolve the repo as is (JSON files, cookie accounts). Fastest, but credits
  and logins in JSON files plus in-memory rate limits are unsafe.
- B. Keep the engine, add Postgres for new state only. **Chosen.**
- C. Fresh codebase. Rejected: rebuilds the hard part.

## V1 scope

### 1. Landing page (`/`)
Hook headline, a handle box ("Connect your Instagram" — in V1 this takes a
handle and reads public data), a niche search bar, and 24–30 trending-niche
bubbles. Signed-in users with a plan see their dashboard instead.

Candidate hooks (creator-first, brand-neutral):
- "Know what to post before you post it."
- "Instagram shows you numbers. We tell you what to do next."
- "The AI that works for creators."
- "Your next reel, built from what is already working in your niche."
- "Know your worth, then grow it." (leans toward the later rate card)

### 2. Trending niches
24–30 niches, seeded from the ~50 already cached, refreshed weekly by a cron
job (about $2/week at SocialCrawl rates). "Trending" must be measurable: ranked
by the existing opportunity score and breakout rate, not invented. Clicking a
bubble opens the cached niche view (free).

### 3. Niche explorer
Existing `/discover` behaviour: top accounts, best reels, gate report. Cached
niches cost 0 credits; a fresh niche costs credits.

### 4. Profile analysis
Any handle (own or competitor). Existing `analyseHandle` output: standing, best
3 / worst 3 with why, what worked, comment themes, next move. For competitors,
the same read without personalised advice.

### 5. Chat assistant
Grounded only in the analysed data (plan, audit, comments, niche signals).
Answers "what should I post next", generates hook + script + caption. Refuses
off-topic requests. One credit per message.

### 6. Accounts and credits
Google sign-in. A daily free credit pool resets at midnight IST. Cached view
costs 0; a fresh niche read, a fresh handle read and a chat message cost
credits (amounts set by the builder from measured vendor cost). Every spend is
a ledger row. Anonymous visitors may open cached niches only.

## Data layer

- Keep the provider router. Intended roles: SocialCrawl for niche search,
  Apify or ScrapeCreators for profiles/comments, HikerAPI once its rate is
  verified.
- Before launch, one live call to confirm whether Business Discovery returns
  `view_count`; if yes it becomes a free competitor supplement.
- Correct Apify's price constant to the free-plan rate ($2.70 / 1,000).
- Add a daily canary probe per vendor that alerts when output degrades.

## New state (Postgres)

users, credit_ledger, chat_threads, chat_messages, trending_niches. Plans,
ideas and weekly digests move from per-visitor JSON to the database keyed by
user id. Vendor caches stay on disk initially.

## Hosting

A small VPS in an Indian region. Not serverless: the deep pass needs disk,
ffmpeg, whisper and long requests. The macOS-only OCR script does not run on
Linux; hook reading falls back to caption mode (already supported) until an
OCR replacement is chosen.

## Parallel track (founder)

Meta business verification and App Review paperwork; venue and brand outreach.

## Left to the builder

Schema details, chat prompt design, exact credit prices, bubble UI, deployment
tooling, OCR replacement, migration of existing visitor JSON.

## Calls made by the author (not agreed in conversation)

- Google sign-in over phone OTP (SMS in India needs DLT registration).
- Daily reset at midnight IST.
- Chat restricted to analysed data.
- Postgres as the database.
- Bubbles ranked by the existing opportunity score.
