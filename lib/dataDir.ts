/**
 * One data root for every cache in the app.
 *
 * `CREATORS_DATA_DIR` is how a preview, a worker and a test point the whole
 * data layer at one directory. The niche cache and the handle cache follow it;
 * the raw harvest cache, the post cache, the media downloads, the intent cache
 * and the vendor usage ledgers must follow the same rule. A second hard-coded
 * `./data` is how a live run writes a cache the app never reads.
 *
 * Resolved per call, not captured at import, so a test can move the root
 * without reloading modules.
 */
import path from "node:path";

export function dataRoot(): string {
  return process.env.CREATORS_DATA_DIR
    ? path.resolve(process.env.CREATORS_DATA_DIR)
    : path.join(process.cwd(), "data");
}

/** A path inside `dataRoot()`, e.g. `dataPath("niches")`. */
export function dataPath(...parts: string[]): string {
  return path.join(dataRoot(), ...parts);
}
