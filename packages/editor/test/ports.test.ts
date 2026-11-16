import { describe, expect, it } from "vitest";
import { assertNever } from "@fm/domain";
import type { Notice } from "../src/document/types";
import type { Effect, WorkspaceOp } from "../src/ports/effects";
import type { Event, ServerEvent, UiAction, WorkspaceEvent } from "../src/ports/events";
import { NO_MODS, type SnapKind } from "../src/types";
import type { ViewModel } from "../src/view/view-model";

function label(e: Event): string {
  switch (e.type) {
    case "pointerDown":
    case "pointerMove":
    case "pointerUp":
      return `${e.type} ${e.screen.x},${e.screen.y}`;
    case "pointerLeave":
      return "pointerLeave";
    case "pointAt":
      return `pointAt ${e.world.x},${e.world.y}`;
    case "wheel":
      return `wheel ${e.deltaY}`;
    case "key":
      return `key ${e.key}`;
    case "ui":
      return `ui ${e.action.type}`;
    case "timerFired":
      return `timer ${e.timerId}`;
    case "frame":
      return `frame ${e.now}`;
    case "workspaceEvent":
      return `workspace ${e.event.type}`;
    case "saveResult":
      return `save ${e.writeId}`;
    case "serverEvent":
      return `server ${e.event.type}`;
    case "viewportResized":
      return `resize ${e.size.width}`;
    case "command":
      return `command ${e.command.type}`;
    case "rasterised":
      return `rasterised ${e.requestId}`;
  }
}

function effectLabel(e: Effect): string {
  switch (e.type) {
    case "render":
      return `render ${e.scene.layers.length}`;
    case "workspace":
      return `workspace ${e.op.type}`;
    case "saveSnapshot":
      return `save ${e.writeId}`;
    case "submit":
      return `submit ${e.changeset.id}`;
    case "presence":
      return `presence ${e.projectId}`;
    case "startTimer":
      return `start ${e.timerId} ${e.ms}`;
    case "cancelTimer":
      return `cancel ${e.timerId}`;
    case "requestFrame":
      return "frame";
    case "saveFile":
      return `saveFile ${e.name}`;
    case "rasterise":
      return `rasterise ${e.requestId}`;
    default:
      return assertNever(e);
  }
}

// Pin the exact variants of the unions built only in part above: a missing or an extra one fails the typecheck.
const serverEventTypes: Record<ServerEvent["type"], true> = {
  welcome: true,
  snapshot: true,
  openFailed: true,
  projectDeleted: true,
  changes: true,
  ack: true,
  rejected: true,
  presence: true,
  presenceLeft: true,
  connection: true,
};
const uiActionTypes: Record<UiAction["type"], true> = {
  createProject: true,
  openProject: true,
  showProjectList: true,
  cardSeen: true,
  cardHover: true,
  cardOrbit: true,
  cardNextLayout: true,
  setCardOrder: true,
  deleteProject: true,
  pickTool: true,
  selectEntity: true,
  setField: true,
  setWallThickness: true,
  setColumnSize: true,
  setSnapStep: true,
  setActiveState: true,
  pickUnderPointer: true,
  hoverUnderPointer: true,
  closeUnderPointer: true,
  selectHole: true,
  hoverHole: true,
  setViewedLevel: true,
  pickKind: true,
  pickPreset: true,
  setArmedSize: true,
  chipHover: true,
  chipClick: true,
  pickOpeningKind: true,
  pickDeckPreset: true,
  pickMotif: true,
  setFinishesOn: true,
  toggleFinish: true,
  addState: true,
  renameState: true,
  deleteState: true,
  openExport: true,
  closeExport: true,
  setExport: true,
  download: true,
  setSheetSetting: true,
  selectSheet: true,
  addSheet: true,
  addMissingSheet: true,
  addMissingSection: true,
  duplicateSheet: true,
  deleteSheet: true,
  moveSheet: true,
  tickSheet: true,
  tickAllSheets: true,
  setSheet: true,
  renameSheet: true,
  setSheetDrawing: true,
  setSheetSection: true,
  toggleSheetPane: true,
  frameSheet: true,
  typeReport: true,
  leaveReport: true,
  openSheet: true,
  undo: true,
  redo: true,
  deleteSelection: true,
  duplicate: true,
  breakApart: true,
  split: true,
  pickSet: true,
  importUnderlay: true,
  removeUnderlay: true,
      importLogo: true,
      removeLogo: true,
  setUnderlayFade: true,
  toggleUnderlay: true,
  toggle3d: true,
  toggleRoof3d: true,
  set3dSize: true,
  turn3d: true,
  orbit3d: true,
  reset3d: true,
  showSection: true,
  closeSection: true,
  setSectionMarks: true,
  setDockHeight: true,
  resetDockHeight: true,
  toggleLargerDock: true,
  setDockShare: true,
  swapFrames: true,
};
const workspaceEventTypes: Record<WorkspaceEvent["type"], true> = { projects: true, created: true, drawing: true, failed: true };
const workspaceOpTypes: Record<WorkspaceOp["type"], true> = { list: true, create: true, delete: true, open: true, read: true };
const noticeTypes: Record<Notice["type"], true> = { accepted: true, rejected: true, remoteChange: true, resynced: true, offline: true };
const snapKinds: Record<SnapKind, true> = {
  endpoint: true, midpoint: true, perpendicular: true, onWall: true, angle: true, aligned: true, equal: true, grid: true, edge: true, none: true,
};

const view: ViewModel = {
  activeTool: "wall",
  underPointer: null,
  commandBar: { prompt: "Next point or length", value: "3.20", unit: "m", chips: [] },
  typing: true,
  properties: { kind: "none" },
  cursor: "crosshair",
  snap: { kind: "endpoint", at: { x: 3, y: 0 } },
  presence: [],
  project: { name: "Apartment", status: "saved", dirty: false, canEdit: true },
  projectList: null,
  toast: null,
  canUndo: true,
  canRedo: false,
  wallThickness: "0.20",
  states: [{ id: "s0", name: "Layout", active: true }],
  warnings: { rows: [], blink: 0 },
  objectKind: "bed",
  sizePicker: null,
  sizeFields: null,
  openingKind: "swing",
  openingKinds: [],
  deckPreset: "platform",
  deckPresets: [],
  columnSize: { width: "0.30", depth: "0.30" },
  columnSizes: [],
  tools: [],
  palette: [{ group: "Sleep", cards: [{ kind: "bed", preset: null, name: "Bed", size: "1.60 × 2.00 m", config: "standard", w: 1.6, d: 2 }] }],
  toolHelp: { tool: "wall", label: "Wall", key: "W", hint: "Next point or length" },
  shortcuts: [{ label: "Wall", key: "W" }],
  gridStep: 0.2,
  cut: null,
  levels: null,
  ceiling: null,
  outside: null,
  trailer: null,
  sectionMarks: null,
  frames: { height: 0.46, larger: false, sectionShare: 0.56, sectionFirst: true, docked: false, side: false },
  view3d: null,
  sectionStrip: null,
  snapStep: "auto",
  snapSteps: [],
  export: { available: true, reason: null },
  sheetsView: null,
  projectFields: null,
  underlay: null,
      logo: null,
  rooms: null,
  floors: { on: true, tiles: [{ motif: "planks", label: "Planks", w: 1.92, d: 1.2 }], armed: null },
};

describe("ports", () => {
  it("covers every event variant", () => {
    const events: Event[] = [
      { type: "pointerDown", screen: { x: 1, y: 2 }, mods: NO_MODS, button: 0 },
      { type: "pointerLeave" },
      { type: "wheel", screen: { x: 0, y: 0 }, deltaX: 0, deltaY: 5, mods: NO_MODS },
      { type: "key", key: "w", mods: NO_MODS },
      { type: "ui", action: { type: "pickTool", tool: "zone" } },
      { type: "timerFired", timerId: "toast" },
      { type: "workspaceEvent", event: { type: "failed", requestId: null, message: "x" } },
      { type: "saveResult", writeId: "w1", ok: true },
      { type: "serverEvent", event: { type: "connection", state: "open" } },
      { type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 2 },
      { type: "command", command: { type: "renameZone", id: "L1", name: "Kitchen" } },
      { type: "rasterised", requestId: "r9", image: null },
    ];
    expect(events.map(label)).toEqual([
      "pointerDown 1,2", "pointerLeave", "wheel 5", "key w", "ui pickTool", "timer toast",
      "workspace failed", "save w1", "server connection", "resize 800", "command renameZone", "rasterised r9",
    ]);
  });

  it("covers every effect variant", () => {
    const camera = { center: { x: 0, y: 0 }, zoom: 80, viewport: { width: 800, height: 600 }, dpr: 1 };
    const effects: Effect[] = [
      { type: "render", scene: { layers: [], underlay: null }, view, camera, view3d: null },
      { type: "workspace", op: { type: "list", requestId: "r1" } },
      { type: "saveSnapshot", projectId: "p", writeId: "w", content: "{}" },
      { type: "submit", projectId: "p", generation: "g", changeset: { id: "c", patch: { puts: [], deletes: [] }, expect: [] } },
      { type: "presence", projectId: "p", generation: "g", cursor: null, selection: [], state: null, level: null },
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "cancelTimer", timerId: "toast" },
      { type: "saveFile", name: "Flat.svg", content: { kind: "image", image: null } },
      { type: "rasterise", requestId: "r9", page: { widthMm: 10, heightMm: 10, primitives: [] }, size: { w: 300, h: 300 } },
    ];
    expect(effects.map(effectLabel)).toEqual([
      "render 0", "workspace list", "save w", "submit c", "presence p", "start toast 3000", "cancel toast", "saveFile Flat.svg", "rasterise r9",
    ]);
  });

  it("pins the server event, UI action, workspace, notice and snap kind variants", () => {
    expect(Object.keys(serverEventTypes)).toEqual([
      "welcome", "snapshot", "openFailed", "projectDeleted", "changes", "ack", "rejected", "presence", "presenceLeft", "connection",
    ]);
    expect(Object.keys(uiActionTypes)).toEqual(["createProject", "openProject", "showProjectList", "cardSeen", "cardHover", "cardOrbit", "cardNextLayout", "setCardOrder", "deleteProject", "pickTool", "selectEntity", "setField", "setWallThickness", "setColumnSize", "setSnapStep", "setActiveState", "pickUnderPointer", "hoverUnderPointer", "closeUnderPointer", "selectHole", "hoverHole", "setViewedLevel", "pickKind", "pickPreset", "setArmedSize", "chipHover", "chipClick", "pickOpeningKind", "pickDeckPreset", "pickMotif", "setFinishesOn", "toggleFinish", "addState", "renameState", "deleteState", "openExport", "closeExport", "setExport", "download", "setSheetSetting", "selectSheet", "addSheet", "addMissingSheet", "addMissingSection", "duplicateSheet", "deleteSheet", "moveSheet", "tickSheet", "tickAllSheets", "setSheet", "renameSheet", "setSheetDrawing", "setSheetSection", "toggleSheetPane", "frameSheet", "typeReport", "leaveReport", "openSheet", "undo", "redo", "deleteSelection", "duplicate", "breakApart", "split", "pickSet", "importUnderlay", "removeUnderlay", "importLogo", "removeLogo", "setUnderlayFade", "toggleUnderlay", "toggle3d", "toggleRoof3d", "set3dSize", "turn3d", "orbit3d", "reset3d", "showSection", "closeSection", "setSectionMarks", "setDockHeight", "resetDockHeight", "toggleLargerDock", "setDockShare", "swapFrames"]);
    expect(Object.keys(workspaceEventTypes)).toEqual(["projects", "created", "drawing", "failed"]);
    expect(Object.keys(workspaceOpTypes)).toEqual(["list", "create", "delete", "open", "read"]);
    expect(Object.keys(noticeTypes)).toEqual(["accepted", "rejected", "remoteChange", "resynced", "offline"]);
    expect(Object.keys(snapKinds)).toEqual(["endpoint", "midpoint", "perpendicular", "onWall", "angle", "aligned", "equal", "grid", "edge", "none"]);
  });
});
