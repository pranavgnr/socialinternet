import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { fetchTranscript } from "./harvest";
import { normaliseLang } from "./lang";
import type { HookMode, HookReading, RawReel } from "./types";

const run = promisify(execFile);

/* --------------------- paid transcript fallback --------------------- */

/**
 * Ten credits a call, so this exists for one case only: a machine with no
 * whisper model. Off unless asked for, and never more than the cap per run —
 * a bug in a loop must not be able to empty the key.
 */
const PAID_TRANSCRIPT = process.env.HOOK_PAID_TRANSCRIPT === "1";
const PAID_TRANSCRIPT_CAP = Number(process.env.HOOK_PAID_TRANSCRIPT_CAP ?? 1);

let paidTranscripts = 0;

function canPayForTranscript(): boolean {
  return PAID_TRANSCRIPT && paidTranscripts < PAID_TRANSCRIPT_CAP && Boolean(process.env.SOCIALCRAWL_API_KEY);
}

/**
 * Reading the hook off the video, at zero credits.
 *
 * The one thing a view count cannot tell a creator is where the first three
 * seconds actually happen: in the words said, in the text burned onto the
 * frame, or in the shot itself. That is answerable by watching, and watching
 * costs nothing here — the reel's own MP4 is on the CDN, whisper.cpp is local,
 * and macOS reads on-screen text through Vision.
 *
 * SocialCrawl sells the same transcript for 10 credits a reel. With ~55 credits
 * on the key that is five reels ever, so the paid path is off by default and
 * capped at one reel per run: set `HOOK_PAID_TRANSCRIPT=1` on a machine with no
 * whisper model and the reader still answers, for ten credits, once.
 */

const MEDIA_DIR = path.join(process.cwd(), "data", "_media");
const CACHE_PATH = path.join(process.cwd(), "data", "_hook_cache.json");

const WHISPER_MODELS = [
  process.env.WHISPER_MODEL,
  // Multilingual first: most of the niches this serves are Telugu, Kannada or
  // Hindi, and base.en answers those with "(speaking in foreign language)",
  // which loses the hook. base multilingual transcribes English just as
  // usably and at least gets the real words when it is not English.
  path.join(process.cwd(), "data", "_models", "ggml-base.bin"),
  path.join(process.cwd(), "data", "_models", "ggml-base.en.bin"),
  path.join(process.env.HOME ?? "", "brain/models/ggml-base.bin"),
  path.join(process.env.HOME ?? "", "brain/models/ggml-base.en.bin"),
  "/opt/homebrew/share/whisper.cpp/ggml-base.bin",
  "/opt/homebrew/share/whisper.cpp/ggml-base.en.bin",
].filter(Boolean) as string[];

export interface MediaTools {
  ffmpeg: boolean;
  whisperModel: string | null;
  ocr: boolean;
}

let toolsCache: MediaTools | null = null;

export function mediaTools(): MediaTools {
  if (toolsCache) return toolsCache;
  toolsCache = {
    ffmpeg: existsSync("/opt/homebrew/bin/ffmpeg") || existsSync("/usr/local/bin/ffmpeg") || existsSync("/usr/bin/ffmpeg"),
    whisperModel: WHISPER_MODELS.find((m) => existsSync(m)) ?? null,
    ocr: existsSync(path.join(process.cwd(), "scripts", "ocr.swift")),
  };
  return toolsCache;
}

export function mediaReady(): boolean {
  const t = mediaTools();
  return t.ffmpeg && Boolean(t.whisperModel) && t.ocr;
}

/* ------------------------------ download ------------------------------ */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Fetch the MP4 with curl, not with fetch.
 *
 * Instagram's CDN hangs undici's connect on this machine (ETIMEDOUT, no
 * response), while curl to the same signed URL returns the file in a second.
 * The signed URL is already the authorisation, so the only thing that matters
 * is sending a browser user-agent and following the redirect.
 */
async function download(url: string, out: string): Promise<void> {
  await run("curl", [
    "-sSL", "--fail", "--max-time", "90",
    "-A", BROWSER_UA,
    "-o", out, url,
  ], { maxBuffer: 4 * 1024 * 1024 });
}

/* ------------------------------ cache ------------------------------ */

type HookCache = Record<string, HookReading>;

function readCache(): HookCache {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as HookCache;
  } catch {
    return {};
  }
}

function writeCache(cache: HookCache): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf8");
  } catch {
    /* cache misses only cost a re-read */
  }
}

/* --------------------------- transcription --------------------------- */

interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

interface WhisperJson {
  transcription?: { offsets?: { from?: number; to?: number }; text?: string }[];
  result?: { language?: string };
}

interface Hearing {
  segments: Segment[];
  /**
   * The language whisper heard, and how sure it was.
   *
   * This is the whole point of asking for `-l auto`. Without it whisper assumes
   * English, so a Telugu lyric comes back as invented English words — Latin
   * letters, no script to detect, and the video witness says nothing about a
   * reel whose caption was already in English. The same ten seconds decoded
   * with detection on comes back as `te`, which is evidence.
   */
  lang: string | null;
  prob: number;
}

const NO_HEARING: Hearing = { segments: [], lang: null, prob: 0 };

/** First N seconds of speech, with the ms each phrase starts at. */
async function transcribe(file: string, seconds = 10): Promise<Hearing> {
  const tools = mediaTools();
  if (!tools.ffmpeg || !tools.whisperModel) return NO_HEARING;
  const wav = file.replace(/\.mp4$/, ".wav");
  await run("/opt/homebrew/bin/ffmpeg", [
    "-v", "error", "-y", "-i", file, "-t", String(seconds),
    "-ac", "1", "-ar", "16000", wav,
  ]);
  const out = file.replace(/\.mp4$/, "");
  /**
   * `-l auto` is only valid on a multilingual model: base.en was trained on
   * English alone and fails outright when asked to detect. `-ojf` writes the
   * detected language into the JSON, which is more reliable to read back than
   * the log line, and the log line still carries the probability.
   */
  const multilingual = !/\.en\.bin$/.test(tools.whisperModel);
  const args = [
    "-m", tools.whisperModel, "-f", wav, "-ojf", "-of", out,
    "-ml", "40", "-sow", "-nt",
    ...(multilingual ? ["-l", "auto"] : []),
  ];
  let stderr = "";
  await run("whisper-cli", args)
    .then((r) => {
      stderr = String(r.stderr ?? "");
    })
    .catch((e: { stderr?: string }) => {
      stderr = String(e?.stderr ?? "");
    });
  let json: WhisperJson = {};
  try {
    json = JSON.parse(readFileSync(`${out}.json`, "utf8")) as WhisperJson;
  } catch {
    return NO_HEARING;
  }
/** whisper's placeholder for speech in a language it was not given, plus music tags. */
const NOT_WORDS =
  /^\(?\s*(speaking in foreign language|speaking foreign language|foreign language|music|inaudible|silence|blank_audio|applause|laughter)\s*\)?$/i;

  const segments = (json.transcription ?? [])
    .map((s) => ({
      startMs: Number(s.offsets?.from ?? 0),
      endMs: Number(s.offsets?.to ?? 0),
      text: (s.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 1 && !NOT_WORDS.test(s.text));

  const detected = normaliseLang(json.result?.language);
  const p = stderr.match(/auto-detected language:\s*([a-z]{2,3})\s*\(p = ([\d.]+)\)/i);
  const prob = p ? Number(p[2]) : detected ? 1 : 0;
  return { segments, lang: detected ?? normaliseLang(p?.[1]), prob: Number.isFinite(prob) ? prob : 0 };
}

/* ------------------------------- OCR ------------------------------- */

interface OcrLine {
  text: string;
  confidence: number;
  box: [number, number, number, number];
}

/**
 * Text burned onto the first frames, biggest-on-screen first.
 *
 * Instagram's own furniture sits in fixed places — the handle and audio name at
 * the bottom, the action rail on the right — so boxes outside the middle band
 * are dropped. A hook that reads "natgeo · Original audio" is not a hook.
 */
async function readOnScreen(frames: string[]): Promise<{ lines: string[]; atStart: boolean }> {
  if (!frames.length) return { lines: [], atStart: false };
  const script = path.join(process.cwd(), "scripts", "ocr.swift");
  const { stdout } = await run("swift", [script, ...frames], {
    maxBuffer: 8 * 1024 * 1024,
  }).catch(() => ({ stdout: "{}", stderr: "" }));
  let parsed: Record<string, OcrLine[]> = {};
  try {
    parsed = JSON.parse(stdout || "{}") as Record<string, OcrLine[]>;
  } catch {
    return { lines: [], atStart: false };
  }

  const perFrame = frames.map((f) =>
    (parsed[f] ?? [])
      .filter((l) => l.confidence > 0.45 && cleanText(l.text).length > 2)
      .filter((l) => {
        const [, y, , h] = l.box;
        return y > 0.12 && y + h < 0.93;
      })
      // Vision's origin is bottom-left, so a larger y is nearer the top of the
      // frame and is read first.
      .sort((a, b) => b.box[1] - a.box[1]),
  );

  const first = perFrame[0] ?? [];
  const counts = new Map<string, number>();
  for (const frame of perFrame) {
    for (const l of frame) {
      const t = cleanText(l.text);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  // Text that persists across frames is the hook; a one-frame flicker is a cut.
  const keep = [...counts.entries()]
    .filter(([, n]) => n >= Math.max(1, Math.floor(perFrame.length * 0.25)))
    .map(([t]) => t);

  const ordered = first.map((l) => cleanText(l.text)).filter((t) => keep.includes(t));
  return { lines: dedupe(ordered), atStart: ordered.length > 0 };
}

function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[|·•\-\s]+|[|·•\-\s]+$/g, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();
}

function dedupe(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const k = l.toLowerCase();
    if (out.some((o) => o.toLowerCase().includes(k) || k.includes(o.toLowerCase()))) continue;
    out.push(l);
  }
  return out;
}

/* ------------------------------ reading ------------------------------ */

const UI = /^(original audio|audio original|·|follow|sponsored|paid partnership|see more|more|like|comment|share|save|reply)\b/i;

function modeOf(spoken: string, onScreen: string[]): HookMode {
  const said = spoken.split(/\s+/).filter(Boolean).length >= 3;
  const shown = onScreen.join(" ").split(/\s+/).filter(Boolean).length >= 2;
  if (said && shown) return "both";
  if (said) return "spoken";
  if (shown) return "on_screen";
  return "visual";
}

/** Fall back to the caption when the video cannot be watched. */
export function captionHook(reel: RawReel, note: string): HookReading {
  const line = (reel.caption ?? "")
    .replace(/#\S+/g, " ")
    .replace(/\s+/g, " ")
    .split(/[.!?\n]/)[0]
    .trim()
    .slice(0, 140);
  return {
    mode: "unknown",
    hookText: line,
    basis: "caption",
    note,
    analysedAt: new Date().toISOString(),
  };
}

/**
 * Buy the transcript when the machine cannot read the video itself.
 *
 * No frames are seen, so on-screen text is unknown: the verdict can only say
 * "spoken" or "visual", never "both". That limitation is stated in the note
 * rather than hidden, because a wrong "your hook is the words on screen" is
 * worse than admitting the frames were not read.
 */
async function paidTranscriptHook(reel: RawReel): Promise<HookReading | null> {
  paidTranscripts += 1;
  let text = "";
  try {
    text = (await fetchTranscript(reel.url)) ?? "";
  } catch {
    return null;
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.split(" ").filter(Boolean).length < 3) return null;
  return {
    mode: "spoken",
    hookText: clean.split(/[.!?]/)[0].slice(0, 140),
    spoken: clean.slice(0, 400),
    basis: "measured",
    analysedAt: new Date().toISOString(),
    note: "transcript bought from SocialCrawl for 10 credits — no local transcriber, so the frames were not read",
  };
}

export interface HookReadInput {
  reel: RawReel;
  /** signed MP4 URL from the post payload; expanded at read time */
  mediaUrl?: string;
}

/**
 * One reel in, one reading out. Cached by reel URL, so a plan rebuild or a
 * second visitor in the same niche costs nothing and makes no downloads.
 */
export async function readHook(
  input: HookReadInput,
  cacheIn?: HookCache,
): Promise<HookReading> {
  const { reel, mediaUrl } = input;
  const cache = cacheIn ?? readCache();
  const hit = cache[reel.url];
  /**
   * A reading taken before the reader asked whisper for a language has no
   * `heardLang`, and trusting it would keep the old blind spot alive forever.
   * Those are re-read once; a caption-only reading points at nothing to redo.
   */
  const stale = hit?.basis === "measured" && hit.heardLang === undefined;
  if (hit && !stale) return hit;

  const tools = mediaTools();
  if (!tools.whisperModel && canPayForTranscript()) {
    const paid = await paidTranscriptHook(reel);
    if (paid) {
      cache[reel.url] = paid;
      writeCache(cache);
      return paid;
    }
  }
  if (!tools.ffmpeg) return captionHook(reel, "ffmpeg is not installed, so the video was not watched");
  if (!tools.ocr && !tools.whisperModel) {
    return captionHook(reel, "no local transcriber or screen reader, so the video was not watched");
  }
  if (!mediaUrl) return captionHook(reel, "no video URL was returned for this post");

  mkdirSync(MEDIA_DIR, { recursive: true });
  const stem = path.join(MEDIA_DIR, reel.id.replace(/[^a-z0-9_]/gi, "_").slice(0, 60));
  const mp4 = `${stem}.mp4`;
  const frames: string[] = [];

  try {
    // `file://` is for testing and for a reel the creator hands over directly:
    // same code path, no download, so the reader is verifiable offline.
    if (mediaUrl.startsWith("file://")) {
      writeFileSync(mp4, readFileSync(decodeURIComponent(mediaUrl.slice(7))));
    } else {
      await download(mediaUrl, mp4);
      if (!existsSync(mp4) || statSync(mp4).size < 10_000) throw new Error("video download was empty");
    }

    const heard = await transcribe(mp4).catch(() => NO_HEARING);
    const segments = heard.segments;
    const spokenAll = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    const firstVoice = segments.find((s) => s.startMs <= 3_000)?.text ?? "";
    const speechStartMs = segments.find((s) => s.text.split(" ").length >= 2)?.startMs;

    let onScreen: string[] = [];
    let textAtStart = false;
    if (tools.ocr) {
      await run("/opt/homebrew/bin/ffmpeg", [
        "-v", "error", "-y", "-i", mp4, "-t", "3", "-vf", "fps=3,scale=720:-2",
        path.join(MEDIA_DIR, `${path.basename(stem)}_f%02d.jpg`),
      ]).catch(() => ({}));
      for (let i = 1; i <= 10; i += 1) {
        const f = path.join(MEDIA_DIR, `${path.basename(stem)}_f${String(i).padStart(2, "0")}.jpg`);
        if (!existsSync(f)) break;
        frames.push(f);
      }
      const screen = await readOnScreen(frames);
      onScreen = screen.lines.filter((l) => !UI.test(l));
      textAtStart = screen.atStart;
    }

    const mode = modeOf(firstVoice || (speechStartMs === 0 ? spokenAll : ""), onScreen);
    const hookText =
      onScreen.length > 0
        ? onScreen.slice(0, 3).join(" ").slice(0, 140)
        : (firstVoice || spokenAll.split(/[.!?]/)[0] || "").slice(0, 140);

    const reading: HookReading = {
      mode,
      hookText,
      spoken: spokenAll.slice(0, 400) || undefined,
      onScreen: onScreen.length ? onScreen.slice(0, 5) : undefined,
      speechStartMs,
      textAtStart,
      ...(heard.lang ? { heardLang: heard.lang, heardLangProb: heard.prob } : {}),
      basis: "measured",
      analysedAt: new Date().toISOString(),
      ...(mode === "visual"
        ? { note: "no words in the first seconds — the shot is doing the work" }
        : {}),
    };

    if (mode !== "visual" || hookText) {
      cache[reel.url] = reading;
      writeCache(cache);
    }
    return reading;
  } catch (err) {
    return captionHook(reel, `could not watch this one (${(err as Error).message})`);
  } finally {
    for (const f of [mp4, `${stem}.wav`, `${stem}.json`, ...frames]) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* leftover files are cleaned on the next run */
      }
    }
  }
}

/**
 * Read a batch, best first, newest first. Sequential on purpose: whisper on a
 * laptop will not enjoy four parallel decodes, and six reels is seconds.
 */
export async function readHooks(
  inputs: HookReadInput[],
  opts: { max?: number } = {},
): Promise<Map<string, HookReading>> {
  const max = opts.max ?? 6;
  const cache = readCache();
  const out = new Map<string, HookReading>();
  for (const input of inputs.slice(0, max)) {
    const reading = await readHook(input, cache);
    out.set(input.reel.id, reading);
  }
  return out;
}

export function hookSummary(readings: HookReading[]): string {
  const measured = readings.filter((r) => r.basis === "measured");
  if (!measured.length) return "";
  const counts = new Map<HookMode, number>();
  for (const r of measured) counts.set(r.mode, (counts.get(r.mode) ?? 0) + 1);
  const [mode, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const label =
    mode === "spoken"
      ? "the spoken line"
      : mode === "on_screen"
        ? "the words on screen"
        : mode === "both"
          ? "words on screen plus a voiceover"
          : "the shot itself";
  return `${label} is where the grab happens on ${n} of ${measured.length} reels watched`;
}
