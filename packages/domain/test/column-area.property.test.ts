import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { columnOf } from "../src/column-checks";
import { execute } from "../src/commands/execute";
import { emptyDocument, type Document } from "../src/model";
import { zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { rng, wallRow } from "./helpers";

// The area oracle (pillars.01, AC-01, AC-02): random rectangular and L-shaped rooms with random columns (turned,
// off-grid; a centre in a wall's body puts the column in that wall's line), each room's area compared with a
// brute-force one, the clear floor of the room without its columns less each column rectangle (as columnOf reads it)
// clipped to that floor (Sutherland–Hodgman against the convex rectangle): for an in-line column, the part standing
// proud into the room. Columns the domain refuses (touching a wall, outside the room) are left out and counted.

type Ring = readonly Point[];

const shoelace = (ring: Ring): number => {
  let s = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    s += p.x * q.y - q.x * p.y;
  });
  return s / 2;
};

/** The part of `subject` inside the convex counter-clockwise `clip`: area-exact for a concave subject too. */
function clipArea(subject: Ring, clip: Ring): number {
  let out: Point[] = [...subject];
  clip.forEach((c, i) => {
    const d = clip[(i + 1) % clip.length] ?? c;
    const side = (p: Point): number => (d.x - c.x) * (p.y - c.y) - (d.y - c.y) * (p.x - c.x);
    const input = out;
    out = [];
    input.forEach((p, k) => {
      const q = input[(k + 1) % input.length] ?? p;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    });
  });
  return out.length >= 3 ? Math.abs(shoelace(out)) : 0;
}

/** A column's rectangle, counter-clockwise, from its typed centre, width, depth and rotation. */
function rectangle(at: Point, width: number, depth: number, rotation: number): Point[] {
  const r = (rotation * Math.PI) / 180;
  const u = { x: Math.cos(r), y: Math.sin(r) };
  const v = { x: -u.y, y: u.x };
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s = 0, t = 0]) => ({
    x: at.x + (s * width * u.x) / 2 + (t * depth * v.x) / 2,
    y: at.y + (s * width * u.y) / 2 + (t * depth * v.y) / 2,
  }));
}

/** A closed loop of walls through `ring` (counter-clockwise), each wall of a random thickness 0.10–0.30. */
function room(ring: Ring, next: () => number): Document {
  const doc = emptyDocument();
  ring.forEach((p, i) => (doc.joints[`J${i}`] = { id: `J${i}`, x: p.x, y: p.y }));
  ring.forEach((_, i) => (doc.walls[`W${i}`] = wallRow(`W${i}`, `J${i}`, `J${(i + 1) % ring.length}`, 0.1 + 0.2 * next())));
  return doc;
}

/** A random rectangle or L, off the grid. */
function randomRing(next: () => number): Point[] {
  const x = 10 * next() - 5;
  const y = 10 * next() - 5;
  const w = 2 + 6 * next();
  const h = 2 + 6 * next();
  if (next() < 0.5) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const w1 = 1 + (w - 2) * next();
  const h1 = 1 + (h - 2) * next();
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h1 }, { x: x + w1, y: y + h1 }, { x: x + w1, y: y + h }, { x, y: y + h }];
}

type Counts = { rooms: number; checked: number; inLine: number; leftOut: number; failures: string[] };

function oracle(seed: number, rooms: number, columnsPerRoom: number): Counts {
  const next = rng(seed);
  const counts: Counts = { rooms, checked: 0, inLine: 0, leftOut: 0, failures: [] };
  for (let n = 0; n < rooms; n++) {
    const ring = randomRing(next);
    let doc = room(ring, next);
    if (!validateDocument(doc).ok) throw new Error(`room ${n} is not valid`);
    const [bare] = zones(doc);
    if (!bare?.floor || bare.area === null) throw new Error(`room ${n} has no floor`);
    const floor = bare.floor;
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const rects: Point[][] = [];
    for (let c = 0; c < columnsPerRoom; c++) {
      const at = { x: x0 + (x1 - x0) * next(), y: y0 + (y1 - y0) * next() };
      const width = 0.1 + 0.5 * next();
      const depth = 0.1 + 0.5 * next();
      const rotation = 360 * next();
      const r = execute(doc, { type: "placeColumn", opId: `c${c}`, at, width, depth, rotation });
      if (!r.ok) {
        counts.leftOut += 1;
        continue;
      }
      doc = r.value.doc;
      const placed = columnOf(doc, `c${c}/w0`);
      if (!placed) throw new Error(`room ${n} column ${c} is not a column`);
      const host = placed.line ? doc.walls[placed.line[0]] : undefined;
      if (placed.line) counts.inLine += 1;
      // An in-line column is at least as deep as its wall (pillars.42), so it never leaves a recess.
      if (host && placed.depth < host.thickness - 1e-3) counts.failures.push(`room ${n} column ${c}: thinner than its wall`);
      rects.push(rectangle(placed.centre, placed.width, placed.depth, placed.rotation));
      const expected = rects.reduce((sum, q) => sum - clipArea(floor, q), bare.area);
      const got = zones(doc);
      counts.checked += 1;
      // An in-line column splits a wall of the room, so the room's key changes: one room, its area checked.
      if (got.length !== 1 || !got[0]) counts.failures.push(`room ${n} column ${c}: ${got.length} rooms`);
      else if (Math.abs((got[0].area ?? Number.NaN) - expected) > 1e-9 * expected || got[0].area === null) {
        counts.failures.push(`room ${n} column ${c}: area ${got[0].area} expected ${expected}`);
      }
    }
  }
  return counts;
}

const RESULT = oracle(20261027, 150, 3);

describe("column area oracle (AC-01, AC-02)", () => {
  it(`each room's area is its bare floor less its columns' rectangles: ${RESULT.checked} checked (${RESULT.inLine} in a line), ${RESULT.leftOut} left out of ${RESULT.rooms * 3}`, () => {
    expect(RESULT.failures).toEqual([]);
    expect(RESULT.checked).toBeGreaterThanOrEqual(200);
    expect(RESULT.inLine).toBeGreaterThan(0);
    expect(RESULT.leftOut).toBeGreaterThan(0);
  });
});
