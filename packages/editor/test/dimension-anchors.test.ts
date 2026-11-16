import { describe, expect, it } from "vitest";
import { dimensionPoints, emptyDocument, rectangleRoom, type Dimension, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { jointAt, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Anchored and free ends through the Dimension tool (AC-03 to AC-06). R is the AC-04 rectangle, 3.2 × 2 with 0.20 m
// walls: inner face corners (0.1,0.1) (3.1,0.1) (3.1,1.9) (0.1,1.9). Zoom 80 unless said: tolerance 0.125 m, grid 0.2 m.

const P = (x: number, y: number): Point => ({ x, y });
const R = (): Document => withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 3.2, 2));
/** L: walls (0,0)–(3,0) and (3,0)–(3,2). */
const L = (): Document =>
  withCommands(
    emptyDocument(),
    { type: "addWall", opId: "w1", from: { at: P(0, 0) }, to: { at: P(3, 0) } },
    { type: "addWall", opId: "w2", from: { at: P(3, 0) }, to: { at: P(3, 2) } },
  );

const rows = (shell: FakeShell): Dimension[] => Object.values(shell.doc().dimensions);
const layer = (shell: FakeShell, name: string): readonly Primitive[] => shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
const texts = (shell: FakeShell): string[] => layer(shell, "dimensions").flatMap((p) => (p.kind === "text" ? [p.text] : []));

/** A fresh shell on `doc` at `zoom` with the Dimension tool picked. */
function armed(doc: Document, zoom = 80): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
  shell.key("m");
  return shell;
}

function place(shell: FakeShell, a: Point, b: Point, at: Point): void {
  shell.click(a);
  shell.click(b);
  shell.click(at);
}

function expectNear(actual: Point | undefined, x: number, y: number, digits: number): void {
  expect(actual?.x).toBeCloseTo(x, digits);
  expect(actual?.y).toBeCloseTo(y, digits);
}

describe("anchored ends through the Dimension tool", () => {
  it("hovering an inner face corner shows the endpoint square and anchors the end there (AC-03)", () => {
    const shell = armed(R());
    shell.moveTo(P(3.07, 0.13));
    expect(shell.state.snap?.kind).toBe("endpoint");
    expectNear(shell.state.snap?.point, 3.1, 0.1, 9);
    const r = 5 / 80;
    const p = shell.state.snap?.point ?? P(NaN, NaN);
    expect(layer(shell, "overlays")).toContainEqual(expect.objectContaining({
      kind: "segment", a: P(p.x - r, p.y - r), b: P(p.x + r, p.y - r), color: COLORS.snap,
    }));
    place(shell, P(3.07, 0.13), P(0.12, 0.08), P(1.6, 0.5));
    const [row, ...more] = rows(shell);
    expect(more).toEqual([]);
    const a = row?.a;
    expect(a && "joint" in a ? a.joint : null).toBe(jointAt(shell.doc(), P(3.2, 0)));
    expect(a && "joint" in a ? a.tx : NaN).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(a && "joint" in a ? a.ty : NaN).toBeCloseTo(Math.SQRT1_2, 6);
    const pts = row ? dimensionPoints(shell.doc(), row) : null;
    expectNear(pts?.a, 3.1, 0.1, 9);
    expectNear(pts?.b, 0.1, 0.1, 9);

    // At zoom 50 the centre (0.042 away) beats the corner (0.099 away): an end on the joint itself.
    const far = armed(R(), 50);
    place(far, P(3.17, 0.03), P(1.6, 1.0), P(1.6, 1.5));
    expect(rows(far).map((d) => d.a)).toEqual([{ joint: jointAt(far.doc(), P(3.2, 0)), tx: 0, ty: 0 }]);
  });

  it("dragging a corner moves the anchored end with the mitre, writing no dimension row (AC-04)", () => {
    const shell = armed(R());
    place(shell, P(0.12, 0.08), P(3.08, 0.12), P(1.6, 0.5));
    expect(texts(shell)).toEqual(["3.00"]);
    shell.key("v");
    shell.moveTo(P(3.2, 0));
    shell.down(P(3.2, 0));
    shell.moveTo(P(3.6, 0));
    // The inner corner is now (3.478, 0.1). 3.40 is a fixed offset from the joint centre, 3.60 centre anchors, 3.00 free ends.
    expect(texts(shell)).toEqual(["3.38"]);
    shell.up(P(3.6, 0));
    expect(texts(shell)).toEqual(["3.38"]);
    const patch = shell.state.undo.past.at(-1)?.patch;
    expect(patch?.puts.length).toBeGreaterThan(0);
    expect(patch?.puts.filter((p) => p.table === "dimensions")).toEqual([]);
    expect(patch?.deletes.filter((d) => d.table === "dimensions")).toEqual([]);
  });

  it("free ends keep their coordinates when walls move (AC-05)", () => {
    const shell = armed(R());
    place(shell, P(1.03, 1.02), P(2.03, 0.14), P(2.0, 1.2)); // grid (1,1), then the face point (2.03,0.1)
    const placed = rows(shell);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.a).toEqual({ x: 1, y: 1 });
    const b = placed[0]?.b;
    expect(b && "joint" in b).toBe(false);
    expectNear(b && !("joint" in b) ? b : undefined, 2.03, 0.1, 9);
    const before = placed.map((d) => dimensionPoints(shell.doc(), d));
    shell.key("v");
    shell.moveTo(P(2.6, 0));
    shell.down(P(2.6, 0));
    shell.moveTo(P(2.6, -0.4));
    shell.up(P(2.6, -0.4));
    expect(jointAt(shell.doc(), P(0, -0.4))).toBeTruthy(); // the bottom wall moved: its inner face is at y = −0.3
    expect(rows(shell)).toEqual(placed);
    expect(rows(shell).map((d) => dimensionPoints(shell.doc(), d))).toEqual(before);
  });

  it("deleting a wall takes the dimension anchored to the joint that goes with it; undo restores both (AC-06)", () => {
    const shell = armed(L());
    place(shell, P(3, 2), P(0.02, 2.03), P(1.5, 2.4)); // dimension 1: the centre (3,2), then (0,2)
    place(shell, P(0, 0), P(3, 0), P(1.5, -0.6)); // dimension 2: joints (0,0) and (3,0)
    expect(rows(shell)).toHaveLength(2);
    const top = jointAt(shell.doc(), P(3, 2));
    const keep = rows(shell).find((d) => !("joint" in d.a && d.a.joint === top));
    expect(rows(shell).find((d) => "joint" in d.a && d.a.joint === top)?.a).toEqual({ joint: top, tx: 0, ty: 0 });
    const captured = shell.doc();
    const past = shell.state.undo.past.length;
    shell.key("v");
    shell.click(P(3, 1));
    shell.key("Delete");
    expect(shell.doc().joints[top]).toBeUndefined();
    expect(rows(shell)).toEqual([keep]);
    expect(shell.state.undo.past.length).toBe(past + 1);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(captured);
  });
});

describe("the other tools keep the global snap list", () => {
  it("the Wall tool and joint drags snap as before", () => {
    const wall = FakeShell.withDocument(roomDoc());
    wall.key("w");
    wall.moveTo(P(1.53, 0.09));
    expect(wall.state.snap?.kind).toBe("onWall");
    expectNear(wall.state.snap?.point, 1.53, 0, 9);
    wall.key("Escape");
    wall.key("m");
    wall.moveTo(P(1.53, 0.09));
    expect(wall.state.snap?.kind).toBe("onWall");
    expectNear(wall.state.snap?.point, 1.53, 0.1, 9);

    const drag = FakeShell.withDocument(withCommands(roomDoc(), { type: "addWall", opId: "x", from: { at: P(8, 0) }, to: { at: P(8, 2) } }));
    drag.key("v");
    drag.moveTo(P(8, 2));
    drag.down(P(8, 2));
    drag.moveTo(P(6.09, 2.6));
    expect(drag.state.snap?.kind).toBe("onWall"); // the centre line, not the face point (6.1, 2.6)
    expectNear(drag.state.snap?.point, 6, 2.6, 9);
  });
});
