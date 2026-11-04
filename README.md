# Shambles

**The AI that works for creators.** Paste a public Instagram handle and Shambles
reads the account, shows what is actually working in its niche, and tells the
creator what to post next. Koko, the AI director, turns that read into scripts
and answers.

Not an idea generator. An evidence pipeline: **harvest → score → converge →
decode → adapt → rank**. Every recommendation can be traced to a real public
reel that beat its own account's median, and to how many independent accounts
proved the same theme.

- Launch scope and screen-by-screen design: [`docs/superpowers/specs/2026-11-03-shambles-launch-design.md`](./docs/superpowers/specs/2026-11-03-shambles-launch-design.md)
- Instagram data layer, costs and what one real plan bought: [`docs/instagram-data-layer.md`](./docs/instagram-data-layer.md)
- Provider options and prices: [`docs/data-providers.md`](./docs/data-providers.md)
- Small-VPS deployment: [`docs/deploy.md`](./docs/deploy.md)
- Research behind the design: [`RESEARCH.md`](./RESEARCH.md)

---

## What ships at launch

| Route | What it does |
| --- | --- |
| `/` | Landing page: the Shambles wordmark, one search bar, the hero line, the handle audit box, Koko, the locked vault, an example audit, trending rooms and FAQs. A signed-in visitor with a saved plan goes straight to their profile; `?new=1` always shows the landing page again. |
| `/profile/[handle]` | The six-section audit: vitals and authenticity, who they are and creator DNA, top three reels (why they worked), bottom three (why they flopped), comment-section analysis, and three next reel ideas from niche competitors. The owner also gets the next move and their tools. |
| `/search/niche/[query]` | The niche dossier: reels breaking out there, the bar to beat, views per follower, and a briefing written only from the numbers read. Cached rooms are free; an uncached room needs sign-in and 6 💎. |
| `/chat` | Koko's studio: persisted threads, context chips, one-tap actions, and `Script this (1 💎)` links from a profile. |
| `/ideas` | The owner's posts for this week, kept from the old studio. Reachable from the owner's profile only. |
| `/weekly` | The Monday digest: what moved, the moves in order, and the posts to make them with. Reachable from the owner's profile only. |
| `/offline` | The PWA offline shell. |
| `/demo` | Copies a finished real account to a fresh cookie, for judging the product without spending a credit. |
| `/start`, `/discover`, `/room` | Retired. A permanent (308) redirect sends `/start` to `/`, and `/discover` or `/room` to `/search/niche/<q>` when `?q=` is present, else `/`. |

No testimonials are invented and no numbers are made up. Sample content is
labelled **Example**. Every number on a profile or niche page comes from data
actually read; a section whose data is missing says so instead of showing a
number. Locked features are visibly locked and only open the waitlist.

Koko is the agent's name throughout. Credits are shown as 💎; amounts are
unchanged from the original engine.

---

## Run it

```bash
npm install
cp .env.example .env.local   # optional for a first look
npm run dev                  # http://localhost:3000
```

The landing page, the demo account and the free YouTube web reader need no
keys. Instagram reads need one paid vendor. A database is needed for sign-in,
the credit ledger, saved waitlist rows and the other Postgres-backed features;
without it the landing page and stored dossiers still render.

Apply the schema once (safe to re-run):

```bash
npm run migrate
```

Then, for a production build:

```bash
npm run build
npm run start -- -H 127.0.0.1 -p 3000
```

### Environment

Copy `.env.example` to `.env.local` (or `.env.production`). The full annotated
list, defaults and which values are secret is in [`docs/deploy.md`](./docs/deploy.md).
The groups that matter most:

- **Database:** `DATABASE_URL`, `DB_POOL_MAX` (default 5).
- **Instagram vendors:** `DATA_PROVIDER`, `APIFY_TOKEN`, `SCRAPECREATORS_API_KEY`,
  `SOCIALCRAWL_API_KEY`, `HIKERAPI_KEY` — at least one is required for an
  Instagram read. `HIKERAPI_COMMENTS` (default 1) controls the extra comment call.
- **Generation:** `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_REASONING_EFFORT`.
- **Sign-in:** `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **Budget and caches:** `CREDIT_BUDGET`, `CREDIT_BUDGET_USD`, `ENRICH_MAX_CREDITS`,
  `ENRICH_CREDIT_RESERVE`, `HARVEST_CACHE_HOURS`, `NICHE_CACHE_HOURS`,
  `HANDLE_CACHE_HOURS`, `PROFILE_CACHE_HOURS`, `OWNER_CACHE_HOURS`,
  `POST_CACHE_HOURS`.
- **Profile reads:** `OWNER_PROFILE_MAX` (default 12), `PEER_MAX` (6),
  `PEER_LOOKUP_MAX` (6), `AUTH_SAMPLE_PAGES` (default 0 = authenticity sampling
  off), `VIDEO_READ_MAX` (6), optional `GEMINI_API_KEY` / `GEMINI_MODEL`.
- **Jobs and waitlist:** `CRON_SECRET`, `WEEKLY_MAX`, `WAITLIST_GLOBAL_PER_HOUR`
  (default 300), `CANARY_HANDLE`, `CANARY_MAX_USD`, `CANARY_WEBHOOK_URL`.
- **Runtime:** `CREATORS_DATA_DIR` (default `./data`), `COOKIE_SECURE`.

`GET /api/status` reports what the running server actually has configured and
whether an Instagram read is funded right now. It never echoes a secret.

---

## How it works

```
harvest   pull public posts from providers, cache them, normalise every dialect
score     per-account median → ratio, velocity, engagement, trend phase
converge  cluster themes → count independent accounts → tier
decode    extract pattern cards: opening, format, tension, payoff, skeleton
adapt     songs / shapes / hooks / craft → drafts
rank      fit + novelty + convergence + timing − saturation − effort
plan      archetype → cohort → moves → one next move
```

The three rules that keep it honest:

1. **Outliers, not view counts.** A post matters only relative to that account's
   own median. 50k views on a 10k-median account is stronger evidence than 2M on
   a 2M-median account.
2. **One outlier is an anecdote.** The same theme overperforming on unrelated
   accounts is demand; that is the `converge` stage.
3. **The opening is the product.** The deep pass buys six decisive posts and
   reads speech and on-screen text locally, so the plan can say where the hook
   actually lives — spoken, on screen, or the picture itself.

Scoring:

```
score = 0.30·signal + 0.24·convergence + 0.20·fit + 0.16·novelty
        + 0.08·timing − 0.18·saturation − 0.05·effort
```

Key files:

- `lib/providers/` — vendor router, adapters, credit ledger, budget guards.
- `lib/niche.ts` / `lib/nicheDossier.ts` — niche research, gates, cache, dossier.
- `lib/plan.ts` / `lib/profileView.ts` / `lib/profileStore.ts` — handle analysis,
  cohort, six-section view, stored dossiers.
- `lib/authenticity.ts` — the follower-sample estimate (dormant by default).
- `lib/videoReader.ts` — caption reader plus the optional Gemini video reader.
- `lib/kokoActions.ts` / `lib/renderCards.ts` — Koko's one-tap actions and the
  safe markdown-to-card renderer.
- `lib/waitlist.ts` — contact normalisation and idempotent signups.
- `lib/store.ts` — per-visitor JSON store. Swap for SQLite/Postgres at scale.
- `lib/legacyRoutes.ts` + `proxy.ts` — the permanent redirects for retired pages.

The data layer is documented separately in
[`docs/instagram-data-layer.md`](./docs/instagram-data-layer.md), including the
vendor order, the exact costs of one plan, and what is still missing.

### Storage

Everything mutable lives under `data/` (override with `CREATORS_DATA_DIR`):

- `data/accounts/<uuid>/` — one visitor: `plan.json`, `profile.json`,
  `ideas.json`, `weekly.json`, `signals.json`, `runs.json`.
- `data/profiles/` — stored profile dossiers.
- `data/niches/` — shared niche pulls, keyed by phrase and TTL.
- `data/handles/` — per-handle feeds.
- `data/_post_cache.json`, `_hook_cache.json`, `_intent_cache.json`,
  `_owner_profiles.json`, `authenticity.json`, `video_readings.json` — paid data
  reused for free.

Postgres holds users, sessions, the credit ledger, chat threads, trending
niches, creator profiles, the vendor canary and `waitlist_signups`.

### Progressive Web App

Shambles ships installable: `app/manifest.ts` (name, colours from the design
tokens, icons, shortcuts), `public/sw.js` (network-first navigations with an
`/offline` fallback, stale-while-revalidate for static assets, and no caching of
non-GET, `/api/*`, credentialed or `Set-Cookie`/`no-store` responses), plus the
install prompt and the iOS "Add to Home Screen" hint. The worker registers only
in production. Service workers require HTTPS except on `localhost`; testing
from a phone over a plain LAN address will not register the worker. See
[`docs/deploy.md`](./docs/deploy.md#the-service-worker-https-and-installability).

---

## API: internal and legacy endpoints

Every route below is kept and gated. There is no UI for the ones marked "none".

| Route | Used by |
| --- | --- |
| `POST /api/plan` | Landing audit box (`components/HandleAudit.tsx`). |
| `POST /api/profile` | The profile page's paid read panel (`components/profile/ReadPanel.tsx`). |
| `POST /api/niche` | The niche page's paid read panel (`components/niche/ReadPanel.tsx`). |
| `POST /api/chat` | Koko studio (`components/koko/KokoStudio.tsx`). |
| `POST /api/waitlist` | Every vault and locked card (`components/WaitlistForm.tsx`). |
| `POST /api/weekly` | "Pull this week" (`components/WeeklyRefresh.tsx`). |
| `PATCH /api/idea/[id]` | Marking an idea made/posted/skipped (`components/IdeaCard.tsx`). |
| `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/logout` | Header sign-in and sign-out. |
| `GET /api/weekly/rebuild` | None — maintenance/CLI only. |
| `GET /api/trending` | None — the landing page reads the ranking server-side; the cron route rebuilds it. |
| `GET /api/status` | None — operations and the deployment smoke test. |
| `GET /api/cron/weekly`, `/api/cron/trending`, `/api/cron/canary` | None — called by the host's scheduler with `x-cron-secret`. |
| `GET/POST /api/room` | None — retired room plans. Kept and gated. |
| `GET/POST /api/recommend` | None — retired recommendation path. Kept and gated. |

The two routes with no UI are deliberately not deleted: they are covered by
tests and remain the server-side implementation for a future screen.

---

## Tests

Tests run offline with `node:test`; paid vendors are replayed from fixtures.
Run one script with:

```bash
npm run test:file -- test-waitlist
# or directly
sh scripts/run-test.sh test-waitlist
```

The suite covers the data layer, credits, auth, gates, the plan and profile
views, niche dossiers, Koko, authenticity, video readings, the waitlist, the
redirect table, PWA rules and more. Type-check and build before shipping:

```bash
npx tsc --noEmit
npm run build
```

`scripts/` also contains offline probes (`check-*`, `probe-*`) that replay cached
pulls and cost nothing, and live-verification scripts that require keys. Files
beginning with `_` are scratch.

---

## Known limits

- **One machine.** Sessions, the credit ledger and the JSON plans assume one
  server. Rate limits are in memory: they reset on restart and are not shared
  between processes.
- **Plans, ideas, dossiers and digests are JSON on local disk.** They survive
  restarts only because the data directory is a volume. Back it up.
- **The deep pass is caption-only on Linux.** macOS Vision OCR is macOS-only, so
  a Linux deployment reads captions and says so. Video-level hook reading needs
  a macOS worker or a Linux OCR replacement.
- **The video reader is optional and billed by Google** per token, not in gems.
  Without `GEMINI_API_KEY` every profile is captions-only and labelled that way.
- **Authenticity sampling is dormant by default.** One follower page is below
  the 40-row floor, so the estimate only runs when `AUTH_SAMPLE_PAGES` is
  positive after paging is verified.
- **Postgres and the app should both be in Mumbai.** A database in another
  region adds latency to every page and every credit check.
- **No notifications, email or scheduled runs without a host cron.** The cron
  routes are the interface; the scheduler is the operator's.

## Roadmap

Locked at launch, joining the waitlist only:

- **IG Wrapped** — a year-end recap for a creator's account.
- **Rate card** — what a creator should charge a brand, from their real numbers.
- **Mini-business** — a shop/dine/stay presence built from the account.
- **Comment-to-DM** — turn comment requests into replies.
- **VIP** — the paid tier.
- **Communities and payments** — post-launch.

Deliberately deferred:

- **No `DEMO_FALLBACK` switch.** There is no demo-data engine to fall back to,
  and inventing one would put unlabelled fake numbers on screen. `/demo` copies
  a finished real account instead; sample content elsewhere is labelled
  **Example**. A production-only demo-data engine remains a possible later
  addition, behind a visible "Demo data" badge.
- **No hosted scheduler, multi-region database or read replica.** One VPS, one
  database, backups documented in `docs/deploy.md`.
