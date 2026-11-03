/**
 * Koko's replies arrive as markdown-ish text. This module turns that text into
 * a small, typed block tree the UI renders with ordinary React elements — never
 * with `dangerouslySetInnerHTML`.
 *
 * The safe subset is deliberate:
 *
 * - paragraphs
 * - `**bold**` inline runs
 * - `-` / `*` (and `1.`) lists
 * - `#` headings, clamped to levels 2-3 so a reply cannot outrank the page
 *
 * Everything else is text. Raw HTML, links, images, tables and code fences are
 * not interpreted: they render exactly as characters a reader can see. That is
 * what makes a hostile reply ("javascript:", `<script>`, a 5,000-character
 * unbroken token) inert instead of something the layout has to survive.
 *
 * Input is capped at 8,000 characters. Any unbroken run longer than
 * `BREAK_EVERY` characters gets a zero-width space between chunks, which gives
 * the browser a legal place to wrap even inside one enormous token; the UI also
 * carries `overflow-wrap: anywhere` as the second line of defence.
 */

export type InlineRun =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string };

export type CardBlock =
  | { type: "heading"; level: 2 | 3; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] }
  | { type: "list"; ordered: boolean; items: InlineRun[][] };

/** The whole input is clipped here, before any parsing. */
export const MAX_CARD_INPUT = 8000;

/** A run is only split when it is much longer than a normal word. */
const BREAK_AFTER = 120;

/** Chunks are short enough to fit a narrow phone bubble. */
const BREAK_EVERY = 60;

const LONG_TOKEN = new RegExp(`\\S{${BREAK_AFTER + 1},}`, "g");

/**
 * Insert zero-width spaces inside long unbroken runs.
 *
 * The space is invisible and copyable, and it never changes the visible
 * characters. Ordinary words (under `BREAK_AFTER`) are left alone, so a URL or
 * a normal sentence is untouched. Only a token that could overflow on its own
 * is chunked.
 */
function wrapSafe(text: string): string {
  return text.replace(LONG_TOKEN, (token) => {
    const out: string[] = [];
    for (let i = 0; i < token.length; i += BREAK_EVERY) {
      out.push(token.slice(i, i + BREAK_EVERY));
    }
    return out.join("\u200B");
  });
}

const BOLD = /\*\*([\s\S]+?)\*\*/g;

/**
 * Parse `**bold**` into runs. An unmatched `**` stays literal text, so a
 * malformed reply cannot swallow the rest of the message.
 */
export function parseInline(input: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let cursor = 0;

  BOLD.lastIndex = 0;
  for (const match of input.matchAll(BOLD)) {
    const index = match.index ?? 0;
    const body = match[1] ?? "";
    if (!body) continue;
    if (index > cursor) {
      runs.push({ kind: "text", text: wrapSafe(input.slice(cursor, index)) });
    }
    runs.push({ kind: "bold", text: wrapSafe(body) });
    cursor = index + match[0].length;
  }

  if (cursor < input.length) {
    runs.push({ kind: "text", text: wrapSafe(input.slice(cursor)) });
  }

  return runs.filter((run) => run.text.length > 0);
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

function headingLevel(hashes: string): 2 | 3 {
  // `#` (level 1) still renders as 2 so it sits under the studio's own h1;
  // anything deeper than 3 clamps to 3.
  return Math.min(3, Math.max(2, hashes.length)) as 2 | 3;
}

/**
 * Turn Koko's markdown-ish reply into safe blocks.
 *
 * Lines are grouped in one pass: consecutive list items become one list,
 * consecutive plain lines one paragraph, and a fenced block one paragraph whose
 * contents are never interpreted. Empty lines close the current block.
 */
export function renderCards(markdown: string): CardBlock[] {
  if (typeof markdown !== "string") return [];
  const source = markdown.replace(/\r\n?/g, "\n").slice(0, MAX_CARD_INPUT);
  if (!source.trim()) return [];

  const lines = source.split("\n");
  const blocks: CardBlock[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n");
    paragraph = [];
    const runs = parseInline(text);
    if (runs.length) blocks.push({ type: "paragraph", runs });
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item) => parseInline(item));
    const ordered = list.ordered;
    list = null;
    if (items.some((item) => item.length)) {
      blocks.push({ type: "list", ordered, items });
    }
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // A fenced block is data, not formatting. Everything up to the closing
    // fence (or the end of the reply) becomes one literal paragraph.
    if (FENCE.test(line)) {
      flushAll();
      const fenced: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        fenced.push(lines[i] ?? "");
        i += 1;
      }
      if (fenced.length) {
        blocks.push({
          type: "paragraph",
          runs: [{ kind: "text", text: wrapSafe(fenced.join("\n")) }],
        });
      }
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        type: "heading",
        level: headingLevel(heading[1] ?? "#"),
        runs: parseInline(heading[2] ?? ""),
      });
      continue;
    }

    const unordered = UNORDERED.exec(line);
    const ordered = unordered ? null : ORDERED.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const kind = Boolean(ordered);
      if (!list || list.ordered !== kind) {
        flushList();
        list = { ordered: kind, items: [] };
      }
      list!.items.push((unordered ?? ordered)![1] ?? "");
      continue;
    }

    // A plain line: close a list, then continue (or start) the paragraph.
    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}
