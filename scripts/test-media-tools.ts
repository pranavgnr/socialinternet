/**
 * Can this machine actually watch a video, and does the plan say so when it cannot?
 *
 * The deep pass needs three things at once: ffmpeg to cut frames and audio,
 * whisper.cpp to hear the words, and macOS Vision to read the text on screen.
 * The first two exist on Linux; Vision does not. A copied `scripts/ocr.swift`
 * on a Linux box is a file, not a screen reader, and letting it count as one is
 * how the deep pass would start "watching" videos with the on-screen half
 * silently missing.
 *
 * This test injects the platform and the file-exists answers, so the two
 * machines can be checked on either one.
 *
 *   sh scripts/run-test.sh test-media-tools
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { buildAudit } from "../lib/audit";
import { deepSkipReason, DEEP_UNAVAILABLE } from "../lib/enrich";
import {
  captionHook,
  detectMediaTools,
  mediaReadyFor,
  readHook,
  type MediaTools,
} from "../lib/media";
import type { RawReel } from "../lib/types";

/** A fake filesystem: the paths a machine with the tools installed would have. */
function fakeFs(files: {
  ffmpeg?: "homebrew" | "usr-local" | "usr-bin" | false;
  whisper?: boolean;
  ocrSwift?: boolean;
}) {
  const ffmpegPath =
    files.ffmpeg === "homebrew"
      ? "/opt/homebrew/bin/ffmpeg"
      : files.ffmpeg === "usr-local"
        ? "/usr/local/bin/ffmpeg"
        : files.ffmpeg === "usr-bin"
          ? "/usr/bin/ffmpeg"
          : null;
  return (candidate: string): boolean => {
    if (ffmpegPath && candidate === ffmpegPath) return true;
    if (files.ffmpeg && candidate.endsWith("/ffmpeg")) return candidate === ffmpegPath;
    if (files.whisper && candidate.endsWith("ggml-base.bin")) return true;
    if (files.ocrSwift && candidate.endsWith(path.join("scripts", "ocr.swift"))) return true;
    return false;
  };
}

function toolsFor(
  platform: NodeJS.Platform,
  files: Parameters<typeof fakeFs>[0],
): MediaTools {
  return detectMediaTools({ platform, exists: fakeFs(files) });
}

const reel = {
  id: "test-reel",
  platform: "instagram",
  account: "someone",
  url: "https://www.instagram.com/p/test-reel/",
  caption: "How I film a vlog in 60 seconds #vlog",
  postedAt: new Date().toISOString(),
  views: 10_000,
  likes: 100,
  comments: 4,
  hashtags: ["vlog"],
} as RawReel;

test("darwin with ffmpeg, whisper and ocr.swift is ready", () => {
  const tools = toolsFor("darwin", { ffmpeg: "homebrew", whisper: true, ocrSwift: true });
  assert.equal(tools.ffmpeg, true);
  assert.equal(tools.ffmpegPath, "/opt/homebrew/bin/ffmpeg");
  assert.equal(tools.ocr, true);
  assert.ok(tools.whisperModel);
  assert.equal(mediaReadyFor(tools), true);
});

test("linux with ffmpeg, whisper and a copied ocr.swift is NOT ready", () => {
  const tools = toolsFor("linux", { ffmpeg: "usr-bin", whisper: true, ocrSwift: true });
  assert.equal(tools.ffmpeg, true);
  assert.equal(tools.ffmpegPath, "/usr/bin/ffmpeg");
  assert.ok(tools.whisperModel);
  // Vision is macOS-only: the file being present does not make OCR available.
  assert.equal(tools.ocr, false);
  assert.equal(mediaReadyFor(tools), false);
});

test("missing ffmpeg is not ready", () => {
  const tools = toolsFor("darwin", { ffmpeg: false, whisper: true, ocrSwift: true });
  assert.equal(tools.ffmpeg, false);
  assert.equal(tools.ffmpegPath, null);
  assert.equal(mediaReadyFor(tools), false);
});

test("when not ready the deep pass is skipped and the plan falls back to captions", async () => {
  const linux = toolsFor("linux", { ffmpeg: "usr-bin", whisper: true, ocrSwift: true });
  assert.equal(mediaReadyFor(linux), false);
  assert.equal(deepSkipReason(linux), DEEP_UNAVAILABLE);

  // The worker itself, given no ffmpeg, returns a caption reading and says why.
  const noFfmpeg = toolsFor("darwin", { ffmpeg: false, whisper: true, ocrSwift: true });
  const reading = await readHook(
    { reel, mediaUrl: "file:///nonexistent.mp4", tools: noFfmpeg },
    {},
  );
  assert.equal(reading.basis, "caption");
  assert.equal(reading.mode, "unknown");
  assert.match(reading.note ?? "", /ffmpeg is not installed/);

  // And the plan's audit says, in words, that it read captions rather than video.
  const posts: RawReel[] = [
    { ...reel, id: "a", url: "https://instagram.com/p/a", caption: "How I film a vlog in 60 seconds", views: 40_000 },
    { ...reel, id: "b", url: "https://instagram.com/p/b", caption: "Why this shot works", views: 30_000 },
    { ...reel, id: "c", url: "https://instagram.com/p/c", caption: "My morning routine", views: 2_000 },
    { ...reel, id: "d", url: "https://instagram.com/p/d", caption: "A quiet day at home", views: 1_000 },
  ];
  const audit = buildAudit({ reels: posts });
  assert.ok(audit);
  assert.equal(audit.watched, 0);
  const opening = audit.gaps.find((g) => g.lever === "opening");
  assert.ok(opening, "the opening lever should be reported");
  assert.match(opening.note, /Read from the caption/);
});

test("the local Mac probe still resolves the homebrew ffmpeg", { skip: process.platform !== "darwin" }, () => {
  const ocr = path.join(process.cwd(), "scripts", "ocr.swift");
  if (!existsSync("/opt/homebrew/bin/ffmpeg")) return;
  const real = detectMediaTools();
  assert.equal(real.ffmpegPath, "/opt/homebrew/bin/ffmpeg");
  assert.equal(real.ocr, existsSync(ocr));
  assert.equal(real.ocr, true);
});
