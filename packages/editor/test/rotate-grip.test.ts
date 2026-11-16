import { describe, expect, it } from "vitest";
import { footprints, validateDocument, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Mods } from "../src/types";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import { LAYER_ORDER } from "../src/view/scene";
import type { LayerName, Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The rotation grip (direct.05, direct.17, direct.18; AC-05). The chair (0.45 × 0.45) anchored at (3, 1.725) is
// centred on (3, 1.5). `chairBy(deg)` adds a free-standing 2 m wall at `deg` whose centre line passes 0.5 m from that
// centre on the side (−sin deg, cos deg): at rotation 0 the chair's nearest corner is 0.093 m (30°) or 0.112 m (20°)
// off the wall body, within the 0.15 m "near" distance; turned, it is no longer near, so cases do not chain.
const CENTRE = { x: 3, y: 1.5 };
const CHAIR: Command = { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 1.725 }, rotation: 0 };
const WALLS: Record<number, [Point, Point]> = { 30: [{ x: 1.884, y: 1.433 }, { x: 3.616, y: 2.433 }], 20: [{ x: 1.889, y: 1.628 }, { x: 3.769, y: 2.312 }] };

function chairBy(deg: 30 | 20): Document {
  const [from, to] = WALLS[deg] ?? [];
  if (!from || !to) throw new Error("no wall");
  return withCommands(roomDoc(), { type: "addWall", opId: "s", from: { at: from }, to: { at: to } }, CHAIR);
}

const noWall = (): Document => withCommands(roomDoc(), CHAIR);

/** The point at θ degrees from the centre, 1 m out, in the front's direction at rotation θ. */
const towards = (deg: number): Point => ({ x: CENTRE.x + Math.sin((deg * Math.PI) / 180), y: CENTRE.y - Math.cos((deg * Math.PI) / 180) });

/** The selected piece's rotation grip, from the handle list the scene and the hit test share. */
function gripOf(shell: FakeShell): Point {
  const g = handles(shell.state, shell.doc()).find((h) => h.kind === "rotate");
  if (!g) throw new Error("no rotation grip");
  return g.at;
}

/** Selects the chair and drags its rotation grip to the point at θ degrees. */
function turnTo(shell: FakeShell, deg: number, mods?: Partial<Mods>): void {
  shell.click(CENTRE);
  shell.drag(gripOf(shell), towards(deg), mods);
}

function turned(doc: Document, deg: number, mods?: Partial<Mods>): number | undefined {
  const shell = FakeShell.withDocument(doc);
  turnTo(shell, deg, mods);
  return shell.doc().placements["c/p0"]?.rotation;
}

function centreOf(doc: Document, id: string): Point {
  const q = footprints(doc).get(id) ?? [];
  return { x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length };
}

function layer(shell: FakeShell, name: LayerName): readonly Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}

function moving(shell: FakeShell) {
  const t = shell.state.tool;
  return t.name === "select" && t.state.kind === "moving" ? t.state : null;
}

const texts = (shell: FakeShell, text: string) => layer(shell, "annotations").filter((p) => p.kind === "text" && p.text === text);

describe("rotation grip", () => {
  it("the fixtures are valid", () => {
    expect(validateDocument(chairBy(30)).ok).toBe(true);
    expect(validateDocument(chairBy(20)).ok).toBe(true);
    expect(validateDocument(noWall()).ok).toBe(true);
  });

  it("AC-05: near a 30° wall, a drag to 32° commits 30° and keeps the centre", () => {
    const shell = FakeShell.withDocument(chairBy(30));
    turnTo(shell, 32);
    expect(shell.doc().placements["c/p0"]?.rotation).toBe(30);
    const c = centreOf(shell.doc(), "c/p0");
    expect(Math.abs(c.x - CENTRE.x)).toBeLessThanOrEqual(0.0015);
    expect(Math.abs(c.y - CENTRE.y)).toBeLessThanOrEqual(0.0015);
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(shell.doc().placements["c/p0"]?.rotation).toBe(0);
  });

  it("AC-05: with Ctrl, a drag to 37° commits 37°, even near the 30° wall", () => {
    const shell = FakeShell.withDocument(chairBy(30));
    turnTo(shell, 37, { ctrl: true });
    expect(shell.doc().placements["c/p0"]?.rotation).toBe(37);
    const c = centreOf(shell.doc(), "c/p0");
    expect(Math.abs(c.x - CENTRE.x)).toBeLessThanOrEqual(0.0015);
    expect(Math.abs(c.y - CENTRE.y)).toBeLessThanOrEqual(0.0015);
    expect(turned(chairBy(30), 37)).toBe(30);
  });

  // AC-05's 30° wall is itself a multiple of 15°: only a 20° wall proves the wall candidate is used.
  it.each([[22, 20], [18, 20], [24, 30], [112, 110]])("near a 20° wall the wall angle beats the 15° step: %s° → %s", (deg, expected) => {
    expect(turned(chairBy(20), deg)).toBe(expected);
  });

  it("away from walls the 15° step applies", () => {
    expect(turned(noWall(), 22)).toBe(15);
    expect(turned(noWall(), 37)).toBe(30);
  });

  it("the rotation grip draws a circular arrow (AC-01)", () => {
    // A selected bed: at its grip, a white 5 px disc beneath (in an earlier layer: WebGL draws a layer's discs after
    // its arcs), a blue open arc of about 270°, 3 px round, and a blue arrowhead triangle at the arc's end.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 } }));
    shell.click({ x: 3, y: 2.85 });
    const grip = gripOf(shell);
    const zoom = shell.state.camera.zoom;
    const scene = shell.scene();
    const at = (c: Point): boolean => Math.hypot(c.x - grip.x, c.y - grip.y) * zoom < 1e-6;
    const all = scene.layers.flatMap((l) => l.primitives.map((p) => ({ layer: LAYER_ORDER.indexOf(l.name), p })));
    const discs = (px: number) => all.flatMap(({ layer, p }) => (p.kind === "disc" && at(p.center) && "px" in p.radius && p.radius.px === px ? [{ layer, p }] : []));
    const backs = discs(5).filter((d) => d.p.color === COLORS.handle);
    const arcs = all.flatMap(({ layer, p }) => (p.kind === "arc" && at(p.center) && p.color === COLORS.wallSelected ? [{ layer, p }] : []));
    expect(backs).toHaveLength(1);
    expect(arcs).toHaveLength(1);
    const arc = arcs[0];
    const back = backs[0];
    if (!arc || !back) throw new Error("no grip");
    expect(back.layer).toBeLessThan(arc.layer);
    expect(arc.p.radius * zoom).toBeCloseTo(3, 9);
    expect(arc.p.width).toEqual({ px: 1.5 });
    const span = ((arc.p.to - arc.p.from) * 180) / Math.PI;
    expect(span).toBeGreaterThanOrEqual(250);
    expect(span).toBeLessThanOrEqual(290);
    const end = { x: grip.x + arc.p.radius * Math.cos(arc.p.to), y: grip.y + arc.p.radius * Math.sin(arc.p.to) };
    const near = (v: Point): boolean => Math.hypot(v.x - end.x, v.y - end.y) * zoom <= 4;
    const heads = all.filter(({ p }) => p.kind === "polygon" && p.color === COLORS.wallSelected && p.points.length === 3 && p.points.every(near));
    expect(heads).toHaveLength(1);
    expect(discs(3.5)).toEqual([]); // not the old plain grip
  });

  it("the turn is measured from the press, so grabbing the grip off its centre does not jump", () => {
    // 7 px beside the grip is still within HANDLE_HIT_PX; the angle to that point is about 9.5°, which would step to 15.
    // The drag goes out along the same ray, so the turn since the press is 0.
    const shell = FakeShell.withDocument(noWall());
    shell.click(CENTRE);
    const grip = gripOf(shell);
    const off = { x: grip.x + 7 / shell.state.camera.zoom, y: grip.y };
    const out = { x: CENTRE.x + 2 * (off.x - CENTRE.x), y: CENTRE.y + 2 * (off.y - CENTRE.y) };
    shell.moveTo(off);
    shell.down(off);
    shell.moveTo(out);
    expect(moving(shell)?.target).toEqual({ kind: "rotate", placementId: "c/p0" });
    shell.up(out);
    expect(shell.doc().placements["c/p0"]?.rotation).toBe(0);
  });

  it("pressing the grip starts a rotate drag, not a move", () => {
    const shell = FakeShell.withDocument(chairBy(30));
    shell.click(CENTRE);
    const grip = gripOf(shell);
    shell.moveTo(grip);
    shell.down(grip);
    shell.moveTo(towards(32));
    expect(moving(shell)?.target).toEqual({ kind: "rotate", placementId: "c/p0" });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "c/p0" }]);
  });

  it("AC-05: the angle is drawn by the grip while dragging", () => {
    const shell = FakeShell.withDocument(chairBy(30));
    shell.click(CENTRE);
    const grip = gripOf(shell);
    shell.moveTo(grip);
    shell.down(grip);
    shell.moveTo(towards(32));
    // At 30° the front faces (sin 30, −cos 30); the label sits 0.225 + (24 + 16) / 80 = 0.725 m from the centre,
    // to within a millimetre (anchors are rounded to the millimetre).
    const label = texts(shell, "30°");
    expect(label).toEqual([expect.objectContaining({ color: COLORS.text })]);
    const at = label[0]?.kind === "text" ? label[0].at : null;
    expect(Math.abs((at?.x ?? 0) - (CENTRE.x + 0.725 * Math.sin(Math.PI / 6)))).toBeLessThanOrEqual(1e-3);
    expect(Math.abs((at?.y ?? 0) - (CENTRE.y - 0.725 * Math.cos(Math.PI / 6)))).toBeLessThanOrEqual(1e-3);
    shell.up(towards(32));
    expect(texts(shell, "30°")).toHaveLength(0);
  });

  it("a refused turn is red and commits nothing", () => {
    // The desk spans y 0.1–0.7 with its back on the bottom wall face, centre (3, 0.4); its grip is on the +y side.
    // The raw angle is 180 + 90 − 180 = 90; the bottom wall is near, so 90 is tried, and a desk at 90 overlaps it.
    const doc = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 0.1 }, rotation: 180 });
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 3, y: 0.4 });
    const before = shell.doc();
    const grip = gripOf(shell);
    expect(grip.y).toBeGreaterThan(0.7);
    shell.moveTo(grip);
    shell.down(grip);
    shell.moveTo({ x: 4, y: 0.4 });
    expect(moving(shell)?.attempt.ok).toBe(false);
    expect(layer(shell, "overlays").filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill).length).toBeGreaterThan(0);
    expect(texts(shell, "90°")).toEqual([expect.objectContaining({ color: COLORS.invalid })]);
    shell.up({ x: 4, y: 0.4 });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("Desk (0.00–0.75) overlaps a wall in Layout");
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("Esc during the drag cancels it", () => {
    const shell = FakeShell.withDocument(chairBy(30));
    shell.click(CENTRE);
    const grip = gripOf(shell);
    shell.moveTo(grip);
    shell.down(grip);
    shell.moveTo(towards(32));
    shell.key("Escape");
    shell.up(towards(32));
    expect(shell.doc().placements["c/p0"]?.rotation).toBe(0);
    expect(shell.state.undo.past).toHaveLength(0);
  });
});
