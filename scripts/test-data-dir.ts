/**
 * Every cache follows CREATORS_DATA_DIR.
 *
 * The live verification found one cache (handles) writing under `<cwd>/data`
 * while the app read the shared directory. This test pins the same rule for the
 * rest: raw pulls, post/enrichment cache, media downloads, hook cache, intent
 * cache, owner cache, the niche/handle directories and the Apify/YouTube usage
 * ledgers.
 *
 *   sh scripts/run-test.sh test-data-dir
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataPath, dataRoot } from "../lib/dataDir";
import { rawCachePath } from "../lib/harvest";
import { postCachePath as enrichPostCache } from "../lib/enrich";
import { postCachePath as commentsPostCache } from "../lib/comments";
import { hookCachePath, mediaDir } from "../lib/media";
import { intentCachePath } from "../lib/nicheIntent";
import { handleDir } from "../lib/plan";
import { nicheDir } from "../lib/niche";
import { ownerCachePath } from "../lib/ownerProfiles";
import { apifyUsagePath } from "../lib/providers/apify";
import { youtubeUsagePath } from "../lib/providers/youtube";
import { subCachePath } from "../lib/providers/youtubeweb";
import { accountDir, store } from "../lib/store";
import { dataRoot as weeklyDataRoot } from "../lib/weekly";

const TMP = mkdtempSync(path.join(os.tmpdir(), "reel-engine-data-dir-"));
const ORIGINAL = process.env.CREATORS_DATA_DIR;

function restore(): void {
  if (ORIGINAL === undefined) delete process.env.CREATORS_DATA_DIR;
  else process.env.CREATORS_DATA_DIR = ORIGINAL;
}

test("every cache path resolves under CREATORS_DATA_DIR when it is set", () => {
  process.env.CREATORS_DATA_DIR = TMP;
  try {
    const root = path.resolve(TMP);
    const checks: [string, string, string][] = [
      ["dataRoot", dataRoot(), root],
      ["dataPath", dataPath("example.json"), path.join(root, "example.json")],
      ["rawCachePath", rawCachePath(), path.join(root, "_raw_cache.json")],
      ["enrich postCachePath", enrichPostCache(), path.join(root, "_post_cache.json")],
      ["comments postCachePath", commentsPostCache(), path.join(root, "_post_cache.json")],
      ["mediaDir", mediaDir(), path.join(root, "_media")],
      ["hookCachePath", hookCachePath(), path.join(root, "_hook_cache.json")],
      ["intentCachePath", intentCachePath(), path.join(root, "_intent_cache.json")],
      ["nicheDir", nicheDir(), path.join(root, "niches")],
      ["handleDir", handleDir(), path.join(root, "handles")],
      ["ownerCachePath", ownerCachePath(), path.join(root, "_owner_profiles.json")],
      ["apifyUsagePath", apifyUsagePath(), path.join(root, "_apify_usage.json")],
      ["youtubeUsagePath", youtubeUsagePath(), path.join(root, "_youtube_usage.json")],
      ["subCachePath", subCachePath(), path.join(root, "_yt_subs.json")],
      ["weekly dataRoot", weeklyDataRoot(), root],
    ];
    for (const [name, actual, expected] of checks) {
      assert.equal(actual, expected, `${name} must honour CREATORS_DATA_DIR`);
    }
  } finally {
    restore();
  }
});

test("every cache path resolves under ./data when CREATORS_DATA_DIR is unset", () => {
  delete process.env.CREATORS_DATA_DIR;
  try {
    const root = path.join(process.cwd(), "data");
    const checks: [string, string, string][] = [
      ["dataRoot", dataRoot(), root],
      ["rawCachePath", rawCachePath(), path.join(root, "_raw_cache.json")],
      ["enrich postCachePath", enrichPostCache(), path.join(root, "_post_cache.json")],
      ["comments postCachePath", commentsPostCache(), path.join(root, "_post_cache.json")],
      ["mediaDir", mediaDir(), path.join(root, "_media")],
      ["hookCachePath", hookCachePath(), path.join(root, "_hook_cache.json")],
      ["intentCachePath", intentCachePath(), path.join(root, "_intent_cache.json")],
      ["nicheDir", nicheDir(), path.join(root, "niches")],
      ["handleDir", handleDir(), path.join(root, "handles")],
      ["ownerCachePath", ownerCachePath(), path.join(root, "_owner_profiles.json")],
      ["apifyUsagePath", apifyUsagePath(), path.join(root, "_apify_usage.json")],
      ["youtubeUsagePath", youtubeUsagePath(), path.join(root, "_youtube_usage.json")],
      ["subCachePath", subCachePath(), path.join(root, "_yt_subs.json")],
      ["weekly dataRoot", weeklyDataRoot(), root],
    ];
    for (const [name, actual, expected] of checks) {
      assert.equal(actual, expected, `${name} must fall back to ./data`);
    }
  } finally {
    restore();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("the shared store resolves CREATORS_DATA_DIR lazily, per use", async () => {
  const first = mkdtempSync(path.join(os.tmpdir(), "reel-engine-store-a-"));
  const second = mkdtempSync(path.join(os.tmpdir(), "reel-engine-store-b-"));
  try {
    process.env.CREATORS_DATA_DIR = first;
    await store.saveIdeas([]);
    assert.equal(
      existsSync(path.join(first, "ideas.json")),
      true,
      "the first use must write under the directory set before it",
    );
    assert.equal(
      existsSync(path.join(second, "ideas.json")),
      false,
      "nothing may be written to a directory that was not set yet",
    );

    process.env.CREATORS_DATA_DIR = second;
    await store.saveIdeas([]);
    assert.equal(
      existsSync(path.join(second, "ideas.json")),
      true,
      "a later root change must move the store, not reuse the captured one",
    );

    assert.equal(
      accountDir("abc"),
      path.join(path.resolve(second), "accounts", "abc"),
      "accountDir must follow the same lazy root",
    );
  } finally {
    restore();
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});
