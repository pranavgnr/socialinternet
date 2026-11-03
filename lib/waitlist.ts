// Waitlist signups: one contact validation path for the route and its tests,
// and one insert that turns a repeat signup into `duplicate` rather than an
// error. No email or phone number is ever logged here.
import { currentDb } from "./db";
import { normalizeHandle } from "./handle";

export const WAITLIST_FEATURES = [
  "shop-dine-stay",
  "mini-business",
  "rate-card",
  "comment-to-dm",
  "ig-wrapped",
  "vip",
] as const;

export type WaitlistFeature = (typeof WAITLIST_FEATURES)[number];

export function isWaitlistFeature(value: unknown): value is WaitlistFeature {
  return (
    typeof value === "string" &&
    (WAITLIST_FEATURES as readonly string[]).includes(value)
  );
}

export interface WaitlistContact {
  email?: string;
  whatsapp?: string;
}

/**
 * A validated contact pair. The caller gets either both fields the person
 * actually supplied, normalised, or one friendly sentence to show them.
 */
export function normalizeContact(
  input: { email?: string; whatsapp?: string },
): WaitlistContact | { error: string } {
  const rawEmail = typeof input.email === "string" ? input.email.trim() : "";
  const rawWhatsApp =
    typeof input.whatsapp === "string" ? input.whatsapp.trim() : "";

  if (!rawEmail && !rawWhatsApp) {
    return { error: "Enter your email or WhatsApp number." };
  }

  const out: WaitlistContact = {};

  if (rawEmail) {
    const email = rawEmail.toLowerCase();
    if (!validEmail(email)) {
      return { error: "That email address doesn't look right." };
    }
    out.email = email;
  }

  if (rawWhatsApp) {
    const whatsapp = normalizeWhatsApp(rawWhatsApp);
    if (!whatsapp) {
      return {
        error:
          "That WhatsApp number doesn't look right. Use the country code, for example +91 98765 43210.",
      };
    }
    out.whatsapp = whatsapp;
  }

  return out;
}

/**
 * E.164 for the launch market. A bare ten-digit number is Indian by default;
 * a leading 0 is the domestic trunk prefix; anything with a + is kept when it
 * is a plausible international number (8 to 15 digits).
 */
export function normalizeWhatsApp(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, "");
  if (!cleaned) return null;
  if (!/^\+?\d+$/.test(cleaned)) return null;

  const hasPlus = cleaned.startsWith("+");
  const digits = hasPlus ? cleaned.slice(1) : cleaned;

  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) {
    // A ten-digit Indian number does not itself start with the trunk 0; that
    // shape is an 11-digit input with the 0 dropped.
    return digits.startsWith("0") ? null : `+91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+91${digits.slice(1)}`;
  }
  return null;
}

function validEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;

  const parts = value.split("@");
  if (parts.length !== 2) return false;

  const [local, domain] = parts as [string, string];
  if (!local || !domain) return false;
  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;

  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false;
  }
  return /^[a-z0-9.-]+$/.test(domain);
}

/**
 * The handle field is optional and public text, so it is never stored raw.
 * HTML tags are removed first, then the same canonical rule as the rest of the
 * site applies; a value that still cannot be a handle is dropped silently.
 */
export function cleanWaitlistHandle(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;

  const plain = input.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
  if (!plain) return undefined;

  return normalizeHandle(plain) ?? normalizeHandle(plain.slice(0, 30)) ?? undefined;
}

/** A source is a short internal label, never free text from the person. */
export function cleanWaitlistSource(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().toLowerCase();
  return /^[a-z0-9:_-]{1,40}$/.test(value) ? value : undefined;
}

export interface WaitlistSignup {
  email?: string;
  whatsapp?: string;
  handle?: string;
  feature: WaitlistFeature;
  source?: string;
}

/**
 * Writes one signup. `ON CONFLICT DO NOTHING` with `RETURNING` is the whole
 * duplicate check: the expression unique index decides, and an empty result
 * means this contact had already joined this feature. That is a success for
 * the visitor, not an error.
 */
export async function saveWaitlistSignup(
  input: WaitlistSignup,
): Promise<{ ok: true; duplicate: boolean }> {
  if (!isWaitlistFeature(input.feature)) {
    throw new Error("Unknown waitlist feature.");
  }

  const contact = normalizeContact(input);
  if ("error" in contact) throw new Error(contact.error);

  const { rows } = await currentDb().query<{ id: string | number }>(
    `INSERT INTO waitlist_signups (email, whatsapp, handle, feature, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      contact.email ?? null,
      contact.whatsapp ?? null,
      cleanWaitlistHandle(input.handle) ?? null,
      input.feature,
      cleanWaitlistSource(input.source) ?? null,
    ],
  );

  return { ok: true, duplicate: rows.length === 0 };
}
