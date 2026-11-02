# Shambles launch — design

Status: written 2026-11-03 from the founder's wireframes and guidelines. The
founder said "get started"; this document is treated as approved-to-build and is
open for correction at any time. Approach **A** (rebuild the interface in place on
the unreleased branch) was chosen by the founder.

## Intent

**Shambles** is the startup; **Koko** is its AI agent and mascot. Shambles is an
AI-first platform that works for Instagram creators (India first): it audits a
creator's account, shows what is working in their niche, and tells them what to
post next. Brands and venues come later; the creator's data is theirs.

## Launch scope (founder's decision)

Ships: the **landing page**, the **profile page** (`/profile/[handle]`, six
sections), and the **Koko chat** (`/chat` plus a floating concierge widget). The
**niche page** (`/search/niche/[query]`) ships because the single search bar needs
it. Everything else is shown as **locked cards behind a waitlist**: Shop / Dine /
Stay, 1-click mini-business, verified rate card, comment-to-DM, IG Wrapped.

## Goals

- A creator lands, understands the offer in seconds, and gets a real audit of any
  Instagram handle without friction.
- The whole interface is the founder's design language: obsidian background, acid
  lime for important numbers, champagne gold for premium/locked, tight headings,
  mono for metrics. Tone: premium, direct, no slang, no SaaS fluff.
- Real data only (Instagram reels via the data layer). Locked features capture a
  waitlist signup with email or WhatsApp, the creator's handle and the feature
  they want.

## Non-goals (launch)

Communities, collab matching, venues, cashback score, brand deals, invoicing, auto
DMs, rate card, mini-business, IG Wrapped (all waitlist-locked), other platforms,
payments.

## Anti-goals

- Invented testimonials, invented creator stats, or demo numbers presented as real.
  Example content must be labelled "Example"; demo-mode data (when
  `DEMO_FALLBACK=true`, local development only) carries a visible "Demo data" badge.
- Claims about Instagram's algorithm that the data does not support.
- Printing a number for an account that was not read (existing rule).

## Design system (from the founder's guidelines, verbatim values)

Colours: `obsidian #09090C` (canvas), `card #131318` with `border-white/10` and a
subtle top-lit bevel, `limelight #CCFF00` (priority metrics, active states),
`luxury-gold #E5C158` (VIP, locks, rate-card), `pure-white #FAFAFA` (headlines and
numbers), `muted-zinc #9898A0` (secondary text). Fonts: Plus Jakarta Sans (headings
and body; Syne is optional for display), Space Mono (metrics and financials), via
`next/font`. Credits are shown as **💎**.

## Screens

### Header (all pages)
SHAMBLES wordmark; **OmniSearch** bar (one input: `@handle` or an instagram.com
profile URL goes to `/profile/<handle>`; anything else goes to
`/search/niche/<query>`); locked **IG WRAPPED** pill; **SIGN IN** (or credits 💎 and
account); **JOIN VIP** (opens the waitlist).

### Landing (`/`)
Rotating hero ticker that flips every 3.5 s between creator questions ("Why did my
latest Reel get stuck at 1,200 views?" / "How do I unlock the VIP creator
lifestyle?"; reduced-motion users get a static line); headline "THE OPERATING SYSTEM
FOR ELITE INSTAGRAM CREATORS." with the founder's subcopy; handle audit box ("Enter
your handle to run an instant audit") with SEE ANALYTICS; three pillars (Audit &
diagnose, Competitor intel, Lifestyle VIP); the **velvet-rope waitlist vault**
(wave-2 priority access: Shop/Dine/Stay, 1-click mini-business, verified rate card,
unlimited comment-to-DM) with email-or-WhatsApp + handle + request; FAQs (audit
without an account? how are rate cards calculated? when do lifestyle perks go
live?); trending-niche bubbles from the existing trending list. Testimonials are
**omitted** until real; an "Example audit" card may stand in, labelled.

### Profile (`/profile/[handle]`)
Header: avatar, @handle, niche badge ("verified niche" only when derived from the
posts), top-right actions **IG WRAPPED** and **SEE MY VERIFIED RATE CARD** (both
locked, waitlist). Sections:
- **01 Vitals & authenticity:** followers, bot-to-real ratio, likes ratio, average
  comments with comment ratio. Bot-to-real is an **estimate** from a sample of
  followers (about 100) with its confidence stated; it is shown only when computed.
- **02 Creator DNA:** an executive summary of niche positioning, written from the
  bio, captions and comments. The wireframe's "audience demographics" is replaced by
  **audience signals** (languages in comments, what they ask for): demographics are
  not available from public data.
- **03 Top 3 winning reels / 04 Bottom 3 flop reels:** views, likes, comments and a
  structural breakdown (hook, pacing, visual contrast, loop, on-screen text). The
  breakdown is produced by a **video reader**: a multimodal model when a key is
  configured, otherwise a labelled fallback ("From captions and numbers; video not
  watched"). The page always says which one was used.
- **05 Comment intelligence:** mood split and the top 3 recurring viewer requests
  with mention counts, from the comments read (about 15 to 20 per reel).
- **06 Competitor ideas:** 3 next-reel concepts taken from the top competitors,
  each with the source handle, their views, why that account was chosen, and a
  **Script this (1💎)** button that opens Koko with the concept loaded.
Own handle (matches the signed-in user's saved plan) shows the full view including
the next move; any other handle shows the read-only competitor view.

### Niche (`/search/niche/[query]`)
Outlier reels for the niche ranked by views divided by the owner's followers,
Koko's **executive briefing** (a short summary written only from the niche data on
the page; no claims about Instagram's algorithm), and the button **Generate custom
scripts & strategies with Koko (1💎)** which opens `/chat` with the niche loaded.

### Koko chat (`/chat` and the floating widget)
Widget fixed `bottom-6 right-6 z-50`: obsidian pill with a lime or gold aura ring,
an animated minimal avatar, "● Online · AI Director"; click opens the chat preloaded
with the active handle or niche. Studio header "KOKO AI COMMAND STUDIO" with the
back link and the 💎 balance; **active memory** chips (handle, niche, competitors
loaded); **one-tap actions (1💎 each):** write 3 scripts from my comments, deep-spy
on a competitor (opens a competitor read), rewrite my flop reel hooks, calculate my
brand-deal rate card (locked, waitlist); chat stream with replies rendered as
cards (bold, lists, no raw HTML). The existing chat rules stay: grounded only in
the analysed data, refuses everything else, refunds on refusal or error.

### Locked features
A `LockedCard` shows the feature, a gold lock, one sentence and "Join the
waitlist". Joining stores the signup and confirms in place.

## Data and money

- Reads come from the Instagram data layer (HikerAPI first). The existing credit
  pool (15 per IST day) and costs stay; the interface calls credits 💎. A fresh
  handle or niche read still costs 6💎, a Koko message or one-tap action 1💎, cached
  views 0.
- New table `waitlist_signups(id, email, whatsapp, handle, feature, source,
  created_at)`; at least one of email or WhatsApp is required; basic validation and
  a per-IP rate limit; no marketing sends in launch.
- `DEMO_FALLBACK=true` (development only, off by default and rejected in
  production) serves clearly labelled sample data when no vendor key is set.

## Approaches considered

- A. Rebuild in place on the unreleased branch. **Chosen.** No users to protect;
  reuses the engine, sign-in, credits and tests.
- B. Parallel route group, switch later. Rejected: two interfaces for no benefit.
- C. Separate front-end calling the engine as an API. Rejected: duplicates
  sign-in, caching and credit rules.

## Calls made by the author (not agreed in conversation)

- Credits are renamed 💎 without changing prices.
- Testimonials omitted; "Example audit" card instead.
- Audience demographics replaced by audience signals.
- Bot-to-real shown as an estimate with stated confidence, or not shown.
- Video reader with a labelled fallback, so launch does not depend on a model key.
- IG Wrapped is locked (year-end feature).
- Old pages (`/start`, `/room`, `/discover`, `/ideas`, `/weekly`) are redirected or
  removed once their content lives in the new screens; the weekly digest and ideas
  feed are kept reachable from the profile and chat until replaced.

## Open inputs

A Gemini API key (or another multimodal key) for the video reader; real copy for
FAQs; final mascot artwork (a simple vector placeholder is used meanwhile).

## Left to the builder

Component structure, animation details, exact copy for locked cards, and the
markdown-to-card renderer.
