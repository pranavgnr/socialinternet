-- 001_init.sql — V1 schema.
-- Applied in filename order by lib/migrate.ts; every statement is
-- CREATE TABLE IF NOT EXISTS so re-running is always safe.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  google_sub text UNIQUE,
  email text,
  name text,
  legacy_account_id uuid,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  day date,
  delta int,
  reason text,
  ref text,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  handle text,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  thread_id uuid REFERENCES chat_threads(id),
  role text CHECK (role IN ('user', 'assistant')),
  content text,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS trending_niches (
  slug text PRIMARY KEY,
  label text,
  query text,
  score real,
  rank int,
  refreshed_at timestamptz
);

CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  handle text,
  niche text,
  followers int,
  platform text DEFAULT 'instagram',
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS vendor_canary (
  id bigserial PRIMARY KEY,
  vendor text,
  ok boolean,
  detail text,
  checked_at timestamptz
);
