# Deploying Shambles

This is the small-VPS guide: one server, Docker Compose, Postgres, Caddy for
HTTPS, and cron for the jobs. It is written for a first deployment; you do not
need to know Docker beforehand.

**Target setup:** one Linux VPS with 2 vCPU and 4 GB RAM, in a Mumbai (India)
region, running Ubuntu 24.04. Any provider works — for example a Mumbai or
Bangalore region from DigitalOcean, Linode, AWS (`ap-south-1`), or GCP
(`asia-south1`). Keep the app and the database in India: most users are there,
and a round trip to another continent is felt on every page.

If you only want to run it on your laptop, skip to [Run it with Docker
Compose](#run-it-with-docker-compose) and start the bundled `db` profile.

---

## 1. What you need

- A domain name, with an `A` record pointing at the server's public IPv4
  address **before** you start Caddy. Caddy gets the HTTPS certificate by
  answering a challenge on that domain.
- A Postgres database. Production uses a managed Postgres (for example
  Supabase's Mumbai region, or any Postgres 16 provider). The optional `db`
  service in `docker-compose.yml` is only for local/dev parity; you do not need
  it on the VPS.
- Google OAuth credentials (step 7).
- At least one Instagram data vendor key, **or** a YouTube API key for
  YouTube-only use. Instagram reads cannot work without one paid vendor.
- An LLM key for generated copy (DeepSeek is the default).

---

## 2. Install Docker

On the server:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in so the group change applies
docker compose version
```

You should see a Compose version (v2). This project uses `docker compose` (the
plugin), not the old `docker-compose`. Version 2.20 or newer is required for
the optional `db` dependency; on an older version, remove the `db` entry from
`migrate.depends_on` or upgrade Docker.

---

## 3. Put the code on the server

```bash
git clone <your-repo-url> creators-101
cd creators-101
```

Or copy the directory with `rsync`. Do not copy `.env.local`, `data/` or
`.superpowers/` — the container gets its configuration from `.env.production`
and its data from a volume.

---

## 4. Configure the environment

```bash
cp .env.example .env.production
nano .env.production
```

`.env.production` is git-ignored. Never commit it. Every value in it is read by
the `web` and `migrate` services.

### Database

For a managed Postgres, paste the connection string:

```dotenv
DATABASE_URL=postgresql://user:password@host:5432/postgres?sslmode=require
```

Supabase's pooler string works. If migrations fail through a transaction pooler
(port 6543), run the migration once with the direct connection string (port
5432) and then switch back — the app itself is happy on the pooler.

For the local Compose database, use:

```dotenv
DATABASE_URL=postgres://creators:creators@db:5432/creators101
```

`web` works with either value; the `db` container is simply unused when the URL
points elsewhere.

### Environment variables

Values marked **secret** must never be pasted into a chat, an issue, a commit or
a screenshot. If one leaks, rotate it at the provider (see the last section).

| Variable | Required? | Secret? | What it is / where to get it |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Yes | Postgres connection string. Supabase → Project Settings → Database → Connection string (use the Mumbai region). |
| `DB_POOL_MAX` | No (default `5`) | No | Connections the shared Postgres pool may hold open. Raise it only when the plan allows more. |
| `APP_URL` | Yes | No | The public URL, exactly as the browser shows it, e.g. `https://creators.example.com`. Used for the OAuth redirect and links. |
| `GOOGLE_CLIENT_ID` | Yes | No | Google Cloud Console → APIs & Services → Credentials → OAuth client (Web). |
| `GOOGLE_CLIENT_SECRET` | Yes | Yes | Same OAuth client. |
| `CRON_SECRET` | Yes | Yes | Any long random string (`openssl rand -hex 32`). The cron routes refuse to run without it. |
| `LLM_API_KEY` | Yes | Yes | DeepSeek (or another OpenAI-compatible provider) API key. |
| `APIFY_TOKEN` | One Instagram vendor is required | Yes | apify.com → Console → Integrations. $5 free every month. |
| `SCRAPECREATORS_API_KEY` | One Instagram vendor is required | Yes | scrapecreators.com dashboard. |
| `HIKERAPI_KEY` | One Instagram vendor is required | Yes | hikerapi.com dashboard. |
| `SOCIALCRAWL_API_KEY` | One Instagram vendor is required | Yes | socialcrawl.dev dashboard. Also enables transcripts/comments. |
| `YOUTUBE_API_KEY` | No | Yes | Google Cloud Console → enable YouTube Data API v3 → API key. Free; only needed for the official YouTube path. |
| `YOUTUBE_WEB` | No (default `1`) | No | Keyless YouTube page reader. Set `0` to forbid it. |
| `DATA_PROVIDER` | No (default `auto`) | No | `auto`, or a vendor id (`apify`, `scrapecreators`, `hikerapi`, `socialcrawl`). |
| `APIFY_MONTHLY_FREE_USD` | No (default `5`) | No | Apify's recurring free allowance. |
| `APIFY_ITEM_USD` | No (default `0.0027`) | No | What Apify bills per result on your plan. |
| `APIFY_RESULTS_LIMIT` | No (default `24`) | No | Results requested per Apify profile read. |
| `HIKERAPI_USD_PER_CALL` | No (default `0.02`) | No | What HikerAPI actually charges your account tier. |
| `HIKERAPI_COMMENTS` | No (default `1`) | No | Fetch comments with a HikerAPI post read (one extra call). Set `0` to skip. |
| `SCRAPECREATORS_USD_PER_CALL` | No (default `0.00188`) | No | What ScrapeCreators bills per request (`$47 / 25,000`). |
| `CREDIT_COST_NICHE` | No (default `6`) | No | Gems charged for a fresh niche read. |
| `CREDIT_COST_HANDLE` | No (default `6`) | No | Gems charged for a fresh handle/profile read. |
| `CREDIT_COST_CHAT` | No (default `1`) | No | Gems charged for one Koko message. |
| `CREDIT_DAILY_FREE` | No (default `15`) | No | The free gem pool per IST day. Never accumulates. |
| `CREDIT_BUDGET` | No (default `12`) | No | Vendor units allowed in one run. |
| `CREDIT_BUDGET_USD` | No (default `1.00`) | No | Real-money ceiling for one run. |
| `WAITLIST_GLOBAL_PER_HOUR` | No (default `300`) | No | Global waitlist signup ceiling per hour across all IPs. The per-IP cap is 10/hour and one contact is capped at 5/hour; this is the backstop when an untrusted client can rotate or spoof `x-forwarded-for`. |
| `HARVEST_CACHE_HOURS` | No (default `12`) | No | How long a pulled sample stays fresh. |
| `NICHE_CACHE_HOURS` | No (default `12`) | No | How long a niche pull is served from disk. Set `168` for a week of free reopens after a paid verification run. |
| `HANDLE_CACHE_HOURS` | No (default `12`) | No | How long an account's own feed is reused before it is read again. `168` keeps a warmed handle open for a week. |
| `OWNER_CACHE_HOURS` | No (default `168`) | No | How long an owner's follower count from a niche search is reused. A cached count costs no profile read. |
| `OWNER_PROFILE_MAX` | No (default `12`) | No | Fresh owner-profile reads allowed per niche search. Cached handles do not count. |
| `PEER_MAX` | No (default `6`) | No | Maximum similar accounts kept per plan. |
| `PEER_LOOKUP_MAX` | No (default `6`) | No | Fresh follower reads bought while discovering peers. |
| `PEER_MIN_COHORT` | No (default `3`) | No | Smallest size-matched peer set quoted as "accounts your size"; below it the plan compares against the whole room. |
| `PROFILE_CACHE_HOURS` | No (default `168`) | No | How long a stored profile dossier is served before a fresh read is offered. |
| `AUTH_SAMPLE_PAGES` | No (default `0` = off) | No | Follower pages bought for the authenticity estimate. One page is below the 40-row floor, so sampling stays dormant until paging is verified. |
| `ENRICH_MAX_CREDITS` | No (default `6`) | No | Posts bought for the deep pass per plan. |
| `ENRICH_CREDIT_RESERVE` | No (default `5`) | No | Never spend the vendor key below this balance. |
| `ENRICH_ACCOUNTS` | No (default `6`) | No | Paid accounts topped up with their own feed during a niche search. |
| `FREE_ENRICH_ACCOUNTS` | No (default `32`) | No | Accounts topped up when the reader is free. Patience-bound, not budget-bound. |
| `ENRICH_COMMENTS_MAX` | No (default `4`) | No | Comment calls bought for thin posts in a plan. |
| `LANG_VERIFY_MAX` | No (default `8`) | No | Reels downloaded and watched to settle a language the caption could not. Free, but cached. |
| `LANG_COMMENT_MAX` | No (default `4`) | No | Posts bought for their comment section during language verification. `0` switches the paid step off. |
| `LANG_COMMENT_CREDITS` | No (default `4`) | No | Hard credit ceiling for that paid comment step. |
| `POST_CACHE_HOURS` | No (default `168`) | No | How long a bought post payload is reused. |
| `WHISPER_MODEL` | No | No | Path to a whisper.cpp model. Not used in the Docker image (caption-only Linux). |
| `HOOK_PAID_TRANSCRIPT` | No (default `0`) | No | `1` buys a transcript when no local model exists. Costs 10 vendor credits each. |
| `HOOK_PAID_TRANSCRIPT_CAP` | No (default `1`) | No | Maximum paid transcripts per run. |
| `WEEKLY_MAX` | No (default `3`) | No | Accounts refreshed per weekly cron call. |
| `CANARY_HANDLE` | No (default `natgeo`) | No | The public handle every vendor is tested against. |
| `CANARY_MAX_USD` | No (default `0.25`) | No | Real-money ceiling for one canary run. |
| `CANARY_WEBHOOK_URL` | No | No (treat as private) | Optional webhook for a failed canary. |
| `CREATORS_DATA_DIR` | No (default `./data`) | No | Where JSON plans and caches live. Compose sets `/app/data`. |
| `COOKIE_SECURE` | No | No | Force the session cookie's `Secure` flag on/off when testing over LAN/HTTP. Leave unset in production. |
| `GEMINI_API_KEY` | No | Yes | Google AI Studio / Cloud key. Turns on watching a reel's own MP4; without it profiles are captions-only and say so. Billed by Google per token, not in gems. |
| `GEMINI_MODEL` | No (default `gemini-2.5-flash`) | No | Model used by the video reader when `GEMINI_API_KEY` is set. |
| `VIDEO_READ_MAX` | No (default `6`) | No | Reels watched per profile, one at a time, inside a 90-second budget. Capped at `12`; `0` is treated as unset. |
| `LLM_MODEL` | No (default `deepseek-chat`) | No | Model name. |
| `LLM_BASE_URL` | No (default `https://api.deepseek.com/v1`) | No | Any OpenAI-compatible endpoint. |
| `LLM_REASONING_EFFORT` | No (default `none`) | No | `none` is faster and cheaper for JSON extraction. |

The gem prices above are the defaults the code ships with; they can be tuned
without a deploy.

> **Video reading is billed by Google, not in gems.** When `GEMINI_API_KEY` is
> set, watching a reel's MP4 spends Google tokens on the Google bill; no gem is
> charged for it.
>
> **`VIDEO_READ_MAX=0` does not turn video reading off.** The env parser treats
> `0` as "unset" and falls back to `6` (capped at `12`). To disable the feature,
> leave `GEMINI_API_KEY` blank; without a key the reader never runs.

---

## 5. Run it with Docker Compose

On the VPS (managed Postgres, no local `db`):

```bash
docker compose up -d --build
docker compose logs -f web
```

On a laptop (bundled Postgres; set `DATABASE_URL` to
`postgres://creators:creators@db:5432/creators101` first):

```bash
docker compose --profile local-db up -d --build
```

What happens:

1. With the `local-db` profile, `db` starts and must pass its healthcheck. On
   the VPS the profile is off, so no Postgres container starts.
2. `migrate` runs `npm run migrate` once and exits. It applies everything in
   `db/migrations/` in order and is safe to re-run.
3. `web` starts only after `migrate` succeeds, then serves
   `next start -H 0.0.0.0 -p 3000` as the non-root `node` user.

Check it:

```bash
curl -fsS http://127.0.0.1:3000/api/status
curl -fsS http://127.0.0.1:3000/ > /dev/null && echo "landing page ok"
```

`/api/status` returns `{"ok":true,...}`. It also reports which vendors are
configured and whether an Instagram read is funded right now.

Useful commands:

```bash
docker compose ps
docker compose logs -f web
docker compose restart web
docker compose run --rm migrate     # migrate by hand
docker compose down                 # stop (volumes are kept)
```

### If you are not using Compose

`npm run migrate` only needs `DATABASE_URL`:

```bash
npm ci
DATABASE_URL='postgresql://…' npm run migrate
npm run build
npm run start -- -H 0.0.0.0 -p 3000
```

In that case run the app under a process manager (systemd, pm2) and make
`CREATORS_DATA_DIR` point at a persistent disk.

---

## 6. Put HTTPS in front

Do not expose port 3000 to the internet. Install Caddy on the host:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Replace `/etc/caddy/Caddyfile` with this, using your domain:

```caddyfile
creators.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtains and renews the certificate automatically once DNS points at the
server. Allow only the ports you need:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Proxy headers and the waitlist limit

The waitlist route takes the caller's IP from `x-forwarded-for`. That header is
only trustworthy behind a proxy that overwrites it on every request; the Caddy
example above does (Caddy replaces the header with the address it sees). If you
expose `next start` directly to the internet, a client can spoof the header and
rotate the per-IP key. The global ceiling `WAITLIST_GLOBAL_PER_HOUR` (default
300, per hour across all IPs) bounds the table even then, and each normalised
contact is also capped at 5 requests per hour. Keep the app behind the proxy.

### The service worker, HTTPS and installability

Shambles ships as a Progressive Web App. The manifest, icons and offline shell
are served over the same origin as the app, and `public/sw.js` registers only in
a production build.

- **HTTPS is required.** Browsers only allow a service worker on a secure
  origin. The Caddy block above already terminates TLS, so
  `https://creators.example.com` works with no extra configuration. The one
  exception is `http://localhost` (and `127.0.0.1`), which browsers treat as
  secure for development and for the production build run locally. Testing over
  a LAN IP such as `http://192.168.1.20:3000` will *not* register the worker;
  use an HTTPS tunnel, or test the phone flows against the deployed domain.
- **The worker serves no private data.** It caches only `/_next/static/**`,
  `/icons/**`, font files and the `/offline` page shell. Non-GET requests,
  anything under `/api/`, and responses with `Set-Cookie`,
  `Cache-Control: no-store` or `private` are never stored. Navigations are
  network-first; on failure they show `/offline`.
- **A new deploy invalidates the cache by version.** Bump `CACHE_VERSION` in
  `public/sw.js` (`v1` → `v2`) in the same release that changes the app shell.
  On `activate`, every older `shambles-*` cache is deleted. The registration
  code checks for an update on load and when the tab becomes visible again; a
  waiting worker takes over on the next navigation, never by reloading a form
  the visitor is filling in. `/sw.js` is served with `Cache-Control: no-cache`
  and `Service-Worker-Allowed: /` from `next.config.ts`.
- **Testing an install on a phone.** Deploy over HTTPS, then:
  - **Chrome on Android:** open the site, wait for the install bar (second
    visit or after opening a profile), tap **Install**, or use the browser menu
    → **Add to Home screen**. The app opens standalone with the obsidian theme.
  - **Safari on iOS:** open the site in Safari, tap **Share** (the square with
    an arrow), scroll to **Add to Home Screen**, confirm. iOS does not fire
    `beforeinstallprompt`; the site shows the "Share, then Add to Home Screen"
    hint instead. If it does not appear, dismiss any previous prompt and
    revisit after a second day.
  - To remove it, long-press the home-screen icon and delete it. The site's
    cache can be cleared from the browser's site-data settings.
- **Offline check.** After one visit, turn on airplane mode and reload a
  visited page. The `/offline` shell should appear with a retry button. On the
  first-ever visit (nothing cached), the browser's own offline page may appear
  instead.

---

## 7. Google sign-in

In Google Cloud Console → **APIs & Services → Credentials**, edit the OAuth
client (Web application) and add this **Authorised redirect URI** exactly:

```
https://creators.example.com/api/auth/google/callback
```

That is `https://<your-domain>/api/auth/google/callback` — no trailing slash,
and it must match `APP_URL`. Set:

```dotenv
APP_URL=https://creators.example.com
```

Then `docker compose up -d` to pick up the change. A mismatch here is the usual
cause of `redirect_uri_mismatch`.

The OAuth consent screen can stay in Google's **Testing** mode while you trial
the app: only the test users you add can sign in, and everyone else sees the
"unverified app" warning (100-user cap). The scopes used here — `openid`,
`email` and `profile` — are non-sensitive, so publishing needs no Google
verification. When the trial is over, flip the consent screen to **In
production** in the same console; no code or redirect change is needed.

---

## 8. Cron jobs

The app exposes three GET endpoints. All three require `CRON_SECRET`. Send it in
the `x-cron-secret` header so it does not appear in access logs or process lists.

| Job | When | URL |
| --- | --- | --- |
| Weekly refresh | Monday | `https://creators.example.com/api/cron/weekly` |
| Trending rebuild | Daily | `https://creators.example.com/api/cron/trending` |
| Vendor canary | Daily | `https://creators.example.com/api/cron/canary` |

Put the secret in a private curl config file rather than on the command line, so
it never appears in `ps` output or the shell history:

```bash
umask 077
printf 'header = "x-cron-secret: %s"\n' "$(openssl rand -hex 32)" > /root/.creators-cron
# or paste your existing CRON_SECRET instead of generating a new one:
# printf 'header = "x-cron-secret: YOUR_CRON_SECRET"\n' > /root/.creators-cron
chmod 600 /root/.creators-cron
```

The file must contain one line: `header = "x-cron-secret: …"`. Edit the crontab
on the server:

```bash
crontab -e
```

Add (replace the domain; times are the server's local time):

```cron
0  6 * * 1  curl -fsS --config /root/.creators-cron https://creators.example.com/api/cron/weekly   >> /var/log/creators-weekly.log 2>&1
15 6 * * *  curl -fsS --config /root/.creators-cron https://creators.example.com/api/cron/trending >> /var/log/creators-trending.log 2>&1
30 6 * * *  curl -fsS --config /root/.creators-cron https://creators.example.com/api/cron/canary   >> /var/log/creators-canary.log 2>&1
```

Notes:

- The weekly job re-reads a capped number of accounts (`WEEKLY_MAX`) and costs
  real vendor calls. It skips a week it has already recorded.
- `/api/cron/trending` without query parameters is the free half (rebuilds the
  ranking from pulls already on disk). Add `?refresh=1` only if you want it to
  spend credits researching the stalest rooms.
- `/api/cron/canary` accepts the secret **only** through the header. It spends
  one profile read per configured Instagram vendor, bounded by
  `CANARY_MAX_USD`; vendors that would cross the ceiling are skipped.
- All three routes accept the secret **only** through the `x-cron-secret`
  header. The old `?secret=` query parameter is gone: a URL secret lands in
  access logs, proxy logs and shell history.

Check a job by running its line by hand first, then confirm `GET /api/status`
still looks right.

---

## 9. Backups

Two things hold state:

1. **`/app/data`** — the `app_data` volume. This contains niche caches, handle
   caches and every visitor's JSON plan. Losing it loses plans and forces paid
   re-pulls, but not accounts or credits.
2. **Postgres** — users, sessions, the credit ledger, chat, trending niches,
   creator profiles and the vendor canary.

Back up `data/`:

```bash
mkdir -p backups
docker compose exec -T web tar czf - -C /app/data . > "backups/creators-data-$(date +%F).tgz"
```

Back up a managed Postgres:

```bash
pg_dump "$DATABASE_URL" -Fc -f "backups/creators-db-$(date +%F).dump"
```

Back up the Compose Postgres:

```bash
docker compose exec -T db pg_dump -U creators -d creators101 -Fc > "backups/creators-db-$(date +%F).dump"
```

Copy both files off the machine (object storage or another server). A backup on
the same disk is not a backup. Restore the JSON with
`docker compose exec -T web tar xzf - -C /app/data < file.tgz` and the database
with `pg_restore -d "$DATABASE_URL" file.dump`.

If you use a bind mount for `data/` instead of the named volume, the host
directory must be writable by uid `1000` (the `node` user in the image):

```bash
sudo chown -R 1000:1000 /srv/creators-data
```

---

## 10. Updating

```bash
git pull
docker compose up -d --build
docker compose logs -f web
```

`migrate` runs again automatically before `web` restarts. It is idempotent.

---

## Known V1 limits

- **One machine.** Sessions, the credit ledger and the JSON plans assume one
  server. Do not run two `web` containers against the same data directory
  without moving plans to Postgres first.
- **Rate limits are in memory.** They reset on restart and are not shared
  between processes. Fine for one VPS; not a distributed limiter.
- **Plans, ideas and weekly digests are JSON on local disk.** They survive
  restarts only because `/app/data` is a volume. Back it up.
- **The deep pass is caption-only on Linux.** The container installs `ffmpeg`
  but not whisper.cpp or Swift. macOS Vision OCR is macOS-only, so
  `lib/media.ts` reports OCR as unavailable on Linux and the plan uses captions,
  saying so. A copied `scripts/ocr.swift` does not change that. To get
  video-level hook reading in production you need a macOS worker or a Linux OCR
  replacement; that is post-V1.
- **Postgres and the app should both be in Mumbai.** Supabase has an
  `ap-south-1` (Mumbai) region. A database in another region adds latency to
  every page and every credit check.
- **Single-region, single-DB.** There is no read replica or failover. Take
  backups and keep the restore commands somewhere you can find them.

---

## Video reading (Gemini)

The profile page can watch a reel's own MP4 instead of reasoning only from its
caption, but only when `GEMINI_API_KEY` is set. Without the key the page is
captions-only and says so on every card; nothing breaks.

- Reads at most `VIDEO_READ_MAX` reels per profile (default 6), one at a time,
  inside a 90-second budget. Readings are cached for seven days by shortcode in
  `video_readings.json` under the data directory.
- The MP4 is downloaded from Instagram's CDN (HTTPS, Instagram hosts only,
  15 MB and 20 s ceilings) and sent inline to Gemini.

**Cost:** this is **not** paid for in gems. Google bills the Gemini API per
token (input video tokens plus the answer), and the price is Google's to change.
Check the current Gemini API pricing page and your Cloud billing before enabling
it in production. A rough budget should be based on that page, not on a number
hard-coded here.

Rotate a leaked `GEMINI_API_KEY` in Google AI Studio / Cloud Console and update
`.env.production`.

---

## If a secret leaks

Rotate it at the source, then update `.env.production` and restart:

- `CRON_SECRET` — generate a new one and update the crontab.
- `GOOGLE_CLIENT_SECRET` — reset it in Google Cloud Console; the old one stops
  working immediately.
- `DATABASE_URL` — rotate the database password in Supabase (or your provider).
- Vendor keys (`APIFY_TOKEN`, `SCRAPECREATORS_API_KEY`, `HIKERAPI_KEY`,
  `SOCIALCRAWL_API_KEY`) — revoke and reissue in each dashboard.
- `LLM_API_KEY` — revoke and reissue with the LLM provider.

A secret pasted into a public issue, chat, screenshot or commit is already
public. Rotating is the only fix; deleting the message is not enough.
