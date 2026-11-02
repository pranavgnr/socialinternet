# Shambles Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the interface as Shambles (landing, profile, niche, Koko chat, locked waitlist features) on the existing engine, using the founder's wireframes and design guidelines.

**Architecture:** Rebuild in place. New design tokens and fonts in `app/globals.css` and `app/layout.tsx`; new routes `/profile/[handle]`, `/search/niche/[query]`, `/chat`; one `OmniSearch` in the header; a waitlist table and API; old pages redirect or are removed at the end. Data comes from the existing engine (`analyseHandle`, niche research, competitor read) through server functions that return view models.

**Tech Stack:** Next.js 16.4.3 (cacheComponents), React 19, Tailwind 4, `next/font`, Postgres (`pg`), `node:test` via `npm run test:file -- <name>`.

**Spec:** `docs/superpowers/specs/2026-11-03-shambles-launch-design.md` (the wireframe text and guideline values live there; executors read it fully).

**Prerequisite:** the Instagram data layer plan (`docs/superpowers/plans/2026-11-03-instagram-data-layer.md`) is complete first.

## Global Constraints

- Colours exactly: obsidian `#09090C`, card `#131318`, limelight `#CCFF00`, luxury-gold `#E5C158`, pure-white `#FAFAFA`, muted-zinc `#9898A0`; card borders `border-white/10`. Fonts: Plus Jakarta Sans (headings, body) and Space Mono (metrics) via `next/font/google` (self-hosted at build). Credits are shown as 💎 everywhere; amounts unchanged.
- Tone: premium, direct, no slang. No internal words on screen (see `INTERNAL_WORDS` in `lib/plain.ts`); user-visible strings go through `plain()` where they come from generated text.
- No invented testimonials or numbers. Sample content is labelled "Example"; demo data (only when `DEMO_FALLBACK=true`, never in production) carries a visible "Demo data" badge.
- Every number on a profile/niche page comes from data actually read; a section whose data is missing says so instead of showing a number.
- Locked features are visually locked (gold lock) and only open the waitlist form.
- Pages that read cookies or the database sit behind `await connection()` or Suspense, and must still render with the database unreachable (follow `app/page.tsx`).
- Respect `prefers-reduced-motion` for the hero ticker and Koko avatar animation. Accessible names for all interactive controls; keyboard operable.
- Read `node_modules/next/dist/docs/` before touching Next APIs. Run `npx tsc --noEmit` and `npm run build` before each commit; commit after every task. Worktree `/Users/pranav/.local/share/opencode/worktree/92fd59/creators-101-v1`, branch `creators-101-v1`.
- Tests run without the network; component logic is extracted into pure functions and tested (the repo has no browser test runner). Visual verification uses the in-app browser on a locally started production build and is reported with screenshots' file paths.

## Review Focus

1. OmniSearch inputs: `@Name`, `name`, an instagram.com profile URL, a post/reel URL, a phrase with spaces, Hinglish or Devanagari text, 1 character, 300 characters, only punctuation (Task 1).
2. A profile for a private, renamed or nonexistent handle; a creator with fewer than 6 reels (so top-3 and bottom-3 would overlap); a creator whose comments are disabled (Task 4).
3. Waitlist abuse: empty submit, invalid email, a WhatsApp number in several formats, the same signup twice, 1,000 signups from one IP, HTML in the handle field (Task 2).
4. The hero ticker and widget with reduced motion, with JavaScript slow, and with a screen reader (Tasks 1, 3).
5. Koko reply containing HTML, markdown tables or a very long unbroken string must render safely and not break the layout (Task 5).
6. Anonymous visitor on `/profile/<uncached handle>` and `/chat`: sign-in prompt, no vendor spend, no cookie minted for refusals (Tasks 4, 5).
7. Database down: landing, profile (cached), niche (cached) and header still render; waitlist shows a friendly retry message (Tasks 1-6).

---

### Task 1: Brand shell, tokens, header, OmniSearch, Koko widget

**Files:**
- Create: `lib/omni.ts`, `components/OmniSearch.tsx`, `components/SiteHeader.tsx`, `components/KokoConcierge.tsx`, `components/Gems.tsx`, `scripts/test-omni.ts`
- Modify: `app/layout.tsx`, `app/globals.css`, `components/SignInButton.tsx` (styling only)

**Interfaces:**
- Produces: `routeFor(input: string): { href: string; kind: "profile" | "niche" } | { error: string }` — `@Name`, `name` that matches the handle rule from `lib/handle.ts` only when prefixed with `@` or given as an instagram.com profile URL (use `normalizeHandle`/`looksLikeHandle`) route to `/profile/<handle>`; reel/post URLs and reserved routes return `{ error: "Paste a profile link or an @handle" }`; any other text of 2 to 120 characters (trimmed, whitespace collapsed) routes to `/search/niche/<encodeURIComponent(text)>`; shorter, longer or punctuation-only input returns `{ error }`. `<Gems value>` renders `💎 N`. `<KokoConcierge handle? niche?>` links to `/chat` (with `?handle=` or `?niche=` when known).

- [ ] **Step 1: Failing tests** for `routeFor` covering every Review Focus 1 case with exact expected hrefs/errors (including `"@Priya.Sharma"` -> `/profile/priya.sharma`, `"kannada songs"` -> `/search/niche/kannada%20songs`, `"https://www.instagram.com/p/Cxyz/"` -> error, `"कन्नड़ गाने"` -> a niche route).
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** `lib/omni.ts`.
- [ ] **Step 4: Tokens and fonts:** define the colour tokens as Tailwind 4 theme variables in `app/globals.css`, load the two fonts in `app/layout.tsx`, set the obsidian canvas, white text, card utility (bevel via a top inset highlight).
- [ ] **Step 5: Build** `SiteHeader` (SHAMBLES wordmark, `OmniSearch`, locked IG WRAPPED pill that opens the waitlist anchor `/#vault`, SIGN IN or `Gems` + account, JOIN VIP to `/#vault`), `KokoConcierge` (fixed `bottom-6 right-6 z-50`, glowing pill, minimal vector avatar, "● Online · AI Director", aura ring lime; animation disabled for reduced motion) and mount both in the layout. `OmniSearch` shows the `error` text inline, submits on Enter.
- [ ] **Step 6: Tests, `tsc`, `build`, start the build and open `/` in the browser to confirm the shell; commit** `feat: Shambles shell, search bar and Koko widget`.

### Task 2: Waitlist and locked cards

**Files:**
- Create: `db/migrations/003_waitlist.sql`, `lib/waitlist.ts`, `app/api/waitlist/route.ts`, `components/WaitlistForm.tsx`, `components/LockedCard.tsx`, `scripts/test-waitlist.ts`

**Interfaces:**
- Produces: `normalizeContact(input: { email?: string; whatsapp?: string }): { email?: string; whatsapp?: string } | { error: string }` (email lowercased and format-checked; WhatsApp digits normalised to E.164, India default `+91` for 10-digit numbers; at least one required); `saveWaitlistSignup(input: { email?: string; whatsapp?: string; handle?: string; feature: WaitlistFeature; source?: string }): Promise<{ ok: true; duplicate: boolean }>`; `type WaitlistFeature = "shop-dine-stay" | "mini-business" | "rate-card" | "comment-to-dm" | "ig-wrapped" | "vip"`; `POST /api/waitlist` returns `{ ok: true, duplicate }` or `{ ok: false, error }` with 400 for invalid input and 429 from a per-IP limit of 10 requests per hour; `<LockedCard feature title blurb>` and `<WaitlistForm feature source>` (inline confirmation, friendly error when the database is unavailable).
- Table `waitlist_signups(id bigserial pk, email text, whatsapp text, handle text, feature text not null, source text, created_at timestamptz default now())` with a unique index on `(coalesce(email, whatsapp), feature)` so a repeat signup is a no-op reported as `duplicate`.

- [ ] **Step 1: Failing tests:** every Review Focus 3 case (empty, invalid email, WhatsApp formats `98765 43210`, `+91 98765-43210`, `09876543210`, `+1 415 555 0100`; duplicate returns `duplicate: true` and one row; HTML in handle is stored as plain text with `<>` stripped and length capped at 30; unknown feature rejected; the limiter allows 10 and rejects the 11th from one IP).
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** the migration (run it against PGlite in tests; apply to the real database with `npm run migrate` in the final task), the module, the route (use the existing `lib/limits.ts` limiter keyed by IP from `x-forwarded-for`, never trusting a client-supplied id) and the components.
- [ ] **Step 4: Tests, `tsc`, `build`; commit** `feat: waitlist and locked cards`.

### Task 3: Landing page

**Files:**
- Modify: `app/page.tsx`, `components/Landing.tsx`; Create: `components/HeroTicker.tsx`, `components/Pillars.tsx`, `components/Vault.tsx`, `components/Faq.tsx`, `lib/tickerLines.ts`, `scripts/test-ticker.ts`

**Interfaces:**
- Produces: `nextIndex(current: number, length: number): number` (wraps); `HeroTicker` flips every 3500 ms between the founder's lines (at least the two in the spec) and renders a single static line when `prefers-reduced-motion` is set; the vault uses `WaitlistForm` and `LockedCard`; the audit box submits to `routeFor("@handle")`; trending bubbles keep using `listTrending()` (zero niches renders no bubbles).

- [ ] **Step 1: Failing tests** for `nextIndex` and for a pure `tickerState` helper (paused when reduced motion).
- [ ] **Step 2-3: Implement** the page in the spec's order: header (from Task 1), ticker, headline "THE OPERATING SYSTEM FOR ELITE INSTAGRAM CREATORS." with the founder's subcopy, handle audit box ("Enter your handle to run an instant audit", SEE ANALYTICS; IG WRAPPED button locked), pillars, vault with the four locked cards and one shared form anchored `#vault`, "Example audit" card clearly labelled, trending bubbles, three FAQs, footer. Signed-in users with a saved plan still go to their profile (`/profile/<their handle>`); the old dashboard home is retired in Task 8.
- [ ] **Step 4: Verify in the browser at 390 px and 1280 px widths; tests, `tsc`, `build`; commit** `feat: Shambles landing page`.

### Task 4: Profile page `/profile/[handle]`

**Files:**
- Create: `lib/profileView.ts`, `app/profile/[handle]/page.tsx`, `components/profile/{Vitals,Dna,ReelTrio,CommentIntel,CompetitorIdeas,ProfileHeader}.tsx`, `scripts/test-profile-view.ts`

**Interfaces:**
- Produces: `buildProfileView(plan: GrowthPlan, opts: { own: boolean }): ProfileView` (pure) where `ProfileView` has `vitals { followers, likesRatio, avgComments, commentRatio, botToReal: { realPct: number; sample: number; confidence: "low" | "medium" | "high" } | null }`, `dna { summary, audienceSignals: string[] }`, `winners: ReelCard[3 max]`, `flops: ReelCard[3 max]` (disjoint: with fewer than 6 reels the lists shrink, never repeat a reel; fewer than 2 reels shows an explanatory empty state), each `ReelCard { url, views, likes, comments, why: string[]; basis: "video" | "captions" }`, `commentIntel { mood: {label, pct}[]; requests: {text, mentions}[3 max] } | null`, `ideas: { fromHandle, theirViews, whyChosen: string[], concept, scriptHref }[3 max]`. All strings pass through `plain()`; `likesRatio = likes / views` and `commentRatio = comments / views` from the reels read, shown with one decimal.
- The page resolves own vs competitor view with the existing machinery (own handle = signed-in user's saved plan handle): own shows full plan data incl. the next move; others use the competitor read through `POST /api/plan {mode:"competitor"}`'s server function and the same gate (sign-in + 6💎, cached free). Anonymous + uncached shows the sign-in prompt and spends nothing. While a fresh read runs (about a minute) show stage text; a failed read shows the vendor-neutral error and a retry.

- [ ] **Step 1: Failing tests** for `buildProfileView` using plan fixtures: winners/flops disjoint and sized correctly for 12, 7, 5 and 1 reels; ratios; `botToReal` null when absent; `ideas` capped at 3 with reasons; no second-person text in competitor views (reuse `neutralisePerson` rules); strings contain no `INTERNAL_WORDS`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** `buildProfileView` then the components with the founder's section numbering and labels (01 Vitals & authenticity, 02 Who they are & creator DNA, 03 Top 3 performing reels (why they popped off), 04 Bottom 3 performing reels (why they flopped), 05 Comment section deep analysis, 06 3 next reel ideas from top niche competitors), top-right locked actions, `Script this (1💎)` linking to `/chat?action=script&idea=<index>&handle=<handle>`.
- [ ] **Step 4: Verify in the browser with the cached `_shravyapawar_` data (own view) and a cached competitor; tests, `tsc`, `build`; commit** `feat: profile page with six sections`.

### Task 5: Koko chat studio

**Files:**
- Create: `app/chat/page.tsx`, `components/koko/{KokoStudio,ActionRow,MemoryChips,CardMessage}.tsx`, `lib/kokoActions.ts`, `lib/renderCards.ts`, `scripts/test-koko.ts`
- Modify: `app/api/chat/route.ts` (accept `action`), `lib/chat.ts` (action prompts), `components/ChatPanel.tsx` (retired in Task 8)

**Interfaces:**
- Produces: `KOKO_ACTIONS: { id: "scripts-from-comments" | "deep-spy" | "rewrite-flop-hooks" | "rate-card"; label: string; cost: 1; locked?: true }[]`; `rate-card` is `locked` and opens the waitlist instead of spending; `renderCards(markdown: string): Block[]` parses a safe subset (paragraphs, `**bold**`, `-`/`1.` lists, headings) into typed blocks — raw HTML, links with `javascript:` and images are rendered as plain text, a 5,000-character unbroken string is wrapped, and the output is never passed to `dangerouslySetInnerHTML`; `POST /api/chat {message?, action?, handle?, niche?, idea?}` keeps every rule of the existing route (sign-in, 1💎, grounded, refund on refusal/error); `deep-spy` with a handle triggers the competitor read path (6💎 for a fresh read, shown before confirming).
- Studio header "KOKO AI COMMAND STUDIO" with back link and 💎 balance; memory chips (handle, niche, number of competitors loaded); four one-tap actions; chat stream; input; the same persisted threads as today.

- [ ] **Step 1: Failing tests:** `renderCards` for every Review Focus 5 case; action routing (locked action never spends; unknown action 400); `action=script&idea=1` builds a grounded prompt from the plan's idea 1 and refuses when the plan has no idea 1.
- [ ] **Step 2-3: Implement.** The widget from Task 1 opens this page; query params preload memory.
- [ ] **Step 4: Verify in the browser; tests incl. `test-chat`, `tsc`, `build`; commit** `feat: Koko studio with one-tap actions`.

### Task 6: Niche page `/search/niche/[query]`

**Files:**
- Create: `lib/nicheDossier.ts`, `app/search/niche/[query]/page.tsx`, `components/niche/{OutlierList,Briefing}.tsx`, `scripts/test-niche-dossier.ts`

**Interfaces:**
- Produces: `buildDossier(view: NicheView): { outliers: { url, handle, views, followers?, multiple: number | null, caption }[]; briefing: string[] }` (outliers sorted by `multiple` descending with `null` last, at most 12; `briefing` is 3 to 5 sentences built only from the numbers on the page: the bar to beat, how many accounts broke out, the dominant format/language when known; no statements about Instagram's algorithm); the page serves cached niches free for anyone, an uncached one needs sign-in + 6💎 through the existing niche gate, and has the button "Generate custom scripts & strategies with Koko (1💎)" -> `/chat?niche=<query>`.

- [ ] **Step 1: Failing tests** for ordering, `null` multiples last, cap, and briefing built from fixture numbers with no unsupported claims (assert it contains none of "algorithm", "shift", "Instagram is").
- [ ] **Step 2-3: Implement; verify in the browser with a cached niche; tests, `tsc`, `build`; commit** `feat: niche dossier page`.

### Task 7: Authenticity estimate and the video reader interface

**Files:**
- Create: `lib/authenticity.ts`, `lib/videoReader.ts`, `scripts/test-authenticity.ts`, `scripts/test-video-reader.ts`
- Modify: `lib/profileView.ts` (use both), `lib/providers/hikerapi.ts` (add `followersSample(userId, pages)` using the verified `/v1/user/followers/chunk`)

**Interfaces:**
- Produces: `estimateAuthenticity(sample: { username: string; full_name?: string; is_private?: boolean; has_profile_pic?: boolean }[]): { realPct: number; sample: number; confidence: "low" | "medium" | "high" } | null` — returns `null` below 40 sampled followers; heuristics (numeric-heavy usernames, no name, default avatar) with a documented weight each; `confidence` from sample size (under 80 low, under 200 medium, else high); the UI copy says "Estimated from a sample of N followers". `interface VideoReader { read(reel: { url: string; mediaUrl?: string; caption: string }): Promise<VideoReading> }` with `CaptionReader` (always available, `basis: "captions"`) and `GeminiReader` (only when `GEMINI_API_KEY` is set; sends the MP4 and asks for a structured JSON of `{hookSeconds, hookType, onScreenText, pacing, loop, why[]}`; validates the JSON; on any error falls back to `CaptionReader` for that reel); at most 6 reels per profile, results cached 7 days by shortcode, per-run cap `VIDEO_READ_MAX` (default 6).

- [ ] **Step 1: Failing tests:** authenticity thresholds, null below 40, confidence bands, deterministic output; `GeminiReader` with an injected fetch returns parsed readings, rejects malformed JSON by falling back, never exceeds the cap, caches by shortcode.
- [ ] **Step 2-3: Implement.** The follower sample costs at most 4 calls per profile (cap `AUTH_SAMPLE_PAGES`, default 4) and is cached 7 days. No key configured means captions-only with the label shown on the page.
- [ ] **Step 4: Tests, `tsc`, `build`; commit** `feat: authenticity estimate and video reader interface`.

### Task 8: Retire the old interface, rebrand, docs

**Files:**
- Modify/delete: `app/{start,room,discover,ideas,weekly}/**`, `components/{ConnectHandle,PlanView,RoomPlanView,StartFlow,RoomBuilder,WeeklyView,WeeklyRefresh,ChatPanel,NicheSearch,IdeaCard,WaitingFeed}.tsx` as appropriate; `README.md`, `docs/deploy.md`, `.env.example`, page titles/metadata

- [ ] **Step 1:** redirect `/start`, `/room`, `/discover` to the landing or niche route as appropriate (`/discover?q=x` -> `/search/niche/x`); keep `/ideas` and `/weekly` reachable from the profile page until replaced, restyled with the new tokens; delete components that nothing imports (grep first).
- [ ] **Step 2:** replace every "Creators 101" string with "Shambles"; set metadata (title "Shambles — the AI that works for creators"); update README and deploy docs; add `DEMO_FALLBACK`, `GEMINI_API_KEY`, `VIDEO_READ_MAX`, `AUTH_SAMPLE_PAGES` to `.env.example` and make `DEMO_FALLBACK` throw at startup when `NODE_ENV=production`.
- [ ] **Step 3:** apply migration 003 to the real database (`npm run migrate`), run the whole test suite, `tsc`, `build`, then walk landing -> profile -> niche -> chat -> waitlist in the browser and save screenshots under `docs/screenshots/` (no secrets in frame).
- [ ] **Step 4: Commit** `chore: retire the old interface and rebrand to Shambles`.

---

## Self-review

- **Spec coverage:** header and search (1), design tokens and widget (1), waitlist and locked cards (2), landing (3), profile sections 01-06 (4, 7), niche page (6), Koko studio and one-tap actions (5), authenticity estimate and video reader (7), redirects, rebrand and demo-data rule (8).
- **Deferred by the spec:** IG Wrapped, rate card, mini-business, comment-to-DM, communities, payments (locked cards only).
- **Open inputs:** Gemini key (Task 7 falls back without it), real FAQ copy, final mascot art.
