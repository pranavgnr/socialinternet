/**
 * One input, two jobs.
 *
 * The header search bar accepts either a profile — `@handle` or an
 * instagram.com profile URL — or a niche phrase. Only the two explicit profile
 * shapes switch to a profile route: a bare word that also happens to be a
 * legal handle (`cooking`, `explore`) is a niche, exactly as it was before.
 * That rule is shared with `looksLikeHandle`, which is also what the handle
 * form uses, so the same account never resolves two ways.
 *
 * Everything else that is 2 to 120 characters (whitespace collapsed) is a
 * niche. Shorter, longer and punctuation-only input is refused here rather
 * than charged for downstream.
 */
import { looksLikeHandle, normalizeHandle } from "./handle";

export type OmniRoute =
  | { href: string; kind: "profile" | "niche" }
  | { error: string };

export const OMNI_HANDLE_ERROR = "Paste a profile link or an @handle";
export const OMNI_EMPTY_ERROR = "Enter a niche or an @handle";
export const OMNI_SHORT_ERROR = "Type at least 2 characters";
export const OMNI_LONG_ERROR = "Keep it under 120 characters";

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Where Koko opens from the current page. A profile carries its handle, a niche
 * page its query, and anything else opens a blank studio. `usePathname` only
 * knows the path, so this is a pure function the widget and the tests share.
 */
export function kokoHref(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean).map(decodeSegment);

  if (parts[0] === "profile" && parts[1]) {
    return `/chat?handle=${encodeURIComponent(parts[1])}`;
  }
  if (parts[0] === "search" && parts[1] === "niche" && parts[2]) {
    return `/chat?niche=${encodeURIComponent(parts.slice(2).join("/"))}`;
  }
  return "/chat";
}

/** `https://…`, `http://…` or a bare `instagram.com/…`, with optional www. */
const INSTAGRAM_URL = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i;

/** A route made only of punctuation, symbols or emoji is not a niche. */
const HAS_WORD = /[\p{L}\p{N}]/u;

export function routeFor(input: string): OmniRoute {
  if (typeof input !== "string") return { error: OMNI_EMPTY_ERROR };

  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return { error: OMNI_EMPTY_ERROR };

  /**
   * Explicit profile shapes are parsed first. A content URL (reel, post,
   * stories, explore) is an instagram.com URL but not a profile, so it gets
   * the handle hint instead of silently becoming the niche "p".
   */
  if (text.startsWith("@") || INSTAGRAM_URL.test(text)) {
    const handle = normalizeHandle(text);
    if (!handle || !looksLikeHandle(text)) {
      return { error: OMNI_HANDLE_ERROR };
    }
    return { href: `/profile/${handle}`, kind: "profile" };
  }

  if (text.length < 2) return { error: OMNI_SHORT_ERROR };
  if (text.length > 120) return { error: OMNI_LONG_ERROR };
  if (!HAS_WORD.test(text)) return { error: OMNI_EMPTY_ERROR };

  return { href: `/search/niche/${encodeURIComponent(text)}`, kind: "niche" };
}
