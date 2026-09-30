import { execute, unwrap, type EntityRef } from "@fm/domain";
import { describe, expect, it } from "vitest";
import { screenToWorld } from "../src/camera";
import type { EditorState } from "../src/state";
import { idleTool } from "../src/tools/types";
import { NO_MODS, type SnapResult } from "../src/types";
import { buildScene } from "../src/view/scene";
import { roomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

/** `pointer.world` is always the pointer's screen point under the current camera. */
function expectPointerOnCamera(shell: FakeShell): void {
  const p = shell.state.pointer;
  expect(p).not.toBeNull();
  if (p) expect(p.world).toEqual(screenToWorld(shell.state.camera, p.screen));
}

const GRID_SNAP: SnapResult = { point: { x: 1, y: 1 }, kind: "grid" };
const WALL_DRAWING: EditorState["tool"] = {
  name: "wall",
  state: { kind: "drawing", origin: { x: 0, y: 0 }, chainStart: { x: 0, y: 0 }, value: "12", preview: null, dragFrom: null },
};

describe("update", () => {
  it("switches tools with V, W and Z in either case", () => {
    const shell = FakeShell.local();
    shell.key("w");
    expect(shell.view().activeTool).toBe("wall");
    shell.key("Z", { shift: true });
    expect(shell.view().activeTool).toBe("zone");
    shell.key("v");
    expect(shell.view().activeTool).toBe("select");
  });

  it("treats Cmd+Z as undo, not as the zone tool", () => {
    const shell = FakeShell.local();
    shell.key("z", { meta: true });
    expect(shell.view().activeTool).toBe("select");
    expect(shell.view().toast).toBe("Nothing to undo");
  });

  it("returns to Select on Esc from the idle wall tool and from the zone tool", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
    shell.key("z");
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("accepts pickTool from the toolbar", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "pickTool", tool: "wall" });
    expect(shell.view().activeTool).toBe("wall");
  });

  it("clears a toast when its timer fires", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "undo" });
    expect(shell.view().toast).toBe("Nothing to undo");
    expect(shell.effectsOf("startTimer")).toEqual([{ type: "startTimer", timerId: "toast", ms: 3000 }]);
    shell.host.advance(3000);
    shell.fireTimer("toast");
    expect(shell.state.toast).toBeNull();
  });

  it("zooms around the cursor with Ctrl + wheel", () => {
    const shell = FakeShell.local();
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(shell.state.camera, screen);
    shell.send({ type: "wheel", screen, deltaX: 0, deltaY: -100, mods: { ...NO_MODS, ctrl: true } });
    expect(shell.state.camera.zoom).toBeCloseTo(80 * Math.E, 6);
    const after = screenToWorld(shell.state.camera, screen);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("pans with a plain wheel", () => {
    const shell = FakeShell.local();
    shell.wheel(40, 0);
    expect(shell.state.camera.center).toEqual({ x: 3.5, y: 2 });
  });

  it("follows viewport resizes", () => {
    const shell = FakeShell.local();
    shell.send({ type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 2 });
    expect(shell.state.camera.viewport).toEqual({ width: 800, height: 600 });
    expect(shell.state.camera.dpr).toBe(2);
  });

  it("ignores save results and Cmd+S (local files are follow-up X1)", () => {
    const shell = FakeShell.local();
    const before = shell.state;
    shell.send({ type: "saveResult", writeId: "w1", ok: true });
    shell.key("s", { meta: true });
    expect(shell.state).toBe(before);
  });

  // Added in review: each test below kills a routing mutation the plan's tests let survive.
  it("treats Ctrl+Z as undo and Cmd+Shift+Z as redo; Alt+W is not a command code", () => {
    const shell = FakeShell.local();
    shell.key("z", { ctrl: true });
    expect(shell.view().activeTool).toBe("select");
    expect(shell.view().toast).toBe("Nothing to undo");
    shell.key("z", { meta: true, shift: true });
    expect(shell.view().toast).toBe("Nothing to redo");
    shell.key("w", { alt: true });
    expect(shell.view().activeTool).toBe("select");
  });

  it("ends every update with one render effect, after the handler's effects", () => {
    const shell = FakeShell.local();
    const effects = shell.send({ type: "ui", action: { type: "undo" } });
    expect(effects.map((e) => e.type)).toEqual(["startTimer", "render"]);
  });

  it("deletes the selection in the idle Select tool, but not with Cmd held or during a press", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const wall: EntityRef = { table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) };
    shell.click({ x: 3, y: 0 });
    expect(shell.state.selection).toEqual([wall]);
    shell.key("Delete", { meta: true });
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    expect(shell.state.tool).toMatchObject({ name: "select", state: { kind: "pressing" } });
    shell.key("Delete");
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.up({ x: 3, y: 0 });
    expect(shell.state.tool).toEqual(idleTool("select"));
    shell.key("Delete");
    expect(shell.doc().walls[wall.id]).toBeUndefined();
  });

  it("deletes nothing in the wall tool and only zone labels in the zone tool", () => {
    const doc = unwrap(execute(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Room" })).doc;
    const shell = FakeShell.withDocument(doc);
    const wall: EntityRef = { table: "walls", id: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }) };
    shell.key("w");
    shell.state = { ...shell.state, selection: [wall] };
    shell.key("Backspace");
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.key("z");
    shell.key("Backspace");
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.state = { ...shell.state, selection: [{ table: "zoneLabels", id: "L1" }] };
    shell.key("Backspace");
    expect(shell.doc().zoneLabels["L1"]).toBeUndefined();
  });

  it("clears the selection on Esc in the idle Select tool", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) }] };
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().activeTool).toBe("select");
  });

  it("pans with a middle-button drag in any tool, tracking the pointer", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 180, y: 100 }, mods: NO_MODS, button: 1 });
    expect(shell.state.pointer?.screen).toEqual({ x: 180, y: 100 });
    expect(shell.state.camera.center).toEqual({ x: 2, y: 2 });
    shell.send({ type: "pointerUp", screen: { x: 180, y: 100 }, mods: NO_MODS, button: 1 });
    expect(shell.state.camera.center).toEqual({ x: 2, y: 2 });
    expect(shell.state.panDrag).toBeNull();
    expect(shell.view().activeTool).toBe("wall");
  });

  it("never passes right-button events to the tool, but tracks the pointer", () => {
    const shell = FakeShell.local();
    shell.key("z");
    const snap: SnapResult = { point: { x: 1, y: 1 }, kind: "grid" };
    shell.state = { ...shell.state, snap };
    shell.send({ type: "pointerDown", screen: { x: 50, y: 60 }, mods: NO_MODS, button: 2 });
    expect(shell.state.snap).toEqual(snap); // the zone tool would clear it
    expect(shell.state.pointer?.screen).toEqual({ x: 50, y: 60 });
  });

  it("zooms with Cmd + wheel", () => {
    const shell = FakeShell.local();
    shell.wheel(0, -100, { meta: true });
    expect(shell.state.camera.zoom).toBeCloseTo(80 * Math.E, 6);
  });

  it("ignores timers other than the toast timer", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "undo" });
    shell.host.advance(3000);
    shell.fireTimer("other");
    expect(shell.state.toast?.text).toBe("Nothing to undo");
  });

  // Added in review (task 3.10): the cursor follows the camera; only an applied undo or redo drops the gesture.
  it("keeps the pointer's world point on the camera after a plain wheel", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.wheel(40, 30);
    expectPointerOnCamera(shell);
  });

  it("keeps the pointer's world point on the camera after a Ctrl + wheel zoom", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.send({ type: "wheel", screen: { x: 700, y: 500 }, deltaX: 0, deltaY: -100, mods: { ...NO_MODS, ctrl: true } });
    expectPointerOnCamera(shell);
  });

  it("keeps the pointer's world point on the camera after a viewport resize", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.send({ type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 2 });
    expectPointerOnCamera(shell);
  });

  it("keeps the pointer's world point on the camera during and after a middle-button pan", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expectPointerOnCamera(shell);
    shell.send({ type: "pointerUp", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expectPointerOnCamera(shell);
  });

  it("replays the cursor to the tool after a wheel, a resize, and the end of a pan", () => {
    const shell = FakeShell.local();
    shell.key("z"); // the zone placeholder clears `snap` on any pointer event it sees
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.state = { ...shell.state, snap: GRID_SNAP };
    shell.wheel(0, 30);
    expect(shell.state.snap).toBeNull();
    shell.state = { ...shell.state, snap: GRID_SNAP };
    shell.send({ type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 1 });
    expect(shell.state.snap).toBeNull();
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.state = { ...shell.state, snap: GRID_SNAP };
    shell.send({ type: "pointerMove", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expect(shell.state.snap).toEqual(GRID_SNAP); // pan moves do not reach the tool
    shell.send({ type: "pointerUp", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expect(shell.state.snap).toBeNull();
  });

  it("leaves the pointer unset after a wheel before any pointer event", () => {
    const shell = FakeShell.local();
    shell.wheel(40, 30);
    expect(shell.state.pointer).toBeNull();
  });

  it("moves only the pointer on a wheel during a middle-button pan; the tool is told when the pan ends", () => {
    const shell = FakeShell.local();
    shell.key("z"); // the zone placeholder clears `snap` on any pointer event it sees
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    // A stale pan anchor on purpose: a replay through the pan branch would pan by the difference.
    shell.state = { ...shell.state, snap: GRID_SNAP, panDrag: { x: 0, y: 0 } };
    const center = shell.state.camera.center;
    shell.wheel(40, 0);
    expect(shell.state.camera.center).toEqual({ x: center.x + 0.5, y: center.y });
    expect(shell.state.panDrag).toEqual({ x: 0, y: 0 });
    expectPointerOnCamera(shell);
    expect(shell.state.snap).toEqual(GRID_SNAP);
    shell.send({ type: "pointerUp", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expect(shell.state.snap).toBeNull();
  });

  it("keeps a wall chain, its snap and hover when undo or redo is refused", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const hover: EntityRef = { table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) };
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.state = { ...shell.state, tool: WALL_DRAWING, snap: GRID_SNAP, hover };
    const before = shell.state;
    shell.key("z", { meta: true });
    expect(shell.view().toast).toBe("Nothing to undo");
    expect(shell.state).toEqual({ ...before, toast: shell.state.toast });
    shell.ui({ type: "redo" });
    expect(shell.view().toast).toBe("Nothing to redo");
    expect(shell.state).toEqual({ ...before, toast: shell.state.toast });
  });

  it("drops a wall chain on an applied undo or redo, from the keyboard and the toolbar", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const wall = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wall }] };
    shell.key("Delete");
    expect(shell.doc().walls[wall]).toBeUndefined();
    shell.key("w");
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    const startChain = (): void => {
      shell.state = { ...shell.state, tool: WALL_DRAWING, snap: GRID_SNAP };
    };
    const expectChainDropped = (): void => {
      expect(shell.state.tool).toEqual(idleTool("wall"));
      expect(shell.state.snap).toEqual({ point: { x: -3.2, y: 5.8 }, kind: "grid" }); // the replay rebuilds it at the cursor
      expect(shell.state.toast).toBeNull();
    };
    startChain();
    shell.key("z", { meta: true });
    expect(shell.doc().walls[wall]).toBeDefined();
    expectChainDropped();
    startChain();
    shell.ui({ type: "redo" });
    expect(shell.doc().walls[wall]).toBeUndefined();
    expectChainDropped();
    startChain();
    shell.ui({ type: "undo" });
    expect(shell.doc().walls[wall]).toBeDefined();
    expectChainDropped();
    startChain();
    shell.key("z", { ctrl: true, shift: true });
    expect(shell.doc().walls[wall]).toBeUndefined();
    expectChainDropped();
  });

  // Added in review (task 3.10): each test below kills a mutation of the render effect or the key routing.
  it("builds the render effect's camera and scene from the state after the event", () => {
    const shell = FakeShell.local();
    const effects = shell.wheel(0, -100, { ctrl: true });
    const render = effects[effects.length - 1];
    expect(render?.type).toBe("render");
    if (render?.type !== "render") return;
    expect(render.camera).toEqual(shell.state.camera);
    expect(render.scene).toEqual(buildScene(shell.state, shell.host));
  });

  it("builds the render effect's view from the state after the event", () => {
    const shell = FakeShell.local();
    const effects = shell.send({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    const render = effects[effects.length - 1];
    expect(render?.type === "render" ? render.view.activeTool : null).toBe("wall");
  });

  it("deletes nothing while the Select tool is moving, or with Ctrl held", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const wallId = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    shell.click({ x: 3, y: 0 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: wallId }]);
    shell.key("Delete", { ctrl: true });
    expect(shell.doc().walls[wallId]).toBeDefined();
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 3, y: -0.6 });
    expect(shell.state.tool).toMatchObject({ name: "select", state: { kind: "moving" } });
    shell.key("Delete");
    expect(shell.doc().walls[wallId]).toBeDefined();
  });

  it("treats Shift+Z as redo when the key arrives upper-case", () => {
    const shell = FakeShell.local();
    shell.key("Z", { meta: true, shift: true });
    expect(shell.view().toast).toBe("Nothing to redo");
  });

  it("pans vertically with the wheel and with a middle-button drag", () => {
    const shell = FakeShell.local();
    shell.wheel(0, 40);
    expect(shell.state.camera.center).toEqual({ x: 3, y: 1.5 });
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 100, y: 180 }, mods: NO_MODS, button: 1 });
    expect(shell.state.camera.center).toEqual({ x: 3, y: 2.5 });
  });

  it("ends a middle-button pan on any button's pointerUp", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerUp", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    expect(shell.state.panDrag).toBeNull();
  });

  it("ignores modifier-only keys and Space outside a value field (spec §5.4)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) }] };
    const before = shell.state;
    shell.key("Shift", { shift: true });
    shell.key("Control", { ctrl: true });
    shell.key("Meta", { meta: true });
    shell.key("Alt", { alt: true });
    shell.key(" ");
    expect(shell.state).toBe(before);
  });
});
