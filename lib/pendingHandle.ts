/**
 * The one session-storage key every sign-in prompt uses to carry a typed
 * handle or niche across the trip through Google.
 *
 * It used to live in `components/ConnectHandle.tsx`. The handle form was
 * retired with the old interface, but the profile, niche and Koko flows still
 * need the same key, so it lives here without importing a deleted component.
 * The `c101` prefix is kept deliberately: it is storage only, not a brand.
 */
export const PENDING_HANDLE_KEY = "c101:pendingHandle";
