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
    case "wheel":
      return `wheel ${e.deltaY}`;
    case "key":
      return `key ${e.key}`;
    case "ui":
      return `ui ${e.action.type}`;
    case "timerFired":
      return `timer ${e.timerId}`;
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
  deleteProject: true,
  pickTool: true,
  setField: true,
  undo: true,
  redo: true,
};
const workspaceEventTypes: Record<WorkspaceEvent["type"], true> = { projects: true, created: true, failed: true };
const workspaceOpTypes: Record<WorkspaceOp["type"], true> = { list: true, create: true, delete: true, open: true };
const noticeTypes: Record<Notice["type"], true> = { accepted: true, rejected: true, remoteChange: true, resynced: true, offline: true };
const snapKinds: Record<SnapKind, true> = {
  endpoint: true, midpoint: true, perpendicular: true, onWall: true, angle: true, aligned: true, grid: true, none: true,
};

const view: ViewModel = {
  activeTool: "wall",
  commandBar: { prompt: "Next point or length", value: "3.20", unit: "m" },
  properties: { kind: "none" },
  cursor: "crosshair",
  snap: { kind: "endpoint", at: { x: 3, y: 0 } },
  presence: [],
  project: { name: "Apartment", status: "saved", dirty: false, canEdit: true },
  projectList: null,
  toast: null,
  canUndo: true,
  canRedo: false,
};

describe("ports", () => {
  it("covers every event variant", () => {
    const events: Event[] = [
      { type: "pointerDown", screen: { x: 1, y: 2 }, mods: NO_MODS, button: 0 },
      { type: "wheel", screen: { x: 0, y: 0 }, deltaX: 0, deltaY: 5, mods: NO_MODS },
      { type: "key", key: "w", mods: NO_MODS },
      { type: "ui", action: { type: "pickTool", tool: "zone" } },
      { type: "timerFired", timerId: "toast" },
      { type: "workspaceEvent", event: { type: "failed", requestId: null, message: "x" } },
      { type: "saveResult", writeId: "w1", ok: true },
      { type: "serverEvent", event: { type: "connection", state: "open" } },
      { type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 2 },
      { type: "command", command: { type: "renameZone", id: "L1", name: "Kitchen" } },
    ];
    expect(events.map(label)).toEqual([
      "pointerDown 1,2", "wheel 5", "key w", "ui pickTool", "timer toast",
      "workspace failed", "save w1", "server connection", "resize 800", "command renameZone",
    ]);
  });

  it("covers every effect variant", () => {
    const camera = { center: { x: 0, y: 0 }, zoom: 80, viewport: { width: 800, height: 600 }, dpr: 1 };
    const effects: Effect[] = [
      { type: "render", scene: { layers: [] }, view, camera },
      { type: "workspace", op: { type: "list", requestId: "r1" } },
      { type: "saveSnapshot", projectId: "p", writeId: "w", content: "{}" },
      { type: "submit", projectId: "p", generation: "g", changeset: { id: "c", patch: { puts: [], deletes: [] }, expect: [] } },
      { type: "presence", projectId: "p", generation: "g", cursor: null, selection: [] },
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "cancelTimer", timerId: "toast" },
    ];
    expect(effects.map(effectLabel)).toEqual([
      "render 0", "workspace list", "save w", "submit c", "presence p", "start toast 3000", "cancel toast",
    ]);
  });

  it("pins the server event, UI action, workspace, notice and snap kind variants", () => {
    expect(Object.keys(serverEventTypes)).toEqual([
      "welcome", "snapshot", "openFailed", "projectDeleted", "changes", "ack", "rejected", "presence", "presenceLeft", "connection",
    ]);
    expect(Object.keys(uiActionTypes)).toEqual(["createProject", "openProject", "showProjectList", "deleteProject", "pickTool", "setField", "undo", "redo"]);
    expect(Object.keys(workspaceEventTypes)).toEqual(["projects", "created", "failed"]);
    expect(Object.keys(workspaceOpTypes)).toEqual(["list", "create", "delete", "open"]);
    expect(Object.keys(noticeTypes)).toEqual(["accepted", "rejected", "remoteChange", "resynced", "offline"]);
    expect(Object.keys(snapKinds)).toEqual(["endpoint", "midpoint", "perpendicular", "onWall", "angle", "aligned", "grid", "none"]);
  });
});
