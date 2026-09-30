import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { cross, distance, distanceToSegment, dot, isSimplePolygon, normalize, pointInPolygon, signedArea, sub } from "../src/geometry";
import { WALL_THICKNESS, type Document } from "../src/model";
import { wallOutlines } from "../src/queries/outlines";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

const HALF = WALL_THICKNESS / 2;

const close = (points: readonly { x: number; y: number }[] | undefined) =>
  (points ?? []).map((p) => ({ x: Math.round(p.x * 1e6) / 1e6 + 0, y: Math.round(p.y * 1e6) / 1e6 + 0 }));

describe("wallOutlines", () => {
  it("is cached by document identity, like the rooms (spec §3.6, P2)", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(wallOutlines(doc)).toBe(wallOutlines(doc));
    expect(wallOutlines(rectDoc(0, 0, 6, 4))).not.toBe(wallOutlines(doc));
  });

  it("gives no outlines for an empty document", () => {
    expect(wallOutlines({ joints: {}, walls: {}, zoneLabels: {} }).size).toBe(0);
  });

  it("gives a lone wall flat ends at its joints", () => {
    const doc = docOf({ joints: [["A", 0, 0], ["B", 4, 0]], walls: [["W", "A", "B"]] });
    expect(close(wallOutlines(doc).get("W"))).toEqual([
      { x: 0, y: 0.1 }, { x: 0, y: -0.1 }, { x: 4, y: -0.1 }, { x: 4, y: 0.1 },
    ]);
  });

  it("miters an L corner: outer (4.1, -0.1), inner (3.9, 0.1)", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3]],
      walls: [["W1", "A", "B"], ["W2", "B", "C"]],
    });
    const out = wallOutlines(doc);
    expect(close(out.get("W1"))).toEqual([
      { x: 0, y: 0.1 }, { x: 0, y: -0.1 }, { x: 4.1, y: -0.1 }, { x: 3.9, y: 0.1 },
    ]);
    expect(close(out.get("W2"))).toContainEqual({ x: 4.1, y: -0.1 });
    expect(close(out.get("W2"))).toContainEqual({ x: 3.9, y: 0.1 });
  });

  it("joins a T-junction: straight-through edge at y = -0.1, corners at x = 2.9 and 3.1, each outline through the joint", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["S", 3, 0], ["B", 6, 0], ["T", 3, 4]],
      walls: [["L", "A", "S"], ["R", "S", "B"], ["D", "S", "T"]],
    });
    const out = wallOutlines(doc);
    // The three outlines meet at S (3, 0) and tile the triangle (2.9, 0.1), (3.1, 0.1), (3, -0.1) between them.
    expect(close(out.get("R"))).toEqual([
      { x: 3.1, y: 0.1 }, { x: 3, y: 0 }, { x: 3, y: -0.1 }, { x: 6, y: -0.1 }, { x: 6, y: 0.1 },
    ]);
    expect(close(out.get("L"))).toEqual([
      { x: 0, y: 0.1 }, { x: 0, y: -0.1 }, { x: 3, y: -0.1 }, { x: 3, y: 0 }, { x: 2.9, y: 0.1 },
    ]);
    expect(close(out.get("D"))).toEqual([
      { x: 2.9, y: 0.1 }, { x: 3, y: 0 }, { x: 3.1, y: 0.1 }, { x: 3.1, y: 4 }, { x: 2.9, y: 4 },
    ]);
  });

  it("returns counter-clockwise polygons, simple for a 4 × 3 rectangle", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3], ["D", 0, 3]],
      walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "C", "D"], ["W4", "D", "A"]],
    });
    const outlines = wallOutlines(doc);
    expect(outlines.size).toBe(4);
    for (const poly of outlines.values()) {
      expect(signedArea(poly)).toBeGreaterThan(0);
      expect(isSimplePolygon(poly)).toBe(true); // a positive-area outline can still self-intersect
    }
  });

  // Walls J→P along +x and J→Q at angle a. Their outer edges meet behind J at distance 0.1 / sin(a/2);
  // the miter limit 4 · 0.1 is passed below a = 2·asin(1/4) ≈ 28.955°.
  const vee = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const out = wallOutlines(docOf({
      joints: [["J", 0, 0], ["P", 5, 0], ["Q", 5 * Math.cos(a), 5 * Math.sin(a)]],
      walls: [["W1", "J", "P"], ["W2", "J", "Q"]],
    }));
    const point = (x: number, y: number) => close([{ x, y }])[0];
    return {
      w1: close(out.get("W1")),
      w2: close(out.get("W2")),
      outerTip: point(-0.1 / Math.tan(a / 2), -0.1),
      innerTip: point(0.1 / Math.tan(a / 2), 0.1),
      bevelMid: point(-0.05 * Math.sin(a), (-0.1 + 0.1 * Math.cos(a)) / 2), // midpoint of (0, -0.1) and W2's outer edge point
    };
  };

  it("miters a 30° corner, just above the miter limit: one shared outer corner", () => {
    const { w1, w2, outerTip, innerTip } = vee(30);
    expect(w1).toEqual([innerTip, outerTip, { x: 5, y: -0.1 }, { x: 5, y: 0.1 }]);
    expect(w2).toContainEqual(outerTip);
    expect(w2).toContainEqual(innerTip);
  });

  it("bevels a 28° corner, just below the miter limit", () => {
    const { w1, w2, outerTip, innerTip, bevelMid } = vee(28);
    expect(w1).toEqual([innerTip, bevelMid, { x: 0, y: -0.1 }, { x: 5, y: -0.1 }, { x: 5, y: 0.1 }]);
    expect(w1).not.toContainEqual(outerTip);
    expect(w2).toHaveLength(5);
    expect(w2).toContainEqual(bevelMid);
    expect(w2).toContainEqual(innerTip);
  });

  it("bevels a sharp 20° corner and both walls share the bevel midpoint", () => {
    const a = (20 * Math.PI) / 180;
    const doc = docOf({
      joints: [["J", 0, 0], ["P", 5, 0], ["Q", 5 * Math.cos(a), 5 * Math.sin(a)]],
      walls: [["W1", "J", "P"], ["W2", "J", "Q"]],
    });
    const out = wallOutlines(doc);
    const w1 = close(out.get("W1"));
    const w2 = close(out.get("W2"));
    expect(w1).toHaveLength(5);
    expect(w2).toHaveLength(5);
    expect(w1).toContainEqual({ x: 0, y: -0.1 });
    const shared = w1.filter((p) => w2.some((q) => q.x === p.x && q.y === p.y));
    expect(shared.length).toBeGreaterThanOrEqual(2); // the inner corner and the bevel midpoint
  });
});

describe("wallOutlines: inner corners stay inside their wall (spec §3.5)", () => {
  const rad = (deg: number) => (deg * Math.PI) / 180;

  // Two walls of length len leaving J: W1 along +x, W2 at deg counter-clockwise from it.
  const corner = (deg: number, len: number): Document => docOf({
    joints: [["J", 0, 0], ["P", len, 0], ["Q", len * Math.cos(rad(deg)), len * Math.sin(rad(deg))]],
    walls: [["W1", "J", "P"], ["W2", "J", "Q"]],
  });

  // Middle wall M from A (0, 0) to B (len, 0); 1 m side walls leave A and B upwards, deg inside each corner.
  const uShape = (deg: number, len: number): Document => docOf({
    joints: [["A", 0, 0], ["B", len, 0], ["P", Math.cos(rad(deg)), Math.sin(rad(deg))], ["Q", len - Math.cos(rad(deg)), Math.sin(rad(deg))]],
    walls: [["SA", "A", "P"], ["M", "A", "B"], ["SB", "B", "Q"]],
  });

  // IDs of walls whose outline is not a simple counter-clockwise polygon.
  const badOutlines = (doc: Document): string[] =>
    [...wallOutlines(doc)].filter(([, poly]) => !isSimplePolygon(poly) || !(signedArea(poly) > 0)).map(([id]) => id);

  it("keeps a 0.05 m wall between two inside right angles simple: its inner corners meet halfway", () => {
    const doc = uShape(90, 0.05);
    expect(badOutlines(doc)).toEqual([]);
    expect(close(wallOutlines(doc).get("M"))).toEqual([{ x: 0.025, y: 0.1 }, { x: -0.1, y: -0.1 }, { x: 0.15, y: -0.1 }]);
  });

  it("keeps two 1 m walls at 5° from spiking past their far ends", () => {
    const doc = corner(5, 1);
    const out = wallOutlines(doc);
    expect(out.size).toBe(2);
    for (const [id, poly] of out) {
      const w = doc.walls[id];
      const a = w && doc.joints[w.a];
      const b = w && doc.joints[w.b];
      const dir = a && b ? normalize(sub(b, a)) : null;
      if (!a || !dir) throw new Error(`no axis for ${id}`);
      for (const p of poly) {
        const along = dot(sub(p, a), dir);
        expect(along, id).toBeGreaterThanOrEqual(-HALF * 4 - 1e-9);
        expect(along, id).toBeLessThanOrEqual(1 + 1e-9);
      }
      expect(isSimplePolygon(poly), id).toBe(true);
    }
  });

  it("gives simple counter-clockwise outlines for L corners and U shapes at every angle from 1° to 179°", () => {
    const failures: string[] = [];
    let valid = 0;
    let total = 0;
    for (const len of [0.01, 0.05, 0.2, 1]) {
      for (let deg = 1; deg <= 179; deg++) {
        for (const [shape, doc] of [["L", corner(deg, len)], ["U", uShape(deg, len)]] as const) {
          total++;
          if (!validateDocument(doc).ok) continue;
          valid++;
          const bad = badOutlines(doc);
          if (bad.length > 0) failures.push(`${shape} ${deg}° ${len} m: ${bad.join(", ")}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(valid).toBeGreaterThan(total / 2); // not vacuous
  });

  // 1 m walls A→(-1, 0) and A→(1, 0), and a stem of length len leaving A at deg.
  const tee = (deg: number, len: number): Document => docOf({
    joints: [["A", 0, 0], ["P", -1, 0], ["Q", 1, 0], ["S", len * Math.cos(rad(deg)), len * Math.sin(rad(deg))]],
    walls: [["W1", "A", "P"], ["W2", "A", "Q"], ["St", "A", "S"]],
  });

  // A bar of length len at deg from A to B, between two straight 2 m walls through A and B: two T-junctions.
  const hBar = (deg: number, len: number): Document => {
    const b = { x: len * Math.cos(rad(deg)), y: len * Math.sin(rad(deg)) };
    return docOf({
      joints: [["A", 0, 0], ["B", b.x, b.y], ["P", -1, 0], ["Q", 1, 0], ["R", b.x - 1, b.y], ["S", b.x + 1, b.y]],
      walls: [["W1", "A", "P"], ["W2", "A", "Q"], ["W3", "B", "R"], ["W4", "B", "S"], ["Bar", "A", "B"]],
    });
  };

  // Two straight walls crossing at J at deg: 1 m arms along ±x and arms of length len along ±deg.
  const cross4 = (deg: number, len: number): Document => {
    const d = { x: len * Math.cos(rad(deg)), y: len * Math.sin(rad(deg)) };
    return docOf({
      joints: [["J", 0, 0], ["P", 1, 0], ["Q", -1, 0], ["R", d.x, d.y], ["S", -d.x, -d.y]],
      walls: [["W1", "J", "P"], ["W2", "J", "Q"], ["W3", "J", "R"], ["W4", "J", "S"]],
    });
  };

  // A fan: 1 m walls J→P along +x and J→R at 2·deg, and J→Q of length len at deg between them.
  // Below 90° the gap outside the fan is wider than 180°: an outer miter, or a bevel below 14.5°.
  const fan = (deg: number, len: number): Document => docOf({
    joints: [["J", 0, 0], ["P", 1, 0], ["Q", len * Math.cos(rad(deg)), len * Math.sin(rad(deg))], ["R", Math.cos(rad(2 * deg)), Math.sin(rad(2 * deg))]],
    walls: [["W1", "J", "P"], ["W2", "J", "Q"], ["W3", "J", "R"]],
  });

  // IDs of walls with an outline point outside the wall body (|offset| ≤ HALF, along the wall) plus the
  // outer miter and bevel zone (within MITER_LIMIT · HALF = 4 · HALF of the joint it lies behind).
  const outsideZone = (doc: Document): string[] =>
    [...wallOutlines(doc)].filter(([id, poly]) => {
      const w = doc.walls[id];
      const a = w && doc.joints[w.a];
      const b = w && doc.joints[w.b];
      const dir = a && b ? normalize(sub(b, a)) : null;
      if (!a || !b || !dir) return true;
      const len = distance(a, b);
      return poly.some((p) => {
        const along = dot(sub(p, a), dir);
        const offset = cross(dir, sub(p, a));
        const behind = (along < 0 && distance(p, a) > 4 * HALF + 1e-9) || (along > len && distance(p, b) > 4 * HALF + 1e-9);
        return Math.abs(offset) > HALF + 1e-9 || behind;
      });
    }).map(([id]) => id);

  it("gives simple counter-clockwise outlines inside their wall zone at joints of 3 and 4 walls, from 1° to 179°", () => {
    const failures: string[] = [];
    let valid = 0;
    let total = 0;
    for (const len of [0.05, 0.2, 1]) {
      for (let deg = 1; deg <= 179; deg++) {
        const shapes = [["T", tee(deg, len)], ["H", hBar(deg, len)], ["X", cross4(deg, len)], ["F", fan(deg, len)]] as const;
        for (const [shape, doc] of shapes) {
          total++;
          if (!validateDocument(doc).ok) continue;
          valid++;
          const bad = badOutlines(doc);
          const outside = outsideZone(doc);
          if (bad.length > 0) failures.push(`${shape} ${deg}° ${len} m not simple or not ccw: ${bad.join(", ")}`);
          if (outside.length > 0) failures.push(`${shape} ${deg}° ${len} m outside the wall zone: ${outside.join(", ")}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(valid).toBeGreaterThan(total / 2); // not vacuous
  });
});

describe("wallOutlines: joints of 3 or more walls leave no gap (spec §3.5)", () => {
  const STEP = 0.005;

  // Grid samples in [x0, x1] × [y0, y1] that lie within HALF of a wall centreline but inside no outline.
  // Samples within 1e-6 of an outline edge are skipped: containment on a boundary may go either way.
  const uncovered = (doc: Document, x0: number, y0: number, x1: number, y1: number): Point[] => {
    const polys = [...wallOutlines(doc).values()];
    const centrelines = Object.values(doc.walls).flatMap((w) => {
      const a = doc.joints[w.a];
      const b = doc.joints[w.b];
      return a && b ? [[a, b] as const] : [];
    });
    const onEdge = (p: Point) =>
      polys.some((poly) => poly.some((q, i) => distanceToSegment(p, q, poly[(i + 1) % poly.length] ?? q) < 1e-6));
    const out: Point[] = [];
    for (let i = 0; x0 + i * STEP <= x1 + 1e-9; i++) {
      for (let k = 0; y0 + k * STEP <= y1 + 1e-9; k++) {
        const p = { x: x0 + i * STEP, y: y0 + k * STEP };
        if (!centrelines.some(([a, b]) => distanceToSegment(p, a, b) < HALF)) continue;
        if (onEdge(p) || polys.some((poly) => pointInPolygon(p, poly))) continue;
        out.push(p);
      }
    }
    return out;
  };
  const report = (points: Point[]) => `${points.length} uncovered, e.g. ${JSON.stringify(points.slice(0, 3))}`;

  it("covers the divided demo room's T-junctions at (3, 0) and (3, 4)", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
      walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    });
    expect(validateDocument(doc).ok).toBe(true);
    const bottom = uncovered(doc, 2.7, -0.2, 3.3, 0.4);
    const top = uncovered(doc, 2.7, 3.6, 3.3, 4.2);
    expect(bottom, report(bottom)).toHaveLength(0);
    expect(top, report(top)).toHaveLength(0);
  });

  it("covers the centre of a Y junction (three walls at 120°)", () => {
    const end = (id: string, deg: number): [string, number, number] =>
      [id, Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
    const doc = docOf({
      joints: [["J", 0, 0], end("P", 90), end("Q", 210), end("R", 330)],
      walls: [["W1", "J", "P"], ["W2", "J", "Q"], ["W3", "J", "R"]],
    });
    const missing = uncovered(doc, -0.3, -0.3, 0.3, 0.3);
    expect(missing, report(missing)).toHaveLength(0);
  });

  it("covers the centre of an X junction (four walls at 90°)", () => {
    const doc = docOf({
      joints: [["J", 0, 0], ["P", 1, 0], ["Q", 0, 1], ["R", -1, 0], ["S", 0, -1]],
      walls: [["W1", "J", "P"], ["W2", "J", "Q"], ["W3", "J", "R"], ["W4", "J", "S"]],
    });
    const missing = uncovered(doc, -0.3, -0.3, 0.3, 0.3);
    expect(missing, report(missing)).toHaveLength(0);
  });

  it("gives a 0.10 m bar between two T-junctions (an H) a simple outline with area", () => {
    const doc = docOf({
      joints: [["a", 0, -1], ["b", 0, 0], ["c", 0, 1], ["d", 0.1, -1], ["e", 0.1, 0], ["f", 0.1, 1]],
      walls: [["ab", "a", "b"], ["bc", "b", "c"], ["de", "d", "e"], ["ef", "e", "f"], ["be", "b", "e"]],
    });
    expect(validateDocument(doc).ok).toBe(true);
    const bar = wallOutlines(doc).get("be") ?? [];
    expect(bar.length).toBeGreaterThanOrEqual(3);
    expect(signedArea(bar)).toBeGreaterThan(0);
    expect(isSimplePolygon(bar)).toBe(true);
    // Its inner corners meet halfway (x = 0.05) on both sides; the joints b and e close a diamond.
    expect(close(bar)).toEqual([{ x: 0.05, y: 0.1 }, { x: 0, y: 0 }, { x: 0.05, y: -0.1 }, { x: 0.1, y: 0 }]);
  });
});

