import type { Logo } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { PageImage } from "../ports/effects";
import type { Color, Primitive } from "../view/scene-types";
import { BAR_METRES, barCells, gap, heightOf, lineHeight, lines, stackDown, stackUp, studioBlocks, text, type Block, type ColumnContent } from "./column";
import { helveticaWidth } from "./helvetica";
import { logoImage, logoSize } from "./logo";
import { NORTH_MARK_MM, northArrow } from "./north-arrow";
import type { Rect } from "./paper";
import { wrapText } from "./wrap";

// The cover's tinted column (sheetset.06; AC-08), in paper millimetres, y up. Sizes follow what the user approved on the
// mockup, and are measured in Helvetica, so nothing leaves the tint: a long title takes a smaller size, a long index
// smaller type or more columns.

export const COVER_TINT = "#f7f5f2";
const INK = "#1a1a1a";
export const MUTED = "#6b6b6b";
const RULE = "#b9b9b3";
const MOST_PAD = 12;
const LOGO_MM = 16; // the tallest it gets: the index shrinks to make room, as it does for a long title
const LOGO_GAP = 3;

const TITLE_SIZES = [13, 11, 9, 7.5, 6];
const TITLE_MM = 36; // the tallest a title gets, so the index keeps its room
const TITLE_LEADING = 1.1;

const INDEX_LEADING = 1.75;
const INDEX_GUTTER = 6;
const INDEX_CLEAR = 3; // above the foot's line
/** The ways to lay out the index, largest type first. */
const INDEX_FITS: readonly IndexFit[] = [
  { across: 2, size: 4 },
  { across: 2, size: 3.6 },
  { across: 2, size: 3.2 },
  { across: 2, size: 2.8 },
  { across: 2, size: 2.4 },
  { across: 3, size: 2.4 },
  { across: 2, size: 2 },
  { across: 3, size: 2 },
  { across: 4, size: 2 },
];
const MOST_ACROSS = 4;

const FOOT_GAP = 5;
const STUDIO_LEAST = 45; // beside the scale; with less, details stack above it
const SCALE_LEAST = 30;
const BAR_MM = 1.5;
const LINE_GAP = 5; // under the foot's line
const DETAILS_GAP = 3;

type IndexFit = { across: number; size: number };
type IndexRow = { number: number; title: string };

export const rectangle = ({ x, y, w, h }: Rect): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

export type CoverColumn = Pick<ColumnContent, "projectName" | "fields" | "date" | "accent" | "logo"> & { scale: number; north: number | null; index: readonly IndexRow[] };

/** The largest size holding the whole name, unbroken if it can be, in the title's height. Past the smallest, it ends in "…". */
function titleBlock(name: string, xl: number, width: number): Block {
  const heightAt = (size: number, count: number): number => count * size * TITLE_LEADING;
  const words = name.split(/\s+/);
  const holds = (size: number): boolean => words.every((w) => helveticaWidth(w, size, "bold") <= width) && heightAt(size, wrapText(name, size, width, Infinity, "bold").length) <= TITLE_MM;
  const smallest = TITLE_SIZES[TITLE_SIZES.length - 1] ?? 6;
  const size = TITLE_SIZES.find(holds) ?? smallest;
  const rows = wrapText(name, size, width, Math.floor(TITLE_MM / (size * TITLE_LEADING)), "bold");
  return {
    height: heightAt(size, rows.length),
    draw: (top) => rows.map((r, i) => text(r, xl, top - heightAt(size, i + 0.5), size, INK, "left", "bold")),
  };
}

/** The date beside a tick of the accent; one line, ending in "…". */
function dateBlock(date: string, xl: number, width: number, accent: Color): Block {
  const size = 3.8;
  const lh = lineHeight(size);
  const [shown] = wrapText(date, size, width - 2.8, 1);
  return {
    height: lh,
    draw: (top) => [{ kind: "polygon", points: rectangle({ x: xl, y: top - lh, w: 0.8, h: lh }), holes: [], color: accent }, text(shown ?? "", xl + 2.8, top - lh / 2, size, INK)],
  };
}

const numberText = (n: number): string => String(n).padStart(2, "0");
const rowsDown = (count: number, across: number): number => Math.ceil(count / across);
const columnWidth = (width: number, across: number): number => (width - (across - 1) * INDEX_GUTTER) / across;

/** What's beside a row's number: its title's room in a column of this width. */
function titleRoom(rows: readonly IndexRow[], fit: IndexFit, width: number): { numberW: number; room: number } {
  const widest = Math.max(...rows.map((r) => helveticaWidth(numberText(r.number), fit.size)));
  const numberW = widest + fit.size;
  return { numberW, room: columnWidth(width, fit.across) - numberW };
}

/**
 * The first fit that holds the index and cuts the fewest titles, as a long list and a narrow column want different ones.
 * None holds it: the most columns, in whatever type lets it stay inside, as a sheet is never dropped from it.
 */
function chooseIndexFit(rows: readonly IndexRow[], width: number, room: number): IndexFit {
  const cuts = (fit: IndexFit): number => {
    const titles = titleRoom(rows, fit, width).room;
    return rows.filter((r) => helveticaWidth(r.title, fit.size) > titles).length;
  };
  const holding = INDEX_FITS.filter((f) => rowsDown(rows.length, f.across) * f.size * INDEX_LEADING <= room);
  const [first, ...rest] = holding;
  if (!first) return { across: MOST_ACROSS, size: room / (rowsDown(rows.length, MOST_ACROSS) * INDEX_LEADING) };
  return rest.reduce((best, f) => (cuts(f) < cuts(best) ? f : best), first);
}

/** Rows down each column in turn, the first the fullest, as on the mockup. */
function indexBlock(rows: readonly IndexRow[], xl: number, width: number, room: number): Block {
  const fit = chooseIndexFit(rows, width, room);
  const down = rowsDown(rows.length, fit.across);
  const lh = fit.size * INDEX_LEADING;
  const column = columnWidth(width, fit.across);
  const { numberW, room: titles } = titleRoom(rows, fit, width);
  return {
    height: down * lh,
    draw: (top) =>
      rows.flatMap((r, i): Primitive[] => {
        const x = xl + Math.floor(i / down) * (column + INDEX_GUTTER);
        const rowTop = top - (i % down) * lh;
        const y = rowTop - lh / 2;
        return [
          text(numberText(r.number), x, y, fit.size, MUTED),
          text(wrapText(r.title, fit.size, titles, 1)[0] ?? "", x + numberW, y, fit.size, INK),
          { kind: "segment", a: { x, y: rowTop - lh }, b: { x: x + column, y: rowTop - lh }, width: { px: 0.15 }, color: RULE, cap: "butt", dash: [0.3, 0.5] },
        ];
      }),
  };
}

/** The longest labelled bar in `room`. */
function barIn(scale: number, room: number): { metres: number; len: number } {
  const k = 1000 / scale;
  const metres = BAR_METRES.find((m) => m * k <= room) ?? 0.5;
  return { metres, len: metres * k };
}

/** "SCALE", its value, a bar true to it and what the bar measures. */
function scaleBlock(scale: number, bar: { metres: number; len: number }, x: number): Block {
  const [label, value, end] = [lineHeight(3), lineHeight(5), lineHeight(2.8)];
  return {
    height: label + value + BAR_MM + 0.6 + end,
    draw: (top) => [
      text("SCALE", x, top - label / 2, 3, MUTED),
      text(`1:${scale}`, x, top - label - value / 2, 5, INK, "left", "bold"),
      ...barCells(x, top - label - value - BAR_MM, bar.len, BAR_MM),
      text(`0 — ${bar.metres} m`, x, top - label - value - BAR_MM - 0.6 - end / 2, 2.8, MUTED),
    ],
  };
}

/** A line across the column, then studio details, north and scale: in a row where there's room, as on the mockup, else the details above the rest. */
function footBlock(c: CoverColumn, xl: number, width: number): Block {
  const mark = c.north === null ? 0 : NORTH_MARK_MM + FOOT_GAP;
  const hasDetails = studioBlocks(c, xl, width).length > 0;
  const beside = hasDetails && width - mark - STUDIO_LEAST - FOOT_GAP >= SCALE_LEAST;
  const bar = barIn(c.scale, width - mark - (beside ? STUDIO_LEAST + FOOT_GAP : 0));
  const groupX = beside ? xl + width - mark - bar.len : xl;
  const scale = scaleBlock(c.scale, bar, groupX + mark);
  const studio = studioBlocks(c, xl, beside ? width - mark - bar.len - FOOT_GAP : width);
  const group = Math.max(scale.height, c.north === null ? 0 : NORTH_MARK_MM);
  const studioH = heightOf(studio);
  const above = hasDetails && !beside ? studioH + DETAILS_GAP : 0;
  const row = beside ? Math.max(studioH, group) : group;
  return {
    height: LINE_GAP + above + row,
    draw: (top) => {
      const rowTop = top - LINE_GAP - above;
      return [
        { kind: "segment", a: { x: xl, y: top }, b: { x: xl + width, y: top }, width: { px: 0.3 }, color: INK, cap: "butt" },
        ...stackDown(studio, beside ? rowTop - (row - studioH) / 2 : top - LINE_GAP),
        ...(c.north === null ? [] : northArrow({ x: groupX + NORTH_MARK_MM / 2, y: rowTop - row / 2 }, c.north)),
        ...scale.draw(rowTop - (row - scale.height) / 2),
      ];
    },
  };
}

const paddingOf = (box: Rect): number => Math.min(MOST_PAD, box.w * 0.1);

/** Where the column left room for the logo, at the top of its tint. */
export function coverLogo(box: Rect, logo: Logo): PageImage {
  const pad = paddingOf(box);
  return logoImage(logo, box.x + pad, box.y + box.h - pad, box.w - 2 * pad, LOGO_MM);
}

/** The tint and what's on it. The foot sits at the bottom, and the index takes what the rest leaves. */
export function coverColumn(box: Rect, c: CoverColumn): Primitive[] {
  const pad = paddingOf(box);
  const xl = box.x + pad;
  const width = box.w - 2 * pad;
  const name = c.projectName.trim() === "" ? "Untitled" : c.projectName;
  const head: Block[] = [...(c.logo ? [gap(logoSize(c.logo, width, LOGO_MM).h + LOGO_GAP)] : []), lines(["DRAWINGS"], xl, 3, MUTED), gap(3), titleBlock(name, xl, width), gap(3), dateBlock(c.date, xl, width, c.accent)];
  const foot = footBlock(c, xl, width);
  const label: Block[] = [gap(9), lines(["SHEET INDEX"], xl, 3, MUTED), gap(2)];
  const room = box.h - 2 * pad - heightOf(head) - heightOf(label) - foot.height - INDEX_CLEAR;
  const index: Block[] = c.index.length > 0 ? [...label, indexBlock(c.index, xl, width, room)] : [];
  return [{ kind: "polygon", points: rectangle(box), holes: [], color: COVER_TINT }, ...stackDown([...head, ...index], box.y + box.h - pad), ...stackUp([foot], box.y + pad)];
}
