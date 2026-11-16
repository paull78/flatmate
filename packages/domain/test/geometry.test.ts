import { describe, expect, it } from "vitest";
import {
  clipHalfPlane, distanceToSegment, isSimplePolygon, lineIntersection, normalize, pointInPolygon, projectOnSegment,
  segmentIntersection, signedArea,
} from "../src/geometry";

const p = (x: number, y: number) => ({ x, y });

describe("geometry", () => {
  it("normalizes, refusing zero vectors", () => {
    expect(normalize(p(3, 4))).toEqual(p(0.6, 0.8));
    expect(normalize(p(0, 0))).toBeNull();
  });

  it("projects onto a segment and clamps to its ends", () => {
    expect(projectOnSegment(p(2, 5), p(0, 0), p(6, 0))).toEqual({ point: p(2, 0), t: 2 / 6 });
    expect(projectOnSegment(p(-3, 1), p(0, 0), p(6, 0)).point).toEqual(p(0, 0));
    expect(distanceToSegment(p(3, 2), p(0, 0), p(6, 0))).toBe(2);
  });

  it("finds a crossing point", () => {
    const hit = segmentIntersection(p(0, 0), p(4, 4), p(0, 4), p(4, 0));
    expect(hit).toMatchObject({ kind: "point", point: p(2, 2), t: 0.5, u: 0.5 });
  });

  it("reports touching ends as a point, within EPS", () => {
    expect(segmentIntersection(p(0, 0), p(2, 0), p(2.0005, 0), p(2.0005, 3)).kind).toBe("point");
    expect(segmentIntersection(p(0, 0), p(2, 0), p(2.01, 0.5), p(2.01, 3)).kind).toBe("none");
  });

  it("separates collinear overlap from collinear touching", () => {
    expect(segmentIntersection(p(0, 0), p(4, 0), p(3, 0), p(6, 0))).toEqual({ kind: "overlap", length: 1 });
    expect(segmentIntersection(p(0, 0), p(4, 0), p(4, 0), p(6, 0)).kind).toBe("point");
    expect(segmentIntersection(p(0, 0), p(4, 0), p(5, 0), p(6, 0)).kind).toBe("none");
    expect(segmentIntersection(p(0, 0), p(4, 0), p(0, 1), p(4, 1)).kind).toBe("none");
  });

  it("intersects infinite lines", () => {
    expect(lineIntersection(p(0, 1), p(1, 0), p(3, 0), p(0, 1))).toEqual(p(3, 1));
    expect(lineIntersection(p(0, 0), p(1, 0), p(0, 1), p(2, 0))).toBeNull();
  });

  it("gives CCW rings positive area", () => {
    const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
    expect(signedArea(square)).toBe(4);
    expect(signedArea([...square].reverse())).toBe(-4);
  });

  it("tests containment and simplicity", () => {
    const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
    expect(pointInPolygon(p(1, 1), square)).toBe(true);
    expect(pointInPolygon(p(3, 1), square)).toBe(false);
    expect(isSimplePolygon(square)).toBe(true);
    expect(isSimplePolygon([p(0, 0), p(2, 2), p(2, 0), p(0, 2)])).toBe(false); // bow tie
  });

  it("clips a ring to the left of a directed line (Sutherland–Hodgman, one edge)", () => {
    const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
    // Left of (1,0)→(1,2) is x ≤ 1: the square's left half, its two cuts on the line.
    expect(clipHalfPlane(square, p(1, 0), p(1, 2))).toEqual([p(0, 0), p(1, 0), p(1, 2), p(0, 2)]);
    // The other way round keeps the right half.
    expect(signedArea(clipHalfPlane(square, p(1, 2), p(1, 0)))).toBe(2);
    // Wholly on the left: unchanged; wholly on the right: empty; a vertex on the line counts as left.
    expect(clipHalfPlane(square, p(3, 0), p(3, 1))).toEqual(square);
    expect(clipHalfPlane(square, p(-1, 0), p(-1, 1))).toEqual([]);
    expect(clipHalfPlane(square, p(2, 0), p(2, 1))).toEqual(square);
    // A concave subject (an L) cut across both arms: one ring, the two pieces joined by a zero-area bridge on the line.
    const ell = [p(0, 0), p(3, 0), p(3, 1), p(1, 1), p(1, 3), p(0, 3)];
    const cut = clipHalfPlane(ell, p(0, 2.5), p(2.5, 0)); // keeps x + y ≥ 2.5: a piece of each arm, 1 m² each
    expect(signedArea(cut)).toBeCloseTo(2, 12);
    for (const q of cut) expect(q.x + q.y).toBeGreaterThanOrEqual(2.5 - 1e-12);
  });
});
