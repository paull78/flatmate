import { describe, expect, it } from "vitest";
import { signedArea } from "../src/geometry";
import { emptyDocument, MAX_WALL_THICKNESS, MIN_WALL_THICKNESS, type Document } from "../src/model";
import { zones, type Zone } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { A, docOf, rectLoop, rng, type Spec } from "./helpers";

// AC-11 (holes.07): rooms with holes checked against exact formulas, no sampling. Random nests of rectangles, up
// to three levels, axis-aligned and rotated, with mixed wall thicknesses and every body apart from every other;
// then hand-computed L shapes for the non-rectangular cases.

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const TOLERANCE = 1e-6; // m²

/** Wall thicknesses in wall order: bottom, right, top, left (wall k runs from joint k to joint k + 1). */
type Thicknesses = readonly [number, number, number, number];

/**
 * One rectangle, one room. `w` and `h` are centreline sizes, `angle` is global, the centre is in the nest frame;
 * `phi` is the angle relative to the parent (0 for the root).
 */
type Rect = {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly angle: number;
  readonly phi: number;
  readonly w: number;
  readonly h: number;
  readonly t: Thicknesses;
  /** Wall k is drawn from joint k + 1 to joint k: thickness belongs to the wall, not to its direction. */
  readonly reversed: readonly boolean[];
  readonly children: readonly Rect[];
};

type Nest = { readonly root: Rect; readonly rects: readonly Rect[] };

const rotate = (angle: number, x: number, y: number): [number, number] => [
  Math.cos(angle) * x - Math.sin(angle) * y,
  Math.sin(angle) * x + Math.cos(angle) * y,
];

/** Room keys are the outer ring's wall IDs, sorted and joined (holes.09). */
const keyOf = (n: Rect): string => [0, 1, 2, 3].map((k) => `${n.id}.w${k}`).sort().join("|");
const holeKeys = (z: Zone): string[] => z.face.holes.map((h) => [...h.wallIds].sort().join("|")).sort();

/** Footprint size: the centreline size pushed out by half of each side wall. */
const footprintW = (n: Rect): number => n.w + (n.t[1] + n.t[3]) / 2;
const footprintH = (n: Rect): number => n.h + (n.t[0] + n.t[2]) / 2;

/** The exact net area: clear floor less each direct child's footprint. Every corner is 90°, so no bevels. */
function oracle(n: Rect): number {
  const floor = (n.w - (n.t[1] + n.t[3]) / 2) * (n.h - (n.t[0] + n.t[2]) / 2);
  return n.children.reduce((sum, c) => sum - footprintW(c) * footprintH(c), floor);
}

/** A nest drawn from its seed; children sit in cells that tile the parent's inset floor shrunk by a clearance. */
function drawNest(seed: number): Nest {
  const r = rng(seed);
  const uniform = (lo: number, hi: number): number => lo + r() * (hi - lo);
  const rects: Rect[] = [];
  const thicknesses = (): Thicknesses => {
    const one = (): number => uniform(MIN_WALL_THICKNESS, MAX_WALL_THICKNESS);
    if (r() < 0.5) {
      const t = one();
      return [t, t, t, t];
    }
    return [one(), one(), one(), one()];
  };
  // Walls longer than twice their thickness keep the inset's direction check away from its limit.
  const sideOk = (side: number, t: Thicknesses): boolean => side > 2 * Math.max(...t) && side >= 0.3;
  const childCount = (level: number): number => {
    const x = r();
    if (level === 1) return x < 0.05 ? 0 : x < 0.35 ? 1 : x < 0.7 ? 2 : 3;
    return x < 0.3 ? 0 : x < 0.6 ? 1 : x < 0.8 ? 2 : 3;
  };

  type Box = { x0: number; y0: number; x1: number; y1: number };

  function rect(cx: number, cy: number, angle: number, phi: number, w: number, h: number, t: Thicknesses, level: number): Rect {
    const id = `n${rects.length}`;
    const children: Rect[] = [];
    const node: Rect = { id, cx, cy, angle, phi, w, h, t, reversed: t.map(() => r() < 0.5), children };
    rects.push(node);
    if (level < 3) children.push(...drawChildren(node, level));
    return node;
  }

  function drawChildren(p: Rect, level: number): Rect[] {
    const k = childCount(level);
    if (k === 0) return [];
    const c = uniform(0.01, 0.3);
    const x0 = -p.w / 2 + p.t[3] / 2 + c;
    const x1 = p.w / 2 - p.t[1] / 2 - c;
    const y0 = -p.h / 2 + p.t[0] / 2 + c;
    const y1 = p.h / 2 - p.t[2] / 2 - c;
    const alongX = x1 - x0 >= y1 - y0;
    const cell = ((alongX ? x1 - x0 : y1 - y0) - (k - 1) * c) / k;
    if (cell <= 0) return [];
    const out: Rect[] = [];
    for (let i = 0; i < k; i++) {
      const start = (alongX ? x0 : y0) + i * (cell + c);
      const box: Box = alongX ? { x0: start, y0, x1: start + cell, y1 } : { x0, y0: start, x1, y1: start + cell };
      const child = placeChild(p, box, level + 1);
      if (child) out.push(child);
    }
    return out;
  }

  function placeChild(p: Rect, box: Box, level: number): Rect | null {
    const cw = box.x1 - box.x0;
    const ch = box.y1 - box.y0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const t = thicknesses();
      const phi = r() < 0.4 ? 0 : uniform(0, Math.PI / 2);
      const fw = uniform(0.3, 0.95) * cw;
      const fh = uniform(0.3, 0.95) * ch;
      const cos = Math.abs(Math.cos(phi));
      const sin = Math.abs(Math.sin(phi));
      const bw = cos * fw + sin * fh;
      const bh = sin * fw + cos * fh;
      const w = fw - (t[1] + t[3]) / 2;
      const h = fh - (t[0] + t[2]) / 2;
      if (bw > cw || bh > ch || !sideOk(w, t) || !sideOk(h, t)) continue;
      // The footprint's centre, anywhere in the slack. The footprint spans [−w/2 − t₃/2, w/2 + t₁/2] across and
      // [−h/2 − t₀/2, h/2 + t₂/2] up in the child's frame, so it is off the centreline centre by a quarter of
      // each opposite pair's difference.
      const fx = box.x0 + bw / 2 + r() * (cw - bw);
      const fy = box.y0 + bh / 2 + r() * (ch - bh);
      const [ox, oy] = rotate(phi, (t[1] - t[3]) / 4, (t[2] - t[0]) / 4);
      const [gx, gy] = rotate(p.angle, fx - ox, fy - oy);
      return rect(p.cx + gx, p.cy + gy, p.angle + phi, phi, w, h, t, level);
    }
    return null;
  }

  const root = rect(uniform(-5, 5), uniform(-5, 5), 0, 0, uniform(8, 20), uniform(8, 20), thicknesses(), 1);
  return { root, rects };
}

/** A fresh document of the nest, every joint rotated by α about the origin and then moved by (tx, ty). */
function buildDoc(nest: Nest, alpha: number, tx: number, ty: number): Document {
  const doc: Document = emptyDocument();
  for (const n of nest.rects) {
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    corners.forEach(([sx, sy], k) => {
      const [lx, ly] = rotate(n.angle, (sx * n.w) / 2, (sy * n.h) / 2);
      const [x, y] = rotate(alpha, n.cx + lx, n.cy + ly);
      const id = `${n.id}.j${k}`;
      doc.joints[id] = { id, x: x + tx, y: y + ty };
    });
    n.t.forEach((thickness, k) => {
      const id = `${n.id}.w${k}`;
      const from = `${n.id}.j${k}`;
      const to = `${n.id}.j${(k + 1) % 4}`;
      doc.walls[id] = n.reversed[k] ? { id, a: to, b: from, thickness, top: "ceiling", base: "floor", column: false } : { id, a: from, b: to, thickness, top: "ceiling", base: "floor", column: false };
    });
  }
  return doc;
}

/** The three builds of a seed's nest: as drawn, a quarter turn about the origin, a random turn and move. */
function builds(seed: number): { nest: Nest; docs: Document[] } {
  const nest = drawNest(seed);
  const r = rng(seed + 100_000);
  const alpha = r() * 2 * Math.PI;
  const tx = r() * 100 - 50;
  const ty = r() * 100 - 50;
  return { nest, docs: [buildDoc(nest, 0, 0, 0), buildDoc(nest, Math.PI / 2, 0, 0), buildDoc(nest, alpha, tx, ty)] };
}

function zoneByKey(doc: Document, key: string): Zone | undefined {
  return zones(doc).find((z) => z.face.key === key);
}

function expectNear(actual: number | null | undefined, expected: number, message: string): void {
  expect(actual, message).toBeTypeOf("number");
  expect(Math.abs((actual ?? Number.NaN) - expected), `${message}: ${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE);
}

describe("holes property test (AC-11)", () => {
  it("the generator draws valid, varied nests", () => {
    let threeLevels = 0;
    let rotated = 0;
    let axisAligned = 0;
    let twoChildren = 0;
    let mixedThickness = 0;
    for (const seed of SEEDS) {
      const { nest, docs } = builds(seed);
      docs.forEach((doc, i) => expect(validateDocument(doc).ok, `seed ${seed} build ${i}`).toBe(true));
      const children = nest.rects.filter((n) => n !== nest.root);
      if (nest.root.children.some((c) => c.children.length > 0)) threeLevels++;
      rotated += children.filter((n) => n.phi !== 0).length;
      if (children.length > 0 && children.every((n) => n.phi === 0)) axisAligned++;
      twoChildren += nest.rects.filter((n) => n.children.length >= 2).length;
      mixedThickness += nest.rects.filter((n) => n.t.some((t) => t !== n.t[0])).length;
      // Every hole moves its parent's area by far more than the tolerance.
      for (const n of children) expect(footprintW(n) * footprintH(n), `seed ${seed} room ${keyOf(n)}`).toBeGreaterThanOrEqual(0.09);
    }
    expect(threeLevels).toBeGreaterThanOrEqual(30);
    expect(rotated).toBeGreaterThanOrEqual(100);
    expect(axisAligned).toBeGreaterThanOrEqual(30);
    expect(twoChildren).toBeGreaterThanOrEqual(30);
    expect(mixedThickness).toBeGreaterThanOrEqual(50);
  });

  it("every room is available and its area is the exact formula", () => {
    for (const seed of SEEDS) {
      const nest = drawNest(seed);
      const doc = buildDoc(nest, 0, 0, 0);
      expect(zones(doc).length, `seed ${seed}`).toBe(nest.rects.length);
      for (const n of nest.rects) {
        const message = `seed ${seed} room ${keyOf(n)}`;
        const zone = zoneByKey(doc, keyOf(n));
        expect(zone, message).toBeDefined();
        if (!zone) continue;
        expect(zone.unavailable, message).toBeNull();
        expectNear(zone.area, oracle(n), message);
        // Direct children only: a hole attached to the grandparent fails this.
        expect(holeKeys(zone), message).toEqual(n.children.map(keyOf).sort());
        expect(zone.holes.length, message).toBe(n.children.length);
        // zone.holes pairs with face.holes: each footprint is its own child's, around that child's outline.
        zone.face.holes.forEach((hole, i) => {
          const child = n.children.find((c) => keyOf(c) === [...hole.wallIds].sort().join("|"));
          const zh = zone.holes[i];
          expect(child, `${message} hole ${i}`).toBeDefined();
          expect(zh?.footprint, `${message} hole ${i}`).not.toBeNull();
          if (!child || !zh?.footprint) return;
          expect(zh.outline, `${message} hole ${i}`).toEqual(hole.ring);
          expectNear(Math.abs(signedArea(zh.footprint)), footprintW(child) * footprintH(child), `${message} hole ${i} footprint`);
        });
      }
    }
  });

  it("rotating or moving a whole nest leaves every area unchanged", () => {
    for (const seed of SEEDS) {
      const { nest, docs } = builds(seed);
      // The turned builds tie leftmost joints only nearly: no extra face, every hole still on its own parent.
      docs.forEach((doc, i) => expect(zones(doc).length, `seed ${seed} build ${i}`).toBe(nest.rects.length));
      for (const n of nest.rects) {
        const message = `seed ${seed} room ${keyOf(n)}`;
        docs.forEach((doc, i) => {
          const zone = zoneByKey(doc, keyOf(n));
          expect(zone?.unavailable, `${message} build ${i}`).toBeNull();
          expect(zone && holeKeys(zone), `${message} build ${i}`).toEqual(n.children.map(keyOf).sort());
        });
        const areas = docs.map((doc) => zoneByKey(doc, keyOf(n))?.area);
        const first = areas[0];
        areas.forEach((area, i) => {
          expectNear(area, oracle(n), `${message} build ${i}`);
          expectNear(area, first ?? Number.NaN, `${message} build ${i} vs build 0`);
        });
      }
    }
  });
});

// ── L-shaped fixtures, computed by hand ─────────────────────────────────────────────────────────────────────────

type Transform = (x: number, y: number) => [number, number];
const asDrawn: Transform = (x, y) => [x, y];
const turned: Transform = (x, y) => {
  const [rx, ry] = rotate(Math.PI / 6, x - 5, y - 4);
  return [rx + 5, ry + 4];
};

function moved(spec: Spec, f: Transform): Spec {
  return {
    ...spec,
    joints: spec.joints?.map(([id, x, y]): [string, number, number] => {
      const [px, py] = f(x, y);
      return [id, px, py];
    }),
  };
}

function docIn(f: Transform, ...parts: Spec[]): Document {
  return docOf({ joints: parts.flatMap((s) => moved(s, f).joints ?? []), walls: parts.flatMap((s) => s.walls ?? []) });
}

/** A closed polygon `${p}j0..` with walls `${p}0..`, wall i from joint i to joint i + 1, at its own thickness. */
function polygon(p: string, points: [number, number][], thickness: (i: number) => number = () => 0.2): Spec {
  return {
    joints: points.map(([x, y], i): [string, number, number] => [`${p}j${i}`, x, y]),
    walls: points.map((_, i): [string, string, string, number] => [`${p}${i}`, `${p}j${i}`, `${p}j${(i + 1) % points.length}`, thickness(i)]),
  };
}

const ringKey = (spec: Spec): string => (spec.walls ?? []).map(([id]) => id).sort().join("|");
const L_CORE: [number, number][] = [[3, 2], [7, 2], [7, 4], [5, 4], [5, 6], [3, 6]];
const L_ROOM: [number, number][] = [[0, 0], [10, 0], [10, 4], [6, 4], [6, 8], [0, 8]];

/** Apartment A around the L core; `thick` makes the bottom (L0) and left (L5) core walls 0.40 m. */
function lCore(f: Transform, thick: boolean, name: string): void {
  const core = polygon("L", L_CORE, (i) => (thick && (i === 0 || i === 5) ? 0.4 : 0.2));
  const doc = docIn(f, A, core);
  const apartment = zoneByKey(doc, ringKey(A));
  const inner = zoneByKey(doc, ringKey(core));
  expect(apartment?.face.holes.length, name).toBe(1);
  expectNear(apartment?.area, thick ? 61.95 : 62.8, `${name} apartment`);
  expectNear(inner?.area, thick ? 9.69 : 10.44, `${name} core`);
}

/** The L room with the upper core alone, then with a core in each arm. */
function lRoom(f: Transform, name: string): void {
  const room = polygon("R", L_ROOM);
  const upper = rectLoop("U", 2, 5, 4, 7);
  const lower = rectLoop("D", 7, 1, 9, 3);
  const one = docIn(f, room, upper);
  expectNear(zoneByKey(one, ringKey(room))?.area, 55.6, `${name} one core`);
  const two = docIn(f, room, upper, lower);
  const z = zoneByKey(two, ringKey(room));
  expect(z?.face.holes.length, name).toBe(2);
  expectNear(z?.area, 50.76, `${name} two cores`);
  expectNear(zoneByKey(two, ringKey(upper))?.area, 3.24, `${name} upper core`);
  expectNear(zoneByKey(two, ringKey(lower))?.area, 3.24, `${name} lower core`);
}

describe("holes: L-shaped fixtures", () => {
  it("L-shaped core in the 10 × 8 m room: 76.44 − 13.64 = 62.80 m², core interior 10.44 m²", () => {
    lCore(asDrawn, false, "L core");
  });

  it("L-shaped core with 0.40 m bottom and left walls: 76.44 − 14.49 = 61.95 m², interior 9.69 m²", () => {
    lCore(asDrawn, true, "thick L core");
  });

  it("L-shaped room with a 2 × 2 m core in each arm: 60.44 − 2 × 4.84 = 50.76 m²", () => {
    lRoom(asDrawn, "L room");
  });

  it("the L fixtures rotated by 30° about (5, 4) keep their areas within 1e-6", () => {
    lCore(turned, false, "turned L core");
    lCore(turned, true, "turned thick L core");
    lRoom(turned, "turned L room");
  });
});
