import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { DEFAULT_ZOOM, type Camera } from "../src/camera";
import { DIMENSION_POLICIES, faceCornerPolicy, facePerpendicularPolicy, onFacePolicy } from "../src/snapping/dimension-policies";
import { POLICIES, type SnapContext } from "../src/snapping/policies";
import { gridSpacingFor, snapPoint } from "../src/snapping/snap";
import { NO_MODS, type Mods } from "../src/types";
import { jointAt, roomDoc, wallBetween, wallDoc, withCommands } from "./builders";

// The Dimension tool's snap list (dims.18). R is the AC-04 rectangle, 3.2 × 2 with 0.20 m walls: inner face corners
// (0.1,0.1) (3.1,0.1) (3.1,1.9) (0.1,1.9); the bottom wall's inner face is y = 0.1 for x 0.1–3.1, its outer face
// y = −0.1 for x −0.1–3.3. Zoom 80 unless said: tolerance 10 px = 0.125 m, grid 0.2 m.

const P = (x: number, y: number): Point => ({ x, y });
const R = (): Document => withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 3.2, 2));

function snap(doc: Document, cursor: Point, opts: { mods?: Partial<Mods>; origin?: Point; angles?: boolean; zoom?: number } = {}) {
  const zoom = opts.zoom ?? DEFAULT_ZOOM;
  const camera: Camera = { center: { x: 3, y: 2 }, zoom, viewport: { width: 1200, height: 800 }, dpr: 1 };
  return snapPoint({
    doc, cursor, camera, mods: { ...NO_MODS, ...opts.mods }, origin: opts.origin ?? null, tolerancePx: 10,
    gridSpacing: gridSpacingFor(zoom), angles: opts.angles, policies: DIMENSION_POLICIES,
  });
}

/** A policy's input with the default zoom's tolerance; `over` sets the cursor, axis, origin or exclusions. */
function ctxOn(doc: Document, cursor: Point, over: Partial<SnapContext> = {}): SnapContext {
  return {
    doc, cursor, gridSpacing: 0.2, tolerance: 0.125, axis: null, excludeJoints: new Set(), excludeWalls: new Set(),
    drawOrigin: null, ...over,
  };
}

const near = (points: Point[], x: number, y: number): Point[] => points.filter((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);

function expectAt(actual: Point, x: number, y: number): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
}

describe("the Dimension tool's snap list (dims.18)", () => {
  it("a face corner outranks a closer face point", () => {
    // Face points (3.07,0.1) and (3.1,0.13) are 0.03 away, the corner 0.042.
    const r = snap(R(), P(3.07, 0.13));
    expect(r.kind).toBe("endpoint");
    expectAt(r.point, 3.1, 0.1);
  });

  it("a face point lies on the face, not the centre line", () => {
    const inner = snap(R(), P(1.53, 0.14));
    expect(inner.kind).toBe("onWall");
    expectAt(inner.point, 1.53, 0.1);
    const outer = snap(R(), P(1.53, -0.13));
    expect(outer.kind).toBe("onWall");
    expectAt(outer.point, 1.53, -0.1);
  });

  it("no face point past the face's extent", () => {
    const points = onFacePolicy(ctxOn(wallDoc(P(0, 0), P(2, 0)), P(2.05, 0.12))).map((c) => c.point);
    expect(points.filter((p) => p.x > 2 + 1e-9)).toEqual([]);
  });

  it("a face ends at its own corner, not at the centre line's end", () => {
    // Inner face y = 0.1 runs x 0.1–3.1, outer face y = −0.1 runs x −0.1–3.3; the centre line runs x 0–3.2.
    const inner = onFacePolicy(ctxOn(R(), P(3.15, 0.12))).map((c) => c.point);
    expect(inner.filter((p) => Math.abs(p.y - 0.1) < 1e-9)).toEqual([]);
    const outer = onFacePolicy(ctxOn(R(), P(3.25, -0.12))).map((c) => c.point);
    expect(near(outer, 3.25, -0.1)).toHaveLength(1);
  });

  it("with Shift, a face counts only where the axis crosses it within its extent", () => {
    // The axis y = 3 crosses the side walls' face lines above their tops (y ≤ 2.1).
    expect(onFacePolicy(ctxOn(R(), P(3.15, 3), { axis: { origin: P(5, 3), dir: P(1, 0) } }))).toEqual([]);
  });

  it("the face perpendicular needs its foot within the face", () => {
    // From (5,1) the side walls' faces (x 3.1, 3.3, 0.1, −0.1) all have a foot; the bottom and top faces end before x = 5.
    const feet = facePerpendicularPolicy(ctxOn(R(), P(4, 1), { drawOrigin: P(5, 1) })).map((c) => c.point);
    expect(feet.map((p) => p.x).sort((a, b) => a - b)).toEqual([-0.1, 0.1, 3.1, 3.3].map((x) => expect.closeTo(x, 9)));
    for (const p of feet) expect(p.y).toBeCloseTo(1, 9);
  });

  it("excluded joints and walls drop their corners and faces", () => {
    const doc = R();
    const corners = (c: SnapContext) => faceCornerPolicy(c).map((k) => k.point);
    expect(near(corners(ctxOn(doc, P(3.1, 0.1))), 3.1, 0.1)).toHaveLength(1);
    expect(near(corners(ctxOn(doc, P(3.1, 0.1), { excludeJoints: new Set([jointAt(doc, P(3.2, 0))]) })), 3.1, 0.1)).toEqual([]);
    const bottom = wallBetween(doc, P(0, 0), P(3.2, 0));
    expect(near(onFacePolicy(ctxOn(doc, P(1.53, 0.14))).map((c) => c.point), 1.53, 0.1)).toHaveLength(1);
    expect(near(onFacePolicy(ctxOn(doc, P(1.53, 0.14), { excludeWalls: new Set([bottom]) })).map((c) => c.point), 1.53, 0.1)).toEqual([]);
  });

  it("joint centres stay reachable at zoom 50", () => {
    // Tolerance 0.2 m, more than half a wall's thickness.
    expect(snap(R(), P(3.2, 0), { zoom: 50 })).toEqual({ point: P(3.2, 0), kind: "endpoint" });
    expect(snap(R(), P(3.17, 0.03), { zoom: 50 })).toEqual({ point: P(3.2, 0), kind: "endpoint" }); // centre 0.042, corner 0.099
    const corner = snap(R(), P(3.12, 0.08), { zoom: 50 });
    expect(corner.kind).toBe("endpoint");
    expectAt(corner.point, 3.1, 0.1);
  });

  it("Shift drops off-axis corners and face points", () => {
    const origin = P(1, 0.2);
    const across = snap(R(), P(3.08, 0.17), { mods: { shift: true }, origin, angles: true });
    expect(across.kind).toBe("onWall"); // the corner (3.1,0.1) is off the axis
    expectAt(across.point, 3.1, 0.2);
    // The bottom face is parallel to the axis: its foot (2.0,0.1) would win unfiltered.
    expect(snap(R(), P(2.0, 0.17), { mods: { shift: true }, origin, angles: true })).toEqual({ point: P(2, 0.2), kind: "grid" });
  });

  it("the second click's perpendicular lands on the face", () => {
    const origin = P(1, 0.1);
    const perp = snap(R(), P(1.02, 1.92), { origin, angles: true });
    expect(perp.kind).toBe("perpendicular"); // the centre-line foot (1,2.0) lies inside the top wall
    expectAt(perp.point, 1, 1.9);
    expect(perp.guides).toEqual([origin]);
    const angle = snap(R(), P(2.0, 1.04), { origin, angles: true });
    expect(angle.kind).toBe("angle"); // without angles: grid (2.0,1.0)
    expectAt(angle.point, 1 + 1.4 * Math.SQRT1_2, 0.1 + 1.4 * Math.SQRT1_2);
  });

  it("Ctrl turns snapping off", () => {
    expect(snap(R(), P(3.07, 0.13), { mods: { ctrl: true } })).toEqual({ point: P(3.07, 0.13), kind: "none" });
  });

  it("the default list is unchanged", () => {
    const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };
    const input = { doc: roomDoc(), cursor: P(1.53, 0.09), camera, mods: NO_MODS, origin: null, tolerancePx: 10, gridSpacing: 0.2 };
    const r = snapPoint(input);
    expect(r.kind).toBe("onWall");
    expectAt(r.point, 1.53, 0);
    expect(snapPoint({ ...input, policies: POLICIES })).toEqual(r);
  });
});
