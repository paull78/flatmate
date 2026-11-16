import { assertNever } from "@fm/protocol";
import { runCommand } from "../commit";
import type { UiAction } from "../ports/events";
import type { ExportContent, ExportPage, ImageHandle } from "../ports/effects";
import type { Host } from "../ports/host";
import { visibleDoc } from "../document/open-document";
import { planView } from "../levels";
import type { EditorState, Step } from "../state";
import { markedBounds, pictureLayers, planPicture, presentationStyle } from "../view/picture";
import type { PlanView } from "../view/plan-view";
import type { Document } from "@fm/domain";
import { closeSheetsView } from "./report-writing";
import { sheetPages } from "./sheet";
import { sheetOptions } from "./sheet-choices";
import { choicesOf, exportAvailability, type ExportChoices } from "./sheets-view";
import { toPage } from "./to-page";

// What Export does (export.04, .18, .19; sheetset.13): opens and closes the sheets view, saves the PDF of its sheets and,
// from its small menu, PNG and SVG of the plan in view. Saving leaves the view open, as there's often more to do in it.

const FINISHES = ["with", "without"] as const; // the floors layer on PNG and SVG (finishes.10)
const SVG_ZOOM = 10; // drawing units per metre: one SVG unit is a paper millimetre at 1:100 (spec "Images")
const PNG_LONG_SIDE = 3000; // pixels (spec "Images")

type ExportUi = Extract<UiAction, { type: "openExport" | "openSheet" | "closeExport" | "setExport" | "download" | "setSheetSetting" }>;

export function onExportUi(state: EditorState, action: ExportUi, host: Host): Step {
  switch (action.type) {
    case "openExport":
      return { state: { ...state, exportOpen: exportAvailability(state).available }, effects: [] };
    case "openSheet":
      return { state: { ...state, exportOpen: exportAvailability(state).available, selectedSheet: action.id }, effects: [] };
    case "closeExport":
      return closeSheetsView(state, host);
    case "setExport":
      return { state: setFinishes(state, action.value), effects: [] };
    case "download":
      return download(state, action.format, host);
    case "setSheetSetting": {
      const { state: next, effects } = runCommand(state, { type: "setProjectField", key: action.key, value: action.value }, host);
      return { state: next, effects };
    }
    default:
      return assertNever(action);
  }
}

/** The project name as a file name: characters files can't hold become "-"; an empty name is "Untitled". */
export function exportFileName(projectName: string, extension: string): string {
  const base = projectName.trim().replace(/[/\\:*?"<>|]/g, "-");
  return `${base === "" ? "Untitled" : base}.${extension}`;
}

/** The SVG's picture as a page: millimetres at 1:100, origin at the frame's bottom-left corner. */
function svgContentPage(doc: Document, view: PlanView, finishes: boolean): ExportPage {
  const { primitives, frame } = svgContent(doc, view, finishes);
  const k = frame.zoom;
  return {
    widthMm: (frame.max.x - frame.min.x) * k,
    heightMm: (frame.max.y - frame.min.y) * k,
    primitives: primitives.map((p) => toPage(p, k, -frame.min.x * k, -frame.min.y * k)),
  };
}

/** The view's picture, framed as the layout is at the floor, so the images of two levels line up. */
function svgContent(doc: Document, view: PlanView, finishes: boolean): Extract<ExportContent, { kind: "svg" }> {
  return {
    kind: "svg",
    primitives: pictureLayers(planPicture(doc, view, presentationStyle(doc), SVG_ZOOM, finishes)),
    frame: { ...markedBounds(doc, view.layout), zoom: SVG_ZOOM },
  };
}

function setFinishes(state: EditorState, value: string): EditorState {
  const id = state.document?.project.id;
  const finishes = FINISHES.find((f) => f === value);
  if (id === undefined || finishes === undefined) return state;
  const next: ExportChoices = { finishes };
  return { ...state, exportChoices: { ...state.exportChoices, [id]: next } };
}

function download(state: EditorState, format: "pdf" | "png" | "svg", host: Host): Step {
  const d = state.document;
  if (!d || !exportAvailability(state).available) return { state, effects: [] };
  const doc = visibleDoc(d);
  const name = d.project.name;
  if (format === "pdf") {
    const { pages } = sheetPages(doc, sheetOptions(doc, name, host));
    if (pages.length === 0) return { state, effects: [] }; // every sheet unticked: the button says so
    return { state, effects: [{ type: "saveFile", name: exportFileName(name, "pdf"), content: { kind: "pdf", pages } }] };
  }
  const view = planView(state);
  if (!view) return { state, effects: [] };
  const finishes = choicesOf(state).finishes === "with";
  if (format === "svg") return { state, effects: [{ type: "saveFile", name: exportFileName(name, "svg"), content: svgContent(doc, view, finishes) }] };
  // The SVG's picture as a page at 1:100, rasterised by the shell to 3,000 px on its long side (export.18).
  const page = svgContentPage(doc, view, finishes);
  const scale = PNG_LONG_SIDE / Math.max(page.widthMm, page.heightMm);
  const requestId = host.newId();
  return {
    state: { ...state, exportPending: { requestId, name: exportFileName(name, "png") } },
    effects: [{ type: "rasterise", requestId, page, size: { w: Math.round(page.widthMm * scale), h: Math.round(page.heightMm * scale) } }],
  };
}

/** The shell's raster for the pending PNG: saved once; a stale or repeated answer is ignored. */
export function onRasterised(state: EditorState, requestId: string, image: ImageHandle): Step {
  const pending = state.exportPending;
  if (pending === null || pending.requestId !== requestId) return { state, effects: [] };
  return { state: { ...state, exportPending: null }, effects: [{ type: "saveFile", name: pending.name, content: { kind: "image", image } }] };
}
