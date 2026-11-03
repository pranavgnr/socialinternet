/**
 * Watching a reel, or honestly not watching it.
 *
 * Every structural claim on a profile card ("it opens on a question", "the text
 * is up before the first word") has to come from somewhere. Until now it came
 * from the caption and the numbers, and the card said so. This module adds a
 * second basis — an actual look at the video — without ever making the page
 * depend on it:
 *
 *   - `CaptionReader` always answers, with `basis: "captions"` and no bullets,
 *     so the existing caption/number bullets stay exactly as they were;
 *   - `GeminiReader` exists only when `GEMINI_API_KEY` is set; it downloads the
 *     reel's MP4 from Instagram's CDN (HTTPS only, Instagram hosts only, 15 MB
 *     and 20 s ceilings, redirects re-checked) and asks Gemini for a small,
 *     strictly validated JSON reading;
 *   - any failure — no key, no URL, an unsafe URL, a slow download, a malformed
 *     answer — falls back to captions for that one reel and never fails the
 *     profile read.
 *
 * Readings are cached by shortcode for seven days in
 * `<dataRoot()>/video_readings.json`, and a profile reads at most
 * `VIDEO_READ_MAX` (default 6) reels, one at a time, inside a 90-second budget.
 *
 * Gemini is billed by Google per token; it is not paid for in gems. See
 * `docs/deploy.md` — the price is not hard-coded here because it is Google's to
 * change and should be checked on the current pricing page.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";

import { dataRoot } from "./dataDir";
import { hoursFromEnv, intFromEnv } from "./env";
import { plain } from "./plain";

export type VideoBasis = "video" | "captions";
export type HookType = "spoken" | "on-screen" | "visual";

/** What a reel's opening, pacing and loop actually look like. */
export interface VideoReading {
  /** "video" only when the MP4 was actually watched */
  basis: VideoBasis;
  /** seconds after frame 0 at which the opening lands */
  hookSeconds?: number;
  hookType?: HookType;
  /** the words burned onto the frame, tags stripped */
  onScreenText?: string;
  /** one short sentence on edit pace */
  pacing?: string;
  /** the ending is designed to replay the start */
  loop?: boolean;
  /** up to four short, plain observations */
  why: string[];
}

/** What the reader is given: enough to find the MP4 and fall back to captions. */
export interface ReelToRead {
  url: string;
  shortcode?: string;
  /** signed CDN link to the reel's own MP4 */
  mediaUrl?: string;
  caption: string;
}

export interface VideoReader {
  read(reel: ReelToRead): Promise<VideoReading>;
}

/** 15 MB: a reel is short, and a huge file is not worth the tokens or the wait. */
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
/** One download may not hang a profile read for longer than this. */
export const DOWNLOAD_TIMEOUT_MS = 20_000;
/** The whole video pass for one profile stops here. */
export const PROFILE_TIMEOUT_MS = 90_000;
/** At most this many redirect hops, each re-checked against the host list. */
const MAX_REDIRECTS = 3;

const CAPTION_READING: VideoReading = { basis: "captions", why: [] };

function captions(): VideoReading {
  return { basis: "captions", why: [] };
}

/**
 * The reader that always works. It adds no claims, which is exactly right: the
 * caption bullets were already computed by `buildProfileView`.
 */
export const CaptionReader: VideoReader = {
  async read() {
    return { ...CAPTION_READING, why: [] };
  },
};

/* ------------------------------------------------------------------ hosts */

const ALLOWED_HOSTS = ["cdninstagram.com", "fbcdn.net", "instagram.com"];

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare) !== 0) return false;
  return ALLOWED_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/**
 * The only URLs worth downloading: HTTPS, one of Instagram's own hosts, no IP
 * literal, no credentials and no unusual port. A signed CDN link is a secret,
 * so nothing here is ever logged.
 */
export function safeMediaUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (!hostAllowed(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- download */

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Download the MP4 with every guard visible in one place.
 *
 * `redirect: "manual"` is deliberate: a 302 is a second URL decision, and
 * following it blind is how a CDN allowlist gets bypassed. Each hop is checked
 * with `safeMediaUrl` before it is fetched.
 */
async function downloadVideo(
  url: string,
  doFetch: typeof fetch,
): Promise<Uint8Array> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const safe = safeMediaUrl(current);
    if (!safe) throw new Error("media URL is not an allowed Instagram HTTPS URL");

    const res = await doFetch(safe, {
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect without a location");
      current = new URL(location, safe).toString();
      continue;
    }

    if (!res.ok) throw new Error(`media download failed (HTTP ${res.status})`);

    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) {
      throw new Error("video is larger than 15 MB");
    }

    if (!res.body) {
      const buffer = new Uint8Array(await res.arrayBuffer());
      if (buffer.byteLength > MAX_VIDEO_BYTES) {
        throw new Error("video is larger than 15 MB");
      }
      return buffer;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("video is larger than 15 MB");
      }
      chunks.push(value);
    }
    return concat(chunks, total);
  }

  throw new Error("too many redirects");
}

/* ------------------------------------------------------------------- ask */

const PROMPT = [
  "You are reading one Instagram Reel for a creator's audit.",
  "Watch the video and answer with ONLY a JSON object, no prose and no markdown fence:",
  '{"hookSeconds": <number 0-60, when the opening lands>, "hookType": "spoken" | "on-screen" | "visual", "onScreenText": "<the words burned on screen in the first seconds, or an empty string>", "pacing": "<one short sentence on the edit pace and how many ideas it fits>", "loop": <true when the ending is designed to replay the start>, "why": ["<up to four short observations>"]}',
  "Describe what is actually in the video: the first seconds, the pacing, the on-screen text, the visual contrast and the loop design.",
  "Use plain words a creator would use. If the audio is spoken, write the observations in the language of the audio where relevant.",
  "Do not guess beyond what you can see or hear.",
].join(" ");

const HOOK_TYPES = new Set<HookType>(["spoken", "on-screen", "visual"]);

/** Remove tag-like text, so model output cannot smuggle markup into the page. */
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function shortText(value: string, max: number): string {
  return plain(stripTags(value)).slice(0, max).trim();
}

/**
 * Extract the JSON object from whatever the model wrote, then validate it.
 *
 * Prose around the object is tolerated (models like to explain themselves) but
 * the object itself is not: wrong types, an unknown hook type, an out-of-range
 * moment or a non-array `why` all mean "no reading", and the caller falls back
 * to captions. Fields are length-capped rather than rejected, because a long
 * sentence is not a lie; a `why` that is not a list of strings is.
 */
export function parseReading(raw: unknown): VideoReading | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const hookType = value.hookType;
  if (typeof hookType !== "string" || !HOOK_TYPES.has(hookType as HookType)) {
    return null;
  }

  const hookSeconds = value.hookSeconds;
  if (
    typeof hookSeconds !== "number" ||
    !Number.isFinite(hookSeconds) ||
    hookSeconds < 0 ||
    hookSeconds > 60
  ) {
    return null;
  }

  if (typeof value.loop !== "boolean") return null;
  if (!Array.isArray(value.why)) return null;
  if (value.why.some((line) => typeof line !== "string")) return null;

  const why = value.why
    .map((line) => shortText(line as string, 160))
    .filter(Boolean)
    .slice(0, 4);

  const onScreenText =
    typeof value.onScreenText === "string"
      ? shortText(value.onScreenText, 300)
      : "";
  const pacing =
    typeof value.pacing === "string" ? shortText(value.pacing, 200) : "";

  return {
    basis: "video",
    hookSeconds: Math.round(hookSeconds * 10) / 10,
    hookType: hookType as HookType,
    onScreenText: onScreenText || undefined,
    pacing: pacing || undefined,
    loop: value.loop,
    why,
  };
}

/** The JSON object inside a model answer, or `null` when there is not one. */
export function extractJsonObject(text: string): unknown {
  const body = text.trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function modelText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  const first = candidates[0] as
    | { content?: { parts?: { text?: unknown }[] } }
    | undefined;
  const parts = first?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  return text || null;
}

/* ----------------------------------------------------------------- cache */

interface CachedReading {
  savedAt: string;
  reading: VideoReading;
}

type ReadingsCache = Record<string, CachedReading>;

function emptyCache(): ReadingsCache {
  return Object.create(null) as ReadingsCache;
}

function cacheHours(): number {
  return hoursFromEnv("VIDEO_CACHE_HOURS", 168);
}

export function videoReadingsPath(): string {
  return path.join(dataRoot(), "video_readings.json");
}

/** How many reels one profile may watch; 6 by default. */
export function videoReadMax(): number {
  return intFromEnv("VIDEO_READ_MAX", 6, 12);
}

function isReading(value: unknown): value is VideoReading {
  if (!value || typeof value !== "object") return false;
  const reading = value as Partial<VideoReading>;
  return reading.basis === "video" && Array.isArray(reading.why);
}

function isFresh(entry: CachedReading, nowMs: number): boolean {
  const at = Date.parse(entry.savedAt);
  if (!Number.isFinite(at)) return false;
  const age = nowMs - at;
  if (age < 0) return true;
  return age < cacheHours() * 3_600_000;
}

async function loadReadings(): Promise<ReadingsCache> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(videoReadingsPath(), "utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyCache();
    }
    const out = emptyCache();
    for (const [key, rawEntry] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const entry = rawEntry as Partial<CachedReading> | null;
      if (!entry || typeof entry !== "object") continue;
      const at = Date.parse(String(entry.savedAt ?? ""));
      if (!Number.isFinite(at)) continue;
      if (!isReading(entry.reading)) continue;
      out[key] = {
        savedAt: new Date(at).toISOString(),
        reading: entry.reading,
      };
    }
    return out;
  } catch {
    return emptyCache();
  }
}

async function saveReading(
  key: string,
  reading: VideoReading,
  nowMs: number,
): Promise<void> {
  const cache = await loadReadings();
  cache[key] = { savedAt: new Date(nowMs).toISOString(), reading };

  const kept = emptyCache();
  for (const [k, entry] of Object.entries(cache)) {
    if (isFresh(entry, nowMs)) kept[k] = entry;
  }

  const target = videoReadingsPath();
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(kept, null, 2), "utf8");
    await fs.rename(tmp, target);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** The shortcode in a reel URL, for the cache key. */
export function shortcodeFromUrl(url: string): string | undefined {
  const match = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/.exec(url);
  return match?.[1];
}

/* ---------------------------------------------------------------- gemini */

export interface GeminiReaderOptions {
  apiKey?: string;
  model?: string;
  /** Injected fetch, for tests. Defaults to the global one at call time. */
  fetch?: typeof fetch;
  /** Injected clock, epoch milliseconds. */
  now?: () => number;
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function geminiBody(apiKey: string, model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * The reader that watches the MP4 through Gemini.
 *
 * `read` never rejects: a bad URL, a slow download, a 500 from Google or an
 * answer that does not validate all resolve to a caption reading for that reel.
 * The key travels only in the `x-goog-api-key` header — never in a URL, never
 * in a log line.
 */
export function GeminiReader(opts: GeminiReaderOptions = {}): VideoReader {
  const model = opts.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const now = opts.now ?? Date.now;
  const doFetch: typeof fetch =
    opts.fetch ?? ((input, init) => fetch(input, init));

  return {
    async read(reel: ReelToRead): Promise<VideoReading> {
      const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? "";
      if (!apiKey.trim()) return captions();

      const key = reel.shortcode ?? shortcodeFromUrl(reel.url) ?? reel.url;
      try {
        const cache = await loadReadings();
        const hit = cache[key];
        if (hit && isFresh(hit, now())) return hit.reading;

        const media = safeMediaUrl(reel.mediaUrl);
        if (!media) return captions();

        const bytes = await downloadVideo(media, doFetch);
        const response = await doFetch(geminiBody(apiKey, model), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: "video/mp4",
                      data: Buffer.from(bytes).toString("base64"),
                    },
                  },
                  { text: PROMPT },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });

        if (!response.ok) return captions();

        const payload = (await response.json().catch(() => null)) as unknown;
        const text = modelText(payload);
        if (!text) return captions();

        const reading = parseReading(extractJsonObject(text));
        if (!reading) return captions();

        await saveReading(key, reading, now());
        return reading;
      } catch {
        return captions();
      }
    },
  };
}

/** The reader the product uses: Gemini when a key exists, captions otherwise. */
export function configuredReader(): VideoReader {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey ? GeminiReader({ apiKey }) : CaptionReader;
}

/* -------------------------------------------------------------- scheduler */

export interface ReadReelsOptions {
  /** hard ceiling on reads; defaults to `VIDEO_READ_MAX` (6) */
  max?: number;
  /** whole-pass budget; defaults to 90 s */
  timeoutMs?: number;
  /** injected clock, epoch milliseconds */
  now?: () => number;
}

/**
 * Read the chosen reels, one at a time, inside a cap and a deadline.
 *
 * The result is keyed by the reel's URL. A reel that failed is simply absent,
 * which the view reads as "keep the caption basis". Reads are sequential on
 * purpose: one video at a time keeps memory and the token bill predictable.
 */
export async function readReels(
  reels: ReelToRead[],
  reader: VideoReader,
  opts: ReadReelsOptions = {},
): Promise<Map<string, VideoReading>> {
  const max = Math.max(0, Math.floor(opts.max ?? videoReadMax()));
  const timeoutMs = opts.timeoutMs ?? PROFILE_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const out = new Map<string, VideoReading>();

  for (const reel of reels) {
    if (out.size >= max) break;
    if (now() - startedAt >= timeoutMs) break;
    try {
      out.set(reel.url, await reader.read(reel));
    } catch {
      // Reading failures never fail the profile read.
    }
  }

  return out;
}

/**
 * The one line a video-read card adds: what opens the reel and when.
 *
 * Deliberately not passed through `plain()`: this is the label the card is
 * supposed to show, not generated prose. The observations themselves were
 * already cleaned when they were parsed.
 */
export function hookLine(reading: VideoReading): string | undefined {
  if (reading.basis !== "video") return undefined;
  if (!reading.hookType || typeof reading.hookSeconds !== "number") {
    return undefined;
  }
  return `Hook: ${reading.hookType}, lands at ${reading.hookSeconds} s`;
}
