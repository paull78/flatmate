import { underPointerView } from "./under-pointer-view";
import { DECK_PRESETS, DEFAULT_DECK_SIZE, SURROUNDINGS_VALUES, deckViews, roofOf, MOTIFS, isDeckPreset, levelHeight, levels, orderedStates, sectionsOf, shown, surroundingsOf, wallChain } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { projectCards } from "./cards";
import { canCommit, isDirty, status, visibleDoc } from "../document/open-document";
import { canRedo, canUndo } from "../history/history";
import type { Host } from "../ports/host";
import { typingValue } from "../keys";
import { typedLine } from "../typed-value";
import { gridSpacingFor } from "../snapping/snap";
import { activeStateId, viewedLevel, viewedLevelOn, type EditorState } from "../state";
import { CLICKED_HOLE } from "../tools/hole-draft";
import { exportView, sheetsView } from "../export/sheets-view";
import { roomsTable } from "../export/rooms-table";
import { FLOOR_TILES, PALETTE } from "./palette";
import { planView } from "../levels";
import type { PlanView } from "./plan-view";
import { ceilingFields } from "../properties/ceiling";
import { openFinishId, withOpenFinish } from "../properties/open-finish";
import { outsideFields } from "../properties/outside";
import { OPENING_CHOICES } from "../properties/opening";
import { projectFields } from "../properties/project";
import { trailerFields } from "../properties/trailer";
import { properties } from "../properties/view";
import { hasUnderlay } from "../tools/scale-tool";
import { SECTION_PROMPTS } from "../tools/section-tool";
import { sizeFieldsView, sizePickerView } from "../tools/armed-size";
import { TOOLS, toolEntry } from "../tools/tool-table";
import { logoSection } from "../logo";
import { underlaySection } from "../underlay";
import type { DimensionToolState, ScaleToolState } from "../tools/types";
import { COLUMN_PRESETS, SNAP_STEPS } from "../types";
import type { Field, ViewModel } from "./view-model-types";
import { cursorFor } from "./cursor";
import { sceneDocument } from "./scene";
import { sectionStripView } from "./section-strip";
import { stairChips, stairHint } from "./stair-hint";
import { warningRows } from "./warnings";
import { framesView } from "../frames-state";

export type { Field, ViewModel, WarningRow } from "./view-model-types";

const SHORTCUTS: ViewModel["shortcuts"] = [
  ...TOOLS.map((t) => ({ label: t.label, key: t.key })),
  // Neutral key names: the shell draws them for its platform (cleanup.09).
  { label: "Undo", key: "Mod+Z" },
  { label: "Delete", key: "Delete" },
];

// The opening kinds in the order the domain's table gives them: the floating bar's choices and Properties' kind field.

// The Deck tool's presets in the domain's table order: the floating bar's Platform | Loft (decks.06).
const DECK_CHOICES: ViewModel["deckPresets"] = Object.keys(DECK_PRESETS).filter(isDeckPreset).map((preset) => ({ preset, label: DECK_PRESETS[preset].name }));

// The Column tool's presets (pillars.12), square, labelled by their side in centimetres.
const COLUMN_CHOICES: ViewModel["columnSizes"] = COLUMN_PRESETS.map((s) => ({ width: shown(s.width), depth: shown(s.depth), label: String(Math.round(s.width * 100)) }));

const BAR_TOOLS: ViewModel["tools"] = TOOLS.map(({ tool, label, key }) => ({ tool, label, key }));
/** With no deck in the drawing, the Hole tool has nothing to cut (smalls.12). */
const NO_DECK_TOOLS: ViewModel["tools"] = BAR_TOOLS.map((t) => (t.tool === "hole" ? { ...t, disabled: true } : t));
// The floating bar's snap steps (direct.14): Auto, then the fixed steps as bare centimetre numbers, so the bar fits one
// row at 1280 px wide; the shell shows the unit in each button's title.
const SNAP_CHOICES: ViewModel["snapSteps"] = SNAP_STEPS.map((step) => ({ step, label: step === "auto" ? "Auto" : String(Math.round(step * 100)) }));

export function buildViewModel(state: EditorState, host: Host): ViewModel {
  const d = state.document;
  const bar: ViewModel["commandBar"] = { ...commandLine(state), chips: stairChips(state) };
  const tool = toolEntry(state.tool.name);
  const strip = sectionStripView(d ? visibleDoc(d) : null, state.stripSection, activeStateId(state));
  return {
    activeTool: state.tool.name,
    commandBar: bar,
    typing: typingValue(state),
    properties: openFinishIn(properties(state), openFinishId(state)), // which finish row is open (inherit step 04)
    cursor: cursorFor(state),
    snap: state.snap && state.snap.kind !== "none" ? { kind: state.snap.kind, at: state.snap.point } : null,
    presence: Object.values(state.presence).map((p) => ({ clientId: p.clientId, name: p.name, color: p.color, at: p.cursor })),
    project: d ? { name: d.project.name, status: status(d), dirty: isDirty(d), canEdit: canCommit(d) } : null,
    projectList: d ? null : { items: projectCards(state), loading: state.workspace.loading, error: state.workspace.error, order: state.workspace.order },
    toast: state.toast && state.toast.until > host.now() ? state.toast.text : null,
    canUndo: d !== null && canCommit(d) && canUndo(state.undo),
    canRedo: d !== null && canCommit(d) && canRedo(state.undo),
    wallThickness: shown(state.wallThickness),
    states: stateList(state),
    warnings: { rows: shownRows(state), blink: state.warningBlink },
    objectKind: state.objectSet ?? state.objectKind,
    sizePicker: sizePickerView(state),
    sizeFields: sizeFieldsView(state),
    openingKind: state.openingKind,
    openingKinds: OPENING_CHOICES,
    deckPreset: state.deckPreset,
    deckPresets: DECK_CHOICES,
    columnSize: { width: shown(state.columnSize.width), depth: shown(state.columnSize.depth) },
    columnSizes: COLUMN_CHOICES,
    palette: PALETTE,
    toolHelp: { tool: tool.tool, label: tool.label, key: tool.key, hint: bar.prompt },
    shortcuts: SHORTCUTS,
    tools: state.document && deckViews(visibleDoc(state.document)).length > 0 ? BAR_TOOLS : NO_DECK_TOOLS,
    gridStep: gridSpacingFor(state.camera.zoom),
    cut: chipCut(planView(state)),
    levels: levelRows(state),
    snapStep: state.snapSettings.step,
    snapSteps: SNAP_CHOICES,
    export: exportView(state),
    sheetsView: sheetsView(state, host),
    projectFields: projectFields(state),
    ceiling: (() => { const c = ceilingFields(state); return c === null ? null : withOpenFinish(c, openFinishId(state)); })(),
    outside: (() => { const o = outsideFields(state); return o === null ? null : withOpenFinish(o, openFinishId(state)); })(),
    trailer: trailerFields(state),
    view3d: view3dPanel(state),
    sectionStrip: strip,
    sectionMarks: d && sectionsOf(visibleDoc(d)).length > 0 ? state.sectionMarksOn : null,
    frames: framesView(state.frames, strip !== null, state.document !== null && state.view3d.open && state.view3d.size === "split"),
    underlay: underlaySection(state),
    underPointer: underPointerView(state),
    logo: logoSection(state),
    rooms: roomsView(state),
    floors: { on: state.finishesOn, tiles: FLOOR_TILES, armed: state.tool.name === "zone" ? state.tool.state.motif : null },
  };
}

/** The warnings of the document the scene draws: during a drag the preview's, so the count agrees with the marks (clarity.12). */
function shownRows(state: EditorState): ViewModel["warnings"]["rows"] {
  const doc = sceneDocument(state);
  const view = planView(state);
  return doc && view ? warningRows(doc, view) : [];
}

/** The cut chip: the plan view's cut, "Cut +1.20", rounded like the strip's heights; none without a document. */
function chipCut(view: PlanView | null): string | null {
  return view ? `Cut +${shown(view.cut)}` : null;
}

/** The level strip (levels.10): every level, highest first, the viewed one marked; none with only the floor level. */
function levelRows(state: EditorState): ViewModel["levels"] {
  const viewed = viewedLevel(state);
  if (!state.document || !viewed) return null;
  const all = levels(visibleDoc(state.document));
  if (all.length < 2) return null;
  const rows = all.map((l) => ({ deck: l.deckIds[0] ?? null, height: levelHeight(l), name: l.name, viewed: l.height === viewed.height }));
  return { rows: rows.reverse() };
}

/** A stepper click (ux-polish item 6): the field's value plus or minus one step, at the step's precision. */
export function steppedValue(f: Field, direction: 1 | -1): string {
  if (f.step === undefined) return f.value;
  const decimals = f.step >= 1 ? 0 : Math.ceil(-Math.log10(f.step) - 1e-9);
  return (Number(f.value) + direction * f.step).toFixed(decimals);
}

/** The hint line's prompt and typed value; its chips are the stair's fixes (stairdraw.13). */
type Line = Omit<ViewModel["commandBar"], "chips">;

function commandLine(state: EditorState): Line {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      switch (tool.state.kind) {
        case "idle":
          return { prompt: "First point", value: "", unit: "m" };
        case "drawing":
          return { prompt: "Next point or length", ...typedLine(tool.state.value) };
        case "paused":
          return { prompt: "Waiting for server", value: "", unit: null };
        default:
          return assertNever(tool.state);
      }
    case "select":
      if (tool.state.kind === "editingGap") return { prompt: "Distance to the deck's edge", ...typedLine(tool.state.value) };
      if (tool.state.kind === "moving" && tool.state.value) return { prompt: "Distance to move", ...typedLine(tool.state.value) };
      if (tool.state.kind === "splitting") return { prompt: "Click the wall to split it, or type the distance from the face's start", ...typedLine(tool.state.value) };
      return tool.state.kind === "editingHelper"
        ? { prompt: helperPrompt(state, tool.state.wallId, tool.state.piece), ...typedLine(tool.state.value) }
        : { prompt: "Select", value: "", unit: null };
    case "zone": // the Floor mode names its motif (finishes.19)
      return { prompt: tool.state.motif === null ? "Click a room to name it · drag to name part of it" : `Click a floor to lay ${MOTIFS[tool.state.motif].name}`, value: "", unit: null };
    case "object":
      if (state.objectSet !== null) return { prompt: "Click inside a room to place the set, R to turn it", value: "", unit: null }; // a set has one size
      if (tool.state.pressing?.corner && tool.state.ghost?.drawn) return { prompt: "Release to place · R to turn", value: "", unit: null }; // sizing.07
      return { prompt: stairHint(state, tool.state) ?? "Click inside a room to place, or drag to draw its footprint", value: "", unit: null };
    case "opening":
      return { prompt: "Click on a wall to place", value: "", unit: null };
    case "dimension":
      return { prompt: dimensionPrompt(tool.state), value: "", unit: null };
    case "column":
      return { prompt: "Click to place a column", value: "", unit: null };
    case "deck":
      return { prompt: `Drag a deck · click for ${shown(DEFAULT_DECK_SIZE.w)} × ${shown(DEFAULT_DECK_SIZE.d)}`, value: "", unit: null };
    case "hole":
      return { prompt: `Drag a hole in a deck · click for ${shown(CLICKED_HOLE)} × ${shown(CLICKED_HOLE)}`, value: "", unit: null };
    case "section":
      return { prompt: SECTION_PROMPTS[tool.state.kind], value: "", unit: null };
    case "scale":
      return scaleBar(state, tool.state);
    default:
      return assertNever(tool);
  }
}

function dimensionPrompt(t: DimensionToolState): string {
  switch (t.kind) {
    case "idle":
      return "Click the first point";
    case "second":
      return "Click the second point";
    case "offset":
      return "Click to place the dimension";
    default:
      return assertNever(t);
  }
}

function scaleBar(state: EditorState, t: ScaleToolState): Line {
  switch (t.kind) {
    case "idle":
      return { prompt: hasUnderlay(state) ? "Click the first point on the picture" : "Choose a picture first", value: "", unit: null };
    case "second":
      return { prompt: "Click the second point", value: "", unit: null };
    case "typing":
      return { prompt: "Real distance between the points", ...typedLine(t.value) };
    default:
      return assertNever(t);
  }
}

/** What the helper value field edits: the wall length, or a chain piece (an opening's width or a distance). */
function helperPrompt(state: EditorState, wallId: string, piece: number | undefined): string {
  if (piece === undefined) return "Wall length";
  const doc = state.document ? visibleDoc(state.document) : null;
  const p = doc ? wallChain(doc, wallId, viewedLevelOn(state, doc))?.pieces[piece] : undefined;
  return p?.role === "opening" ? "Opening width" : "Distance";
}

function stateList(state: EditorState): ViewModel["states"] {
  if (!state.document) return [];
  const active = activeStateId(state);
  return orderedStates(visibleDoc(state.document)).map((s) => ({ id: s.id, name: s.name, active: s.id === active }));
}

/** The Rooms section: shown with nothing selected and at least one labelled room (export.10). */
function roomsView(state: EditorState): ViewModel["rooms"] {
  if (!state.document || state.selection.length > 0) return null;
  const table = roomsTable(visibleDoc(state.document), activeStateId(state));
  return table.rows.length > 0 ? table : null;
}

const SURROUNDINGS_MENU = [{ value: "", label: "None" }, ...SURROUNDINGS_VALUES];

/** The 3D panel's header, with the layout it shows and the drawing's surroundings; null without a drawing. */
function view3dPanel(state: EditorState): ViewModel["view3d"] {
  if (!state.document) return null;
  const doc = visibleDoc(state.document);
  const layout = activeStateId(state);
  const surroundings = { value: surroundingsOf(doc) ?? "", options: SURROUNDINGS_MENU, canEdit: canCommit(state.document) };
  const outside = roofOf(doc).shape === "flat"; // the Roof switch, named Outside under a flat ceiling (roofs.13, inherit step 07)
  return { ...state.view3d, outside, layout: layout === null ? "" : doc.states[layout]?.name ?? layout, surroundings };
}

/** The panel's fields with the open finish row marked (inherit step 04). */
function openFinishIn(p: ViewModel["properties"], open: string | null): ViewModel["properties"] {
  return "fields" in p ? { ...p, fields: withOpenFinish(p.fields, open) } : p;
}
