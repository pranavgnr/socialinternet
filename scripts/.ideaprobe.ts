/**
 * Offline check: what does the idea feed actually read like for a real account?
 * Loads a stored profile + patterns and renders the template ideas, so titles
 * can be judged without spending a single credit or model call.
 *
 *   npx tsx scripts/.ideaprobe.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { familyOf, formatDrafts, musicDrafts } from "../lib/adapt";
import type { PatternCard, Profile } from "../lib/types";

const ACCOUNTS: [string, string][] = [
  ["fd5fb7f2-4d4c-4ef6-a054-7fb4de28d61e", "vlogger"],
  ["ddb19d9f-dd11-45e1-b9d2-69a9d6d3e9c2", "singer"],
  ["bbbb1111-2222-3333-4444-555566667777", "teacher"],
];

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main() {
  for (const [id, label] of ACCOUNTS) {
    const dir = path.join(process.cwd(), "data", "accounts", id);
    const profile = await readJson<Profile>(path.join(dir, "profile.json"));
    const raw = await readJson<PatternCard[] | { patterns: PatternCard[] }>(
      path.join(dir, "patterns.json"),
    );
    const patterns = Array.isArray(raw) ? raw : raw?.patterns ?? [];
    if (!profile || !patterns.length) {
      console.log(`\n── ${label}: no stored profile/patterns`);
      continue;
    }

    /**
     * Same branch adapt() takes offline: a singer's feed is covers built on the
     * songs the plan named, everything else is built on video shapes.
     */
    const family = familyOf(profile);
    const drafts =
      family === "songs" && (profile.songs?.length ?? 0) > 0
        ? musicDrafts(profile, patterns)
        : formatDrafts(profile, patterns);

    console.log(`\n── ${label} (${profile.archetype ?? "?"}) family=${family} niche="${profile.niche}"`);
    for (const idea of drafts) {
      console.log(`  • ${idea.title}`);
      console.log(`    about: ${idea.topic} | tags: ${idea.hashtags.join(" ")}`);
      console.log(`    why: ${idea.whyThis}`);
    }
  }
}

main();
