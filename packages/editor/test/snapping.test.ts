import { describe, expect, it } from "vitest";
import { emptyDocument, execute, incidentWalls, unwrap, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { DEFAULT_ZOOM, type Camera } from "../src/camera";
import { choose } from "../src/snapping/chooser";
import { roundTo } from "../src/snapping/policies";
import { gridSpacingFor, orthogonalAxis, snapPoint } from "../src/snapping/snap";
import { NO_MODS, type Mods } from "../src/types";
import { dividedRoomDoc, jointAt, roomDoc, wallDoc } from "./builders";

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };

function snap(doc: Document, cursor: Point, mods: Partial<Mods> = {}, origin: Point | null = null) {
  return snapPoint({ doc, cursor, camera, mods: { ...NO_MODS, ...mods }, origin, tolerancePx: 10 });
}

describe("grid spacing", () => {
  it("picks the smallest step at least 16 px wide", () => {
    expect(gridSpacingFor(80)).toBe(0.2);
    expect(gridSpacingFor(16)).toBe(1);
    expect(gridSpacingFor(1000)).toBe(0.02);
    expect(gridSpacingFor(5)).toBe(5);
    expect(gridSpacingFor(1)).toBe(10);
  });
});

describe("snapPoint (spec §5.8)", () => {
  it("prefers an endpoint to a closer grid point", () => {
    const doc = wallDoc({ x: 0.33, y: 0.33 }, { x: 2.33, y: 0.33 });
    expect(snap(doc, { x: 0.39, y: 0.39 })).toEqual({ point: { x: 0.33, y: 0.33 }, kind: "endpoint" });
  });

  it("prefers an endpoint to a closer midpoint", () => {
    // Endpoint (0,0) is 0.071 m away, the midpoint (0.1,0) 0.032 m; both are within 0.125 m.
    const doc = wallDoc({ x: 0, y: 0 }, { x: 0.2, y: 0 });
    expect(snap(doc, { x: 0.07, y: 0.01 })).toEqual({ point: { x: 0, y: 0 }, kind: "endpoint" });
  });

  it("gives the exact midpoint of a wall", () => {
    expect(snap(roomDoc(), { x: 3.04, y: 0.03 })).toEqual({ point: { x: 3, y: 0 }, kind: "midpoint" });
  });

  it("prefers the nearest point on a wall to the grid", () => {
    const r = snap(roomDoc(), { x: 1.53, y: 0.04 });
    expect(r.kind).toBe("onWall");
    expect(r.point.x).toBeCloseTo(1.53, 9);
    expect(r.point.y).toBe(0);
  });

  it("prefers a point on a wall to a closer grid point (priority, not distance)", () => {
    // Grid (1.6, 0.2) is 0.091 m away, the bottom wall's (1.61, 0) is 0.11 m; both are within 0.125 m.
    const r = snap(roomDoc(), { x: 1.61, y: 0.11 });
    expect(r.kind).toBe("onWall");
    expect(r.point.x).toBeCloseTo(1.61, 9);
    expect(r.point.y).toBe(0);
  });

  it("falls back to the nearest grid point even beyond 10 px (the grid is the fallback)", () => {
    // Cell centre: the nearest grid point is 0.127 m away, past the 10 px / 80 px per m = 0.125 m tolerance.
    // Grid cells are at least 16 px wide, so a tolerance-bound grid snap missed the middle of every cell.
    expect(snap(roomDoc(), { x: 1.51, y: 2.11 })).toEqual({ point: { x: 1.6, y: 2.2 }, kind: "grid" });
  });

  it("still prefers an endpoint within 10 px to the grid", () => {
    const doc = wallDoc({ x: 0.33, y: 0.33 }, { x: 2.33, y: 0.33 });
    expect(snap(doc, { x: 0.4, y: 0.33 })).toEqual({ point: { x: 0.33, y: 0.33 }, kind: "endpoint" });
  });

  it("with Shift, projects on the orthogonal axis and keeps on-axis candidates", () => {
    expect(snap(roomDoc(), { x: 3.1, y: 3.97 }, { shift: true }, { x: 3, y: 0 })).toEqual({
      point: { x: 3, y: 4 },
      kind: "midpoint",
    });
  });

  it("with Shift, drops candidates off the axis", () => {
    // Axis y = 1 from (1,1): the right wall is crossed at (6,1).
    const r = snap(roomDoc(), { x: 5.95, y: 1.1 }, { shift: true }, { x: 1, y: 1 });
    expect(r.kind).toBe("onWall");
    expect(r.point.x).toBeCloseTo(6, 9);
    expect(r.point.y).toBeCloseTo(1, 9);
    // Axis y = 0.05, 5 cm above the bottom wall: the corner (6,0) and the midpoint (3,0) are within
    // tolerance but off-axis, and the parallel bottom wall is never crossed.
    const origin = { x: 1, y: 0.05 };
    expect(snap(roomDoc(), { x: 5.97, y: 0.06 }, { shift: true }, origin)).toEqual({ point: { x: 6, y: 0.05 }, kind: "onWall" });
    expect(snap(roomDoc(), { x: 3.02, y: 0.06 }, { shift: true }, origin)).toEqual({ point: { x: 3, y: 0.05 }, kind: "grid" });
  });

  it("with Shift, ignores an axis crossing past the end of a wall", () => {
    // Axis y = 4.1 meets the right wall's line at (6, 4.1), 10 cm past its end: not on the wall, but lined up
    // with the corners at x = 6.
    const r = snap(roomDoc(), { x: 6.02, y: 4.12 }, { shift: true }, { x: 1.1, y: 4.1 });
    expect(r.kind).toBe("aligned");
    expect(r.point.x).toBeCloseTo(6, 9);
    expect(r.point.y).toBeCloseTo(4.1, 9);
  });

  it("with Shift, snaps to the nearest axis grid step even beyond 10 px", () => {
    // Zoom 60: grid step 0.5 m, tolerance 10 / 60 = 0.167 m. The axis step 0.5 is 0.24 m away and still wins.
    const zoomed: Camera = { ...camera, zoom: 60 };
    const r = snapPoint({
      doc: emptyDocument(), cursor: { x: 0.26, y: 0.05 }, camera: zoomed, mods: { ...NO_MODS, shift: true },
      origin: { x: 0, y: 0 }, tolerancePx: 10,
    });
    expect(r).toEqual({ point: { x: 0.5, y: 0 }, kind: "grid" });
  });

  it("with Shift, snaps to grid steps measured from the origin", () => {
    // An absolute grid would give x = 1.2; steps from the origin give 0.33 + 4 × 0.2.
    const r = snap(roomDoc(), { x: 1.13, y: 2.3 }, { shift: true }, { x: 0.33, y: 2 });
    expect(r.kind).toBe("grid");
    expect(r.point.x).toBeCloseTo(1.13, 9);
    expect(r.point.y).toBe(2); // the constrained coordinate stays exact
  });

  it("Ctrl bypasses every policy", () => {
    expect(snap(roomDoc(), { x: 3.04, y: 0.03 }, { ctrl: true })).toEqual({ point: { x: 3.04, y: 0.03 }, kind: "none" });
  });

  it("Ctrl keeps the Shift constraint", () => {
    expect(snap(roomDoc(), { x: 2.5, y: 0.3 }, { shift: true, ctrl: true }, { x: 0, y: 0 })).toEqual({
      point: { x: 2.5, y: 0 },
      kind: "none",
    });
  });

  it("ignores excluded joints and walls (the ones being dragged)", () => {
    const doc = roomDoc();
    const j = jointAt(doc, { x: 6, y: 4 });
    const r = snapPoint({
      doc, cursor: { x: 6.02, y: 4.02 }, camera, mods: NO_MODS, origin: null, tolerancePx: 10,
      excludeJoints: new Set([j]), excludeWalls: new Set(incidentWalls(doc, j)),
    });
    // The dragged corner is gone, but its neighbours (6,0) and (0,4) still line it up.
    expect(r).toEqual({ point: { x: 6, y: 4 }, kind: "aligned", guides: [{ x: 6, y: 0 }, { x: 0, y: 4 }] });
  });
});

/** A bent divider: (3.5,0) → (3.4,4) → (3.5,6.5), plus a wall from (0,4) to the bend (placed at a finer zoom). */
function bentDoc(): Document {
  let doc = emptyDocument();
  const walls: [Point, Point][] = [
    [{ x: 3.5, y: 0 }, { x: 3.4, y: 4 }], [{ x: 3.4, y: 4 }, { x: 3.5, y: 6.5 }], [{ x: 0, y: 4 }, { x: 3.4, y: 4 }],
  ];
  walls.forEach(([a, b], i) => { doc = unwrap(execute(doc, { type: "addWall", opId: `w${i}`, from: { at: a }, to: { at: b } })).doc; });
  return doc;
}

describe("aligned snap (spec §5.8)", () => {
  // Zoom 30: grid step 1 m, so neither 3.4 nor 3.5 is on the grid; tolerance 10 / 30 = 0.333 m.
  const far: Camera = { ...camera, zoom: 30 };
  function dragBend(cursor: Point) {
    const doc = bentDoc();
    const j = jointAt(doc, { x: 3.4, y: 4 });
    return snapPoint({
      doc, cursor, camera: far, mods: NO_MODS, origin: { x: 3.4, y: 4 }, tolerancePx: 10,
      excludeJoints: new Set([j]), excludeWalls: new Set(incidentWalls(doc, j)),
    });
  }

  it("lines a dragged joint up with other joints on both axes, whatever the grid step", () => {
    expect(dragBend({ x: 3.62, y: 4.1 })).toEqual({
      point: { x: 3.5, y: 4 }, kind: "aligned", guides: [{ x: 3.5, y: 6.5 }, { x: 0, y: 4 }],
    });
  });

  it("keeps the other coordinate on the grid when only one axis lines up", () => {
    expect(dragBend({ x: 3.62, y: 2.3 })).toEqual({ point: { x: 3.5, y: 2 }, kind: "aligned", guides: [{ x: 3.5, y: 0 }] });
  });

  it("does not line up beyond 10 px", () => {
    expect(dragBend({ x: 3.9, y: 2.3 })).toEqual({ point: { x: 4, y: 2 }, kind: "grid" });
  });

  it("with Shift, lines up along the axis only", () => {
    // Horizontal axis y = 0 from the origin; the joint x = 2.37 is 3 cm away, the grid step (0.2) would give 2.4.
    const doc = wallDoc({ x: 2.37, y: 5 }, { x: 2.37, y: 6 });
    expect(snap(doc, { x: 2.4, y: 0.1 }, { shift: true }, { x: 0, y: 0 })).toEqual({
      point: { x: 2.37, y: 0 }, kind: "aligned", guides: [{ x: 2.37, y: 5 }],
    });
  });

  it("is outranked by a point on a wall", () => {
    // Near the divider x = 3, away from its midpoint: lining up with its ends would give (3, 2.6); the wall gives (3, 2.65).
    const r = snap(dividedRoomDoc(), { x: 2.95, y: 2.65 });
    expect(r.kind).toBe("onWall");
    expect(r.point.x).toBeCloseTo(3, 9);
    expect(r.point.y).toBeCloseTo(2.65, 9);
  });
});

/** The wall tool's call: angle and perpendicular snaps turned on, drawing from `origin`. */
function draw(doc: Document, origin: Point, cursor: Point, mods: Partial<Mods> = {}, cam: Camera = camera) {
  return snapPoint({ doc, cursor, camera: cam, mods: { ...NO_MODS, ...mods }, origin, tolerancePx: 10, angles: true });
}

const O = { x: 0, y: 0 };
const deg = (d: number) => (d * Math.PI) / 180;
/** The point `len` m from `origin` along the ray at `angle` degrees. */
const onRay = (origin: Point, angle: number, len: number): Point => ({
  x: origin.x + len * Math.cos(deg(angle)), y: origin.y + len * Math.sin(deg(angle)),
});
function expectPoint(p: Point, q: Point): void {
  expect(p.x).toBeCloseTo(q.x, 9);
  expect(p.y).toBeCloseTo(q.y, 9);
}

describe("angle snap (spec §5.8, wall tool only)", () => {
  // Default zoom: grid 0.2 m, tolerance 10 / 80 = 0.125 m.
  it("snaps to the nearest 15° ray, at a whole number of grid steps from the origin", () => {
    // (2, 0.6): 16.7°, 0.062 m off the 15° ray, 2.087 m along it → 2.0 m. The grid point (2, 0.6) is the cursor itself.
    const a = draw(emptyDocument(), O, { x: 2, y: 0.6 });
    expect(a.kind).toBe("angle");
    expectPoint(a.point, onRay(O, 15, 2));
    // (2, 1.2): 31°, 0.039 m off the 30° ray, 2.332 m along it → 2.4 m.
    const b = draw(emptyDocument(), O, { x: 2, y: 1.2 });
    expect(b.kind).toBe("angle");
    expectPoint(b.point, onRay(O, 30, 2.4));
    expect(b.guides).toEqual([O]);
  });

  it("keeps the other coordinate exact on the axes", () => {
    // cos 90° is 6e-17 in floating point, which would put x at 0.10000000000000012.
    const origin = { x: 0.1, y: 0.33 };
    expect(draw(emptyDocument(), origin, { x: 0.13, y: 2.35 })).toEqual({ point: { x: 0.1, y: 2.33 }, kind: "angle", guides: [origin] });
  });

  it("is off with Shift, with Ctrl, and without the wall tool's flag (a joint drag passes an origin too)", () => {
    const cursor = { x: 2, y: 0.6 };
    expect(draw(emptyDocument(), O, cursor, { shift: true })).toEqual({ point: { x: 2, y: 0 }, kind: "grid" });
    expect(draw(emptyDocument(), O, cursor, { ctrl: true })).toEqual({ point: cursor, kind: "none" });
    expect(snap(emptyDocument(), cursor, {}, O)).toEqual({ point: cursor, kind: "grid" });
  });

  it("is outranked by an endpoint and a midpoint within the tolerance", () => {
    // Cursor 0.037 m off the 15° ray; the endpoint (2, 0.6) is 0.028 m away.
    expect(draw(wallDoc({ x: 2, y: 0.6 }, { x: 4, y: 0.6 }), O, { x: 2.02, y: 0.58 }).kind).toBe("endpoint");
    // Cursor 0.018 m off the 15° ray; the midpoint (2, 0.55) is 0.022 m away.
    expect(draw(wallDoc({ x: 1, y: 0.55 }, { x: 3, y: 0.55 }), O, { x: 2.02, y: 0.56 })).toEqual({ point: { x: 2, y: 0.55 }, kind: "midpoint" });
  });

  it("outranks aligned and grid", () => {
    // The joint line y = 0.7 is 0.1 m from the cursor (aligned would give (2, 0.7)); it crosses the ray 0.62 m away.
    const r = draw(wallDoc({ x: 5, y: 0.7 }, { x: 7, y: 0.7 }), O, { x: 2, y: 0.6 });
    expect(r.kind).toBe("angle");
    expectPoint(r.point, onRay(O, 15, 2));
    expect(r.guides).toEqual([O]);
  });

  it("falls back to aligned and grid when the cursor is farther than the tolerance from every ray", () => {
    // (2, 0.33): 9.4°, 0.199 m off the 15° ray and 0.33 m off the 0° ray.
    expect(draw(emptyDocument(), O, { x: 2, y: 0.33 })).toEqual({ point: { x: 2, y: 0.4 }, kind: "grid" });
    // The line x = 2.05 is 0.05 m away; it crosses the 15° ray at (2.05, 0.549), 0.225 m from the cursor.
    expect(draw(wallDoc({ x: 2.05, y: 5 }, { x: 2.05, y: 7 }), O, { x: 2, y: 0.33 })).toEqual({
      point: { x: 2.05, y: 0.4 }, kind: "aligned", guides: [{ x: 2.05, y: 5 }],
    });
  });

  it("takes the crossing with another joint's line when it is within the tolerance (tie rule)", () => {
    // (3.05, 3.02): 0.021 m off the 45° ray (4.29 m along it → 4.2, i.e. (2.97, 2.97)); x = 3 is 0.05 m away and
    // crosses the ray at (3, 3), 0.054 m from the cursor.
    const r = draw(wallDoc({ x: 3, y: 5 }, { x: 5, y: 5 }), O, { x: 3.05, y: 3.02 });
    expect(r).toMatchObject({ kind: "angle", guides: [O, { x: 3, y: 5 }] });
    expect(r.point.x).toBe(3); // the lined-up coordinate is exact
    expect(r.point.y).toBeCloseTo(3, 9); // sin 45° and cos 45° differ by 1 ulp
  });

  it("finds no crossing with a line parallel to the ray", () => {
    // The 0° ray and the line y = 0.05 (0.02 m from the cursor) never cross: the ray's grid point stays.
    expect(draw(wallDoc({ x: 5, y: 0.05 }, { x: 7, y: 0.05 }), O, { x: 2.02, y: 0.03 })).toEqual({
      point: { x: 2, y: 0 }, kind: "angle", guides: [O],
    });
  });

  it("keeps the point on the ray at every zoom (lesson 31)", () => {
    // Zoom 60: grid 0.5 m, tolerance 0.167 m. (2.3, 0.65) is 0.033 m off the 15° ray, 2.39 m along it.
    const zoomed: Camera = { ...camera, zoom: 60 };
    const near = draw(emptyDocument(), O, { x: 2.3, y: 0.65 });
    const far = draw(emptyDocument(), O, { x: 2.3, y: 0.65 }, {}, zoomed);
    expect([near.kind, far.kind]).toEqual(["angle", "angle"]);
    expectPoint(near.point, onRay(O, 15, 2.4));
    expectPoint(far.point, onRay(O, 15, 2.5)); // an absolute 0.5 m grid would give (2.5, 0.5), off the ray
    expectPoint(draw(emptyDocument(), O, { x: 2, y: 0.6 }, {}, zoomed).point, onRay(O, 15, 2));
  });
});

describe("perpendicular snap (spec §5.8, wall tool only)", () => {
  const top = () => wallDoc({ x: 0, y: 4 }, { x: 6, y: 4 });

  it("gives the foot of the perpendicular from the origin to a wall", () => {
    // On-wall (2.05, 4) is 0.05 m away and the 90° ray's point (2, 4) is 0.07 m away: perpendicular outranks both.
    expect(draw(top(), { x: 2, y: 0 }, { x: 2.05, y: 3.95 })).toEqual({ point: { x: 2, y: 4 }, kind: "perpendicular", guides: [{ x: 2, y: 0 }] });
    // A slanted wall: the foot (0.4, 3.2) is on no 15° ray (116.6°); on-wall (0.42, 3.21) is 0.067 m away.
    const r = draw(wallDoc({ x: 0, y: 3 }, { x: 6, y: 6 }), { x: 2, y: 0 }, { x: 0.45, y: 3.15 });
    expect(r.kind).toBe("perpendicular");
    expectPoint(r.point, { x: 0.4, y: 3.2 });
  });

  it("beats on-wall at the same place", () => {
    expect(draw(top(), { x: 2, y: 0 }, { x: 2, y: 3.97 }).kind).toBe("perpendicular");
  });

  it("gives nothing when the foot is outside the wall", () => {
    // The foot (2, 4) is 1 m before the wall starts; the 90° ray still gives (2, 4).
    expect(draw(wallDoc({ x: 3, y: 4 }, { x: 6, y: 4 }), { x: 2, y: 0 }, { x: 2.05, y: 3.95 }).kind).toBe("angle");
  });

  it("gives nothing when the origin lies on the wall", () => {
    // The foot would be the origin (2, 4), 0.058 m away; on-wall (2.05, 4) is 0.03 m away; the ray length rounds to 0.
    const r = draw(top(), { x: 2, y: 4 }, { x: 2.05, y: 4.03 });
    expect(r.kind).toBe("onWall");
    expectPoint(r.point, { x: 2.05, y: 4 });
  });

  it("is off with Shift and without the wall tool's flag", () => {
    // With Shift the vertical axis gives on-wall (2, 4); without the flag, the on-wall snap (2.05, 4).
    expect(draw(top(), { x: 2, y: 0 }, { x: 2.05, y: 3.95 }, { shift: true }).kind).toBe("onWall");
    expect(snap(top(), { x: 2.05, y: 3.95 }, {}, { x: 2, y: 0 }).kind).toBe("onWall");
  });
});

describe("roundTo", () => {
  it("rounds to the step, cleaned of float noise and -0", () => {
    expect(roundTo(5.99, 0.2)).toBe(6);
    expect(roundTo(0.61, 0.2)).toBe(0.6); // 3 × 0.2 is 0.6000000000000001 before cleaning
    expect(Object.is(roundTo(-0.04, 0.2), 0)).toBe(true);
    expect(roundTo(-0.3, 0.2)).toBe(-0.2); // Math.round(-1.5) is -1
    expect(roundTo(0.29, 0.2)).toBe(0.2);
  });
});

describe("choose", () => {
  it("breaks ties by distance, then x, then y", () => {
    const a = { point: { x: 2, y: 0 }, kind: "grid", priority: 7, distance: 0.1 } as const;
    const b = { point: { x: 1, y: 0 }, kind: "grid", priority: 7, distance: 0.1 } as const;
    const c = { ...b, point: { x: 1, y: -1 } };
    const far = { ...b, distance: 0.15 };
    expect(choose([far, a], 0.2)).toBe(a);
    expect(choose([a, b], 0.2)).toBe(b);
    expect(choose([b, c], 0.2)).toBe(c);
    expect(choose([c, b], 0.2)).toBe(c);
    const wallPoint = { ...a, kind: "onWall", priority: 4 } as const;
    expect(choose([wallPoint], 0.05)).toBeNull(); // non-grid candidates respect the tolerance
    expect(choose([wallPoint, a], 0.05)).toBe(a); // the grid is the fallback, whatever its distance
  });
});

describe("orthogonalAxis", () => {
  it("follows the dominant direction", () => {
    expect(orthogonalAxis({ x: 0, y: 0 }, { x: -3, y: 1 }).dir).toEqual({ x: -1, y: 0 });
    expect(orthogonalAxis({ x: 0, y: 0 }, { x: 1, y: -3 }).dir).toEqual({ x: 0, y: -1 });
  });
});
