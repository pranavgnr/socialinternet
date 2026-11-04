#!/usr/bin/env node
/**
 * Strip tracking state and unused bulk out of the recorded HikerAPI fixtures.
 *
 * A live HikerAPI payload is not safe to commit as-is: Instagram embeds
 * per-session tokens (`organic_tracking_token`, `mezql_token`, …), pagination
 * cursors and signed CDN query strings, and a single `video_dash_manifest` is
 * tens of kilobytes of XML the adapter never reads. This script is offline —
 * it makes no network calls — and is the single place both the capture script
 * and a manual re-run go through.
 *
 * What it removes:
 *   - keys matching /(^|_)token$/i or /_token_/i, plus client_cache_key;
 *   - cursor *values* (next_min_id, next_page_id, next_max_id, reels_max_id,
 *     cached_comments_cursor, any key ending in `_cursor`) are replaced with
 *     `"[redacted-cursor]"` so the pagination shape stays visible while the
 *     live signed token does not;
 *   - string values that are long base64-ish blobs (≥120 chars of
 *     [A-Za-z0-9+/=_-]) and not URLs;
 *   - the bulk fields the adapter never reads (DASH manifests, reaction data,
 *     attribution blobs, etc.), via a per-fixture whitelist that keeps every
 *     field `toUnified` or `scripts/test-hikerapi.ts` reads.
 *
 * Usage:
 *   node scripts/sanitize-hikerapi-fixtures.mjs
 *   node scripts/sanitize-hikerapi-fixtures.mjs --check
 *
 * `--check` writes nothing and exits non-zero if any file would change.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "lib/providers/__fixtures__/hikerapi",
);

/** Exact keys that carry session state rather than data. */
const DROP_KEYS = new Set([
  "client_cache_key",
  "next_min_id",
  "next_page_id",
  "next_max_id",
  "reels_max_id",
  "cached_comments_cursor",
]);

/**
 * Cursor keys are pagination *shape*, not session state.
 *
 * The value must never be committed (it is a live, signed continuation token),
 * but dropping the key itself hid the shape of `/v1/user/followers/chunk`'s
 * second element — which is exactly what a future reader needs to page it. So
 * the key survives with a fixed placeholder value: the shape is visible, the
 * token is not.
 */
const CURSOR_KEY =
  /(_cursor$|^next_(?:min|max)_id$|^next_page_id$|^reels_max_id$|^cached_comments_cursor$)/i;
const REDACTED_CURSOR = "[redacted-cursor]";

/** Fields that are pure payload bulk; none is read by the adapter or tests. */
const DROP_BULK_KEYS = new Set([
  "dash_manifest",
  "video_dash_manifest",
  "progressive_download_url",
  "video_subtitles_uri",
  "video_dash_manifest_url",
  "xray_visual_2025_100d_embed",
  "clips_demotion_control",
  "media_ui_attributions_data",
  "media_ui_attributions_data_v2",
  "recon_features",
  "logging_info_token",
  "mezql_token",
  "organic_tracking_token",
  "meta_ai_suggested_prompts",
  "sharing_friction_info",
  "view_state_item_type",
]);

/** A long opaque value: base64 with URL-safe alphabet, at least 120 chars. */
const BLOB = /^[A-Za-z0-9+/=_-]{120,}$/;

function shouldDropKey(key) {
  return (
    /(^|_)token$/i.test(key) ||
    /_token_/i.test(key) ||
    /_cursor$/i.test(key) ||
    DROP_KEYS.has(key) ||
    DROP_BULK_KEYS.has(key)
  );
}

function isBlob(value) {
  return (
    typeof value === "string" &&
    !/^https?:\/\//i.test(value) &&
    BLOB.test(value)
  );
}

/** Generic pass: remove tracking keys, redact cursor values and opaque blobs. */
export function stripTracking(value) {
  if (Array.isArray(value)) {
    return value.map(stripTracking);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (CURSOR_KEY.test(k)) {
        /**
         * A null cursor is information ("there is no next page"), so keep it.
         * Only a real token is replaced.
         */
        out[k] = v === null || v === undefined || v === "" ? v : REDACTED_CURSOR;
        continue;
      }
      if (shouldDropKey(k)) continue;
      if (isBlob(v)) continue;
      out[k] = stripTracking(v);
    }
    return out;
  }
  return value;
}

/** Keep only the fields a media row needs (see `toUnified`). */
const MEDIA_KEYS = new Set([
  "id",
  "pk",
  "code",
  "shortcode",
  "product_type",
  "play_count",
  "ig_play_count",
  "like_count",
  "comment_count",
  "reshare_count",
  "share_count",
  "save_count",
  "video_duration",
  "duration",
  "taken_at",
  "taken_at_timestamp",
  "device_timestamp",
  "created_at",
  "caption",
  "caption_text",
  "title",
  "user",
  "owner",
  "author",
  "video_versions",
  "image_versions2",
  "video_url",
  "thumbnail_url",
  "display_uri",
  "clips_metadata",
  "music_canonical_id",
  "audio_id",
  "music_metadata",
  "music",
  "audio",
  "audio_title",
  "hashtags",
]);

function pruneUser(user) {
  if (!user || typeof user !== "object") return user;
  const pick = ["username", "pk", "id", "follower_count", "is_verified"];
  return Object.fromEntries(pick.filter((k) => k in user).map((k) => [k, user[k]]));
}

function pruneCaption(caption) {
  if (!caption || typeof caption !== "object") return caption;
  return "text" in caption ? { text: caption.text } : {};
}

function pruneVideoVersions(versions) {
  if (!Array.isArray(versions)) return versions;
  return versions.map((v) => {
    if (!v || typeof v !== "object") return v;
    const pick = ["url", "width", "height", "type"];
    return Object.fromEntries(pick.filter((k) => k in v).map((k) => [k, v[k]]));
  });
}

function pruneImageVersions(images) {
  if (!images || typeof images !== "object") return images;
  const candidates = Array.isArray(images.candidates)
    ? images.candidates.map((c) => {
        if (!c || typeof c !== "object") return c;
        const pick = ["url", "width", "height"];
        return Object.fromEntries(pick.filter((k) => k in c).map((k) => [k, c[k]]));
      })
    : images.candidates;
  return { candidates };
}

function pruneSoundInfo(sound) {
  if (!sound || typeof sound !== "object") return sound;
  const pick = ["audio_asset_id", "original_audio_title", "ig_artist"];
  const out = Object.fromEntries(pick.filter((k) => k in sound).map((k) => [k, sound[k]]));
  if (out.ig_artist) out.ig_artist = pruneUser(out.ig_artist);
  return out;
}

function pruneClipsMeta(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const out = {};
  if ("music_canonical_id" in meta) out.music_canonical_id = meta.music_canonical_id;
  if (meta.music_info && typeof meta.music_info === "object") {
    const info = {};
    if ("title" in meta.music_info) info.title = meta.music_info.title;
    if ("music_asset_info" in meta.music_info) info.music_asset_info = meta.music_info.music_asset_info;
    if (Object.keys(info).length) out.music_info = info;
  }
  if ("original_sound_info" in meta) out.original_sound_info = pruneSoundInfo(meta.original_sound_info);
  return out;
}

/** Keep only what `toUnified` reads from a media object. */
export function pruneMedia(media) {
  if (!media || typeof media !== "object") return media;
  const out = {};
  for (const [k, v] of Object.entries(media)) {
    if (!MEDIA_KEYS.has(k) || shouldDropKey(k)) continue;
    switch (k) {
      case "user":
      case "owner":
      case "author":
        out[k] = pruneUser(v);
        break;
      case "caption":
        out[k] = pruneCaption(v);
        break;
      case "video_versions":
        out[k] = pruneVideoVersions(v);
        break;
      case "image_versions2":
        out[k] = pruneImageVersions(v);
        break;
      case "clips_metadata":
        out[k] = pruneClipsMeta(v);
        break;
      default:
        out[k] = v;
    }
  }
  return out;
}

function pruneMediaList(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const media = item && typeof item === "object" ? item.media : undefined;
    return media ? { media: pruneMedia(media) } : item;
  });
}

/** Per-fixture whitelists: only what the adapter or its tests read. */
export function pruneFixture(name, value) {
  switch (name) {
    case "user_by_username": {
      const user = value && typeof value === "object" ? value.user : undefined;
      const pick = [
        "username",
        "pk",
        "id",
        "user_id",
        "follower_count",
        "media_count",
        "biography",
        "category",
        "business_category",
        "is_verified",
        "is_private",
      ];
      const kept = user
        ? Object.fromEntries(pick.filter((k) => k in user).map((k) => [k, user[k]]))
        : user;
      return { status: value?.status, user: kept };
    }
    case "user_clips": {
      const response = value?.response ?? {};
      return {
        response: {
          status: response.status,
          items: pruneMediaList(response.items),
        },
      };
    }
    case "search_reels": {
      const modules = Array.isArray(value?.reels_serp_modules)
        ? value.reels_serp_modules.map((m) => ({
            module_type: m?.module_type,
            clips: pruneMediaList(m?.clips),
          }))
        : [];
      return {
        status: value?.status,
        has_more: value?.has_more,
        page_index: value?.page_index,
        reels_serp_modules: modules,
      };
    }
    case "followers_chunk": {
      if (!Array.isArray(value)) return value;
      return value.map((chunk) => {
        /**
         * The second element is pagination state, not followers. Keeping the
         * wrapper (instead of flattening it to `[]`) lets `stripTracking` show
         * its cursor key names with redacted values, which is the only record
         * of the shape we have.
         */
        if (!Array.isArray(chunk)) return chunk;
        return chunk.map((f) => {
          const pick = [
            "pk",
            "id",
            "username",
            "full_name",
            "profile_pic_url",
            "is_private",
            "is_verified",
          ];
          return Object.fromEntries(pick.filter((k) => k in f).map((k) => [k, f[k]]));
        });
      });
    }
    case "search_accounts": {
      /**
       * `/v2/search/accounts` carries profile pictures, friend state, tokens
       * and a `social_context` string ("43.5K followers"), none of which the
       * adapter reads. The username and the two activity flags are the whole
       * contract: `is_private` is a real filter and `latest_reel_media` is the
       * only last-active evidence this endpoint gives.
       */
      const users = Array.isArray(value?.users)
        ? value.users.map((u) => {
            const pick = [
              "username",
              "pk",
              "id",
              "is_private",
              "is_verified",
              "latest_reel_media",
            ];
            return Object.fromEntries(pick.filter((k) => k in u).map((k) => [k, u[k]]));
          })
        : [];
      return {
        status: value?.status,
        num_results: value?.num_results,
        has_more: value?.has_more,
        users,
      };
    }
    case "comments": {
      const comments = Array.isArray(value?.response?.comments)
        ? value.response.comments.map((c) => {
            const user = c && typeof c === "object" ? c.user : undefined;
            return {
              text: c?.text,
              comment_like_count: c?.comment_like_count,
              created_at: c?.created_at,
              user: user ? pruneUser(user) : user,
            };
          })
        : [];
      return { response: { comments } };
    }
    default:
      return value;
  }
}

/** Full pipeline used by the capture script and the CLI. */
export function sanitiseFixture(name, value) {
  return stripTracking(pruneFixture(name, value));
}

function fileSize(file) {
  return statSync(file).size;
}

function main() {
  const check = process.argv.includes("--check");
  const files = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let before = 0;
  let after = 0;
  let changed = 0;
  for (const file of files) {
    const full = path.join(FIXTURE_DIR, file);
    const name = file.replace(/\.json$/, "");
    const raw = readFileSync(full, "utf8");
    const parsed = JSON.parse(raw);
    const safe = sanitiseFixture(name, parsed);
    const next = `${JSON.stringify(safe, null, 2)}\n`;
    const oldSize = fileSize(full);
    const newSize = Buffer.byteLength(next);
    before += oldSize;
    after += newSize;
    if (next !== raw) {
      changed += 1;
      if (!check) writeFileSync(full, next);
    }
    console.log(
      `${file}: ${(oldSize / 1024).toFixed(1)} KB -> ${(newSize / 1024).toFixed(1)} KB${next === raw ? " (unchanged)" : ""}`,
    );
  }
  console.log(
    `total: ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB across ${files.length} files, ${changed} changed`,
  );
  if (check && changed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
