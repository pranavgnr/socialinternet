# How creators actually come up with reel ideas — and the best automatic version of it

Researched October 2026. Every claim below is tied to a source in §8, and every
stage of the recommended system maps to code that exists in this repo.

**One-line verdict:** idea generation is not a creativity problem, it is a
*measurement + translation* problem. The best automatic system is a four-stage
funnel — **evidence → pattern → adaptation → ranking** — where every idea is
traceable back to a specific reel that beat its own account's median. Almost
every tool on the market does stage 1 and stops, or skips it and asks an LLM to
"be creative." That gap is the product.

---

## 1. What "a good idea" actually means

Before methods: what are creators optimising for?

Instagram's own description of ranking (Feb 2025) is explicit. A reel is first
shown to a small test audience of non-followers; if it performs, it goes to a
slightly wider one, and so on. The signals are **watch time, retention, shares,
likes, comments** — with retention and shares weighted heavily because they
measure whether the content earned attention rather than borrowed it.

Two consequences that define the whole design:

- **The first 3 seconds are the product.** Instagram names this directly and
  points creators at *View Rate* (share of viewers still watching after 3s).
  A brilliant idea with a weak opening is indistinguishable from a bad idea.
- **Every post competes on its own.** Reach is not inherited from follower
  count, so a small account can out-distribute a large one on a single reel.
  That is what makes outlier analysis legitimate rather than wishful.

So "a good idea" = a topic with demonstrated demand × an opening that survives
the first 3 seconds × a format the creator can actually execute.

---

## 2. The nine methods creators really use

These are the methods that appear repeatedly across practitioner playbooks,
tool documentation, and platform guidance. They are listed roughly in order of
how much signal they carry per hour spent.

### M1. Outlier mining — the backbone

Sort competitors' posts by views, then divide each post by *that account's own
median*, not by a global benchmark. A 50k-view reel on a 10k-median account is a
5x outlier and far more informative than a 2M-view reel on a 2M-median account.

Industry standard, from the ScrapeCreators outlier methodology: pull ≥20 posts
per account, use the **median** (not mean) as the control group, and label lifts
as mild (1.5–2x), strong (2–5x), huge (5x+). Below ~10 posts, confidence is low.

This is also what 1of10 and vidIQ sell: "videos that are overperforming right
now," chosen because the maths says so, not because they are popular.

*Weakness:* one account's outlier might be that creator's luck, a lucky
algorithm test, or a paid boost. M1 alone produces false positives constantly.

### M2. Hook mining — steal the structure, not the words

Take the top 10 posts of 5–10 mid-tier accounts in the niche, copy the first
line of each, label its psychological type (curiosity gap, contrarian claim,
specific number, confession, objection, direct question), then strip the
topic-specific words to leave a skeleton. "I spent 90 days on X and Y happened"
is the skeleton; X and Y are replaceable.

Mid-tier (10k–500k) is the right band: big enough to have data, small enough
that their hooks are learnable rather than personality-driven.

*Weakness:* hooks without demand behind them are just well-written failures.
Hook mining tells you how to say it, never what to say.

### M3. Comment and demand mining — the highest-intent source

Read comments on high-engagement posts in the niche and classify them: questions
become tutorials, frustrations become pain-point content, disagreements become
contrarian posts, "what about Y" becomes a part two. When eight people ask a
variation of the same question, that cluster *is* the content brief.

The deepest layer is the "hidden pain": the problem the viewer did not know they
had. Ask "why does that feel bad?" three times to get from surface to emotional
to hidden.

Non-social equivalents: Reddit and Quora threads, 1-star reviews, DMs.

*Weakness:* slow by hand, and comment data is the most expensive thing to
scrape. But it is the only method that produces *unmet* demand rather than
already-served demand.

### M4. Trend timing — borrow the wave, then get off it

Trends are distribution subsidies. Four types: format, audio, topic, cultural
moment. The practitioner rule of thumb is that a trend is viable when you first
see it repeated 3+ times and its earliest uses are 3–7 days old; past ~10 days
it is crowded; on TikTok the whole emergence-to-saturation window can close in
**48–72 hours**. Post within 24–48h or don't bother.

Critically, the number that matters is the **slope of new creations**, not the
total. A sound with 300k videos can already be dead. Dash Social exposes exactly
this as a "market saturation" indicator (videos created), and TikTok Creative
Center is the free version of the same data.

Balance: roughly 1 trend post per 3 evergreen posts — trends bring strangers,
evergreen converts them.

*Weakness:* pure timing with no niche fit produces reach with no retention.

### M5. Format transplant and cross-niche remix

The most repeated claim in the practitioner literature: the large majority of
viral short-form is not original. It is a proven container applied to a new
subject, or a container from a different niche applied to yours. The person who
brings a mechanic from niche A into niche B usually wins the distribution,
because the format is novel there but already validated elsewhere.

*Weakness:* transplanting a format that does not fit the creator's constraints
(solo, no cast, no location) yields an idea they will never film.

### M6. Pillar rotation + one-topic-ten-angles

Constraint-driven generation: fix 3–5 content pillars, then force N angles per
topic — what / why / how / when / who / what-if / objection / mistake / cost /
timeline. Constraints generate ideas; blank pages do not. This is the method
that keeps output consistent when nothing is trending.

*Weakness:* without a demand signal it produces competent, forgettable content.

### M7. Own-winner doubling down

Your own outliers are the strongest possible evidence, because the only variable
that changed is the post. Re-run the winner's container with a new subject
before chasing anyone else's. Requires tracking posted ideas against 7-day
views — a loop almost no creator closes manually.

### M8. Packaging-first

Decide the hook line (and for YouTube, title + thumbnail) *before* filming. If
the packaging cannot be made compelling, the idea is not ready. Tools that
generate a packaged concept (hook + visual + angle) beat tools that emit a topic
keyword; that is precisely the complaint levelled at vidIQ-style keyword ideation
versus outlier-first tools.

### M9. Volume + selection (the meta-method)

Serious creators run ideation as a scheduled production stage, not a mood: one
45-minute session, five methods in sequence, 20–50 candidates, then select the
best 5–8. You cannot identify a great idea from a pool of three.

This is the argument for a machine: not to replace taste, but to make the
candidate pool large enough that taste has something to work on.

---

## 3. Why existing "AI idea" tools mostly fail

Landscape checked Oct 2026: Virlo, Exolyt, Kalodata, Socialinsider, Pentos,
Shortimize, Sprout (intelligence dashboards); 1of10, vidIQ (YouTube outlier
tools); OpusClip, Revid, Captions (repurposing/generation).

Four recurring failure modes:

1. **They stop at a dashboard.** You get charts and a list of trending videos,
   then do the translation work yourself. Insight and execution are separated.
2. **Single-account outliers are treated as proof.** One 20x post is presented
   as "this topic works" when it may be one creator's luck. None of the tools
   automatically check whether the *same theme* is overperforming on unrelated
   accounts.
3. **No constraints.** Ideas ignore that the creator is solo, films at a desk,
   has 30 seconds, and refuses to sound like a guru. Unfilmable ideas are waste.
4. **No traceability.** An LLM asked to "generate 20 viral ideas" produces
   plausible slop with no receipt. The creator cannot check the claim, so they
   cannot trust it, so they do not use it.

The design brief falls out of this: **carry the evidence all the way to the
idea, and never emit an idea that cannot cite a reel.**

---

## 4. The best architecture

Six stages. Each is a pure function with a visible receipt, which is what makes
the output auditable.

```
harvest → score → converge → decode → adapt → rank
 (data)   (proof)  (demand)   (pattern) (ideas) (selection)
```

### Stage 1 — Harvest
Pull recent reels from three source types:
- benchmark accounts (10k–500k followers, same or adjacent niche),
- keyword/hashtag search results (catches accounts you don't track),
- your own account (for M7).
Also pull sound usage counts (last 7d vs previous 7d) and comment text.

### Stage 2 — Score (M1 + M4)
For every reel:
- `baseline` = median views of that account's last 20 posts
- `ratio` = views / baseline
- `velocityIndex` = (views/hour) / (account's median views/hour) — catches a reel
  climbing fast before total views look impressive
- `engagementRate` = (likes + 2·comments + 4·shares) / views — shares weighted
  highest because Instagram says shares are a ranking signal
- `phase` and `saturation` from the sound/format usage **slope**

```
signalScore = 0.42·log-ratio + 0.22·velocity + 0.14·engagement + 0.22·phase
              × freshness decay (half-life ≈ 14 days)
```

Threshold: ratio ≥ 3x, age ≤ 60 days, views ≥ 5k. Anything below is noise.

### Stage 3 — Converge (the part nobody else does)
Cluster the surviving outliers by *what they are about* (caption + on-screen
text + transcript, stemmed, Jaccard similarity), then count how many
**independent accounts** each theme appears on.

- support 1 → one creator got lucky → "single"
- support 2 → worth testing → "supported"
- support 3+ → the topic has pull of its own → "validated"

This directly attacks failure mode #2. A theme that produced outliers on three
unrelated accounts is a demand signal; a 20x from one account is an anecdote.
Confidence = f(accounts, platforms, median ratio, saturation).

### Stage 4 — Decode (M2 + M5)
For the top signals, extract a **pattern card**: hook text, hook type, format
container, topic, tension, payoff, CTA, duration, *why it worked*, and a
topic-free `skeleton`. This is the reusable unit — the thing that gets
transplanted in stage 5 without copying anyone's script.

### Stage 5 — Adapt (M5 + M6 + M7 + M8)
Three translation moves per card:
1. same format, different topic
2. same topic, the creator's own stakes
3. format from one outlier + topic from another

Then multiply with pillar rotation and the ten-angles frame, and generate the
**product**: three spoken hook variants (not titles), 5 script beats, shot list,
on-screen text, caption ≤125 chars, hashtags, effort rating. Everything filtered
through the creator's voice, banned words, and physical constraints.

Model choice: a cheap model here is fine and correct. This is structured
extraction and constrained rewriting, not open-ended genius. DeepSeek-flash class
costs ~$0.003 for a full run.

### Stage 6 — Rank and select (M9)
```
score = 0.30·signal + 0.24·convergence + 0.20·fit + 0.16·novelty
        + 0.08·timing − 0.18·saturation − 0.05·effort

fit       = match to pillars (0.6) + audience questions (0.25) + own winners (0.15)
novelty   = 1 − 0.6·similarity-to-source − 0.4·similarity-to-sibling-ideas
```
Then dedupe sibling ideas (Jaccard > 0.55 on the hook), and — the closing of the
loop — **learn from results**: once ideas are marked posted with 7-day views,
reweight hook types and formats by their realised lift for *this* account, with
small-sample shrinkage so one lucky post can't rewrite the model.

That final step is the moat. A prompt wrapper cannot learn that this creator's
confession hooks outperform their tutorial hooks by 2.3x.

---

## 5. What is built in this repo

Every stage above exists and runs:

- `lib/harvest.ts` — provider-agnostic ingestion (Instagram/TikTok/YouTube),
  defensive field normalisation, comment/question extraction, sound stats
- `lib/score.ts` — baselines, ratio, velocity, engagement, trend phase,
  saturation, signal scoring, 3x filter
- `lib/converge.ts` — cross-account theme clustering and tiers
- `lib/patterns.ts` — pattern-card decoding (LLM, with mock fallback)
- `lib/adapt.ts` — the three translation moves + constrained idea generation
- `lib/rank.ts` — scoring, dedupe, learned reweighting from posted results
- `lib/pipeline.ts` — the run, with per-step timing and error capture
- `lib/store.ts` — JSON-backed persistence (swap for SQLite/Postgres later)
- UI: idea feed with receipts and proof badges, `/sources` (what's being watched
  and why), `/pipeline` (run log and step timings), `/settings` (profile,
  pillars, voice, constraints, benchmarks, keywords)

Demo mode ships a fixture corpus so the whole thing is runnable with no keys.
Add `SOCIALCRAWL_API_KEY` or `YOUTUBE_API_KEY` and it switches to live data
automatically; add `LLM_API_KEY` and the idea copy switches from templates to
generated.

---

## 6. Cost (the part that decides whether it's worth building)

The mistake is assuming the AI is the cost. It isn't — the data is.

Per weekly run for one creator (12 accounts × 20 reels + keyword pulls ≈ 300
reels, plus top-comment pulls):

- **Instagram/TikTok reels:** Apify Instagram scraper is ~$1.50–$2.70 per 1,000
  results depending on plan; ScrapeCreators benchmarks meaningfully cheaper per
  request. 300 reels/week ≈ **$0.50–$0.80/week**.
- **YouTube Shorts:** official Data API is free (10k units/day) — use it.
- **LLM:** ~10k tokens in / ~6k out per run on a flash-class model ≈
  **$0.003/run**, i.e. pennies per month.
- **Hosting:** a single Next.js app on Vercel's free/hobby tier, or a $5 VPS.

**Realistic total: under $5/month for one creator**, and it gets cheaper per
creator if several accounts share the same harvest.

Free alternatives that cover most of it: TikTok Creative Center (trends and
sounds), YouTube Data API (Shorts), manual saves of competitor reels. That path
costs $0 but loses automation and comment mining.

---

## 7. How to know it works

Do not measure "ideas generated" — that is the vanity metric of this category.
Measure the only thing that matters:

1. **Hit rate** — share of posted ideas that beat *your own* median views.
   Baseline before the tool, then after 20 posts. Target: 2x baseline rate.
2. **View Rate** — the 3-second retention number Instagram exposes in Insights.
   If ideas score well but View Rate stays flat, the hooks are the problem, not
   the topics.
3. **Convergence calibration** — do "validated" (3+ accounts) themes actually
   outperform "single" ones when you post them? If not, the threshold is wrong
   and should be retuned.
4. **Time to idea** — target under 10 minutes from open to a filmable shot list.

Two honest risks to keep in view: scraping public social data sits in a legal
grey zone that varies by jurisdiction and breaks whenever a platform changes its
markup, so the harvest layer should stay swappable (it is — one interface, three
providers); and no amount of evidence fixes a weak hook, which is why the hook
variants are generated three ways and treated as the real deliverable.

---

## 8. Sources

- Instagram for Creators — *Helping creators of all sizes break through* (26 Feb
  2025): ranking signals, test-audience distribution, first 3 seconds, View Rate.
  https://creators.instagram.com/blog/helping-creators-of-all-sizes-break-through
- Instagram — *Recommendations and originality* guidance.
  https://creators.instagram.com/recommendations-and-originality
- ScrapeCreators — *Outlier Post Finder* methodology: ≥20 posts, median
  baseline, 1.5x/2–5x/5x lift bands, per-account and per-platform separation,
  low-confidence under 10 posts.
  https://github.com/ScrapeCreators/social-media-research-skills
- Pyyrah+ — *Content Ideation Playbook*: five mining methods (hook, comment,
  trend, pain point, remix), 72% of viral ideas are remixes, trend age windows,
  1 trend : 3 evergreen ratio.
  https://pyyrahplus.com/resources/playbook-library/content-ideation-playbook
- Vellum — *7 Best Short-Form Video Intelligence Tools in 2026*: tool landscape,
  48–72h trend window, cross-platform necessity, pricing (Virlo $49/$199,
  Exolyt $400+).
  https://www.vellum.ai/blog/best-short-form-video-intelligence-tools
- 1of10 — *1of10 vs vidIQ*: outlier-first vs keyword-first ideation, packaged
  concepts vs topic keywords.
  https://1of10.com/blog/1of10-vs-vidiq
- vidIQ — *Outliers* feature documentation.
  https://vidiq.com/features/outliers
- Dash Social — *TikTok Trending Sounds*: videos-created as a saturation
  indicator.
  https://www.dashsocial.com/features/tiktok-trending-sounds
- Apify — *Instagram Scraper* / *Instagram Reel Scraper* pricing ($1.50–2.70 per
  1,000 results by plan).
  https://apify.com/apify/instagram-scraper
- ScrapeCreators — *Apify Instagram Scraper benchmark* (cost per 1,000 results
  comparison).
  https://scrapecreators.com/blog/apify-instagram-scraper-benchmark
