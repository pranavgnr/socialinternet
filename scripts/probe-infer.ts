import { promises as fs } from "node:fs";
import { detectArchetype } from "../lib/archetype";
import { inferNiche } from "../lib/plan";
import type { RawReel } from "../lib/types";

const d = JSON.parse(await fs.readFile("data/handles/rachana.kannegulla.json", "utf8")) as { reels: RawReel[] };
const shape = detectArchetype(d.reels);
console.log("shape:", shape.id, shape.label, shape.language, shape.confidence.toFixed(2));
const guess = await inferNiche(d.reels, { subject: shape.label, language: shape.language });
console.log("niche:", JSON.stringify(guess));
