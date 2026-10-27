# Reel Engine

Turns what is *actually working* on Reels, TikTok and Shorts into filmable ideas
for one specific creator — with the evidence attached to every idea.

Not an "AI idea generator". An evidence pipeline: harvest → score → converge →
decode → adapt → rank. Any idea on screen can be traced back to a real reel that
beat its own account's median, and to how many independent accounts proved the
same theme.

The research behind the design (all nine ideation methods, the tool landscape,
the cost model, the sources) is in **[RESEARCH.md](./RESEARCH.md)**.

---

## Why it is built this way

Three findings drove the architecture:

1. **Outliers, not view counts.** A reel is interesting only relative to that
   account's own median. 50k views on a 10k-median account is a stronger signal
   than 2M views on a 2M-median account.
2. **One outlier is an anecdote.** The same theme overperforming on three
   unrelated accounts is demand. This is the `converge` stage, and it is the
   thing competing tools don't do.
3. **The hook is the product.** Instagram's own ranking explanation puts
   retention and shares first and calls out the first 3 seconds. So every idea
   ships with three spoken hook variants, not a topic label.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Works immediately in **demo mode** with a fixture corpus and template-generated
copy — no keys needed. Press **Run** to execute the pipeline.

## Go live

Copy `.env.example` to `.env.local` and fill in what you have.

- `SOCIALCRAWL_API_KEY` or `YOUTUBE_API_KEY` → switches harvest from fixtures to
  real reels (YouTube Data API is free, 10k units/day).
- `LLM_API_KEY` → switches idea copy from templates to generated. Any
  OpenAI-compatible endpoint; defaults to DeepSeek.

The header shows which mode is active, so you always know whether you are
looking at real data.

## Screens

- `/` — ranked idea feed. Each card: hooks, beats, shot list, on-screen text,
  caption, why-this, and a proof badge (`validated` = 3+ accounts, `supported` =
  2, `single` = 1). Mark filmed/posted/skipped; posting views feed back into
  ranking.
- `/sources` — the accounts and keywords being watched, and the raw signals with
  their receipts (ratio, velocity, engagement, sound usage, trend phase).
- `/pipeline` — run history, per-step timings, counts, errors.
- `/settings` — niche, audience, offer, pillars, voice, banned words, physical
  constraints, benchmarks, keywords.

## How it works

```
harvest   pull reels from benchmarks + keyword search + your own account
score     median baseline per account → ratio, velocity, engagement, trend phase
converge  cluster outliers by theme → count independent accounts → tier
decode    extract pattern cards: hook type, format, tension, payoff, skeleton
adapt     three translation moves → hooks, beats, shots, caption, constraints
rank      fit + convergence + novelty + timing − saturation − effort, then dedupe
```

Key files: `lib/pipeline.ts` (orchestration), `lib/score.ts` (proof),
`lib/converge.ts` (cross-account demand), `lib/adapt.ts` (ideas),
`lib/rank.ts` (selection + learned reweighting), `lib/harvest.ts` (data layer).

Scoring, in one line:

```
score = 0.30·signal + 0.24·convergence + 0.20·fit + 0.16·novelty
        + 0.08·timing − 0.18·saturation − 0.05·effort
```

## Cost (measured, not estimated)

Data is the cost, not the model. SocialCrawl bills 1 credit per Instagram call
on these endpoints; a full LLM pass is about three tenths of a cent.

| Action | Credits |
| --- | --- |
| `GET /v1/credits/balance` | **0** (free, used for the in-app balance) |
| Instagram benchmark account (1 page, ~12 reels) | 1 |
| Instagram keyword search (~30 reels) | 1 |
| Reddit question bank | 0 (public JSON) |
| **Default profile: 5 benchmarks + 3 keywords ≈ 150 reels** | **8** |
| Rebuild from the disk cache | **0** |

At Starter pricing (2,500 credits / £15 = £0.006 a credit) a fresh pull is about
**4.8p**, so a weekly refresh costs roughly 20p a month. The 100-credit signup
bonus covers about **12 fresh pulls**, or unlimited cached rebuilds.

Three things protect that budget, because credits are the scarce resource:

1. **The cache is the default.** `POST /api/run` reuses the last pull (0
   credits); only `?force=1` fetches. TTL is `HARVEST_CACHE_HOURS` (12h).
2. **Pre-flight balance check.** A paid pull asks `/v1/credits/balance` (free)
   first and refuses outright when the balance cannot cover the estimate, rather
   than stopping at call 6 of 8 and leaving a half-paid sample.
3. **Hard per-run ceiling.** `SOCIALCRAWL_CREDIT_BUDGET` bounds any single run,
   so a bug cannot loop through the balance.

Credit-dependent behaviour is visible in the UI (balance, cost of a fresh pull,
cache age) and recorded on every run log as `credits: {spent, calls, remaining,
cached}`.

## Status

- Live path verified end-to-end against a real key: 150 reels from 92 accounts,
  all five benchmarks present, 0 empty captions, 33 outliers → 10 ideas.
- Persistence is JSON files in `data/` — swap `lib/store.ts` for SQLite/Postgres
  when more than one creator uses it.
- Not built yet: scheduled runs (cron trigger), comment mining at scale, and a
  mobile capture view.
