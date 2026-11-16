import { PAPER_NAMES, SHEET_SCALES, drawingTitle, flatDrawings, levelOf, levels, orderedStates, sheetDrawings, sheetSetPaper, sheetSetScale, type Document, type PaperName, type Sheet, type SheetDrawing, type SheetKind } from "@fm/domain";
import type { Host } from "../ports/host";
import type { SheetRow } from "../view/view-model-types";
import { PAPERS } from "./paper";
import { centredFit, sheetScale, sheetSet, showsPart, type SheetSet } from "./sheet";

// What the panel and the note offer for a sheet (sheetset.15, .17): the scale grid's neutral dots, and the shortcuts under a
// page showing part of the plan. All optional, and none of it stops anything. Pure.

type Options = Parameters<typeof sheetSet>[1];

/** What the stored settings ask of the PDF. Finishes are on here, and each sheet's own switch decides. */
export function sheetOptions(doc: Document, projectName: string, host: Host) {
  return { projectName, paper: sheetSetPaper(doc), scale: sheetSetScale(doc), host, finishes: true };
}

const area = (paper: PaperName): number => PAPERS[paper].w * PAPERS[paper].h;

const MIN_PANES = 2;
const MIN_SECTION_PANES = 1;
const MAX_PANES = 4;

/** What a compare sheet can show: each layout at the floor and at each loft, as the automatic list orders them, a level by its first deck. */
export function paneChoices(doc: Document): SheetDrawing[] {
  return orderedStates(doc).flatMap((state) => levels(doc).map((level) => ({ layout: state.id, deck: level.deckIds[0] ?? null })));
}

/** What a section sheet can show: each layout, as a section isn't cut per level (section.10). */
const layoutChoices = (doc: Document): SheetDrawing[] => orderedStates(doc).map((state) => ({ layout: state.id, deck: null }));

/** A compare sheet's checks and a section sheet's; none on any other sheet. `locked` would leave it under its least or over 4. */
export function sheetPanes(doc: Document, sheet: Sheet): SheetRow["panes"] {
  if (sheet.kind !== "compare" && sheet.kind !== "section") return [];
  const shown = sheetDrawings(sheet);
  const isOn = (c: SheetDrawing): boolean => shown.some((d) => d.layout === c.layout && levelOf(doc, d.deck) === levelOf(doc, c.deck));
  const choices = sheet.kind === "section" ? layoutChoices(doc) : paneChoices(doc);
  const least = sheet.kind === "section" ? MIN_SECTION_PANES : MIN_PANES;
  const count = choices.filter(isOn).length;
  return choices.map((c) => {
    const on = isOn(c);
    return { ...c, title: drawingTitle(doc, c), on, locked: on ? count <= least : count >= MAX_PANES };
  });
}

/** The grid, General first. A report has no scale, so no grid. */
export function scaleChoices(doc: Document, sheet: Sheet, set: SheetSet): SheetRow["scales"] {
  if (sheet.kind === "report") return [];
  const fits = centredFit(doc, sheet, set);
  return [{ scale: null, label: "General", nofit: !fits(set.scale) }, ...SHEET_SCALES.map((scale) => ({ scale, label: `1:${scale}`, nofit: !fits(scale) }))];
}

/** A new cover's, compare's or section sheet's own scale, the largest showing it whole, when General would cut it (sheetset.65); null follows General, as when none does. */
export function openingScale(doc: Document, kind: SheetKind, drawings: readonly SheetDrawing[], options: Options, section: string | null = null): number | null {
  if ((kind !== "cover" && kind !== "compare" && kind !== "section") || drawings.length === 0) return null;
  const sheet: Sheet = { id: "new", kind, order: 0, inPdf: true, title: "", scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings(drawings), text: "", size: "normal", section };
  const set = sheetSet(doc, options);
  const fits = centredFit(doc, sheet, set);
  return fits(set.scale) ? null : SHEET_SCALES.find(fits) ?? null;
}

/** The next paper up holding the whole plan centred, at the scale the sheet would have there: a sheet following Fit changes with the paper. */
function largerPaper(doc: Document, sheet: Sheet, set: SheetSet, options: Options): PaperName | null {
  const larger = PAPER_NAMES.filter((p) => area(p) > area(set.paper)).sort((a, b) => area(a) - area(b));
  return larger.find((paper) => {
    const there = sheetSet(doc, { ...options, paper });
    return centredFit(doc, sheet, there)(sheetScale(sheet, there));
  }) ?? null;
}

/** Null while the whole plan shows. "Centre it" alone when that's enough; else a smaller scale and a larger paper, each if there's one. */
export function sheetShortcuts(doc: Document, sheet: Sheet, set: SheetSet, options: Options): SheetRow["shortcuts"] {
  if (!showsPart(doc, sheet, set)) return null;
  const fits = centredFit(doc, sheet, set);
  if (fits(sheetScale(sheet, set))) return { centre: true, fit: null, paper: null };
  return { centre: false, fit: SHEET_SCALES.find(fits) ?? null, paper: largerPaper(doc, sheet, set, options) };
}
