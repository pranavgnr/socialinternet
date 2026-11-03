/**
 * The video reader: a caption reader that always answers, and a Gemini reader
 * that watches the reel when a key is configured.
 *
 * The reader is an optional extra, never a dependency: every failure path falls
 * back to captions for that one reel, and the tests pin the guard rails that
 * make downloading a stranger's MP4 acceptable — HTTPS only, Instagram CDN
 * hosts only, 15 MB and 20 s ceilings, redirects re-checked. The key never
 * appears in a URL or a log line, and the cache makes a second read free.
 *
 * No network: `withFetch` swaps `globalThis.fetch` for a stub.
 *
 *   sh scripts/run-test.sh test-video-reader
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CaptionReader,
  GeminiReader,
  configuredReader,
  geminiConfigured,
  hookLine,
  readReels,
  videoReadingsPath,
  videoReadMax,
  type VideoReader,
  type VideoReading,
} from "../lib/videoReader";

const TMP = mkdtempSync(path.join(os.tmpdir(), "reel-engine-video-reader-"));
process.env.CREATORS_DATA_DIR = TMP;

const KEY = "test-gemini-key-do-not-log";
const MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const ENV_KEYS = ["CREATORS_DATA_DIR", "GEMINI_API_KEY", "GEMINI_MODEL", "VIDEO_READ_MAX"] as const;
const ENV_SNAPSHOT = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
) as Record<string, string | undefined>;

async function withEnv<T>(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      const v = ENV_SNAPSHOT[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

interface SeenCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function respond(body: string | Uint8Array, init: ResponseInit = {}): Response {
  return new Response(body as BodyInit, init);
}

async function withFetch<T>(
  handler: (call: SeenCall) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<{ result: T; seen: SeenCall[] }> {
  const real = globalThis.fetch;
  const seen: SeenCall[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const headers: Record<string, string> = {};
    const raw = (init?.headers ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = String(v);
    const call: SeenCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    };
    seen.push(call);
    return handler(call);
  }) as typeof fetch;
  try {
    return { result: await fn(), seen };
  } finally {
    globalThis.fetch = real;
  }
}

const VIDEO_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

let reelCounter = 0;

/** A unique reel per call, so one test's cache can never hide another's work. */
function reel(_i?: number) {
  reelCounter += 1;
  const id = `shortcode${reelCounter}`;
  return {
    url: `https://www.instagram.com/reel/${id}/`,
    shortcode: id,
    mediaUrl: `https://scontent.cdninstagram.com/o1/v/t2/${id}.mp4`,
    caption: `caption ${_i ?? reelCounter}`,
  };
}

function geminiText(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const VALID = {
  hookSeconds: 0.8,
  hookType: "spoken",
  onScreenText: "POV: <b>you</b> wake up",
  pacing: "fast cuts, one idea per second",
  loop: true,
  why: ["Opens with a question", "The text is up before the first word"],
};

function validText(): string {
  return JSON.stringify(VALID);
}

function route(call: SeenCall): Response {
  if (call.url.includes("generativelanguage.googleapis.com")) {
    return geminiText(validText());
  }
  if (call.url.includes(".mp4")) return respond(VIDEO_BYTES);
  return new Response("unexpected", { status: 500 });
}

/* ------------------------------------------------------------- basics */

test("the caption reader always answers and keeps the caption bullets", async () => {
  const reading = await CaptionReader.read(reel(1));
  assert.deepEqual(reading, { basis: "captions", why: [] });
});

test("without a key the configured reader is captions-only", async () => {
  await withEnv({ GEMINI_API_KEY: undefined }, async () => {
    assert.equal(geminiConfigured(), false);
    assert.equal(configuredReader(), CaptionReader);
    const reading = await configuredReader().read(reel(1));
    assert.equal(reading.basis, "captions");
  });
});

test("the per-profile video cap comes from VIDEO_READ_MAX", async () => {
  await withEnv({ VIDEO_READ_MAX: undefined }, async () => {
    assert.equal(videoReadMax(), 6);
  });
  await withEnv({ VIDEO_READ_MAX: "2" }, async () => {
    assert.equal(videoReadMax(), 2);
  });
  await withEnv({ VIDEO_READ_MAX: "0" }, async () => {
    assert.equal(videoReadMax(), 6);
  });
});

/* ------------------------------------------------------------- gemini */

test("a valid Gemini answer becomes a video reading", async () => {
  await withEnv({ GEMINI_API_KEY: KEY, GEMINI_MODEL: undefined }, async () => {
    const target = reel(1);
    const { result, seen } = await withFetch(route, () =>
      GeminiReader({ apiKey: KEY }).read(target),
    );

    assert.equal(seen.length, 2, "one download and one model call");
    const download = seen[0];
    const ask = seen[1];
    assert.equal(download?.url, target.mediaUrl);
    assert.equal(ask?.url, GEMINI_URL, "the model is the default one");
    assert.equal(ask?.method, "POST");
    assert.equal(ask?.headers["x-goog-api-key"], KEY);
    assert.ok(!ask?.url.includes(KEY), "the key is never in a URL");

    const body = JSON.parse(ask?.body ?? "{}") as {
      contents: { parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[];
    };
    const parts = body.contents[0]?.parts ?? [];
    const inline = parts.find((p) => p.inlineData);
    assert.equal(inline?.inlineData?.mimeType, "video/mp4");
    assert.deepEqual(
      Buffer.from(inline?.inlineData?.data ?? "", "base64"),
      Buffer.from(VIDEO_BYTES),
    );
    const prompt = parts.find((p) => p.text)?.text ?? "";
    assert.match(prompt, /JSON/i);
    assert.match(prompt, /hookSeconds/);

    assert.equal(result.basis, "video");
    assert.equal(result.hookSeconds, 0.8);
    assert.equal(result.hookType, "spoken");
    assert.equal(result.onScreenText, "POV: you wake up", "tags are stripped");
    assert.equal(result.pacing, "fast cuts, one idea per second");
    assert.equal(result.loop, true);
    assert.deepEqual(result.why, [
      "Opens with a question",
      "The text is up before the first word",
    ]);
  });
});

test("GEMINI_MODEL picks the endpoint", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const { seen } = await withFetch(route, () =>
      GeminiReader({ apiKey: KEY, model: "gemini-2.5-pro" }).read(reel(1)),
    );
    assert.ok(
      seen.some((c) =>
        c.url.endsWith("/models/gemini-2.5-pro:generateContent"),
      ),
    );
  });
});

test("malformed JSON falls back to captions for that reel", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const { result } = await withFetch(
      (call) =>
        call.url.includes("generativelanguage")
          ? geminiText("I could not read this video.")
          : respond(VIDEO_BYTES),
      () => GeminiReader({ apiKey: KEY }).read(reel(1)),
    );
    assert.deepEqual(result, { basis: "captions", why: [] });
  });
});

test("JSON wrapped in prose is extracted", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const { result } = await withFetch(
      (call) =>
        call.url.includes("generativelanguage")
          ? geminiText(`Here is the reading: ${validText()} — done`)
          : respond(VIDEO_BYTES),
      () => GeminiReader({ apiKey: KEY }).read(reel(1)),
    );
    assert.equal(result.basis, "video");
    assert.equal(result.hookType, "spoken");
  });
});

test("an out-of-range or wrongly typed answer falls back", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const cases = [
      { ...VALID, hookType: "dance" },
      { ...VALID, hookSeconds: "0.8" },
      { ...VALID, hookSeconds: -1 },
      { ...VALID, loop: "yes" },
      { ...VALID, why: "one line" },
    ];
    for (const bad of cases) {
      const { result } = await withFetch(
        (call) =>
          call.url.includes("generativelanguage")
            ? geminiText(JSON.stringify(bad))
            : respond(VIDEO_BYTES),
        () => GeminiReader({ apiKey: KEY }).read(reel(1)),
      );
      assert.deepEqual(
        result,
        { basis: "captions", why: [] },
        `bad reading ${JSON.stringify(bad)}`,
      );
    }
  });
});

test("why is capped at four short lines", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const long = "x".repeat(400);
    const { result } = await withFetch(
      (call) =>
        call.url.includes("generativelanguage")
          ? geminiText(
              JSON.stringify({
                ...VALID,
                why: [long, "two", "three", "four", "five"],
              }),
            )
          : respond(VIDEO_BYTES),
      () => GeminiReader({ apiKey: KEY }).read(reel(1)),
    );
    assert.equal(result.basis, "video");
    assert.equal(result.why.length, 4);
    for (const line of result.why) assert.ok(line.length <= 160);
  });
});

/* ------------------------------------------------------------ downloads */

test("a video over 15 MB is never sent to the model", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const { result, seen } = await withFetch(
      (call) =>
        call.url.includes("generativelanguage")
          ? geminiText(validText())
          : respond(VIDEO_BYTES, {
              headers: { "content-length": String(16 * 1024 * 1024) },
            }),
      () => GeminiReader({ apiKey: KEY }).read(reel(1)),
    );
    assert.equal(result.basis, "captions");
    assert.equal(seen.length, 1, "the model was never asked");
  });
});

test("a streamed body over 15 MB is abandoned", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const big = new Uint8Array(15 * 1024 * 1024 + 1);
    const { result, seen } = await withFetch(
      (call) =>
        call.url.includes("generativelanguage")
          ? geminiText(validText())
          : respond(big),
      () => GeminiReader({ apiKey: KEY }).read(reel(1)),
    );
    assert.equal(result.basis, "captions");
    assert.equal(seen.length, 1);
  });
});

test("a host outside the Instagram CDN list is never fetched", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const hostile = [
      "https://evil.example/v.mp4",
      "http://scontent.cdninstagram.com/v.mp4",
      "https://scontent.cdninstagram.com.evil.example/v.mp4",
      "https://127.0.0.1/v.mp4",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
    ];
    for (const mediaUrl of hostile) {
      const { result, seen } = await withFetch(route, () =>
        GeminiReader({ apiKey: KEY }).read({ ...reel(9), mediaUrl }),
      );
      assert.equal(result.basis, "captions", mediaUrl);
      assert.equal(seen.length, 0, `no request for ${mediaUrl}`);
    }
  });
});

test("a redirect off the allowed hosts is refused", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const { result, seen } = await withFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/stolen.mp4" },
        }),
      () => GeminiReader({ apiKey: KEY }).read(reel(1)),
    );
    assert.equal(result.basis, "captions");
    assert.equal(seen.length, 1, "the redirect target was never fetched");
  });
});

test("a download failure, or no media URL, falls back", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const { result } = await withFetch(
      () => {
        throw new Error("network down");
      },
      () => GeminiReader({ apiKey: KEY }).read(reel(1)),
    );
    assert.equal(result.basis, "captions");

    const { result: noUrl, seen } = await withFetch(route, () =>
      GeminiReader({ apiKey: KEY }).read({ ...reel(1), mediaUrl: undefined }),
    );
    assert.equal(noUrl.basis, "captions");
    assert.equal(seen.length, 0);
  });
});

/* ---------------------------------------------------------------- cache */

test("a reading is cached by shortcode for seven days", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const now = Date.parse("2026-11-03T00:00:00Z");
    const target = reel(1);
    const first = await withFetch(route, () =>
      GeminiReader({ apiKey: KEY, now: () => now }).read(target),
    );
    assert.equal(first.result.basis, "video");
    assert.ok(videoReadingsPath().endsWith("video_readings.json"));
    assert.ok(
      JSON.parse(readFileSync(videoReadingsPath(), "utf8")),
      "the cache file is valid JSON",
    );

    let calls = 0;
    const second = await withFetch(
      () => {
        calls += 1;
        return respond(VIDEO_BYTES);
      },
      () =>
        GeminiReader({ apiKey: KEY, now: () => now + 6 * 864e5 }).read(target),
    );
    assert.equal(calls, 0, "a cache hit makes no network call");
    assert.equal(second.result.basis, "video");
    assert.deepEqual(second.result.why, first.result.why);

    const expired = await withFetch(route, () =>
      GeminiReader({ apiKey: KEY, now: () => now + 8 * 864e5 }).read(target),
    );
    assert.ok(expired.seen.length > 0, "an expired reading is re-read");
  });
});

test("a semantically corrupt cached reading is a miss, never a view input", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const now = Date.parse("2026-11-03T00:00:00Z");
    const target = reel(1);
    writeFileSync(
      videoReadingsPath(),
      JSON.stringify(
        {
          [target.shortcode ?? ""]: {
            savedAt: new Date(now).toISOString(),
            reading: {
              basis: "video",
              hookSeconds: "x",
              hookType: "spoken",
              loop: true,
              why: [123],
            },
          },
        },
        null,
        2,
      ),
    );

    const { result, seen } = await withFetch(route, () =>
      GeminiReader({ apiKey: KEY, now: () => now }).read(target),
    );
    assert.equal(seen.length, 2, "the corrupt entry forced a real read");
    assert.equal(result.basis, "video");
    for (const line of result.why) assert.equal(typeof line, "string");
  });
});

test("the key never appears in a URL or a log line", async () => {
  await withEnv({ GEMINI_API_KEY: KEY }, async () => {
    const logs: string[] = [];
    const real = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      const good = await withFetch(route, () =>
        GeminiReader({ apiKey: KEY }).read(reel(2)),
      );
      const bad = await withFetch(
        (call) =>
          call.url.includes("generativelanguage")
            ? new Response(`error mentioning ${KEY}`, { status: 500 })
            : respond(VIDEO_BYTES),
        () => GeminiReader({ apiKey: KEY }).read(reel(3)),
      );
      assert.equal(good.result.basis, "video");
      assert.equal(bad.result.basis, "captions");
      for (const call of [...good.seen, ...bad.seen]) {
        assert.ok(!call.url.includes(KEY), `key in URL: ${call.url}`);
      }
      for (const line of logs) assert.ok(!line.includes(KEY), `key in log: ${line}`);
    } finally {
      console.log = real.log;
      console.warn = real.warn;
      console.error = real.error;
    }
  });
});

/* ------------------------------------------------------------ scheduler */

test("at most six reels are read per profile, one at a time", async () => {
  const reels = Array.from({ length: 8 }, (_, i) => reel(i));
  let active = 0;
  let peak = 0;
  const read: VideoReader = {
    async read() {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return { basis: "video", hookSeconds: 0.5, hookType: "visual", why: ["peak"] };
    },
  };

  const readings = await readReels(reels, read, { max: 6 });
  assert.equal(readings.size, 6);
  assert.equal(peak, 1, "reads are sequential");
  assert.ok(readings.has(reels[5]?.url ?? ""));
  assert.ok(!readings.has(reels[6]?.url ?? ""));
});

test("the per-profile deadline stops a slow run", async () => {
  let clock = 0;
  const reels = Array.from({ length: 6 }, (_, i) => reel(i));
  const read: VideoReader = {
    async read() {
      clock += 50_000;
      return { basis: "video", hookSeconds: 0.5, hookType: "visual", why: ["peak"] };
    },
  };

  const readings = await readReels(reels, read, {
    max: 6,
    timeoutMs: 90_000,
    now: () => clock,
  });
  assert.equal(readings.size, 2, "two reads fit inside 90 s");
});

test("a reader that throws is treated as a caption read", async () => {
  const read: VideoReader = {
    async read() {
      throw new Error("boom");
    },
  };
  const readings = await readReels([reel(1), reel(2)], read, { max: 6 });
  assert.equal(readings.size, 0);
});

/* --------------------------------------------------------------- copy */

test("the hook line names the type and the moment", () => {
  assert.equal(
    hookLine({
      basis: "video",
      hookSeconds: 0.8,
      hookType: "spoken",
      why: [],
    }),
    "Hook: spoken, lands at 0.8 s",
  );
  assert.equal(hookLine({ basis: "captions", why: [] }), undefined);
  assert.equal(
    hookLine({ basis: "video", hookType: "visual", why: [] }),
    undefined,
    "no moment, no claim",
  );
});

test.after(() => {
  rmSync(TMP, { recursive: true, force: true });
});
