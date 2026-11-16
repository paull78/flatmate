import { describe, expect, it } from "vitest";
import { anchorAt, cross, footprintQuad, normalize, sub, wallBodies, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { flushTargets } from "../src/snapping/faces";
import { nearWalls } from "../src/snapping/near-walls";
import { pickSnap, type SnapTarget } from "../src/snapping/picker";
import { dividedRoomDoc, roomDoc, wallBetween, wallDoc, withCommands } from "./builders";

// The snapping modules under the furniture gestures (direct.17): one picker, the walls near a footprint, and the
// wall faces a footprint side can be sized flush to (direct.06, direct.19). They support AC-04 (resize flush to a
// face) and AC-05 (rotation to a wall's angle).

const target = <T>(value: number, distance: number, tag: T, tolerance = 0.125): SnapTarget<T> => ({ value, distance, tolerance, tag });

describe("pickSnap (direct.17; AC-04, AC-05)", () => {
  const pick = <T>(targets: SnapTarget<T>[], ctrl = false, stepped = 3.8, free = 3.87) => pickSnap({ targets, stepped, free, ctrl });

  it("the nearest target within its tolerance wins, whatever its place in the list (direct.17)", () => {
    const picked = pick([target(3.9, 0.1, "face"), target(3.85, 0.02, "guide")]);
    expect(picked.value).toBe(3.85);
    expect(picked.target?.tag).toBe("guide");
  });

  it("a target is in range up to and including its tolerance", () => {
    expect(pick([target(3.9, 0.125, "face")]).value).toBe(3.9);
    expect(pick([target(3.9, 0.13, "face")])).toEqual({ value: 3.8, target: null });
  });

  it("with nothing in range the step applies", () => {
    expect(pick([target(3.9, 0.3, "face")])).toEqual({ value: 3.8, target: null });
    expect(pick([])).toEqual({ value: 3.8, target: null });
  });

  it("each target has its own tolerance in its own unit", () => {
    // A rotation dragged to 40.5°, stepped to 45°: a wall angle 3.5° away is out of a 3° reach.
    expect(pick([target(37, 2.5, "wall", 3)], false, 45, 40.5).value).toBe(37);
    expect(pick([target(37, 3.5, "wall", 3)], false, 45, 40.5).value).toBe(45);
  });

  it("distances are compared raw, not as a fraction of the tolerance", () => {
    // 0.10 of 0.125 is 0.8 of its reach, 0.12 of 0.3 only 0.4: the raw distance still picks the face.
    expect(pick([target(3.9, 0.1, "face", 0.125), target(3.7, 0.12, "guide", 0.3)]).target?.tag).toBe("face");
  });

  it("ties go to the earlier target", () => {
    expect(pick([target(3.9, 0.05, "a"), target(3.85, 0.05, "b")]).target?.tag).toBe("a");
  });

  it("Ctrl skips every target and the step", () => {
    expect(pick([target(3.85, 0.02, "guide")], true)).toEqual({ value: 3.87, target: null });
  });
});

/** A w × d footprint centred on `centre` at `rotation`. */
const quadAt = (centre: Point, w: number, d: number, rotation: number): Point[] => footprintQuad(anchorAt(centre, d, rotation), w, d, rotation);
const desk = (x: number, y: number, rotation: number): Point[] => quadAt({ x, y }, 1.2, 0.6, rotation);

describe("nearWalls (AC-05 support)", () => {
  const doc = roomDoc();
  const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
  const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
  const top = wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });
  const left = wallBetween(doc, { x: 0, y: 4 }, { x: 0, y: 0 });
  const near = (x: number, y: number, rotation: number, reach?: number) => nearWalls(doc, desk(x, y, rotation), { x, y }, reach);

  it("a desk in the middle of the room is near no wall", () => {
    expect(near(3, 2, 0)).toEqual([]);
  });

  it("a desk across the bottom wall's centre line is at −0.10 m (minus half the thickness), angle 0, room above", () => {
    expect(near(3, 0.42, 90)).toEqual([{ wallId: bottom, distance: -0.1, angleDeg: 0, away: { x: 0, y: 1 } }]);
  });

  it("a desk in a corner lists both walls, nearest first, ties by wall id", () => {
    const walls = near(0.5, 0.45, 30);
    expect(walls.map((w) => w.wallId)).toEqual([bottom, left]);
    expect(walls.map((w) => w.angleDeg)).toEqual([0, 270]);
    expect(walls.map((w) => w.away)).toEqual([{ x: 0, y: 1 }, { x: 1, y: 0 }]);
    expect(walls.map((w) => w.distance)).toEqual([-0.1, -0.1]);
    // Top (at ~0) ahead of right (0.10), against wall id order.
    expect(near(5.2, 3.6, 0).map((w) => w.wallId)).toEqual([top, right]);
  });

  it("angles are whole degrees in [0, 360), along a→b", () => {
    const walls = near(5.55, 3.5, 137);
    expect(walls.map((w) => [w.wallId, w.angleDeg, w.away])).toEqual([[right, 90, { x: -1, y: 0 }], [top, 180, { x: 0, y: -1 }]]);
    // A 3-4-5 wall runs at 36.87°.
    expect(nearWalls(wallDoc({ x: 0, y: 0 }, { x: 4, y: 3 }), desk(2.6, 1, 37), { x: 2.6, y: 1 }, 0.5).map((w) => w.angleDeg)).toEqual([37]);
  });

  it("the reach is 0.15 m from the body, inclusive, and can be widened", () => {
    expect(near(3, 0.54, 0).map((w) => w.wallId)).toEqual([bottom]);
    const d = near(3, 0.54, 0)[0]?.distance ?? NaN;
    expect(near(3, 0.54, 0, d).map((w) => w.wallId)).toEqual([bottom]);
    expect(near(3, 0.56, 0)).toEqual([]);
    expect(near(3, 0.56, 0, 0.2).map((w) => w.wallId)).toEqual([bottom]);
  });

  it("a back edge flush on a face is at distance 0", () => {
    const walls = near(3, 3.6, 0);
    expect(walls.map((w) => w.wallId)).toEqual([top]);
    expect(walls[0]?.distance).toBeCloseTo(0, 9);
  });
});

describe("flushTargets (AC-04)", () => {
  const doc = roomDoc();
  // The sofa in its sofa configuration (2 × 0.9), spanning x 2–4 and y 1.55–2.45. 0.125 m is 10 px at zoom 80.
  const sofa = footprintQuad({ x: 3, y: 2.45 }, 2, 0.9, 0);
  const values = (d: Document, quad: readonly Point[], side: "left" | "right" | "back" | "front", raw = 1) => flushTargets(d, quad, side, raw, 0.125).map((t) => t.value);

  it("the right side reaches the right wall's inner face at 3.90 m", () => {
    const targets = flushTargets(doc, sofa, "right", 3.85, 0.125);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ value: 3.9, tolerance: 0.125, tag: wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 }) });
    expect(targets[0]?.distance).toBeCloseTo(0.05, 9);
  });

  it("each side measures from the opposite side", () => {
    expect(values(doc, sofa, "left")).toEqual([3.9]);
    expect(values(doc, sofa, "back")).toEqual([2.35]);
    expect(values(doc, sofa, "front")).toEqual([2.35]);
  });

  it("a turned piece uses its own axes", () => {
    const turned = footprintQuad({ x: 3, y: 2 }, 2, 0.9, 90);
    expect(turned.map((p) => [Math.round(p.x * 1e9) / 1e9, Math.round(p.y * 1e9) / 1e9])).toEqual([[3.9, 1], [3.9, 3], [3, 3], [3, 1]]);
    expect(values(doc, turned, "right")).toEqual([2.9]);
  });

  it("a wall beside the side's span gives no target", () => {
    const stub = withCommands(doc, { type: "addWall", opId: "stub", from: { at: { x: 5, y: 3 } }, to: { at: { x: 5, y: 3.8 } } });
    expect(values(stub, sofa, "right")).toEqual([3.9]);
  });

  it("a wall touching the side's span only at its end gives no target", () => {
    const stub = withCommands(doc, { type: "addWall", opId: "stub", from: { at: { x: 5, y: 2.45 } }, to: { at: { x: 5, y: 3.2 } } });
    expect(values(stub, sofa, "right")).toEqual([3.9]);
  });

  it("a face further than 10 m gives no target (MAX_OBJECT_SIZE)", () => {
    expect(values(wallDoc({ x: 12, y: 0 }, { x: 12, y: 4 }), footprintQuad({ x: 1, y: 2.3 }, 1.2, 0.6, 0), "right")).toEqual([]);
  });

  it("every wall body ahead gives its near face", () => {
    const quad = footprintQuad({ x: 1.1, y: 2.3 }, 1.2, 0.6, 0);
    expect(values(dividedRoomDoc(), quad, "right")).toEqual([2.4, 5.4]);
  });

  it("a face nearer than MIN_OBJECT_SIZE gives no target; 0.05 away now does (hangings.03)", () => {
    const quad = footprintQuad({ x: 2.95, y: 2.1 }, 0.2, 0.2, 0);
    expect(values(dividedRoomDoc(), quad, "right")).toEqual([0.05, 3.05]);
    const close = footprintQuad({ x: 2.89, y: 2.1 }, 0.2, 0.2, 0);
    expect(values(dividedRoomDoc(), close, "right").every((v) => v >= 0.02)).toBe(true);
  });

  it("a face more than 1° off the side gives no target", () => {
    const slanted = wallDoc({ x: 0, y: 0 }, { x: 4, y: 3 });
    expect(values(slanted, desk(2.6, 1.0, 35.8), "back")).toEqual([]);
    expect(values(slanted, desk(2.6, 1.0, 36), "back")).toHaveLength(1);
  });

  it("on a slanted wall the size is rounded down to the millimetre so no corner passes the face (direct.19)", () => {
    const slanted = wallDoc({ x: 0, y: 0 }, { x: 4, y: 3 });
    const quad = desk(2.6, 1.0, 37);
    const targets = flushTargets(slanted, quad, "back", 1, 0.125);
    expect(targets.map((t) => t.value)).toEqual([0.958]);
    const value = targets[0]?.value ?? NaN;
    expect(Number.isInteger(value * 1000)).toBe(true);
    const body = [...wallBodies(slanted).values()][0];
    const [q0, q1, , q3] = quad;
    const f0 = body?.[0];
    const f1 = body?.[1];
    const n = q0 && q3 ? normalize(sub(q3, q0)) : null;
    const along = f0 && f1 ? normalize(sub(f1, f0)) : null;
    if (!q0 || !q1 || !f0 || !n || !along) throw new Error("missing geometry");
    // Positive means past face 0→1, into the wall body.
    const into = (c: Point): number => cross(along, sub({ x: c.x + n.x * value, y: c.y + n.y * value }, f0));
    const depths = [into(q0), into(q1)];
    expect(Math.max(...depths)).toBeLessThanOrEqual(0);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(-0.001);
  });
});
