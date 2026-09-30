import { describe, expect, it } from "vitest";
import { execute, unwrap, type EntityRef } from "@fm/domain";
import { emptyHistory } from "../src/history/history";
import { DEFAULT_ME_COLOR, initialState, pruneSelection, switchTool, type EditorState } from "../src/state";
import { TOAST_TIMER, onToastTimer, showToast } from "../src/toast";
import { draggedJoints, type WallPreview } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import { jointAt, localState, roomDoc, serverState, wallBetween } from "./builders";
import { FakeHost } from "./fake-shell";

const me = { clientId: "tab1", name: "Alice" };
const viewport = { width: 1200, height: 800 };

describe("initialState", () => {
  it("opens an unsaved local drawing in local mode", () => {
    const s = initialState({ mode: "local", me, viewport, dpr: 1 }, new FakeHost());
    expect(s.mode).toBe("local");
    expect(s.document?.kind).toBe("local");
    expect(s.document?.project).toEqual({ id: "local", name: "Untitled" });
    expect(s.document?.kind === "local" && s.document.openId).toBe("id1"); // the FakeHost's first ID
    expect(s.tool).toEqual({ name: "select", state: { kind: "idle" } });
    expect(s.camera).toEqual({ center: { x: 3, y: 2 }, zoom: 80, viewport, dpr: 1 });
    expect(s.snapSettings).toEqual({ tolerancePx: 10 });
    expect(s.selection).toEqual([]);
    expect(s.hover).toBeNull();
    expect(s.pointer).toBeNull();
    expect(s.panDrag).toBeNull();
    expect(s.snap).toBeNull();
    expect(s.undo).toEqual(emptyHistory);
    expect(s.presence).toEqual({});
    expect(s.toast).toBeNull();
    expect(s.workspace).toEqual({ projects: [], loading: false, error: null, opening: null });
    expect(s.me).toEqual({ clientId: "tab1", name: "Alice", color: DEFAULT_ME_COLOR });
  });

  it("starts on the project list in server mode", () => {
    const host = new FakeHost();
    const s = initialState({ mode: "server", me, viewport, dpr: 2 }, host);
    expect(host.newId()).toBe("id1"); // no drawing, so no open ID taken
    expect(s.mode).toBe("server");
    expect(s.document).toBeNull();
    expect(s.camera.dpr).toBe(2);
    expect(s.workspace).toEqual({ projects: [], loading: true, error: null, opening: null });
  });
});

describe("switchTool", () => {
  it("resets the tool, snap and hover but keeps the selection", () => {
    const doc = roomDoc();
    const corner: EntityRef = { table: "joints", id: jointAt(doc, { x: 6, y: 4 }) };
    const s: EditorState = {
      ...localState(new FakeHost(), doc),
      selection: [corner],
      hover: corner,
      snap: { point: { x: 0, y: 0 }, kind: "grid" },
    };
    const next = switchTool(s, "wall");
    expect(next.tool).toEqual({ name: "wall", state: { kind: "idle" } });
    expect(next.snap).toBeNull();
    expect(next.hover).toBeNull();
    expect(next.selection).toEqual(s.selection);
    expect(switchTool(s, "zone").tool).toEqual({ name: "zone", state: { kind: "idle", hoverFaceKey: null } });
  });

  it("resets the gesture when switching to the tool that is already active", () => {
    const s: EditorState = {
      ...localState(new FakeHost()),
      tool: { name: "wall", state: { kind: "drawing", origin: { x: 0, y: 0 }, chainStart: { x: 0, y: 0 }, value: "", preview: null, dragFrom: null } },
    };
    expect(switchTool(s, "wall").tool).toEqual({ name: "wall", state: { kind: "idle" } });
  });
});

describe("pruneSelection", () => {
  it("drops entities that no longer exist", () => {
    const doc = roomDoc();
    const corner: EntityRef = { table: "joints", id: jointAt(doc, { x: 6, y: 4 }) };
    const missing: EntityRef = { table: "walls", id: "missing" };
    const s: EditorState = { ...localState(new FakeHost(), doc), selection: [corner, missing], hover: missing };
    const pruned = pruneSelection(s);
    expect(pruned.selection).toEqual([corner]);
    expect(pruned.hover).toBeNull();
    const valid: EditorState = { ...s, selection: [corner], hover: corner };
    expect(pruneSelection(valid)).toBe(valid);
    const noDrawing = pruneSelection({ ...serverState(new FakeHost()), selection: [corner], hover: corner });
    expect(noDrawing.selection).toEqual([]);
    expect(noDrawing.hover).toBeNull();
  });

  it("keeps an existing wall and drops a missing joint", () => {
    const doc = roomDoc();
    const wall: EntityRef = { table: "walls", id: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }) };
    const s: EditorState = { ...localState(new FakeHost(), doc), selection: [wall, { table: "joints", id: "missing" }] };
    expect(pruneSelection(s).selection).toEqual([wall]);
  });

  it("clears a missing hover even when the selection is unchanged", () => {
    const s: EditorState = { ...localState(new FakeHost(), roomDoc()), selection: [], hover: { table: "walls", id: "missing" } };
    expect(pruneSelection(s).hover).toBeNull();
  });

  it("keeps existing zone labels and drops missing ones", () => {
    const doc = unwrap(execute(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Room" })).doc;
    const label: EntityRef = { table: "zoneLabels", id: "L1" };
    const s: EditorState = { ...localState(new FakeHost(), doc), selection: [label, { table: "zoneLabels", id: "missing" }] };
    expect(pruneSelection(s).selection).toEqual([label]);
  });

  it("drops IDs that name Object.prototype members", () => {
    const s: EditorState = {
      ...localState(new FakeHost(), roomDoc()),
      selection: [{ table: "walls", id: "constructor" }],
      hover: { table: "joints", id: "__proto__" },
    };
    const pruned = pruneSelection(s);
    expect(pruned.selection).toEqual([]);
    expect(pruned.hover).toBeNull();
  });
});

describe("draggedJoints", () => {
  it("moves the joint itself, both ends of a wall, and nothing for an unknown or prototype-member wall ID", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    expect(draggedJoints(doc, { kind: "joint", jointId: corner })).toEqual([corner]);
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const ends = [jointAt(doc, { x: 0, y: 0 }), jointAt(doc, { x: 6, y: 0 })].sort();
    expect(draggedJoints(doc, { kind: "wall", wallId: wall }).sort()).toEqual(ends);
    expect(draggedJoints(doc, { kind: "wall", wallId: "missing" })).toEqual([]);
    expect(draggedJoints(doc, { kind: "wall", wallId: "constructor" })).toEqual([]);
  });
});

describe("localState builder", () => {
  it("leaves the host's ID sequence untouched", () => {
    const host = new FakeHost();
    localState(host);
    expect(host.newId()).toBe("id1");
  });
});

describe("tool state types", () => {
  it("rules out a successful preview without its document", () => {
    const p = { x: 0, y: 0 };
    // @ts-expect-error a successful preview needs its document
    const bad: WallPreview = { from: p, to: p, ok: true };
    const good: WallPreview = { from: p, to: p, ok: false };
    expect([bad.ok, good.ok]).toEqual([true, false]);
  });
});

describe("colours", () => {
  it("keeps the helper colour distinct from the selection blue", () => {
    expect(COLORS.helper).not.toBe(COLORS.wallSelected);
  });
});

describe("toasts", () => {
  it("shows a toast for 3 s and starts the toast timer", () => {
    const host = new FakeHost();
    host.time = 500;
    const r = showToast(localState(host), "Wall too short", host);
    expect(r.state.toast).toEqual({ text: "Wall too short", until: 3500 });
    expect(r.effects).toEqual([{ type: "startTimer", timerId: TOAST_TIMER, ms: 3000 }]);
  });

  it("clears the toast when its time is up, but keeps a newer one", () => {
    const host = new FakeHost();
    const first = showToast(localState(host), "First", host).state;
    host.advance(3000);
    expect(onToastTimer(first, host).state.toast).toBeNull();
    const second = showToast(first, "Second", host).state;
    expect(onToastTimer(second, host).state.toast?.text).toBe("Second");
  });

  it("re-arms the timer when it fires early, and clears the toast on time", () => {
    const host = new FakeHost();
    const shown = showToast(localState(host), "Wall too short", host).state;
    host.time = 2999;
    const early = onToastTimer(shown, host);
    expect(early.state.toast?.text).toBe("Wall too short");
    expect(early.effects).toEqual([{ type: "startTimer", timerId: TOAST_TIMER, ms: 1 }]);
    host.time = 3000;
    const due = onToastTimer(shown, host);
    expect(due.state.toast).toBeNull();
    expect(due.effects).toEqual([]);
  });

  it("does nothing when no toast is showing", () => {
    const s = localState(new FakeHost());
    expect(onToastTimer(s, new FakeHost())).toEqual({ state: s, effects: [] });
  });
});
