import { describe, expect, it } from "vitest";
import { unwrap, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { distance } from "../src/geometry";
import type { Dimension, DimensionEnd, Document } from "../src/model";
import { dimensionEnd, dimensionLength, dimensionPoints, faceCorners } from "../src/queries/dimensions";
import { wallOutlines } from "../src/queries/outlines";
import { docOf, rectDoc } from "./helpers";

// Anchored dimension ends (dims.16): an end placed on a face corner or a joint centre keeps the joint and the
// direction to the corner, and its point is worked out again from the walls on every read.

const RECT = rectDoc(0, 0, 3.2, 2); // J1 (0,0), J2 (3.2,0), J3 (3.2,2), J4 (0,2); W1 is the bottom wall
const L = docOf({ joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3]], walls: [["W1", "A", "B"], ["W2", "B", "C"]] });
const T = docOf({
  joints: [["J1", 0, 0], ["J2", 2, 0], ["J3", 4, 0], ["J4", 2, 2]],
  walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J2", "J4"]],
});
const ACUTE = docOf({
  joints: [["J0", 0, 0], ["J1", 4, 0], ["J2", 3.75877, 1.368081]], // 20°
  walls: [["W1", "J0", "J1"], ["W2", "J0", "J2"]],
});
// Query-only: the bodies overlap, so it is not validated. W2 is shorter than its two inner corners' reach.
const U = docOf({
  joints: [["A", 0, 1], ["B", 0, 0], ["C", 0.15, 0], ["D", 0.15, 1]],
  walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "C", "D"]],
});
const FIXTURES: [string, Document][] = [["RECT", RECT], ["L", L], ["T", T], ["ACUTE", ACUTE], ["U", U]];

const P = (x: number, y: number): Point => ({ x, y });
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const cornersAt = (doc: Document, joint: string): Point[] =>
  faceCorners(doc).filter((c) => c.joint === joint).map((c) => ({ x: r6(c.point.x), y: r6(c.point.y) }));
const run = (doc: Document, cmd: Command) => unwrap(execute(doc, cmd));
const addDim = (a: Point, b: Point, opId = "m"): Command => ({ type: "addDimension", opId, a, b, offset: -0.5 });
const row = (doc: Document, id = "m/m0"): Dimension => {
  const d = doc.dimensions[id];
  if (!d) throw new Error(`no dimension ${id}`);
  return d;
};
const length = (doc: Document, d: Dimension): number => {
  const l = dimensionLength(doc, d);
  if (l === null) throw new Error("an anchor's joint is missing");
  return l;
};
const anchored = (end: DimensionEnd) => {
  if (!("joint" in end)) throw new Error(`free end (${end.x}, ${end.y})`);
  return end;
};

describe("faceCorners", () => {
  it("L: free-end corners, one outer and one inner mitre, each once", () => {
    expect(faceCorners(L)).toHaveLength(6); // without dropping repeats, both walls would list B's two tips
    expect(cornersAt(L, "A")).toEqual([P(0, -0.1), P(0, 0.1)]);
    expect(cornersAt(L, "B")).toEqual([P(3.9, 0.1), P(4.1, -0.1)]);
    expect(cornersAt(L, "C")).toEqual([P(3.9, 3), P(4.1, 3)]);
  });

  it("T: only the stem's mitres at the junction", () => {
    expect(cornersAt(T, "J2")).toEqual([P(1.9, 0.1), P(2.1, 0.1)]); // not the straight face point (2,−0.1), not the joint
  });

  it("ACUTE: the inner mitre only, no bevel point", () => {
    expect(cornersAt(ACUTE, "J0")).toEqual([P(0.567128, 0.1)]);
    expect((wallOutlines(ACUTE).get("W1") ?? []).map((p) => P(r6(p.x), r6(p.y)))).toContainEqual(P(0, -0.1));
  });

  it("nearly straight unequal walls: no face corner at the joint", () => {
    const near = docOf({ joints: [["A", 0, 0], ["B", 4, 0], ["C", 8, 0.1]], walls: [["W1", "A", "B"], ["W2", "B", "C", 0.3]] });
    expect(cornersAt(near, "B")).toEqual([]); // both walls end flat, a step
  });

  it("U: the meeting point of a short wall's inner corners, at both joints", () => {
    expect(cornersAt(U, "B")).toEqual([P(-0.1, -0.1), P(0.075, 0.1), P(0.1, 0.1)]);
    expect(cornersAt(U, "C")).toContainEqual(P(0.075, 0.1));
  });

  it("is cached by document identity", () => {
    expect(faceCorners(L)).toBe(faceCorners(L));
  });

  it("is sorted by joint, then x, then y", () => {
    const listed = faceCorners(U).map((c) => [c.joint, c.point.x, c.point.y] as const);
    const sorted = [...listed].sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : p[1] - q[1] || p[2] - q[2]));
    expect(listed).toEqual(sorted);
  });
});

describe("dimensionEnd", () => {
  it("RECT: within 1 mm of a corner, the direction goes to the corner, not to the point", () => {
    const end = anchored(dimensionEnd(RECT, P(3.1004, 0.1)));
    expect(end.joint).toBe("J2");
    expect(end.tx).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(end.ty).toBeCloseTo(Math.SQRT1_2, 12);
    expect(dimensionEnd(RECT, P(3.1011, 0.1))).toEqual({ x: 3.1011, y: 0.1 });
    expect(dimensionEnd(RECT, P(3.2004, 0))).toEqual({ joint: "J2", tx: 0, ty: 0 });
  });

  it("nearest wins, then the lower joint ID", () => {
    const near = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3], ["A0", 4.1006, -0.1], ["Z", 6, -2]],
      walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "A0", "Z"]],
    });
    expect(anchored(dimensionEnd(near, P(4.1002, -0.1))).joint).toBe("B"); // 0.0002 against 0.0004 for A0's centre
    expect(dimensionEnd(near, P(4.1003, -0.1))).toEqual({ joint: "A0", tx: 0, ty: 0 }); // a tie
    const above = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3], ["C0", 4.1006, -0.1], ["Z", 6, -2]],
      walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "C0", "Z"]],
    });
    expect(dimensionEnd(above, P(4.1005, -0.1))).toEqual({ joint: "C0", tx: 0, ty: 0 }); // nearer, though C0 > B
    const u = anchored(dimensionEnd(U, P(0.075, 0.1)));
    expect(u.joint).toBe("B");
    expect([u.tx, u.ty].map(r6)).toEqual([0.6, 0.8]);
  });

  it("free otherwise", () => {
    expect(dimensionEnd(RECT, P(1, 1))).toEqual({ x: 1, y: 1 });
    expect(dimensionEnd(RECT, P(1.5, 0.1))).toEqual({ x: 1.5, y: 0.1 }); // a point on a face
  });
});

describe("dimensionPoints", () => {
  const inside = run(RECT, addDim(P(0.1, 0.1), P(3.1, 0.1)));
  const J2: Command = { type: "moveJoints", moves: [{ jointId: "J2", to: P(3.6, 0) }] };

  it("AC-04: a corner drag reads the new inner face from the outlines", () => {
    const d = row(inside.doc);
    expect(anchored(d.a).joint).toBe("J1");
    expect(anchored(d.b).joint).toBe("J2");
    expect(length(inside.doc, d)).toBeCloseTo(3, 9);
    const moved = run(inside.doc, J2);
    const l = length(moved.doc, d);
    expect(l).toBeCloseTo(3.37802, 6);
    const face = (wallOutlines(moved.doc).get("W1") ?? []).filter((p) => Math.abs(p.y - 0.1) < 1e-9);
    const [f0, f1] = face;
    if (face.length !== 2 || !f0 || !f1) throw new Error("W1 should have two inner face vertices");
    expect(l).toBeCloseTo(distance(f0, f1), 9);
    expect(l.toFixed(2)).toBe("3.38"); // a fixed offset from the joint (dims.06) would read 3.40
    expect(moved.patch.puts.some((p) => p.table === "dimensions")).toBe(false);
    expect(moved.patch.deletes.some((k) => k.table === "dimensions")).toBe(false);
  });

  it("a turn about the joint", () => {
    const turned = run(inside.doc, { type: "moveJoints", moves: [{ jointId: "J3", to: P(3.6, 2) }] }).doc;
    expect(length(turned, row(turned))).toBeCloseTo(3.01802, 6); // a fixed offset: 3.00
  });

  it("a thickness change", () => {
    const thick = run(inside.doc, { type: "setWallThickness", wallId: "W2", thickness: 0.3 }).doc;
    expect(length(thick, row(thick))).toBeCloseTo(2.95, 9); // a fixed offset: 3.00
  });

  it("no face corner left: the centre", () => {
    const d: Dimension = { id: "d", a: dimensionEnd(L, P(3.9, 0.1)), b: P(1, 1), offset: 0 };
    expect(anchored(d.a).joint).toBe("B");
    const straight = run(L, { type: "moveJoints", moves: [{ jointId: "C", to: P(8, 0) }] }).doc;
    expect(dimensionPoints(straight, d)?.a).toEqual(P(4, 0));
  });

  it("free ends keep their coordinates when walls move; centre anchors follow the joint (AC-05)", () => {
    const moved = run(inside.doc, J2).doc;
    const d: Dimension = { id: "d", a: P(1.5, 0.1), b: { joint: "J2", tx: 0, ty: 0 }, offset: 0 };
    expect(dimensionPoints(moved, d)).toEqual({ a: P(1.5, 0.1), b: P(3.6, 0) });
  });

  it.each(FIXTURES)("every face corner round-trips (AC-03): %s", (_, doc) => {
    for (const c of faceCorners(doc)) {
      const end = dimensionEnd(doc, c.point);
      expect("joint" in end).toBe(true);
      const p = dimensionPoints(doc, { id: "d", a: end, b: P(100, 100), offset: 0 })?.a;
      if (!p) throw new Error("no point");
      expect(distance(p, c.point)).toBeLessThan(1e-9);
    }
  });
});

describe("addDimension", () => {
  it("anchors its ends and still depends on its row only", () => {
    const r = run(RECT, addDim(P(0.1, 0.1), P(3.2, 0)));
    expect(anchored(row(r.doc).a).joint).toBe("J1");
    expect(row(r.doc).b).toEqual({ joint: "J2", tx: 0, ty: 0 });
    expect(r.patch.dependencies).toEqual([{ table: "dimensions", id: "m/m0" }]);
  });
});
