import type { CardOrder } from "./ports/events";
import { DEFAULT_OPENING_KIND, DEFAULT_WALL_THICKNESS, deckView, type DeckPreset, entityValue, isValidId, levelOf, orderedStates, type Document, type EntityRef, type Level, type OpeningKind } from "@fm/domain";
import { INITIAL_FRAMES, type FramesState } from "./frames-state";
import { CLOSED_3D, type View3dState } from "./view3d-state";
import { assertNever, type Point, type ProjectListing } from "@fm/protocol";
import { DEFAULT_ZOOM, type Camera } from "./camera";
import { createLocalDocument } from "./document/local-document";
import { visibleDoc } from "./document/open-document";
import type { OpenDocument } from "./document/types";
import { emptyHistory, type HistoryState } from "./history/history";
import type { Effect } from "./ports/effects";
import type { Handle } from "./view/handles";
import type { Host } from "./ports/host";
import { selectableAt } from "./tools/selectable";
import { idleTool, type ToolState } from "./tools/types";
import type { ReportDrafts } from "./export/report-draft";
import type { ExportChoices } from "./export/sheets-view";
import { DEFAULT_COLUMN_SIZE, type ColumnSize, type Mods, type RemotePresence, type Size, type SnapResult, type SnapStep, type ToolName } from "./types";

// spec: editor.
/** A project card's drawing while the list shows (cards.02). */

/**
 * One kind's armed size (sizing.19): the picked preset's label (null: the kind's default) and, typed over it, a width,
 * a first-configuration depth and, for a kind that may be lowered, a height (sizing.15).
 */
export type ArmedEntry = { readonly preset: string | null; readonly w?: number; readonly d?: number; readonly h?: number };

/** The armed kind's size fields whose text didn't read as a size, kept as typed (sizing.23). */
export type SizeDraft = { readonly kind: string; readonly width?: string; readonly depth?: string; readonly height?: string };

export type CardDrawing = { status: "loading"; requestId: string } | { status: "ready"; doc: Document } | { status: "failed" };

export type EditorState = {
  mode: "local" | "server";
  document: OpenDocument | null; // null = no drawing open (the project list)
  tool: ToolState;
  selection: EntityRef[]; // one entity, or one or more placements of the active layout (direct.02)
  hover: EntityRef | null;
  // The right-click list (AC-06): the rows under the pointer, where it opened on screen, and the row the pointer is on.
  underPointer: { at: Point; rows: readonly EntityRef[]; hovered: EntityRef | null } | null;
  hoverHandle: Handle | null; // the handle under the pointer, for the cursor (furnish.10); null whenever hover is null
  pointer: { screen: Point; world: Point; mods: Mods } | null;
  panDrag: Point | null; // last screen point of a middle-button pan
  snap: SnapResult | null; // current snap (glyph and ViewModel)
  camera: Camera;
  snapSettings: { tolerancePx: number; step: SnapStep }; // step: for the session only (direct.14)
  wallThickness: number; // what the Wall tool draws with; per editor, not per document (layout-states.27)
  // This viewer's underlay settings for the session, whichever drawing is open (import.06): never synced or undone.
  // fade: 0 = full strength, 1 = invisible.
  underlayView: { fade: number; visible: boolean };
  // This viewer's Finishes switch (finishes.09): on draws rooms' floor finishes; never synced, saved or undone.
  finishesOn: boolean;
  // The finish row open in Properties (inherit step 04) and the selection it was opened for: a new selection closes it.
  openFinish: { id: string; selection: string } | null;
  // This viewer's 3D view (heights.18, .19): open, corner or split, and its turn; never synced, saved or undone.
  view3d: View3dState;
  stripSection: string | null; // the section under the plan (section.11), apart from the selection: this viewer's, never synced, saved or undone
  frames: FramesState; // the dock under the plan (section.45): this viewer's too
  sectionMarksOn: boolean; // this viewer's switch for the marks on screen (section.59): never synced, saved or undone; paper keeps them
  undo: HistoryState;
  presence: Record<string, RemotePresence>;
  // The layout state this user looks at and edits (spec: layouts): a preference, resolved against the document by
  // activeStateId, so a missing or deleted state falls back to the first one. Never sent as an edit.
  activeState: string | null;
  // The level this user looks at (levels.09): null for the floor, else a deck of that level, resolved by viewedLevel,
  // so it follows the deck's top and falls back to the floor when the deck is no longer a level. Never sent as an edit.
  viewedDeck: string | null;
  objectKind: string; // the kind the Object tool places (the palette's choice)
  objectSet: string | null; // the multi-piece set it places instead, armed from the palette (seated.12)
  // The armed size per kind id (furnish.05, sizing.19): the picked preset's label and, from sizing step 02, typed
  // sizes over it. One owner for the hint line's list and fields, the ghost and the click; for the session only, never
  // sent, saved or undone (like exportChoices, export.19).
  armed: Readonly<Record<string, ArmedEntry>>;
  sizeDraft: SizeDraft | null; // the hint line's size fields that didn't read; cleared by a good value, a preset pick or arming a kind
  openingKind: OpeningKind; // the kind the Opening tool places (spec: openings)
  deckPreset: DeckPreset; // the preset the Deck tool adds (decks.06): this viewer's tool setting, never stored
  columnSize: ColumnSize; // the size the Column tool places (pillars.12): this viewer's tool setting, never stored
  // A running flip between two layouts (spec: layouts, layout-states.20): t is the progress at the last frame, 0 to 1.
  // Presentation only: the document is not involved.
  flip: { from: string; to: string; startedAt: number; t: number } | null;
  workspace: {
    projects: ProjectListing[];
    order: CardOrder;
    loading: boolean;
    error: string | null;
    opening: { projectId: string; generation: string } | null;
    cards: Readonly<Record<string, CardDrawing>>; // the list's fetched drawings, by project id; emptied when the list opens (cards.02)
    hover: { id: string; yaw: number; tilt: number } | null; // the card showing its 3D view
    layouts: Readonly<Record<string, string>>; // the layout a card's pill chose, by project id; absent: its first (cards.07)
    cardFlip: { id: string; from: string; to: string; startedAt: number; t: number } | null; // the hovered card's change of layout, in 3D
  };
  toast: { text: string; until: number } | null;
  // The reason at the pointer after a refused press or release, or a rest on a red spot (clarity.02, .07): anchor in screen px, so a zoom leaves it. Never sent.
  plate: { text: string; anchor: Point; sticky: boolean; advice?: string } | null; // sticky: a refused click's, which a move under 24 px keeps; advice: a rest's second line (sizing.09)
  refused: string | null; // this event's refusal, for update's wrapper (plate.ts), which always empties it
  warningBlink: number; // +1 each time this viewer's own edit raises the warnings count (clarity.02): the shell's cue. Never sent.
  exportOpen: boolean; // the full-screen sheets view (sheetset.13)
  selectedSheet: string | null; // this viewer's, never stored, so a removed sheet just moves it: resolved by `selectedSheet` in export/sheet-list.ts
  reportDrafts: ReportDrafts; // what's typed in a report's box and not yet saved, by sheet ID (sheetset.14). Never sent as itself
  exportChoices: Record<string, ExportChoices>; // per project id, for the session (export.19)
  exportPending: { requestId: string; name: string } | null; // a PNG the shell is rasterising (export.18)
  me: { clientId: string; name: string; color: string }; // colour comes from the server (phase 7)
};

/** What every handler returns; update appends the render effect. */
export type Step = { state: EditorState; effects: Effect[] };

export type InitOptions = { mode: "local" | "server"; me: { clientId: string; name: string }; viewport: Size; dpr: number };

const SNAP_TOLERANCE_PX = 10;
export const DEFAULT_ME_COLOR = "#6b6b6b"; // same grey as COLORS.textMuted; until the server's welcome assigns one (phase 7)

export function initialState(opts: InitOptions, host: Host): EditorState {
  return {
    mode: opts.mode,
    document: opts.mode === "local" ? createLocalDocument({ id: "local", name: "Untitled" }, host.newId()) : null,
    tool: idleTool("select"),
    selection: [],
    hover: null,
    underPointer: null,
    hoverHandle: null,
    pointer: null,
    panDrag: null,
    snap: null,
    camera: { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: opts.viewport, dpr: opts.dpr },
    snapSettings: { tolerancePx: SNAP_TOLERANCE_PX, step: "auto" },
    wallThickness: DEFAULT_WALL_THICKNESS,
    underlayView: { fade: 0.5, visible: true },
    finishesOn: true,
    openFinish: null,
    view3d: CLOSED_3D,
    stripSection: null,
    frames: INITIAL_FRAMES,
    sectionMarksOn: true,
    undo: emptyHistory,
    presence: {},
    activeState: null,
    viewedDeck: null,
    objectKind: "bed",
    objectSet: null,
    armed: {},
    sizeDraft: null,
    openingKind: DEFAULT_OPENING_KIND,
    deckPreset: "platform",
    columnSize: DEFAULT_COLUMN_SIZE,
    flip: null,
    workspace: { projects: [], order: "name", loading: opts.mode === "server", error: null, opening: null, cards: {}, hover: null, layouts: {}, cardFlip: null },
    toast: null,
    plate: null,
    refused: null,
    warningBlink: 0,
    exportOpen: false,
    selectedSheet: null,
    reportDrafts: {},
    exportChoices: {},
    exportPending: null,
    me: { clientId: opts.me.clientId, name: opts.me.name, color: DEFAULT_ME_COLOR },
  };
}

/**
 * Switching tools drops any gesture in progress; a submitted edit still settles (spec: collaboration). Switching to another
 * drawing tool also clears the selection, so a selected room is not highlighted while drawing (ux-polish.36).
 */
export function switchTool(state: EditorState, name: ToolName): EditorState {
  const selection = name !== "select" && name !== state.tool.name ? [] : state.selection;
  return { ...state, tool: idleTool(name), snap: null, hover: null, hoverHandle: null, selection, underPointer: null };
}

export function entityExists(doc: Document, ref: EntityRef): boolean {
  if (!isValidId(ref.id)) return false; // an Object.prototype member name would find the inherited member
  switch (ref.table) {
    case "joints":
      return doc.joints[ref.id] !== undefined;
    case "walls":
      return doc.walls[ref.id] !== undefined;
    case "zoneLabels":
      return doc.zoneLabels[ref.id] !== undefined;
    case "decks":
      return deckView(doc, ref.id) !== null;
    case "states":
      return doc.states[ref.id] !== undefined;
    case "objects":
      return doc.objects[ref.id] !== undefined;
    case "placements":
      return doc.placements[ref.id] !== undefined;
    case "openings":
      return doc.openings[ref.id] !== undefined;
    case "dimensions":
      return doc.dimensions[ref.id] !== undefined;
    case "projectFields":
      return doc.projectFields[ref.id] !== undefined;
    case "underlays":
      return doc.underlays[ref.id] !== undefined;
    case "deckHoles": // read in the domain only, through deckViews (stairwell.15)
    case "logos":
    case "ceilings":
    case "sheets":
    case "sections":
    case "areas":
      return entityValue(doc, ref) !== null; // the ceiling row is read in the domain only (heights.27)
    default:
      return assertNever(ref.table);
  }
}

/**
 * Selection and hover drop any entity that no longer exists (spec: tools) or that the viewed level can't select
 * (levels.06, .19): after a level switch, a Stands on, an undo or a collaborator's edit.
 */
export function pruneSelection(state: EditorState): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  const layout = activeStateId(state);
  const level = doc ? viewedLevelOn(state, doc) : null;
  const keep = (r: EntityRef): boolean => doc !== null && level !== null && entityExists(doc, r) && selectableAt(doc, layout, r, level);
  const selection = state.selection.filter(keep);
  const hover = state.hover && keep(state.hover) ? state.hover : null;
  const hoverHandle = hover === null ? null : state.hoverHandle;
  const list = state.underPointer;
  const rows = list ? list.rows.filter(keep) : [];
  const underPointer = !list || rows.length === 0 ? null : rows.length === list.rows.length ? list : { ...list, rows, hovered: list.hovered && keep(list.hovered) ? list.hovered : null };
  if (underPointer !== state.underPointer) return { ...state, selection, hover, hoverHandle, underPointer };
  if (selection.length === state.selection.length && hover === state.hover && hoverHandle === state.hoverHandle) return state;
  return { ...state, selection, hover, hoverHandle };
}

/** The state shown: the user's choice while it exists in the visible document, else the first state (spec: layouts). */
export function activeStateId(state: EditorState): string | null {
  if (!state.document) return null;
  const doc = visibleDoc(state.document);
  if (state.activeState !== null && isValidId(state.activeState) && doc.states[state.activeState]) return state.activeState;
  return orderedStates(doc)[0]?.id ?? null;
}

/** The level shown: the level of the viewed deck in the visible document, else the floor (levels.09). Null with no document. */
export function viewedLevel(state: EditorState): Level | null {
  return state.document ? viewedLevelOn(state, visibleDoc(state.document)) : null;
}

/**
 * The viewed deck's level in `doc`, else the floor: `viewedLevel` on a document the caller names, the visible one or
 * a gesture's preview (live distances). The one place `viewedDeck` becomes a level.
 */
export function viewedLevelOn(state: EditorState, doc: Document): Level {
  return levelOf(doc, state.viewedDeck);
}

/** The selected placements of the active layout, in selection order: the furniture a group drag or R acts on. */
export function selectedPlacements(state: EditorState, selection: EntityRef[] = state.selection): string[] {
  const layout = activeStateId(state);
  const doc = state.document ? visibleDoc(state.document) : null;
  return selection.flatMap((r) => (r.table === "placements" && doc?.placements[r.id]?.state === layout ? [r.id] : []));
}

