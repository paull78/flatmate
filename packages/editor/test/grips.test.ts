import { describe, expect, it } from "vitest";
import { footprintQuad, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { GESTURE_CANCELLED } from "../src/gestures";
import { tryCommand } from "../src/tools/drag-commit";
import { COLORS } from "../src/view/colors";
import type { LayerName, Primitive } from "../src/view/scene-types";
import { roomDoc, sofaBed200, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// Side grips and the resize drag (direct.03, direct.04, direct.06; AC-01 to AC-04). The room's inner faces are at
// x 0.1 / 5.9 and y 0.1 / 3.9. The sofa bed in its sofa configuration is 2 × 0.9 (direct.19): anchored at (2, 3) it
// spans x 1–3, y 2.1–3, centre (2, 2.55); its grips are right (3, 2.55), left (1, 2.55), front (2, 2.1), back (2, 3).
const SOFA: Command = { type: "placeObject", linked: false, deck: null, opId: "sofa", state: "s0", object: { kind: "sofaBed" }, at: { x: 2, y: 3 } };
const CENTRE = { x: 2, y: 2.55 };
const RIGHT = { x: 3, y: 2.55 };
const sofaDoc = (): Document => withCommands(roomDoc(), SOFA, sofaBed200("sofa/o0"));
/** The sofa in Layout (s0) and in Night (n/s0) anchored at (4, 2): x 3–5, y 1.1–2. */
const twoLayouts = (): Document => withCommands(
  roomDoc(),
  { type: "addState", opId: "n", name: "Night" },
  SOFA,
  { type: "placeObject", linked: false, deck: null, opId: "s2", state: "n/s0", object: { existing: "sofa/o0" }, at: { x: 4, y: 2 } },
  sofaBed200("sofa/o0"),
);
const piece = (id: string) => ({ table: "placements", id });

function layer(shell: FakeShell, name: LayerName): readonly Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}

function polygons(shell: FakeShell, color: string): number {
  return layer(shell, "overlays").filter((p) => p.kind === "polygon" && p.color === color).length;
}

function moving(shell: FakeShell) {
  const t = shell.state.tool;
  return t.name === "select" && t.state.kind === "moving" ? t.state : null;
}

/** A fresh shell on `doc` (at `zoom`), the piece under `select` selected by a click. */
function selected(doc: Document, select: Point, zoom = 80): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
  shell.click(select);
  return shell;
}

/** Drags a grip of the sofa on a fresh sofaDoc and returns the sofa's committed width, depth and anchor. */
function resized(from: Point, to: Point, ctrl: boolean, zoom = 80) {
  const shell = selected(sofaDoc(), CENTRE, zoom);
  shell.drag(from, to, { ctrl });
  const d = shell.doc();
  return { w: d.objects["sofa/o0"]?.w.sofa, d: d.objects["sofa/o0"]?.d.sofa, at: d.placements["sofa/p0"]?.at };
}

const near = (x: number, y: number) => ({ x: expect.closeTo(x, 9), y: expect.closeTo(y, 9) });

describe("grips (direct.03, AC-01)", () => {
  it("selecting the sofa shows four side grips and a rotation grip; a wall shows only its joint handles (AC-01)", () => {
    const shell = selected(sofaDoc(), CENTRE);
    expect(polygons(shell, COLORS.wallSelected)).toBe(5); // four grip squares and the rotation arrow's head
    expect(polygons(shell, COLORS.handle)).toBe(4);
    // A ring disc and a fill disc for each of the 4 zone chips (smart.24), and two discs for each of the front zone's
    // 3 handles (furnish.20); the rotation grip's white disc lies in the annotations layer, under its arrow.
    expect(layer(shell, "overlays").filter((p) => p.kind === "disc")).toHaveLength(14);
    expect(layer(shell, "overlays").filter((p) => p.kind === "arc")).toHaveLength(1);
    shell.click({ x: 6, y: 2 }); // the right wall
    expect(layer(shell, "overlays").filter((p) => p.kind === "polygon")).toHaveLength(0);
    expect(layer(shell, "overlays").filter((p) => p.kind === "disc")).toHaveLength(4);
  });

  it("a group shows no grips (AC-01)", () => {
    const doc = withCommands(sofaDoc(), { type: "placeObject", linked: false, deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 4.5, y: 1.5 } });
    const shell = selected(doc, CENTRE);
    shell.click({ x: 4.5, y: 1.275 }, { shift: true });
    expect(shell.state.selection).toHaveLength(2);
    expect(polygons(shell, COLORS.wallSelected)).toBe(0);
  });
});

describe("resize drag (direct.04, direct.06, AC-02 to AC-04)", () => {
  it("dragging the right grip of the 2.00 × 0.90 sofa by +0.30 with Ctrl makes it 2.30 wide, left side kept; Night keeps its back edge; one undo (AC-02)", () => {
    const shell = selected(twoLayouts(), CENTRE);
    shell.moveTo(RIGHT, { ctrl: true });
    shell.down(RIGHT, { ctrl: true });
    shell.moveTo({ x: 3.15, y: 2.55 }, { ctrl: true });
    shell.moveTo({ x: 3.3, y: 2.55 }, { ctrl: true });
    const m = moving(shell);
    expect(m && tryCommand(m.target, m.attempt.tried)).toEqual({ type: "resizePlacement", placementId: "sofa/p0", side: "right", size: 2.3 });
    shell.up({ x: 3.3, y: 2.55 }, { ctrl: true });
    const d = shell.doc();
    expect(d.objects["sofa/o0"]).toMatchObject({ w: { sofa: 2.3, bed: 2.3 }, d: { sofa: 0.9, bed: 1.6 } });
    expect(d.placements["sofa/p0"]?.at).toEqual({ x: 2.15, y: 3 });
    expect(d.placements["s2/p0"]?.at).toEqual({ x: 4, y: 2 });
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection).toEqual([piece("sofa/p0")]);
    shell.key("z", { meta: true });
    expect(shell.doc().objects["sofa/o0"]?.w.sofa).toBe(2);
    expect(shell.doc().objects["sofa/o0"]?.w.bed).toBe(2);
    expect(shell.doc().placements["sofa/p0"]?.at).toEqual({ x: 2, y: 3 });
  });

  it("left, front and back grips keep the opposite side (AC-02)", () => {
    expect(resized({ x: 1, y: 2.55 }, { x: 0.6, y: 2.55 }, true)).toEqual({ w: 2.4, d: 0.9, at: { x: 1.8, y: 3 } });
    expect(resized({ x: 2, y: 2.1 }, { x: 2, y: 1.8 }, true)).toEqual({ w: 2, d: 1.2, at: { x: 2, y: 3 } });
    expect(resized({ x: 2, y: 3 }, { x: 2, y: 3.2 }, true)).toEqual({ w: 2, d: 1.1, at: { x: 2, y: 3.2 } });
  });

  it("a resize that breaks Night's fit draws red and commits nothing (AC-03)", () => {
    const shell = selected(twoLayouts(), CENTRE);
    const before = shell.doc();
    shell.moveTo(RIGHT);
    shell.down(RIGHT);
    shell.moveTo({ x: 5, y: 2.55 }, { ctrl: true }); // 4 m wide: Night would span x 2–6
    expect(moving(shell)?.attempt.ok).toBe(false);
    const overlays = layer(shell, "overlays");
    expect(overlays).toContainEqual({ kind: "disc", center: near(5, 2.55), radius: { px: 4 }, color: COLORS.invalid });
    const red = overlays.filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill);
    expect(red).toHaveLength(1);
    expect(red[0]).toMatchObject({ points: footprintQuad({ x: 3, y: 3 }, 4, 0.9, 0).map((p) => near(p.x, p.y)) });
    expect(layer(shell, "annotations")).toContainEqual(expect.objectContaining({ kind: "text", text: "4.00 m", color: COLORS.invalid }));
    shell.up({ x: 5, y: 2.55 }, { ctrl: true });
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.view().toast).toBe("Sofa bed (0.00–0.90) overlaps a wall in Night");
    // In the active layout the refused piece is drawn once, as the red ghost with its symbol, not also as blocked.
    shell.moveTo({ x: 1, y: 2.55 });
    shell.down({ x: 1, y: 2.55 });
    shell.moveTo({ x: 0, y: 2.55 }, { ctrl: true });
    const ghost = layer(shell, "overlays");
    expect(ghost.filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill)).toHaveLength(1);
    expect(ghost.some((p) => p.kind !== "disc" && p.color === COLORS.invalid)).toBe(true);
    shell.up({ x: 0, y: 2.55 }, { ctrl: true });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("Sofa bed (0.00–0.90) overlaps a wall in Layout");
  });

  it("a resize into another piece draws both red and commits nothing (AC-03)", () => {
    // The chair anchored at (3.5, 3) spans x 3.275–3.725, y 2.55–3.
    const doc = withCommands(sofaDoc(), { type: "placeObject", linked: false, deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 3.5, y: 3 } });
    const shell = selected(doc, CENTRE);
    const before = shell.doc();
    shell.moveTo(RIGHT);
    shell.down(RIGHT);
    shell.moveTo({ x: 3.5, y: 2.55 }, { ctrl: true });
    expect(moving(shell)?.attempt.ok).toBe(false);
    expect(polygons(shell, COLORS.invalidFill)).toBe(2); // the ghost and the chair
    shell.up({ x: 3.5, y: 2.55 }, { ctrl: true });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("Chair (0.00–0.90) and Sofa bed (0.00–0.90) overlap in Layout");
  });

  it("the size moves in the snap step, snaps flush to a wall face, and follows the cursor with Ctrl (AC-04)", () => {
    expect(resized(RIGHT, { x: 3.27, y: 2.55 }, false).w).toBeCloseTo(2.2, 9);
    expect(resized(RIGHT, { x: 3.27, y: 2.55 }, true).w).toBeCloseTo(2.27, 9);
    expect(resized(RIGHT, { x: 5.83, y: 2.55 }, false)).toMatchObject({ w: 4.9, at: { x: 3.45, y: 3 } });
    expect(resized(RIGHT, { x: 5.75, y: 2.55 }, false).w).toBeCloseTo(4.8, 9);
    expect(resized(RIGHT, { x: 5.95, y: 2.55 }, false).w).toBeCloseTo(4.9, 9);
    expect(resized(RIGHT, { x: 3.27, y: 2.55 }, false, 160).w).toBeCloseTo(2.3, 9); // step 0.1
  });

  it("dragged toward a neighbouring desk, the grip snaps flush to its face (furnish.61, AC-13)", () => {
    // The desk's left face is x 3.53, off the 0.2 step: flush gives 2.53, the step alone 2.6.
    const doc = withCommands(sofaDoc(), { type: "placeObject", linked: false, deck: null, opId: "desk", state: "s0", object: { kind: "desk", size: { w: 1.2, d: 0.6 } }, at: { x: 4.13, y: 2.85 } });
    const shell = selected(doc, CENTRE);
    shell.drag(RIGHT, { x: 3.5, y: 2.55 }, {});
    expect(shell.doc().objects["sofa/o0"]?.w.sofa).toBeCloseTo(2.53, 9);
  });

  it("the new size is drawn by the grip while dragging (AC-04)", () => {
    const shell = selected(sofaDoc(), CENTRE);
    shell.moveTo(RIGHT);
    shell.down(RIGHT);
    shell.moveTo({ x: 3.27, y: 2.55 });
    const annotations = layer(shell, "annotations");
    expect(annotations).toContainEqual(expect.objectContaining({ kind: "text", text: "2.20 m", color: COLORS.text, at: near(3.2 + 28 / 80, 2.55) }));
    expect(annotations.some((p) => p.kind === "polygon" && p.color === COLORS.background)).toBe(true);
  });

  it("a small object's body still drags; its outside grip resizes", () => {
    // A chair (0.45 × 0.45) anchored at (3, 2.25): x 2.775–3.225, y 1.8–2.25; 22.5 px at zoom 50, so its grips sit outside.
    const doc = withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2.25 } });
    const body = selected(doc, { x: 3, y: 2.025 }, 50);
    body.drag({ x: 3, y: 2.025 }, { x: 3.5, y: 2.025 }, { ctrl: true });
    expect(body.doc().placements["chair/p0"]?.at.x).toBeCloseTo(3.5, 9);
    expect(body.doc().objects["chair/o0"]?.w.standard).toBe(0.45);
    const grip = selected(doc, { x: 3, y: 2.025 }, 50);
    grip.drag({ x: 3.385, y: 2.025 }, { x: 3.585, y: 2.025 }, { ctrl: true });
    expect(grip.doc().objects["chair/o0"]?.w.standard).toBeCloseTo(0.65, 9);
  });

  it("a turned sofa resizes along its own axis", () => {
    // At rotation 90 the sofa anchored at (2, 2) spans x 2–2.9, y 1–3; local +x is world +y.
    const doc = withCommands(roomDoc(), { ...SOFA, at: { x: 2, y: 2 }, rotation: 90 }, sofaBed200("sofa/o0"));
    const shell = selected(doc, { x: 2.45, y: 2 });
    shell.drag({ x: 2.45, y: 3 }, { x: 2.45, y: 3.2 }, { ctrl: true });
    expect(shell.doc().objects["sofa/o0"]?.w.sofa).toBeCloseTo(2.2, 9);
    expect(shell.doc().placements["sofa/p0"]?.at).toEqual({ x: 2, y: 2.1 });
  });

  it("Esc during a resize cancels it", () => {
    const shell = selected(sofaDoc(), CENTRE);
    const before = shell.doc();
    shell.moveTo(RIGHT);
    shell.down(RIGHT);
    shell.moveTo({ x: 3.4, y: 2.55 });
    expect(moving(shell)?.target).toEqual({ kind: "resize", placementId: "sofa/p0", side: "right" });
    shell.key("Escape");
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    shell.up({ x: 3.4, y: 2.55 });
    expect(shell.doc()).toBe(before);
  });

  it("a remote move of the sofa in Night cancels the resize", () => {
    const r = FakeRemote.open(twoLayouts());
    r.shell.click(CENTRE);
    r.shell.moveTo(RIGHT);
    r.shell.down(RIGHT);
    r.shell.moveTo({ x: 3.3, y: 2.55 }, { ctrl: true });
    expect(moving(r.shell)?.target.kind).toBe("resize");
    r.remote({ type: "movePlacement", placementId: "s2/p0", at: { x: 4, y: 1.9 }, rotation: 0 });
    expect(r.shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.up({ x: 3.3, y: 2.55 }, { ctrl: true });
    expect(r.submits()).toEqual([]);
  });
});
