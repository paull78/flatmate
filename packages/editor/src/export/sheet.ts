import { drawingTitle, levelOf, logoOf, orderedStates, sectionsOf, sheetDrawings, sheetSetIssueDate, sheetSetNorth, sheetSetPaper, sheetSetScale, sheetsOf, toMm, type Document, type PaperName, type Section, type Sheet } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import type { ExportPage } from "../ports/effects";
import type { Host } from "../ports/host";
import { memoLast } from "../view/memo";
import { drawnBounds, presentationStyle, type Bounds } from "../view/picture";
import type { Primitive } from "../view/scene-types";
import { sectionBounds } from "../view3d/section-picture";
import { COLUMN_FITS, SHORTEST_COLUMN, columnFits, columnLogo, columnPrimitives, type ColumnContent, type ColumnFit } from "./column";
import type { CoverColumn } from "./cover-column";
import { boundsCentre, fitScale, planFits } from "./fit";
import { chooseSplit, comparePage, paneFrame, type PaneSplit } from "./page-compare";
import { coverPage, coverParts } from "./page-cover";
import { blankPage, planPage, type PageParts } from "./page-plan";
import { reportFlow, reportPages } from "./page-report";
import { sectionPage } from "./page-section";
import { MARGIN_MM, PAPERS, SMALLEST_SCALE, columnMm, drawingArea, orientationFor, paperSize, type Orientation, type Size } from "./paper";
import { roomsTable, type RoomsTable } from "./rooms-table";

export { DISCLAIMER } from "./column";
import { toPage } from "./to-page";

export { toPage };

// The PDF as data (sheetset.08, .17, .19; export.24): a page per sheet In PDF and as many as a report needs, in paper millimetres with the origin at
// the bottom-left corner and y up, like the world and like PDF. Paper and orientation are the set's; scale and framing the
// sheet's. `sheetSet` works out what's the set's, `pagesOf` draws one sheet, kept per document for the sheets view.

export type SheetPage = ExportPage;
type SheetOptions = { projectName: string; paper: PaperName; scale: number | "fit"; host: Host; finishes: boolean }; // finishes: With (finishes.10)

/** What every page of a set shares. `columnFull`: the rooms table had to go, for the status to note (sheetset.21). */
export type SheetSet = {
  projectName: string;
  paper: PaperName;
  scale: number; // the general scale, for a sheet with none of its own
  orientation: Orientation;
  finishes: boolean;
  date: string;
  numbers: ReadonlyMap<string, number>; // by sheet ID: the sheets In PDF, in order; a report's first page, as each page counts (sheetset.05)
  total: number; // pages in the PDF
  columnFit: ColumnFit;
  columnFull: boolean;
};

function unionOf(boxes: readonly Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  return {
    min: { x: Math.min(...boxes.map((b) => b.min.x)), y: Math.min(...boxes.map((b) => b.min.y)) },
    max: { x: Math.max(...boxes.map((b) => b.max.x)), y: Math.max(...boxes.map((b) => b.max.y)) },
  };
}

/** What's drawn at the floor over every layout, so all pages share one scale and placement; a point at the origin when nothing is. */
export const sheetBounds = memoLast((doc: Document): { min: Point; max: Point } => {
  const layouts = orderedStates(doc).map((s) => s.id);
  return unionOf((layouts.length > 0 ? layouts : [null]).flatMap((id) => drawnBounds(doc, id) ?? [])) ?? { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
});

export function planSize(doc: Document): Size {
  const b = sheetBounds(doc);
  return { w: b.max.x - b.min.x, h: b.max.y - b.min.y };
}

/** Fit to page for this drawing on this paper (export.14), in the area left of the column. */
export function sheetFitScale(doc: Document, paper: PaperName): number | null {
  return fitScale(planSize(doc), paper);
}

export const sheetScale = (sheet: Sheet, set: Pick<SheetSet, "scale">): number => sheet.scale ?? set.scale;

/** "fit" is today's Fit for the whole drawing, or the smallest scale when it fits at none: nothing refuses a save (sheetset.17). */
const generalScale = (doc: Document, paper: PaperName, scale: number | "fit"): number => (scale === "fit" ? (sheetFitScale(doc, paper) ?? SMALLEST_SCALE) : scale);

/** The framing after a plan moved on paper by `mm`, y up, at `scale`: the centre goes against the plan, to the millimetre (sheetset.17). */
export function framedBy(framing: { cx: number; cy: number }, mm: { x: number; y: number }, scale: number): { cx: number; cy: number } {
  const metres = (at: number, by: number): number => toMm(at - (by * scale) / 1000) / 1000 + 0; // no -0 in a stored row
  return { cx: metres(framing.cx, mm.x), cy: metres(framing.cy, mm.y) };
}

/** The framing a framing drag let go on this sheet leaves. Zoom never reaches here: the shell's pixels are already millimetres. */
export function draggedFraming(doc: Document, sheet: Sheet, mm: { x: number; y: number }): { cx: number; cy: number } {
  return framedBy(sheet, mm, sheet.scale ?? generalScale(doc, sheetSetPaper(doc), sheetSetScale(doc)));
}

/**
 * The set's one orientation, from what each plan or compare sheet In PDF draws at its own scale, and never from its framing, so dragging a plan
 * can't turn the pages (export.24). A section sheet has no say, so adding one moves no other sheet (section.12).
 */
function setOrientation(doc: Document, paper: PaperName, general: number): Orientation {
  const onPaper = sheetsOf(doc).flatMap((sheet): Size[] => {
    const drawn = sheet.inPdf && sheet.kind !== "section" ? measuredBounds(doc, sheet) : null;
    if (!drawn) return [];
    const k = 1000 / sheetScale(sheet, { scale: general });
    return [{ w: (drawn.max.x - drawn.min.x) * k, h: (drawn.max.y - drawn.min.y) * k }];
  });
  return orientationFor({ w: Math.max(0, ...onPaper.map((s) => s.w)), h: Math.max(0, ...onPaper.map((s) => s.h)) }, paper);
}

/** A compare sheet would need a table per layout, so has none; nor has a section sheet, which isn't a plan. */
const NO_ROOMS: RoomsTable = { rows: [], total: null };

function pageParts(paper: PaperName, orientation: Orientation): PageParts {
  const page = paperSize(paper, orientation);
  const w = columnMm(paper);
  return { page, area: drawingArea(paper, orientation), column: { x: page.w - MARGIN_MM - w, y: MARGIN_MM, w, h: page.h - 2 * MARGIN_MM } };
}

function columnContent(doc: Document, sheet: Sheet, set: Omit<SheetSet, "columnFit" | "columnFull">, page = 0): ColumnContent {
  const drawn = sheet.kind !== "report";
  const first = set.numbers.get(sheet.id);
  return {
    projectName: set.projectName,
    fields: doc.projectFields,
    rooms: sheet.kind === "compare" || sheet.kind === "section" ? NO_ROOMS : roomsTable(doc, sheetDrawings(sheet)[0]?.layout ?? null),
    date: set.date,
    accent: presentationStyle(doc).accent,
    scale: drawn ? sheetScale(sheet, set) : null,
    north: drawn && sheet.kind !== "section" ? sheetSetNorth(doc) : null,
    paperLabel: PAPERS[set.paper].label,
    sheet: first === undefined ? null : first + page,
    sheets: set.total,
    logo: logoOf(doc),
  };
}

/** What the cover's column says. A set of one sheet has nothing to index and no number (sheet.29). */
function coverContent(doc: Document, sheet: Sheet, set: SheetSet): CoverColumn {
  const listed = set.numbers.size > 1 ? sheetsOf(doc).filter((s) => set.numbers.has(s.id)) : [];
  return {
    projectName: set.projectName,
    fields: doc.projectFields,
    logo: logoOf(doc),
    date: set.date,
    accent: presentationStyle(doc).accent,
    scale: sheetScale(sheet, set),
    north: sheetSetNorth(doc),
    index: listed.map((s) => ({ number: set.numbers.get(s.id) ?? 0, title: s.title })),
  };
}

/** How many pages a sheet prints, with nothing drawn: only a report's can pass one, and its flow is kept by row. */
export function pageCountOf(sheet: Sheet, set: Pick<SheetSet, "paper" | "orientation">): number {
  return sheet.kind === "report" ? reportFlow(sheet, drawingArea(set.paper, set.orientation)).pages.length : 1;
}

/** Each printed sheet's first number, and how many pages they make. */
function numbering(printed: readonly Sheet[], set: Pick<SheetSet, "paper" | "orientation">): { numbers: Map<string, number>; total: number } {
  const numbers = new Map<string, number>();
  let total = 0;
  for (const sheet of printed) {
    numbers.set(sheet.id, total + 1);
    total += pageCountOf(sheet, set);
  }
  return { numbers, total };
}

/** What a set's pages share. */
export function sheetSet(doc: Document, opts: SheetOptions): SheetSet {
  const scale = generalScale(doc, opts.paper, opts.scale);
  const orientation = setOrientation(doc, opts.paper, scale);
  const printed = sheetsOf(doc).filter((s) => s.inPdf);
  const shared = { projectName: opts.projectName, paper: opts.paper, scale, orientation, finishes: opts.finishes, date: sheetSetIssueDate(doc) ?? opts.host.today(), ...numbering(printed, { paper: opts.paper, orientation }) };
  // One layout for every page, the first fit every column holds, so pages flipped through stay alike (sheet.09).
  const { column } = pageParts(opts.paper, orientation);
  const contents = printed.filter((s) => s.kind !== "cover").map((s) => columnContent(doc, s, shared)); // a cover has no title block
  const columnFit = COLUMN_FITS.find((f) => contents.every((c) => columnFits(column, c, f))) ?? SHORTEST_COLUMN;
  return { ...shared, columnFit, columnFull: !columnFit.rooms };
}

/** The section a section sheet draws; null on any other sheet, and in a race with its delete. */
function sectionOf(doc: Document, sheet: Sheet): Section | null {
  return sheet.kind === "section" ? (sectionsOf(doc).find((s) => s.id === sheet.section) ?? null) : null;
}

/** The point at a centred frame's centre: the section's own, in metres along the cut and up, or the floor's whole drawing, so sheets of one project line up when flipped through (sheetset.24). */
function centredOn(doc: Document, sheet: Sheet): Point {
  const section = sectionOf(doc, sheet);
  return boundsCentre(section ? sectionBounds(doc, section) : sheetBounds(doc));
}

/** The point at a sheet's frame centre: where it centres plus its own framing. */
function framingOf(doc: Document, sheet: Sheet): Point {
  const centre = centredOn(doc, sheet);
  return { x: centre.x + sheet.cx, y: centre.y + sheet.cy };
}

/**
 * What the fit test measures on a sheet: what's drawn on a plan or cover, the union over a compare sheet's panes, which
 * leaves a pane just when one pane's drawing does, as they're one size at one framing, and a section's own bounds, the
 * same in every layout. Null on a report, with no drawing, so it can't turn the set's pages.
 */
function measuredBounds(doc: Document, sheet: Sheet): Bounds | null {
  if (sheet.kind === "report") return null;
  if (sheet.kind === "section") {
    const section = sectionOf(doc, sheet);
    return section && sectionBounds(doc, section);
  }
  return unionOf(sheetDrawings(sheet).flatMap((d) => drawnBounds(doc, d.layout, levelOf(doc, d.deck)) ?? []));
}

/** How a compare or section sheet's panes lie. Automatic reads only what's drawn, never the scale or framing, so a drag can't re-split it. */
function splitOf(doc: Document, sheet: Sheet, area: Size): PaneSplit {
  const drawn = measuredBounds(doc, sheet);
  return chooseSplit(sheet.split, drawn ? { w: drawn.max.x - drawn.min.x, h: drawn.max.y - drawn.min.y } : { w: 0, h: 0 }, area, sheetDrawings(sheet).length);
}

/** What a sheet's drawing must lie inside: the drawing area, a pane under its name, or a cover's left part. */
function fitFrame(doc: Document, sheet: Sheet, set: Pick<SheetSet, "paper" | "orientation">): Size {
  if (sheet.kind === "cover") return coverParts(paperSize(set.paper, set.orientation)).area;
  const area = drawingArea(set.paper, set.orientation);
  return sheet.kind === "compare" || sheet.kind === "section" ? paneFrame(area, sheetDrawings(sheet).length, splitOf(doc, sheet, area)) : area;
}

/** Whether a sheet shows only part of what's drawn: a note, never an error (sheetset.17). */
export function showsPart(doc: Document, sheet: Sheet, set: Pick<SheetSet, "paper" | "orientation" | "scale">): boolean {
  return !planFits({ drawn: measuredBounds(doc, sheet), scale: sheetScale(sheet, set), frameMm: fitFrame(doc, sheet, set), framing: framingOf(doc, sheet) });
}

/** What each sheet prints, for a reader with no pages to draw and no date to print (MCP): what the view's rows say. A number is null out of the PDF, a scale on a report. */
export function sheetFacts(doc: Document): { id: string; number: number | null; scale: number | null; pages: number; partOfPlan: boolean }[] {
  const paper = sheetSetPaper(doc);
  const scale = generalScale(doc, paper, sheetSetScale(doc));
  const set = { paper, scale, orientation: setOrientation(doc, paper, scale) };
  const { numbers } = numbering(sheetsOf(doc).filter((s) => s.inPdf), set);
  return sheetsOf(doc).map((sheet) => ({
    id: sheet.id,
    number: numbers.get(sheet.id) ?? null,
    scale: sheet.kind === "report" ? null : sheetScale(sheet, set),
    pages: pageCountOf(sheet, set),
    partOfPlan: showsPart(doc, sheet, set),
  }));
}

/**
 * Asks, for a sheet centred on this paper, whether a scale holds all of what's drawn: the scale grid's dots and the
 * shortcuts. Takes the paper's orientation as it stands, though a scale could turn the set's when sheets differ in
 * shape: drawn boxes all hold the walls, so they rarely do.
 */
export function centredFit(doc: Document, sheet: Sheet, set: Pick<SheetSet, "paper" | "orientation">): (scale: number) => boolean {
  const drawn = measuredBounds(doc, sheet);
  const frameMm = fitFrame(doc, sheet, set);
  const framing = centredOn(doc, sheet);
  return (scale) => planFits({ drawn, scale, frameMm, framing });
}

/** A sheet's pages, each with the logo in its column; a cover places its own. */
function drawSheet(doc: Document, sheet: Sheet, set: SheetSet): SheetPage[] {
  const parts = pageParts(set.paper, set.orientation);
  const pages = drawnPages(doc, sheet, set, parts);
  const logo = logoOf(doc);
  if (sheet.kind === "cover" || logo === null) return pages;
  const images = [columnLogo(parts.column, logo)];
  return pages.map((page) => ({ ...page, images }));
}

function drawnPages(doc: Document, sheet: Sheet, set: SheetSet, parts: PageParts): SheetPage[] {
  const titleBlock = (page = 0): Primitive[] => columnPrimitives(parts.column, columnContent(doc, sheet, set, page), set.columnFit);
  const drawings = sheetDrawings(sheet);
  const common = { title: sheet.title, scale: sheetScale(sheet, set), framing: framingOf(doc, sheet), finishes: set.finishes && sheet.finishes, marks: sheet.marks };
  switch (sheet.kind) {
    case "plan": {
      const [drawing] = drawings;
      if (!drawing) return [blankPage(parts, titleBlock())]; // I23 keeps this from a stored row
      return [planPage(doc, parts, { ...common, layout: drawing.layout, level: levelOf(doc, drawing.deck) }, titleBlock())];
    }
    case "compare": {
      if (drawings.length === 0) return [blankPage(parts, titleBlock())]; // as above
      const panes = drawings.map((d) => ({ layout: d.layout, level: levelOf(doc, d.deck), name: drawingTitle(doc, d) }));
      return [comparePage(doc, parts, { ...common, panes, split: splitOf(doc, sheet, parts.area) }, titleBlock())];
    }
    case "cover": {
      const [drawing] = drawings; // I23 keeps one on a stored row
      return [coverPage(doc, parts.page, { ...common, drawing: drawing ? { layout: drawing.layout, level: levelOf(doc, drawing.deck) } : null }, coverContent(doc, sheet, set))];
    }
    case "report":
      return reportPages(parts, reportFlow(sheet, parts.area), titleBlock);
    case "section": {
      const section = sectionOf(doc, sheet);
      if (!section || drawings.length === 0) return [blankPage(parts, titleBlock())]; // I23 keeps these from a stored row
      const panes = drawings.map((d) => ({ layout: d.layout, name: drawingTitle(doc, d) }));
      return [sectionPage(doc, parts, { section, panes, split: splitOf(doc, sheet, parts.area), title: common.title, scale: common.scale, framing: common.framing }, titleBlock())];
    }
    default:
      return assertNever(sheet.kind);
  }
}

const kept = new WeakMap<Document, Map<string, SheetPage[]>>();

/**
 * A sheet's pages, kept per document, as the view model rebuilds on every event and a single slot can't hold a list.
 * Read-only: thumbnails and the PDF share them. The sheet's own fields are in the document, so its ID keys it.
 */
export function pagesOf(doc: Document, sheet: Sheet, set: SheetSet): SheetPage[] {
  const key = JSON.stringify([sheet.id, set.projectName, set.paper, set.scale, set.orientation, set.finishes, set.date, set.numbers.get(sheet.id), set.numbers.size, set.total, set.columnFit]);
  const known = kept.get(doc)?.get(key);
  if (known) return known;
  const pages = drawSheet(doc, sheet, set);
  const forDoc = kept.get(doc) ?? new Map<string, SheetPage[]>();
  forDoc.set(key, pages);
  kept.set(doc, forDoc);
  return pages;
}

/** A report's pages from a draft, for the sheets view (sheetset.14). Not kept here, as the draft isn't in the document that keys them. */
export function draftPages(doc: Document, sheet: Sheet, set: SheetSet): SheetPage[] {
  return drawSheet(doc, sheet, set);
}

/** Every page of the PDF, in order, with what they share. */
export function sheetPages(doc: Document, opts: SheetOptions): SheetSet & { pages: SheetPage[] } {
  const set = sheetSet(doc, opts);
  return { ...set, pages: sheetsOf(doc).filter((s) => s.inPdf).flatMap((s) => pagesOf(doc, s, set)) };
}
