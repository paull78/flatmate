import type { SheetSize } from "@fm/domain";
import type { FontStyle, Primitive } from "../view/scene-types";
import { text } from "./column";
import { helveticaWidth } from "./helvetica";
import type { Rect } from "./paper";
import { parseReport, type ReportBlock, type Run } from "./report-text";

// A report's text on its pages (sheetset.08; AC-09), in paper millimetres, y up, sizes as on the mockup the user approved.
// Each column fills to the bottom before the next begins, as balanced columns read as text jumping across early.
//
//   +-- the frame -----------------+
//   |  Title, across the columns   |   first page only
//   |  HEADING       text          |
//   |  text          text          |
//   |  text          text          |
//   +------------------------------+
//
// Line breaking measures word by word and, inside a word too long for a column, character by character, so it's linear in
// the text: `wrapText` re-measures what's left of a word, too slow for 20,000 characters with no space.

export type ReportFlow = { pages: readonly (readonly Primitive[])[] };

const INK = "#1a1a1a";
const INSET = 8; // the frame to the text
const COLUMN_GAP = 9;
const MM_PER_COLUMN = 90;
const BODY: Record<SheetSize, number> = { small: 2.8, normal: 3.3, large: 3.9 };
const LEADING = 1.45;
const PARAGRAPH_GAP = 2;
const HEADING_GAP = 1.5;
const TITLE_SIZE = 8;
const TITLE_LEADING = 1.1;
const TITLE_GAP = 6;
const TITLE_LINES = 3; // so the columns keep their page: it ends in "…", as a long field does in the title block
const ELLIPSIS = "…";

/** A column per 90 mm of the frame's inner width, from 2 to 4 (sheetset.08): 90 mm holds about 60 characters at the normal size. */
export function columnCount(area: Rect): number {
  return Math.min(4, Math.max(2, Math.floor((area.w - 2 * INSET) / MM_PER_COLUMN)));
}

/** A stretch of one style on a line. */
type Piece = { text: string; style?: FontStyle; width: number };
type Line = Piece[];

/** Whole words, each a list of pieces as a mark can start inside a word: spaces are all one width, in all three fonts. */
function wordsOf(runs: readonly Run[]): Run[][] {
  const words: Run[][] = [];
  let word: Run[] = [];
  const endWord = (): void => {
    if (word.length > 0) words.push(word);
    word = [];
  };
  for (const run of runs) {
    run.text.split(" ").forEach((part, i) => {
      if (i > 0) endWord();
      if (part !== "") word.push(run.style ? { text: part, style: run.style } : { text: part });
    });
  }
  endWord();
  return words;
}

/** Greedy at spaces, inside a word only when it's wider than a line. */
function breakLines(runs: readonly Run[], size: number, width: number): Line[] {
  const space = helveticaWidth(" ", size);
  const lines: Line[] = [];
  let line: Line = [];
  let used = 0;
  const endLine = (): void => {
    if (line.length > 0) lines.push(line);
    line = [];
    used = 0;
  };
  const add = (t: string, style: FontStyle | undefined, w: number): void => {
    const last = line[line.length - 1];
    if (last && last.style === style) {
      last.text += t;
      last.width += w;
    } else {
      line.push(style ? { text: t, style, width: w } : { text: t, width: w });
    }
    used += w;
  };
  for (const word of wordsOf(runs)) {
    const w = word.reduce((sum, r) => sum + helveticaWidth(r.text, size, r.style), 0);
    const last = line[line.length - 1];
    if (last && used + space + w <= width + 1e-9) {
      add(" ", last.style, space);
    } else if (line.length > 0) {
      endLine();
    }
    if (w <= width + 1e-9) {
      for (const r of word) add(r.text, r.style, helveticaWidth(r.text, size, r.style));
      continue;
    }
    for (const r of word) {
      for (const ch of r.text) {
        const cw = helveticaWidth(ch, size, r.style);
        if (line.length > 0 && used + cw > width + 1e-9) endLine();
        add(ch, r.style, cw);
      }
    }
  }
  endLine();
  return lines;
}

/** What a page lays down one after the other. `keep`: it stays with the row after it (a heading's). */
type Row = { line: Line; after: number; keep: boolean };

function rowsOf(blocks: readonly ReportBlock[], size: number, width: number): Row[] {
  return blocks.flatMap((block): Row[] => {
    const heading = block.kind !== "paragraph";
    const lines = breakLines(heading ? [{ text: block.text.toUpperCase(), style: "bold" }] : block.runs, size, width);
    const gap = heading ? HEADING_GAP : PARAGRAPH_GAP;
    return lines.map((line, i) => ({ line, after: i === lines.length - 1 ? gap : 0, keep: heading }));
  });
}

/** The title's lines, at most three, and the height it takes off the first page. */
function titleOf(title: string, box: Rect): { primitives: Primitive[]; height: number } {
  const lh = TITLE_SIZE * TITLE_LEADING;
  const lines = breakLines([{ text: title, style: "bold" }], TITLE_SIZE, box.w);
  const rows = lines.slice(0, TITLE_LINES).map((l) => l.map((p) => p.text).join(""));
  const last = rows[rows.length - 1];
  if (lines.length > TITLE_LINES && last !== undefined) {
    let cut = last.trimEnd();
    while (cut !== "" && helveticaWidth(cut + ELLIPSIS, TITLE_SIZE, "bold") > box.w) cut = cut.slice(0, -1);
    rows[rows.length - 1] = cut.trimEnd() + ELLIPSIS;
  }
  const top = box.y + box.h;
  return { primitives: rows.map((r, i) => text(r, box.x, top - (i + 0.5) * lh, TITLE_SIZE, INK, "left", "bold")), height: rows.length * lh + TITLE_GAP };
}

/**
 * A report's text in `area`, the page's frame, as a page's text each. Always at least one page. Where a heading goes needs
 * what stays with it in the column; a run of headings taller than a whole column gives up on that, or each would take one.
 */
export function flowReport(source: string, sizeName: SheetSize, area: Rect): ReportFlow {
  const box: Rect = { x: area.x + INSET, y: area.y + INSET, w: area.w - 2 * INSET, h: area.h - 2 * INSET };
  const columns = columnCount(area);
  const width = (box.w - (columns - 1) * COLUMN_GAP) / columns;
  const size = BODY[sizeName];
  const lh = size * LEADING;
  const blocks = parseReport(source);
  const [first] = blocks;
  const title = first?.kind === "title" ? titleOf(first.text, box) : null;
  const rows = rowsOf(title ? blocks.slice(1) : blocks, size, width);

  const boxTop = box.y + box.h;
  const pageTop = boxTop - (title?.height ?? 0);
  const pages: Primitive[][] = [title?.primitives ?? []];
  let columnTop = pageTop;
  let column = 0;
  let y = columnTop;
  let fresh = true; // nothing yet in this column
  const nextColumn = (): void => {
    column++;
    if (column === columns) {
      column = 0;
      columnTop = boxTop;
      pages.push([]);
    }
    y = columnTop;
    fresh = true;
  };
  /** The height from row i through the last row keeping with it, or just its own when they couldn't fit any column. */
  const needed = (i: number): number => {
    const most = columnTop - box.y;
    let height = lh;
    for (let j = i; rows[j]?.keep && rows[j + 1]; j++) {
      height += (rows[j]?.after ?? 0) + lh;
      if (height > most) return lh;
    }
    return height;
  };
  rows.forEach((row, i) => {
    const gap = fresh ? 0 : (rows[i - 1]?.after ?? 0);
    if (!fresh && y - gap - needed(i) < box.y - 1e-9) nextColumn();
    else y -= gap;
    const page = pages[pages.length - 1];
    let x = box.x + column * (width + COLUMN_GAP);
    for (const piece of row.line) {
      page?.push(text(piece.text, x, y - lh / 2, size, INK, "left", piece.style));
      x += piece.width;
    }
    y -= lh;
    fresh = false;
  });
  return { pages };
}
