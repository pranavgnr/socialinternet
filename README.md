# Creators 101 (reel-engine)

Turns what is *actually working* on Reels, TikTok and Shorts into a plan for one
specific creator — with the evidence attached to every claim.

Not an "AI idea generator". An evidence pipeline: **harvest → score → converge →
decode → adapt → rank**. Any recommendation can be traced back to a real post
that beat its own account's median, and to how many independent accounts proved
the same theme.

The research behind the design (the nine ideation methods, the tool landscape,
the cost model, the sources) is in **[RESEARCH.md](./RESEARCH.md)**. Provider
options and prices are in **[docs/data-providers.md](./docs/data-providers.md)**.

---

## Why it is built this way

1. **Outliers, not view counts.** A post is interesting only relative to that
   account's own median. 50k views on a 10k-median account is a stronger signal
   than 2M views on a 2M-median account.
2. **One outlier is an anecdote.** The same theme overperforming on three
   unrelated accounts is demand. That is the `converge` stage.
3. **The opening is the product.** Instagram's own ranking explanation puts
   retention and shares first and calls out the first 3 seconds. So the pipeline
   asks *where the hook lives* — spoken, on-screen, or the picture itself — by
   reading the video locally.

## Two ways in

**With a handle** (`/`) — the account is read, its shape detected (singer,
vlogger, teacher, maker…), its niche inferred, a size-matched cohort assembled,
and a plan written. Every move cites a post. The idea feed is built from the same
paid pull, after the response is sent.

**Without a handle** (`/start`, `/discover`, `/room`) — rooms are ranked by
whether a newcomer can realistically break out, then a first-posts plan is built
from the room itself. `discover` prices any niche and shows which gates removed
what.

## Screens

| Route | What it does |
| --- | --- |
| `/` | The plan: standing, diagnosis, one next move, moves in order, songs / shapes / hooks, own-post audit, comments |
| `/ideas` | This week's posts, ready to film; mark made/posted/skipped and enter views |
| `/discover` | Search a niche: breakouts, the bar to beat, accounts to study, language/subject gate report |
| `/start` | Describe what you know; get rooms ranked for headroom, demand, openness, money, freshness |
| `/room` | A first-posts plan for a space, with no account required |
| `/weekly` | The Monday digest: what moved, the moves, the posts, earlier weeks |
| `/demo` | Copies a finished demo account to a fresh cookie — no credits spent |

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

The app runs with no keys at all: `/demo` is a real, finished account on disk and
the free YouTube web reader needs no key. Instagram reads need one paid vendor.

## Go live

Copy `.env.example` to `.env.local`. The provider router picks the cheapest
healthy vendor per call and fails over automatically:

- `APIFY_TOKEN` — Instagram; $5 free every month, then $2.30 / 1,000 results.
- `HIKERAPI_KEY` — Instagram; per-call price depends on account tier.
- `SCRAPECREATORS_API_KEY` — Instagram; $1.88 / 1,000 requests.
- `SOCIALCRAWL_API_KEY` — broadest coverage (transcripts, comments); $7.60 / 1,000 calls.
- `YOUTUBE_API_KEY` — official YouTube Data API (free, 10k units/day).
- `YOUTUBE_WEB=0` — disables the keyless YouTube fallback (on by default).
- `LLM_API_KEY` — generated copy; any OpenAI-compatible endpoint, defaults to DeepSeek.

`GET /api/status` reports what the running server actually has configured and
whether an Instagram vendor is funded *right now*.

Three things protect the budget:

1. **The cache is the default.** Niche pulls, handle feeds, posts, hooks and
   intent resolutions are cached on disk. Reopening any of them costs 0.
2. **Pre-flight readiness.** Paid pulls check that a vendor can actually serve
   them before spending, instead of dying at call 6 of 8.
3. **Hard per-run ceilings.** `SOCIALCRAWL_CREDIT_BUDGET`, `CREDIT_BUDGET`,
   `CREDIT_BUDGET_USD`, `ENRICH_MAX_CREDITS` and `ENRICH_CREDIT_RESERVE` bound a
   run, a vendor and the deep pass.

## The deep pass

Six decisive posts are bought (1 credit each, cached a week), then read locally:
`ffmpeg` + `whisper.cpp` for speech/language and macOS Vision OCR for on-screen
text. This answers whether the scroll was stopped by a sentence, a caption, or
the picture itself. Requires `ffmpeg`, a whisper model (`WHISPER_MODEL` or
`data/_models/`), and `scripts/ocr.swift`; without them it falls back to the
caption and says so.

## Weekly job

`GET /api/cron/weekly?secret=…` (or `x-cron-secret`) re-reads every account that
has a plan, records the week, and diffs it against the previous one. It is
capped (`WEEKLY_MAX`, default 3), sequential, and skips a week already recorded.
`POST /api/weekly` is the one-press version; `POST /api/weekly/rebuild` rewrites
stored weeks from disk for **0 credits**.

## Architecture

```
harvest   pull posts from providers, cache them, normalise every dialect
score     per-account median → ratio, velocity, engagement, trend phase
converge  cluster themes → count independent accounts → tier
decode    extract pattern cards: opening, format, tension, payoff, skeleton
adapt     songs / shapes / hooks / craft → drafts
rank      fit + novelty + convergence + timing − saturation − effort
plan      archetype → cohort → moves → one next move
```

Key files:

- `lib/providers/` — vendor router, adapters, credit ledger, budget guards.
- `lib/niche.ts` — niche research, language/subject gates, cache.
- `lib/plan.ts` — handle analysis, cohort, plan assembly, handle cache.
- `lib/newcomer.ts` — room plans for creators with no account yet.
- `lib/pipeline.ts` — the ideas pipeline.
- `lib/adapt.ts` / `lib/rank.ts` — idea generation and selection.
- `lib/weekly.ts` — weekly digest and diff.
- `lib/store.ts` — per-visitor JSON store. Swap for SQLite/Postgres at scale.

Scoring:

```
score = 0.30·signal + 0.24·convergence + 0.20·fit + 0.16·novelty
        + 0.08·timing − 0.18·saturation − 0.05·effort
```

## Storage

Everything lives under `data/` (override with `CREATORS_DATA_DIR`):

- `data/accounts/<uuid>/` — one visitor: `plan.json`, `profile.json`,
  `ideas.json`, `weekly.json`, `room.json`, `signals.json`, `runs.json`.
- `data/niches/` — shared niche pulls, keyed by phrase and TTL.
- `data/handles/` — per-handle feeds (`<slug>.json`, `<slug>--yt.json`).
- `data/_post_cache.json`, `_hook_cache.json`, `_intent_cache.json` — paid data
  reused for free.
- `data/_apify_usage.json`, `_youtube_usage.json` — vendor quota ledgers.

## Status

- Live path verified end-to-end against real keys: 150 reels from 92 accounts,
  33 outliers → 10 ideas; YouTube and Instagram identity are kept separate.
- Single-machine design: cookie-scoped accounts (unguessable UUID), in-memory
  rate limits, JSON storage. No login and no multi-tenant isolation yet.
- Not built: scheduled runs wired to a hosted cron, comment mining at scale,
  and a mobile capture view.

## Checks

```bash
npx tsc --noEmit

# Regression tests for the data-layer fixes:
npx tsc scripts/test-fixes.ts --module commonjs --target es2022 \
  --moduleResolution node --outDir .tmp-build --skipLibCheck \
  --esModuleInterop --lib es2022,dom --types node
node --test .tmp-build/scripts/test-fixes.js
```

`scripts/` also contains offline probes (`test-*`, `check-*`, `probe-*`) that
replay cached pulls and cost nothing. Files beginning with `_` are scratch.
