import { PROJECT_FIELDS, type Document, type Logo } from "@fm/domain";
import type { PageImage } from "../ports/effects";
import type { Color, FontStyle, Primitive } from "../view/scene-types";
import { helveticaWidth } from "./helvetica";
import { logoImage, logoSize } from "./logo";
import { NORTH_MARK_MM, northArrow } from "./north-arrow";
import type { Rect } from "./paper";
import type { RoomsTable } from "./rooms-table";
import { wrapText } from "./wrap";

// The title block column on a sheet's right edge (sheet.07, .08, sheetset.19): stacked blocks of text in paper
// millimetres, origin bottom-left, y up. The top stack runs down from the column's top: the logo, the studio's details, the project
// name, the subtitle, the fields and notes, the rooms table. The bottom stack runs up from its foot: the sheet number (two
// or more sheets), the paper and date, the disclaimer, the scale bar with the north arrow beside it. Text is measured in
// Helvetica, the PDF's font (sheet.14), so nothing leaves the column.

export const DISCLAIMER = "Dimensions are approximate; check on site.";

const INK = "#1a1a1a";
const GREY = "#4d4d4d";
const LABEL = "#7a7a7a";
const PAD = 4; // inside the column, left and right
const RULE_MM = 0.18;
const TOP_GAP = 3;
const LOGO_MM = 10; // the tallest it gets: what the column at its fullest has to spare on the shortest page (sheetset.45)
const LOGO_GAP = 1.5; // above the studio's name

/** What may be left out of a full column: the notes cut to fewer lines, then the rooms table (sheetset.21). */
export type ColumnFit = { notesLines: number; rooms: boolean };
/** With every field at its limit this still fits the shortest page (`overflow.test.ts`): the rooms table is the only unbounded block. */
export const SHORTEST_COLUMN: ColumnFit = { notesLines: 2, rooms: false };
/** The ways to lay out a column, most complete first; the first that fits is used (drop by importance, sheet.09). */
export const COLUMN_FITS: readonly ColumnFit[] = [{ notesLines: 8, rooms: true }, { notesLines: 2, rooms: true }, SHORTEST_COLUMN];

export type ColumnContent = {
  projectName: string;
  fields: Document["projectFields"];
  rooms: RoomsTable;
  date: string; // as typed, or today's
  accent: Color; // the studio's name and the sheet number
  scale: number | null; // what the bar measures; null for a page with no drawing
  north: number | null; // the arrow beside the bar; null for none
  paperLabel: string;
  sheet: number | null; // 1-based; null when it isn't in the PDF
  sheets: number;
  logo?: Logo | null; // above the studio's name, as a page image: none draws nothing
};

/** A run of the column: its height, and what it draws below `top`. */
export type Block = { height: number; draw(top: number): Primitive[] };

export const lineHeight = (size: number): number => size * 1.3;

export function text(t: string, x: number, y: number, size: number, color: string, align: "left" | "center" | "right" = "left", style?: FontStyle): Primitive {
  return { kind: "text", text: t, at: { x, y }, size, color, align, rotation: 0, font: "helvetica", ...(style ? { style } : {}) }; // paper (render.15)
}

export const gap = (height: number): Block => ({ height, draw: () => [] });

/** Lines of text at one size, left-aligned at x, each centred in its line height. */
export function lines(rows: readonly string[], x: number, size: number, color: string): Block {
  const lh = lineHeight(size);
  return { height: rows.length * lh, draw: (top) => rows.map((r, i) => text(r, x, top - (i + 0.5) * lh, size, color)) };
}

function rule(x0: number, x1: number): Block {
  return {
    height: 5,
    draw: (top) => [{ kind: "segment", a: { x: x0, y: top - 2.5 }, b: { x: x1, y: top - 2.5 }, width: { px: RULE_MM }, color: INK, cap: "butt" }],
  };
}

/** Blocks top to bottom from `top`: each draws below the previous. */
export function stackDown(blocks: readonly Block[], top: number): Primitive[] {
  const out: Primitive[] = [];
  let y = top;
  for (const b of blocks) {
    out.push(...b.draw(y));
    y -= b.height;
  }
  return out;
}

/** Blocks bottom to top from `bottom`: the first sits lowest. */
export function stackUp(blocks: readonly Block[], bottom: number): Primitive[] {
  const out: Primitive[] = [];
  let y = bottom;
  for (const b of blocks) {
    out.push(...b.draw(y + b.height));
    y += b.height;
  }
  return out;
}

export const heightOf = (blocks: readonly Block[]): number => blocks.reduce((sum, b) => sum + b.height, 0);

/** The column's blocks for one page, laid out as `fit` says. */
function columnBlocks(box: Rect, c: ColumnContent, fit: ColumnFit): { top: Block[]; bottom: Block[] } {
  const xl = box.x + PAD;
  const xr = box.x + box.w - PAD;
  const inner = xr - xl;
  const value = (key: string): string => c.fields[key]?.value ?? "";

  const studio = studioBlocks(c, xl, inner);
  const logo = c.logo ? [gap(logoSize(c.logo, inner, LOGO_MM).h), ...(studio.length > 0 ? [gap(LOGO_GAP)] : [])] : [];
  const letterhead = [...logo, ...studio];
  const top: Block[] = letterhead.length > 0 ? [gap(TOP_GAP), ...letterhead, rule(box.x, box.x + box.w)] : [];
  top.push(gap(TOP_GAP), lines(wrapText(c.projectName.trim() === "" ? "Untitled" : c.projectName, 5.5, inner, 2), xl, 5.5, INK));
  const subtitle = value("subtitle");
  if (subtitle !== "") top.push(gap(0.5), lines(wrapText(subtitle, 3, inner, 2), xl, 3, GREY));

  const details: Block[] = [];
  for (const f of PROJECT_FIELDS) {
    const v = value(f.key);
    if (f.key === "subtitle" || v === "") continue;
    const size = f.multiline ? 2.3 : 2.5;
    const max = f.multiline ? fit.notesLines : 2;
    details.push(lines([f.label.toUpperCase()], xl, 1.8, LABEL), lines(wrapText(v, size, inner, max), xl, size, INK), gap(1.5));
  }
  if (details.length > 0) top.push(rule(box.x, box.x + box.w), ...details);
  if (fit.rooms && c.rooms.rows.length > 0) top.push(rule(box.x, box.x + box.w), roomsBlock(c.rooms, xl, xr));

  // A one-page PDF has no sheet number (sheet.29).
  const number: Block[] = c.sheet !== null && c.sheets > 1 ? [numberBlock(c.sheet, c.sheets, xl, c.accent), rule(box.x, box.x + box.w)] : [];
  const bottom: Block[] = [
    gap(1),
    ...number,
    paperBlock(c.paperLabel, c.date, xl, xr),
    gap(1),
    lines(wrapText(DISCLAIMER, 2, inner, 2), xl, 2, GREY),
    gap(1.5),
    ...(c.scale !== null ? [scaleBar(c.scale, c.north, xl, inner)] : []),
  ];
  return { top, bottom };
}

/** Where the column's blocks left room for the logo, at its top left. */
export function columnLogo(box: Rect, logo: Logo): PageImage {
  return logoImage(logo, box.x + PAD, box.y + box.h - TOP_GAP, box.w - 2 * PAD, LOGO_MM);
}

/** The column's primitives: the top stack from the box's top edge, the bottom stack from its foot. */
export function columnPrimitives(box: Rect, c: ColumnContent, fit: ColumnFit): Primitive[] {
  const { top, bottom } = columnBlocks(box, c, fit);
  return [...stackDown(top, box.y + box.h), ...stackUp(bottom, box.y)];
}

/** Whether the content fits the box laid out as `fit`: both stacks, with a 2 mm gap between them. */
export function columnFits(box: Rect, c: ColumnContent, fit: ColumnFit): boolean {
  const { top, bottom } = columnBlocks(box, c, fit);
  return heightOf(top) + heightOf(bottom) + 2 <= box.h + 1e-9;
}

/** The studio's name in the accent, its address and contact under it, each up to two lines; nothing when none is set (sheetset.18). */
export function studioBlocks(c: Pick<ColumnContent, "fields" | "accent">, xl: number, inner: number): Block[] {
  const value = (key: string): string => c.fields[key]?.value ?? "";
  const name = value("studioName");
  const rest = [value("studioAddress"), value("studioContact")].filter((v) => v !== "");
  if (name === "" && rest.length === 0) return [];
  return [
    ...(name !== "" ? [lines(wrapText(name, 3.5, inner, 2), xl, 3.5, c.accent)] : []),
    ...rest.map((v) => lines(wrapText(v, 2.3, inner, 2), xl, 2.3, GREY)),
  ];
}

/** How far a named area's row sits in from its room's (areas.12). */
const PART_INDENT_MM = 3;

/**
 * Room / Area / Free, a room's detail (its size, its floor) in grey under its name, its named areas indented under it,
 * then the total (export.32, sheet.08, finishes.11, areas.12).
 */
function roomsBlock(table: RoomsTable, xl: number, xr: number): Block {
  const areaRight = xr - 16;
  const nameWidth = areaRight - 16 - xl;
  const head = lineHeight(3);
  const row = lineHeight(2.5);
  const detailRow = lineHeight(2);
  const total = lineHeight(3);
  const height = head + table.rows.reduce((h, r) => h + row + (r.detail !== null ? detailRow : 0) + 0.6, 0) + 3 + total;
  return {
    height,
    draw: (top) => {
      let y = top - head / 2;
      const out: Primitive[] = [text("ROOM", xl, y, 1.8, LABEL), text("AREA", areaRight, y, 1.8, LABEL, "right")];
      if (table.rows.some((r) => r.free !== null)) out.push(text("FREE", xr, y, 1.8, LABEL, "right")); // free floor needs a layout, which a report has none of (sheetset.70)
      y = top - head;
      for (const r of table.rows) {
        const indent = r.part === true ? PART_INDENT_MM : 0; // a named area under its room (areas.12)
        const name = wrapText(r.name, 2.5, nameWidth - indent, 1)[0] ?? "";
        out.push(text(name, xl + indent, y - row / 2, 2.5, INK), text(r.area, areaRight, y - row / 2, 2.5, INK, "right"));
        if (r.free !== null) out.push(text(r.free, xr, y - row / 2, 2.5, INK, "right"));
        y -= row;
        if (r.detail !== null) {
          out.push(text(wrapText(r.detail, 2, xr - xl, 1)[0] ?? "", xl, y - detailRow / 2, 2, LABEL));
          y -= detailRow;
        }
        y -= 0.6;
      }
      out.push({ kind: "segment", a: { x: xl, y: y - 1.5 }, b: { x: xr, y: y - 1.5 }, width: { px: RULE_MM }, color: INK, cap: "butt" });
      y -= 3;
      out.push(text("Total", xl, y - total / 2, 2.5, INK));
      if (table.total !== null) out.push(text(table.total, areaRight, y - total / 2, 2.5, INK, "right"));
      return out;
    },
  };
}

/** "Sheet 02 / 03" in the accent (sheet.11, sheetset.19); only with two or more sheets. */
function numberBlock(sheet: number, sheets: number, xl: number, accent: Color): Block {
  const two = (n: number): string => String(n).padStart(2, "0");
  const lh = lineHeight(4);
  return { height: lh + 1, draw: (top) => [text(`Sheet ${two(sheet)} / ${two(sheets)}`, xl, top - lh / 2, 4, accent)] };
}

/** The paper at the left, the date at the right, cut with "…" before it reaches the paper's name. */
function paperBlock(paperLabel: string, date: string, xl: number, xr: number): Block {
  const lh = lineHeight(2.5);
  const room = xr - xl - helveticaWidth(paperLabel, 2.5) - 2;
  const [shown] = wrapText(date, 2.5, room, 1);
  return { height: lh + 1, draw: (top) => [text(paperLabel, xl, top - 1 - lh / 2, 2.5, INK), text(shown ?? "", xr, top - 1 - lh / 2, 2.5, INK, "right")] };
}

/** What a scale bar's length can be labelled in metres, longest first. */
export const BAR_METRES: readonly number[] = [20, 10, 5, 2, 1, 0.5];

/** Four alternating cells in an outline, from (x, y). */
export function barCells(x: number, y: number, len: number, height: number): Primitive[] {
  const cell = len / 4;
  const cells = [0, 1, 2, 3].map((i): Primitive => {
    const x0 = x + i * cell;
    return { kind: "polygon", points: [{ x: x0, y }, { x: x0 + cell, y }, { x: x0 + cell, y: y + height }, { x: x0, y: y + height }], holes: [], color: i % 2 === 0 ? "#000000" : "#ffffff" };
  });
  const c = [{ x, y }, { x: x + len, y }, { x: x + len, y: y + height }, { x, y: y + height }];
  return [...cells, ...c.map((a, i): Primitive => ({ kind: "segment", a, b: c[(i + 1) % 4] ?? a, width: { px: 0.18 }, color: "#000000", cap: "butt" }))];
}

/**
 * A bar whose labelled length is the longest of `BAR_METRES` that leaves room for its end label inside the column, and
 * for the north arrow at the column's right, whose foot the bar shares.
 */
function scaleBar(scale: number, north: number | null, xl: number, inner: number): Block {
  const k = 1000 / scale;
  const room = north === null ? inner : inner - NORTH_MARK_MM - 1;
  const metres = BAR_METRES.find((m) => m * k <= room - 6) ?? 0.5;
  const len = metres * k;
  const labelLine = lineHeight(2);
  const bar = 1.5;
  const barHeight = labelLine + bar + 1;
  const height = north === null ? barHeight : Math.max(barHeight, NORTH_MARK_MM);
  return {
    height,
    draw: (blockTop) => {
      const top = blockTop - (height - barHeight);
      const labelY = top - labelLine / 2;
      const out: Primitive[] = [text("0", xl, labelY, 2, INK, "center"), text(`${metres} m`, xl + len, labelY, 2, INK, "center")];
      out.push(...barCells(xl, top - labelLine - bar, len, bar));
      if (north !== null) out.push(...northArrow({ x: xl + inner - NORTH_MARK_MM / 2, y: blockTop - height / 2 }, north));
      return out;
    },
  };
}
