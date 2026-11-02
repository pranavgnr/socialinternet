# Deploying Creators 101

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
| `CREDIT_BUDGET` | No (default `12`) | No | Vendor units allowed in one run. |
| `CREDIT_BUDGET_USD` | No (default `1.00`) | No | Real-money ceiling for one run. |
| `HARVEST_CACHE_HOURS` | No (default `12`) | No | How long a pulled sample stays fresh. |
| `NICHE_CACHE_HOURS` | No (default `12`) | No | How long a niche pull is served from disk. Set `168` for a week of free reopens after a paid verification run. |
| `HANDLE_CACHE_HOURS` | No (default `12`) | No | How long an account's own feed is reused before it is read again. `168` keeps a warmed handle open for a week. |
| `ENRICH_MAX_CREDITS` | No (default `6`) | No | Posts bought for the deep pass per plan. |
| `ENRICH_CREDIT_RESERVE` | No (default `5`) | No | Never spend the vendor key below this balance. |
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
| `LLM_MODEL` | No (default `deepseek-chat`) | No | Model name. |
| `LLM_BASE_URL` | No (default `https://api.deepseek.com/v1`) | No | Any OpenAI-compatible endpoint. |
| `LLM_REASONING_EFFORT` | No (default `none`) | No | `none` is faster and cheaper for JSON extraction. |

The credit prices can also be tuned with `CREDIT_COST_NICHE`,
`CREDIT_COST_HANDLE`, `CREDIT_COST_CHAT` and `CREDIT_DAILY_FREE`; the defaults
are fine for V1.

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
