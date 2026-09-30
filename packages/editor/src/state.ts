import { isValidId, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point, type ProjectMeta } from "@fm/protocol";
import { DEFAULT_ZOOM, type Camera } from "./camera";
import { createLocalDocument } from "./document/local-document";
import { visibleDoc } from "./document/open-document";
import type { OpenDocument } from "./document/types";
import { emptyHistory, type HistoryState } from "./history/history";
import type { Effect } from "./ports/effects";
import type { Host } from "./ports/host";
import { idleTool, type ToolState } from "./tools/types";
import type { Mods, RemotePresence, Size, SnapResult, ToolName } from "./types";

// Spec §5.3.
export type EditorState = {
  mode: "local" | "server";
  document: OpenDocument | null; // null = no drawing open (the project list)
  tool: ToolState;
  selection: EntityRef[]; // zero or one entity
  hover: EntityRef | null;
  pointer: { screen: Point; world: Point; mods: Mods } | null;
  panDrag: Point | null; // last screen point of a middle-button pan
  snap: SnapResult | null; // current snap (glyph and ViewModel)
  camera: Camera;
  snapSettings: { tolerancePx: number };
  undo: HistoryState;
  presence: Record<string, RemotePresence>;
  workspace: {
    projects: ProjectMeta[];
    loading: boolean;
    error: string | null;
    opening: { projectId: string; generation: string } | null;
  };
  toast: { text: string; until: number } | null;
  me: { clientId: string; name: string; color: string }; // colour comes from the server (phase 7)
};

/** What every handler returns; update appends the render effect. */
export type Step = { state: EditorState; effects: Effect[] };

export type InitOptions = { mode: "local" | "server"; me: { clientId: string; name: string }; viewport: Size; dpr: number };

export const SNAP_TOLERANCE_PX = 10;
export const DEFAULT_ME_COLOR = "#6b6b6b"; // same grey as COLORS.textMuted; until the server's welcome assigns one (phase 7)

export function initialState(opts: InitOptions, host: Host): EditorState {
  return {
    mode: opts.mode,
    document: opts.mode === "local" ? createLocalDocument({ id: "local", name: "Untitled" }, host.newId()) : null,
    tool: idleTool("select"),
    selection: [],
    hover: null,
    pointer: null,
    panDrag: null,
    snap: null,
    camera: { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: opts.viewport, dpr: opts.dpr },
    snapSettings: { tolerancePx: SNAP_TOLERANCE_PX },
    undo: emptyHistory,
    presence: {},
    workspace: { projects: [], loading: opts.mode === "server", error: null, opening: null },
    toast: null,
    me: { clientId: opts.me.clientId, name: opts.me.name, color: DEFAULT_ME_COLOR },
  };
}

/** Switching tools drops any gesture in progress; a submitted edit still settles (spec §7.4). */
export function switchTool(state: EditorState, name: ToolName): EditorState {
  return { ...state, tool: idleTool(name), snap: null, hover: null };
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
    default:
      return assertNever(ref.table);
  }
}

/** Selection and hover drop any entity that no longer exists (spec §5.7). */
export function pruneSelection(state: EditorState): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  const selection = doc ? state.selection.filter((r) => entityExists(doc, r)) : [];
  const hover = doc && state.hover && entityExists(doc, state.hover) ? state.hover : null;
  if (selection.length === state.selection.length && hover === state.hover) return state;
  return { ...state, selection, hover };
}
