#!/usr/bin/env node
/**
 * Record what HikerAPI actually returns, so the adapter can be tested without
 * spending the founder's calls.
 *
 * Every response in `lib/providers/__fixtures__/hikerapi/` came from a live
 * call made on 2026-11-03. The adapter used to be written from the published
 * docs and several paths were wrong; these fixtures are the ground truth the
 * tests in `scripts/test-hikerapi.ts` assert against.
 *
 * Usage (the key is read from `.env.local`, never printed):
 *
 *   node --env-file=.env.local scripts/capture-hikerapi-fixtures.mjs
 *   node --env-file=.env.local scripts/capture-hikerapi-fixtures.mjs --comments
 *
 * Costs four calls (five with `--comments`). The output is sanitised twice:
 * every list is truncated to 12 items (a fixture is a sample, not a dump) and
 * every URL loses its query string, because Instagram's CDN URLs carry signed
 * tokens that must not be committed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE = "https://api.hikerapi.com";
const OUT = path.join(process.cwd(), "lib/providers/__fixtures__/hikerapi");
const MAX_ITEMS = 12;

const CALLS = [
  {
    name: "user_by_username",
    path: "/v2/user/by/username",
    params: { username: "_shravyapawar_" },
  },
  {
    name: "user_clips",
    path: "/v2/user/clips",
    params: { user_id: "32334432364" },
  },
  {
    name: "search_reels",
    path: "/v2/search/reels",
    params: { query: "kannada songs" },
  },
  {
    name: "followers_chunk",
    path: "/v1/user/followers/chunk",
    params: { user_id: "32334432364" },
  },
];

/**
 * Comments are optional (`--comments`): step 1 captures the four reel reads,
 * and the comments shape is only needed for `hikerapi.post`. The media id is
 * the one on the first reel in `user_clips.json`; `id` — not `media_id` — is
 * the parameter `/v2/media/comments` requires (verified live: `media_id` is a
 * 422).
 */
if (process.argv.includes("--comments")) {
  CALLS.push({
    name: "comments",
    path: "/v2/media/comments",
    params: { id: "3747491665579061432_32334432364" },
  });
}

/**
 * Drop signed query strings. A CDN URL is
 * `https://.../x.jpg?_nc_ht=...&oe=...&oh=...&sig=...`; only the path is
 * stable, public and safe to store. Also strips fragments, which carry nothing
 * the adapter reads.
 */
function sanitizeUrl(value) {
  const query = value.indexOf("?");
  const hash = value.indexOf("#");
  const cut = [query, hash].filter((i) => i >= 0);
  return cut.length ? value.slice(0, Math.min(...cut)) : value;
}

/**
 * URLs are not only bare fields: `clips_metadata.original_sound_info
 * .dash_manifest` is an XML string full of `<BaseURL>https://…mp4?_nc_ohc=…`
 * signed CDN links, and captions can carry links too. Strip the query string
 * inside any string, not just strings that begin with the scheme.
 */
function sanitizeEmbedded(text) {
  return text.replace(/https?:\/\/[^\s"'<>\\]+/gi, sanitizeUrl);
}

/** Walk the body: truncate every list and strip URLs. Never returns secrets. */
function sanitise(value) {
  if (typeof value === "string") {
    return sanitizeEmbedded(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map(sanitise);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitise(v)]),
    );
  }
  return value;
}

async function main() {
  const apiKey = process.env.HIKERAPI_KEY;
  if (!apiKey) {
    console.error("HIKERAPI_KEY missing — run with `node --env-file=.env.local`.");
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });

  for (const call of CALLS) {
    const qs = new URLSearchParams(call.params).toString();
    const res = await fetch(`${BASE}${call.path}?${qs}`, {
      headers: { "x-access-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(
        `${call.name}: HTTP ${res.status} ${String(body.detail ?? body.message ?? "")}`,
      );
      process.exitCode = 1;
      continue;
    }
    /**
     * Pagination cursors are opaque server state, not data the adapter reads;
     * dropping them keeps a session-scoped token out of the repository.
     */
    delete body.next_page_id;
    const safe = sanitise(body);
    const file = path.join(OUT, `${call.name}.json`);
    await writeFile(file, `${JSON.stringify(safe, null, 2)}\n`);
    console.log(`${call.name}: HTTP ${res.status} -> ${path.relative(process.cwd(), file)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

export { sanitise, sanitizeUrl };
