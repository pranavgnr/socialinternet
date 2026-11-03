-- 003_waitlist.sql — signups for the locked features.
--
-- A person joins with an email, a WhatsApp number, or both, and one feature.
-- The unique index is an expression index so a repeat signup for the same
-- contact and feature is a no-op instead of another row: the coalesce picks
-- whichever contact they gave, and the same contact may still join a different
-- feature. Safe to re-run because both statements are idempotent.

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id bigserial PRIMARY KEY,
  email text,
  whatsapp text,
  handle text,
  feature text NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_signups_contact_check
    CHECK (email IS NOT NULL OR whatsapp IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_contact_feature_key
  ON waitlist_signups (coalesce(email, whatsapp), feature);
