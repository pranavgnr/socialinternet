import { currentDb } from "./db";
import { normalizeHandle } from "./handle";

/**
 * The creator profile captured from a successful plan: who they are and what
 * they make.
 *
 * This record is private by default and is the future seed for a media kit; V1
 * exposes no read endpoint for it and stores nothing beyond what the plan
 * already measured (no email, no raw posts).
 */
export type CreatorProfilePlatform = "instagram" | "youtube";

export interface CreatorProfileInput {
  handle: string;
  niche?: string;
  followers?: number;
  platform?: CreatorProfilePlatform;
}

/** The column is text; 120 characters is enough to name any niche we infer. */
const NICHE_MAX = 120;

/**
 * Persist one creator's profile, keyed by the signed-in user.
 *
 * `handle` and `platform` always take the value just measured. `niche` and
 * `followers` are COALESCEd on conflict so a plan that could not read one of
 * them never erases the value an earlier plan already knew.
 */
export async function saveCreatorProfile(
  userId: string,
  p: CreatorProfileInput,
): Promise<void> {
  const handle = normalizeHandle(p.handle);
  if (!handle) {
    throw new Error("creator profile handle is not a valid handle");
  }

  const platform = p.platform ?? "instagram";
  if (platform !== "instagram" && platform !== "youtube") {
    throw new Error(
      'creator profile platform must be "instagram" or "youtube"',
    );
  }

  await currentDb().query(
    `INSERT INTO creator_profiles (user_id, handle, niche, followers, platform, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       handle = EXCLUDED.handle,
       platform = EXCLUDED.platform,
       niche = COALESCE(EXCLUDED.niche, creator_profiles.niche),
       followers = COALESCE(EXCLUDED.followers, creator_profiles.followers),
       updated_at = now()`,
    [userId, handle, cleanNiche(p.niche) ?? null, cleanFollowers(p.followers) ?? null, platform],
  );
}

/** Trimmed, capped at the column's useful length; blank is "not known". */
function cleanNiche(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, NICHE_MAX);
}

/**
 * A follower count is only stored when it is a real, non-negative number.
 * Fractional values are rounded; NaN, Infinity and negatives mean "unknown"
 * and are left out so COALESCE keeps whatever was known before.
 */
function cleanFollowers(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
}
