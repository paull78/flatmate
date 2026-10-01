import { describe, expect, it } from "vitest";
import { err, ok, type EntityKey, type Point, type Result } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Violation } from "../src/errors";
import { distance, distanceToSegment, overlappingPairs, pointInPolygon, segmentIntersection, type Box } from "../src/geometry";
import { EPS, MIN_EDGE, type Document, type Wall } from "../src/model";
import { boundedFaces, bridges } from "../src/queries/faces";
import { faceAt, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";

// Large drawings (spec §6.3): the pair checks use a bounding-box sweep instead of testing every pair. Each fast
// path is compared with the all-pairs code it replaced on random drawings full of near misses at the 1 mm tolerance.

declare const performance: { now(): number };

/** A small deterministic generator (mulberry32), so a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Joints on a 0.5 m lattice, some nudged to just inside or just outside the tolerance; random walls between them. */
function randomDoc(seed: number): Document {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => {
    const x = xs[Math.floor(r() * xs.length)];
    if (x === undefined) throw new Error("empty list");
    return x;
  };
  const nudges = [0, 0, 0, EPS * 0.4, -EPS * 0.4, EPS * 0.99, EPS * 1.01, -EPS * 1.5, EPS * 3];
  const doc: Document = { joints: {}, walls: {}, zoneLabels: {} };
  const jointCount = 4 + Math.floor(r() * 10);
  for (let i = 0; i < jointCount; i++) {
    const id = `j${i}`;
    doc.joints[id] = { id, x: Math.floor(r() * 6) * 0.5 + pick(nudges), y: Math.floor(r() * 6) * 0.5 + pick(nudges) };
  }
  const ids = Object.keys(doc.joints);
  const wallCount = 2 + Math.floor(r() * 12);
  for (let i = 0; i < wallCount; i++) {
    const id = `w${i}`;
    doc.walls[id] = { id, a: pick(ids), b: r() < 0.05 ? "missing" : pick(ids) };
  }
  return doc;
}

// ── The all-pairs code the sweep replaced (validate.ts and faces.ts before 2026-10-01) ──────────────────────────

const jointKey = (id: string): EntityKey => ({ table: "joints", id });
const wallKey = (id: string): EntityKey => ({ table: "walls", id });

function allPairsValidate(doc: Document): Result<void, Violation[]> {
  type Segment = { wall: Wall; a: Point; b: Point };
  const out: Violation[] = [];
  const segments: Segment[] = [];
  const used = new Set<string>();
  const wallIds = Object.keys(doc.walls).sort();
  const jointIds = Object.keys(doc.joints).sort();
  for (const id of wallIds) {
    const wall = doc.walls[id];
    if (!wall) continue;
    const a = doc.joints[wall.a];
    const b = doc.joints[wall.b];
    if (!a || !b || wall.a === wall.b) {
      out.push({ invariant: "I1", message: `Wall ${id} needs two existing, distinct joints`, entities: [wallKey(id)] });
      continue;
    }
    used.add(wall.a);
    used.add(wall.b);
    if (distance(a, b) < MIN_EDGE) out.push({ invariant: "I2", message: `Wall ${id} is shorter than 1 cm`, entities: [wallKey(id)] });
    segments.push({ wall, a, b });
  }
  for (const id of jointIds) {
    if (!used.has(id)) out.push({ invariant: "I3", message: `Joint ${id} is not used by any wall`, entities: [jointKey(id)] });
  }
  const joints = jointIds.flatMap((id) => doc.joints[id] ?? []);
  joints.forEach((p, i) => {
    for (const q of joints.slice(i + 1)) {
      if (distance(p, q) < EPS) out.push({ invariant: "I4", message: `Joints ${p.id} and ${q.id} coincide`, entities: [jointKey(p.id), jointKey(q.id)] });
    }
  });
  segments.forEach((s, i) => {
    for (const t of segments.slice(i + 1)) {
      const shared = [s.wall.a, s.wall.b].filter((j) => j === t.wall.a || j === t.wall.b);
      const entities = [wallKey(s.wall.id), wallKey(t.wall.id)];
      if (shared.length === 2) {
        out.push({ invariant: "I7", message: `Walls ${s.wall.id} and ${t.wall.id} overlap`, entities });
        continue;
      }
      const hit = segmentIntersection(s.a, s.b, t.a, t.b);
      if (hit.kind === "overlap") {
        out.push({ invariant: "I7", message: `Walls ${s.wall.id} and ${t.wall.id} overlap`, entities });
      } else if (hit.kind === "point") {
        const sharedJoint = shared[0] === undefined ? undefined : doc.joints[shared[0]];
        if (!sharedJoint || distance(hit.point, sharedJoint) >= EPS) {
          out.push({ invariant: "I5", message: `Walls ${s.wall.id} and ${t.wall.id} cross`, entities });
        }
      }
    }
  });
  for (const j of joints) {
    for (const s of segments) {
      if (s.wall.a === j.id || s.wall.b === j.id) continue;
      if (distanceToSegment(j, s.a, s.b) < EPS) {
        out.push({ invariant: "I6", message: `Joint ${j.id} lies on wall ${s.wall.id}`, entities: [jointKey(j.id), wallKey(s.wall.id)] });
      }
    }
  }
  return out.length === 0 ? ok(undefined) : err(out);
}

type Edge = { wallId: string; a: string; b: string };

function searchBridges(edges: Edge[]): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    const seen = new Set<string>([e.a]);
    const stack = [e.a];
    for (let v = stack.pop(); v !== undefined && !seen.has(e.b); v = stack.pop()) {
      for (const f of edges) {
        if (f.wallId === e.wallId || (f.a !== v && f.b !== v)) continue;
        const w = f.a === v ? f.b : f.a;
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    if (!seen.has(e.b)) out.add(e.wallId);
  }
  return out;
}

function edgesOf(doc: Document): Edge[] {
  return Object.values(doc.walls).flatMap((w) => (doc.joints[w.a] && doc.joints[w.b] && w.a !== w.b ? [{ wallId: w.id, a: w.a, b: w.b }] : []));
}

/** An n × n grid of 1 m rooms, one label per room. */
function grid(n: number): Document {
  const doc: Document = { joints: {}, walls: {}, zoneLabels: {} };
  const j = (x: number, y: number): string => `j${x}_${y}`;
  for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) doc.joints[j(x, y)] = { id: j(x, y), x, y };
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      if (x < n) doc.walls[`h${x}_${y}`] = { id: `h${x}_${y}`, a: j(x, y), b: j(x + 1, y) };
      if (y < n) doc.walls[`v${x}_${y}`] = { id: `v${x}_${y}`, a: j(x, y), b: j(x, y + 1) };
      if (x < n && y < n) doc.zoneLabels[`l${x}_${y}`] = { id: `l${x}_${y}`, at: { x: x + 0.5, y: y + 0.5 }, name: "Room" };
    }
  }
  return doc;
}

/** Adds a square room of the given side with its lower-left corner at (x, y). */
function withSquare(doc: Document, name: string, x: number, y: number, side: number): Document {
  const corners = [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }];
  const joints = { ...doc.joints };
  const walls = { ...doc.walls };
  corners.forEach((c, i) => {
    joints[`${name}${i}`] = { id: `${name}${i}`, ...c };
    walls[`${name}w${i}`] = { id: `${name}w${i}`, a: `${name}${i}`, b: `${name}${(i + 1) % 4}` };
  });
  return { ...doc, joints, walls };
}

/** A 40 m square room at x 10…50, much larger than the grid's 1 m rooms. */
function withBigRoom(doc: Document): Document {
  return withSquare(doc, "big", 10, 0, 40);
}

describe("overlappingPairs", () => {
  it("returns exactly the pairs whose widened boxes overlap, sorted", () => {
    const r = rng(7);
    for (let round = 0; round < 50; round++) {
      const boxes: Box[] = Array.from({ length: 30 }, () => {
        const x = Math.floor(r() * 10);
        const y = Math.floor(r() * 10);
        return { minX: x, minY: y, maxX: x + Math.floor(r() * 3), maxY: y + Math.floor(r() * 3) };
      });
      const margin = r() < 0.5 ? 0 : 0.5;
      const expected: [number, number][] = [];
      boxes.forEach((a, i) =>
        boxes.forEach((b, j) => {
          const gap = 2 * margin;
          if (i < j && a.minX <= b.maxX + gap && b.minX <= a.maxX + gap && a.minY <= b.maxY + gap && b.minY <= a.maxY + gap) expected.push([i, j]);
        }),
      );
      expect(overlappingPairs(boxes, margin)).toEqual(expected);
    }
  });
});

describe("large drawings: the sweep gives the same answers as all pairs", () => {
  it("validateDocument reports the same violations in the same order (500 random drawings)", () => {
    let invalid = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const doc = randomDoc(seed);
      const expected = allPairsValidate(doc);
      if (!expected.ok) invalid += 1;
      expect(validateDocument(doc), `seed ${seed}`).toEqual(expected);
    }
    expect(invalid).toBeGreaterThan(100); // the generator does exercise the violations
  });

  it("bridges finds the walls that close no cycle (300 random graphs)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const edges = edgesOf(randomDoc(seed));
      expect(bridges(edges), `seed ${seed}`).toEqual(searchBridges(edges));
    }
  });

  it.each([
    ["a grid of equal rooms", grid(6), 8],
    ["small rooms next to one large room (tested for every point)", withBigRoom(grid(6)), 52],
  ])("faceAt picks the same face as testing every face: %s", (_name, doc, span) => {
    const faces = boundedFaces(doc);
    const r = rng(3);
    for (let i = 0; i < 600; i++) {
      const p = { x: r() * span - 1, y: r() < 0.2 ? Math.round(r() * 6) : r() * span - 1 }; // some on walls
      const onBoundary = (ring: readonly Point[]): boolean =>
        ring.some((a, k) => {
          const b = ring[(k + 1) % ring.length];
          return b !== undefined && distanceToSegment(p, a, b) < EPS;
        });
      const hits = faces.filter((f) => onBoundary(f.ring) || pointInPolygon(p, f.ring)).sort((a, b) => a.centreArea - b.centreArea);
      const best = hits[0];
      const expected = best && best.simple && !onBoundary(best.ring) ? best.key : null;
      expect(faceAt(doc, p)?.key ?? null, `(${p.x}, ${p.y})`).toBe(expected);
    }
  });
});

describe("large drawings: far from the origin", () => {
  // Beyond 2^53 grid cells x + 1 === x: a cell loop there never ends (the worker runs out of memory, so this test
  // hangs rather than fails if the guard is removed). Validation accepts any finite coordinates (I8).
  it("finds a room 2^60 m away next to rooms near the origin", () => {
    const far = 2 ** 60;
    // Four 1 m rooms and a 512 m room give a grid cell of about 103 m, so the far room covers 36 cells about 1.1e16
    // cells out, past 2^53. Doubles step by 256 at 2^60, so far + 256 is the room's exact centre.
    const doc = withSquare(grid(2), "far", far, 0, 512);
    expect(validateDocument(doc).ok).toBe(true);
    expect(zones(doc)).toHaveLength(5);
    expect(faceAt(doc, { x: far + 256, y: 256 })?.jointIds).toHaveLength(4);
    expect(faceAt(doc, { x: 0.5, y: 0.5 })).not.toBeNull();
  });
});

describe("large drawings: speed (spec §6.3)", () => {
  it("moves a joint in a 40 × 40 grid (1 600 rooms) well within a second", () => {
    const doc = grid(40);
    zones(doc);
    const move = (dx: number) => execute(doc, { type: "moveJoints", moves: [{ jointId: "j20_20", to: { x: 20 + dx, y: 20 } }] });
    move(0.05); // warm-up
    const t = performance.now();
    const r = move(0.1);
    const ms = performance.now() - t;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(250); // all-pairs: about 1.5 s
  });
});
