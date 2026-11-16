import { MAX_SHEET_TEXT, PAPER_NAMES, SHEET_SCALES, drawingTitle, levelHeight, levelOf, levels, orderedStates, sectionLabel, sectionsOf, sheetDrawings, sheetSetNorth, sheetSetScale, sheetsOf, type Document, type Sheet } from "@fm/domain";
import { canCommit, visibleDoc } from "../document/open-document";
import type { ExportPage } from "../ports/effects";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import { memoLast } from "../view/memo";
import { PRESENTATION_STYLE, presentationStyle } from "../view/plan-style";
import type { SheetRow, SheetsView, ViewModel } from "../view/view-model-types";
import { unsupportedChars } from "./charset";
import { missingDrawings, missingSections, selectedSheet } from "./sheet-list";
import { PAPERS, SMALLEST_SCALE, paperSize } from "./paper";
import { OVERTAKEN_NOTE, type ReportDraft, type ReportDrafts } from "./report-draft";
import { reportStrings } from "./report-text";
import { draftPages, pageCountOf, pagesOf, sheetFitScale, sheetScale, sheetSet, showsPart, type SheetSet } from "./sheet";
import { paneChoices, scaleChoices, sheetOptions, sheetPanes, sheetShortcuts } from "./sheet-choices";

// The full-screen sheets view's model (sheetset.13–.15, .17, .21). It runs on every event, so nothing here draws a page:
// each row hands React a function that does, kept per document by `pagesOf`.

/** This viewer's choice for PNG and SVG of the plan, for the session (export.19); the PDF's finishes are each sheet's. */
export type ExportChoices = { finishes: "with" | "without" };

const ACCENTS = [
  { value: PRESENTATION_STYLE.accent, label: "Brick red" },
  { value: "#1d4ed8", label: "Blue" },
  { value: "#0f766e", label: "Teal" },
  { value: "#1d1d1f", label: "Black" },
]; // as on the mockup

const NO_WALLS = "Draw some walls first";
const NO_SHEETS = "Tick a sheet to save a PDF";
const CHARS_WARNING = "Some names use characters the PDF can't show";
const REPORT_CHARS_WARNING = "The report uses characters the PDF can't show";

export function exportAvailability(state: EditorState): { available: boolean; reason: string | null } {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc || Object.keys(doc.walls).length === 0) return { available: false, reason: NO_WALLS };
  return { available: true, reason: null };
}

/** Whether the view covers the plan. An undo of the last wall hides it, and a redo brings it back. */
export function sheetsViewShowing(state: EditorState): boolean {
  return state.exportOpen && exportAvailability(state).available;
}

/** The floating bar's Export button. Null with no drawing open. */
export function exportView(state: EditorState): ViewModel["export"] {
  return state.document ? exportAvailability(state) : null;
}

export function choicesOf(state: EditorState): ExportChoices {
  const id = state.document?.project.id;
  return (id !== undefined ? state.exportChoices[id] : undefined) ?? { finishes: "with" };
}

type SheetOptions = ReturnType<typeof sheetOptions>;


export function sheetsView(state: EditorState, host: Host): SheetsView | null {
  const d = state.document;
  if (!d || !sheetsViewShowing(state)) return null;
  const doc = visibleDoc(d);
  const { set, ...stored } = storedView(doc, d.project.name, host.today(), host);
  return { ...stored, sheets: withDrafts(doc, stored.sheets, state.reportDrafts, set), finishes: choicesOf(state).finishes, readOnly: !canCommit(d), selected: selectedSheet(state, doc) };
}

/** The last row drawn from each stored row's draft: the ViewModel runs on every event, and only a new draft should flow. */
const drafted = new WeakMap<SheetRow, { draft: ReportDraft; row: SheetRow }>();

function withDrafts(doc: Document, rows: readonly SheetRow[], drafts: ReportDrafts, set: SheetSet): readonly SheetRow[] {
  if (Object.keys(drafts).length === 0) return rows;
  return rows.map((row) => {
    const draft = drafts[row.id];
    if (!draft) return row;
    const known = drafted.get(row);
    if (known?.draft === draft) return known.row;
    const next = draftRow(doc, row, draft, set);
    drafted.set(row, { draft, row: next });
    return next;
  });
}

/**
 * A report's row as its draft would print: its pages and its count, with the set's total moved to match. Only this sheet's
 * page redraws per keystroke, so a later sheet's number catches up on leaving the box. Over the limit the page waits, which also keeps a huge paste from stalling the view.
 */
function draftRow(doc: Document, row: SheetRow, draft: ReportDraft, set: SheetSet): SheetRow {
  const sheet = sheetsOf(doc).find((s) => s.id === row.id);
  if (!sheet) return row;
  const over = draft.text.length - MAX_SHEET_TEXT;
  const shown = over > 0 ? sheet : { ...sheet, text: draft.text };
  const pageCount = pageCountOf(shown, set);
  const total = set.numbers.has(row.id) ? set.total - row.pageCount + pageCount : set.total;
  let pages: readonly ExportPage[] | null = null;
  return {
    ...row,
    text: draft.text,
    textNote: over > 0 ? `${over.toLocaleString("en-US")} characters over the ${MAX_SHEET_TEXT.toLocaleString("en-US")} a report holds: not saved, and the page waits` : draft.overtaken && draft.sent === null && !draft.held ? OVERTAKEN_NOTE : null,
    textHeld: draft.held && over <= 0,
    pageCount,
    pages: () => (pages ??= draftPages(doc, shown, { ...set, total })),
  };
}

/** Memoised, so an event that changes no drawing costs nothing and the rows stay the same objects. `_today` keys a date printed on the pages. */
const storedView = memoLast((doc: Document, projectName: string, _today: string, host: Host): Omit<SheetsView, "finishes" | "readOnly" | "selected"> & { set: SheetSet } => {
  const options = sheetOptions(doc, projectName, host);
  const set = sheetSet(doc, options);
  const sheets = sheetsOf(doc).map((sheet) => row(doc, sheet, set, options));
  const page = paperSize(set.paper, set.orientation);
  return {
    set,
    projectName,
    paper: set.paper,
    papers: PAPER_NAMES.map((p) => ({ value: p, label: PAPERS[p].label })),
    scale: options.scale === "fit" ? "" : String(options.scale),
    scales: [{ value: "", label: `Fit (1:${sheetFitScale(doc, set.paper) ?? SMALLEST_SCALE})` }, ...SHEET_SCALES.map((s) => ({ value: String(s), label: `1:${s}` }))],
    north: sheetSetNorth(doc),
    accent: presentationStyle(doc).accent,
    accents: ACCENTS,
    page: { widthMm: page.w, heightMm: page.h },
    status: statusOf(sheets),
    note: set.columnFull ? tooFull(doc, projectName, set, host) : null,
    warning: charsWarning(doc, projectName),
    canSave: set.numbers.size > 0,
    saveReason: set.numbers.size > 0 ? null : NO_SHEETS,
    sheets,
    missing: missingDrawings(doc),
    missingSections: missingSections(doc),
    canCompare: paneChoices(doc).length >= 2,
    sections: sectionsOf(doc).map((s) => ({ id: s.id, label: sectionLabel(s.id) })),
    layouts: orderedStates(doc).map((s) => ({ id: s.id, name: s.name })),
    levels: levels(doc).map((l) => ({ deck: l.deckIds[0] ?? null, label: l.deckIds.length === 0 ? l.name : `${l.name} ${levelHeight(l)}` })),
  };
});

/** A sheet's first drawing as the panel's choices name it: a level by its first deck, so sibling decks read as one (levels.02). */
function firstDrawing(doc: Document, sheet: Sheet): SheetRow["drawing"] {
  const [drawing] = sheetDrawings(sheet);
  return drawing ? { layout: drawing.layout, deck: levelOf(doc, drawing.deck).deckIds[0] ?? null } : null;
}

function row(doc: Document, sheet: Sheet, set: SheetSet, options: SheetOptions): SheetRow {
  return {
    id: sheet.id,
    number: set.numbers.get(sheet.id) ?? null,
    kind: sheet.kind,
    section: sheet.section,
    title: sheet.title,
    scale: sheet.kind === "report" ? null : sheetScale(sheet, set),
    ownScale: sheet.scale !== null,
    partOfPlan: showsPart(doc, sheet, set),
    inPdf: sheet.inPdf,
    drawing: firstDrawing(doc, sheet),
    panes: sheetPanes(doc, sheet),
    split: sheet.split,
    finishes: sheet.finishes,
    marks: sheet.marks,
    text: sheet.text,
    textNote: null,
    textHeld: false,
    size: sheet.size,
    centred: sheet.cx === 0 && sheet.cy === 0,
    scales: scaleChoices(doc, sheet, set),
    shortcuts: sheetShortcuts(doc, sheet, set, options),
    pageCount: pageCountOf(sheet, set),
    pages: () => pagesOf(doc, sheet, set),
  };
}

/** The chip counts what will print, so an unticked sheet's note waits for its tick. With nothing ticked, it has nothing to say: Save PDF's reason does. */
function statusOf(rows: readonly SheetRow[]): string {
  const printed = rows.filter((r) => r.inPdf);
  if (printed.length === 0) return "";
  const cropped = printed.filter((r) => r.partOfPlan);
  const part = cropped.length;
  const drawing = cropped.every((r) => r.kind === "plan" || r.kind === "compare") ? "the plan" : "the drawing"; // a section's isn't a plan
  const own = printed.filter((r) => r.ownScale).length;
  const parts = [...(part > 0 ? [`${part} ${part === 1 ? "shows" : "show"} part of ${drawing}`] : []), ...(own > 0 ? [`${own} with their own scale`] : [])];
  return parts.length > 0 ? parts.join(" · ") : "Whole plans on every sheet";
}

/** "Title block too full for A4; try A3" (sheetset.21): a note, as the page still saves, with the rooms table left out. Names every other paper whose sheets hold it all. */
function tooFull(doc: Document, projectName: string, set: SheetSet, host: Host): string {
  const scale = sheetSetScale(doc);
  const others = PAPER_NAMES.filter((p) => p !== set.paper && !sheetSet(doc, { projectName, paper: p, scale, host, finishes: true }).columnFull).map((p) => PAPERS[p].label);
  const label = PAPERS[set.paper].label;
  return others.length > 0 ? `Title block too full for ${label}; try ${others.join(" or ")}` : "Title block too full for any paper";
}

/** A report ticked to print is named apart, as "names" wouldn't send anyone to its text. */
function charsWarning(doc: Document, projectName: string): string | null {
  if (sheetNames(doc, projectName).some(unsupportedChars)) return CHARS_WARNING;
  const reports = sheetsOf(doc).filter((s) => s.kind === "report" && s.inPdf);
  return reports.some((s) => reportStrings(s.text).some(unsupportedChars)) ? REPORT_CHARS_WARNING : null;
}

/** The text a sheet prints from the drawing: the project, the sheets' titles, the rooms' labels and the project fields. */
function sheetNames(doc: Document, projectName: string): string[] {
  return [
    projectName,
    ...sheetsOf(doc).flatMap((s) => [s.title, ...(s.kind === "compare" || s.kind === "section" ? sheetDrawings(s).map((d) => drawingTitle(doc, d)) : [])]), // a pane prints its name
    ...Object.values(doc.zoneLabels).map((l) => l.name),
    // The notes' line breaks never reach the PDF: the sheet prints each line on its own.
    ...Object.values(doc.projectFields).flatMap((f) => f.value.split(/\r\n|\r|\n/)),
  ];
}
