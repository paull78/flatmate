import { assertNever } from "@fm/protocol";
import { automaticSheets, cutName, drawingTitle, levelOf, orderedStates, sectionLabel, sectionSheetTitle, sectionsOf, sheetDrawings, sheetsOf, type Command, type Document, type Sheet, type SheetDrawing, type SheetKind } from "@fm/domain";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { UiAction } from "../ports/events";
import type { Host } from "../ports/host";
import { activeStateId, type EditorState, type Step } from "../state";
import { flushReportDrafts, leaveReport, typeReport } from "./report-writing";
import { draggedFraming } from "./sheet";
import { openingScale, paneChoices, sheetOptions, sheetPanes } from "./sheet-choices";

// The sheet list's and the right panel's actions (sheetset.13–.15): one command each, through the ordinary history, so each undoes as one step
// (AC-03). The selection is this viewer's and never stored, so it isn't undone, and a sheet that goes just moves it.

type ListUi = Extract<UiAction, { type: "selectSheet" | "addSheet" | "addMissingSheet" | "addMissingSection" | "duplicateSheet" | "deleteSheet" | "moveSheet" | "tickSheet" | "tickAllSheets" | "setSheet" | "renameSheet" | "setSheetDrawing" | "setSheetSection" | "toggleSheetPane" | "frameSheet" | "typeReport" | "leaveReport" }>;
type NewSheet = Omit<Extract<Command, { type: "addSheet" }>, "type" | "opId" | "after">;

const REPORT_TITLE = "Project report";
const REPORT_TEXT = "# Title\n\n## Heading\n\nWrite here.";

/** This viewer's sheet, or the first when it has gone, as when an undo takes it. */
export function selectedSheet(state: EditorState, doc: Document): string | null {
  const list = sheetsOf(doc);
  return list.find((s) => s.id === state.selectedSheet)?.id ?? list[0]?.id ?? null;
}

/**
 * What an automatic list would print that no sheet shows. An automatic list shows it all, so nothing's offered until
 * the first edit (AC-02), and a level with nothing of its own on it, which wouldn't print by itself, isn't either.
 */
export function missingDrawings(doc: Document): { layout: string; deck: string | null; title: string }[] {
  const shown = sheetsOf(doc).filter((s) => s.kind !== "section").flatMap(sheetDrawings); // a section sheet doesn't show the layout's plan
  return automaticSheets(doc)
    .flatMap(sheetDrawings)
    .filter((d) => !shown.some((s) => s.layout === d.layout && levelOf(doc, s.deck) === levelOf(doc, d.deck)))
    .map((d) => ({ layout: d.layout, deck: d.deck, title: drawingTitle(doc, d) }));
}

/** What no section sheet draws: offered in the view, on an automatic list too, as a project's automatic sheets stay plans (spec "On paper"). */
export function missingSections(doc: Document): { section: string; label: string }[] {
  const drawn = sheetsOf(doc).map((s) => s.section);
  return sectionsOf(doc)
    .filter((s) => !drawn.includes(s.id))
    .map((s) => ({ section: s.id, label: sectionLabel(s.id) }));
}

/** What a compare sheet is called until it's given a title: "Day, Night and Guests". */
function panesTitle(doc: Document, drawings: readonly SheetDrawing[]): string {
  const names = drawings.map((d) => drawingTitle(doc, d));
  return cutName([names.slice(0, -1).join(", "), ...names.slice(-1)].filter((n) => n !== "").join(" and "));
}

/** What a section sheet is called until it's given a title. */

/** A new section sheet: this section for the viewed layout, at the floor. */
function sectionDefaults(state: EditorState, section: string | null): NewSheet {
  const viewed = activeStateId(state);
  return { kind: "section", drawings: viewed === null ? [] : [{ layout: viewed, deck: null }], section, title: section === null ? "" : sectionSheetTitle(section) };
}

/** Adds it at the scale it opens at, after the selected sheet. */
function addOpening(state: EditorState, doc: Document, name: string, sheet: NewSheet, host: Host): Step {
  const scale = openingScale(doc, sheet.kind, sheet.drawings, sheetOptions(doc, name, host), sheet.section ?? null);
  return add(state, { ...sheet, scale }, selectedSheet(state, doc), host);
}

/** A new sheet's defaults: the viewed layout on a plan or a section sheet, the first layouts elsewhere, each at the floor. */
function defaults(state: EditorState, doc: Document, kind: SheetKind): NewSheet {
  const atFloor = (layout: string): SheetDrawing => ({ layout, deck: null });
  const [first, second] = orderedStates(doc).map((s) => atFloor(s.id));
  const viewed = activeStateId(state);
  const atViewed = viewed === null ? [] : [atFloor(viewed)];
  switch (kind) {
    case "plan":
      return plain(doc, kind, atViewed);
    case "compare": {
      const drawings = first && second ? [first, second] : paneChoices(doc).slice(0, 2); // a lone layout: its floor and its loft
      return { kind, drawings, title: panesTitle(doc, drawings) };
    }
    case "cover":
      return { ...plain(doc, kind, first ? [first] : []), first: true }; // a cover belongs at the front (sheetset.70)
    case "report":
      return { kind, drawings: [], title: REPORT_TITLE, text: REPORT_TEXT };
    case "section": // with no section, the domain refuses it: the menu offers it off
      return sectionDefaults(state, sectionsOf(doc)[0]?.id ?? null);
    default:
      return assertNever(kind);
  }
}

/** What a sheet showing one drawing is called until it's given a title. A cover's differs from its plan's, or the index would read "Day" twice (sheetset.67). */
function plainTitle(doc: Document, kind: SheetKind, drawing: SheetDrawing): string {
  return kind === "cover" ? cutName(`${drawingTitle(doc, drawing)} cover`) : drawingTitle(doc, drawing);
}

function plain(doc: Document, kind: SheetKind, drawings: readonly SheetDrawing[]): NewSheet {
  const [drawing] = drawings;
  return { kind, drawings, title: drawing ? plainTitle(doc, kind, drawing) : "" };
}

/** Adds after `after` and selects the new sheet; a refusal leaves the selection. */
function add(state: EditorState, sheet: NewSheet, after: string | null, host: Host): Step {
  const opId = host.newId();
  const { state: next, effects, committed } = runCommand(state, { type: "addSheet", opId, after, ...sheet }, host);
  return { state: committed === null ? next : { ...next, selectedSheet: `${opId}/t0` }, effects };
}

function copyOf(s: Sheet): NewSheet {
  return { kind: s.kind, inPdf: s.inPdf, scale: s.scale, split: s.split, cx: s.cx, cy: s.cy, finishes: s.finishes, marks: s.marks, text: s.text, size: s.size, section: s.section, drawings: sheetDrawings(s), title: cutName(`${s.title} copy`) };
}

function remove(state: EditorState, doc: Document, id: string, host: Host): Step {
  const list = sheetsOf(doc);
  const at = list.findIndex((s) => s.id === id);
  const { state: next, effects, committed } = runCommand(state, { type: "deleteSheet", sheetId: id }, host);
  if (committed === null || selectedSheet(state, doc) !== id) return { state: next, effects };
  return { state: { ...next, selectedSheet: (list[at + 1] ?? list[at - 1])?.id ?? null }, effects };
}

function command(state: EditorState, cmd: Command, host: Host): Step {
  const { state: next, effects } = runCommand(state, cmd, host);
  return { state: next, effects };
}

/** Layout and Level. A title still naming its drawing follows it, or a sheet of Night would print "DAY"; one the user typed stays. */
function setDrawing(state: EditorState, doc: Document, sheet: Sheet, drawing: SheetDrawing, host: Host): Step {
  const [was] = sheetDrawings(sheet);
  const title = was && sheet.title === plainTitle(doc, sheet.kind, was) ? { title: plainTitle(doc, sheet.kind, drawing) } : {};
  return command(state, { type: "setSheet", sheetId: sheet.id, drawings: [drawing], ...title }, host);
}

/** Which section it draws. A title still naming the section follows it, as `setDrawing`'s does. */
function setSheetSection(state: EditorState, sheet: Sheet, section: string, host: Host): Step {
  const title = sheet.section !== null && sheet.title === sectionSheetTitle(sheet.section) ? { title: sectionSheetTitle(section) } : {};
  return command(state, { type: "setSheet", sheetId: sheet.id, section, ...title }, host);
}

/** A compare or section sheet's check, in the choices' order. A locked one does nothing, and a title still naming the panes follows them, as `setDrawing`'s does. */
function togglePane(state: EditorState, doc: Document, sheet: Sheet, pane: SheetDrawing, host: Host): Step {
  const panes = sheetPanes(doc, sheet);
  const toggled = panes.find((p) => p.layout === pane.layout && p.deck === pane.deck);
  if (!toggled || toggled.locked) return { state, effects: [] };
  const drawings = panes.filter((p) => (p === toggled ? !p.on : p.on)).map(({ layout, deck }) => ({ layout, deck }));
  const title = sheet.title === panesTitle(doc, sheetDrawings(sheet)) ? { title: panesTitle(doc, drawings) } : {};
  return command(state, { type: "setSheet", sheetId: sheet.id, drawings, ...title }, host);
}

export function onSheetListUi(state: EditorState, action: ListUi, host: Host): Step {
  if (!state.document) return { state, effects: [] };
  const doc = visibleDoc(state.document);
  switch (action.type) {
    case "selectSheet": {
      const { state: next, effects } = flushReportDrafts(state, host);
      return { state: { ...next, selectedSheet: action.id }, effects };
    }
    case "typeReport":
      return { state: typeReport(state, action.id, action.text), effects: [] };
    case "leaveReport":
      return leaveReport(state, action.id, host);
    case "addSheet":
      return addOpening(state, doc, state.document.project.name, defaults(state, doc, action.kind), host);
    case "addMissingSection":
      return addOpening(state, doc, state.document.project.name, sectionDefaults(state, action.section), host);
    case "addMissingSheet": {
      const drawing: SheetDrawing = { layout: action.layout, deck: action.deck };
      return add(state, plain(doc, "plan", [drawing]), selectedSheet(state, doc), host);
    }
    case "duplicateSheet": {
      const source = sheetsOf(doc).find((s) => s.id === action.id);
      return source ? add(state, copyOf(source), source.id, host) : { state, effects: [] };
    }
    case "deleteSheet":
      return remove(state, doc, action.id, host);
    case "moveSheet":
      return command(state, { type: "moveSheet", sheetId: action.id, index: action.index }, host);
    case "tickSheet":
      return command(state, { type: "setSheet", sheetId: action.id, inPdf: action.on }, host);
    case "tickAllSheets":
      return command(state, { type: "setSheetsInPdf", on: action.on }, host);
    case "setSheet":
      return command(state, { type: "setSheet", sheetId: action.id, ...action.fields }, host);
    case "renameSheet": {
      const title = cutName(action.title.trim());
      return title === "" ? { state, effects: [] } : command(state, { type: "setSheet", sheetId: action.id, title }, host); // a blank row couldn't be told from another
    }
    case "setSheetDrawing": {
      const sheet = sheetsOf(doc).find((s) => s.id === action.id);
      return sheet ? setDrawing(state, doc, sheet, { layout: action.layout, deck: action.deck }, host) : { state, effects: [] };
    }
    case "setSheetSection": {
      const sheet = sheetsOf(doc).find((s) => s.id === action.id);
      return sheet ? setSheetSection(state, sheet, action.section, host) : { state, effects: [] };
    }
    case "toggleSheetPane": {
      const sheet = sheetsOf(doc).find((s) => s.id === action.id);
      return sheet ? togglePane(state, doc, sheet, { layout: action.layout, deck: action.deck }, host) : { state, effects: [] };
    }
    case "frameSheet": {
      const sheet = sheetsOf(doc).find((s) => s.id === action.id);
      return sheet ? command(state, { type: "setSheet", sheetId: sheet.id, ...draggedFraming(doc, sheet, { x: action.dxMm, y: action.dyMm }) }, host) : { state, effects: [] };
    }
    default:
      return assertNever(action);
  }
}
