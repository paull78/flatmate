import { describe, expect, it } from "vitest";
import { convexOverlap, placedPiece } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { aggregateLayout } from "../../src/view/aggregate";
import { APPEARANCE } from "../../src/view3d/parts";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Box3, Part } from "../../src/view3d/parts/types";
import { STYLE_3D } from "../../src/view3d/style";
import { LIVE_KINDS, PARTS_KINDS, PLAIN_KINDS, kind, namedSizes, outside, partsOf, pieceOf, stream, type Size } from "./parts-fixtures";

// What every kind's parts must meet (parts AC-01, AC-03, AC-09): inside the drawn shape and range, filling the box with
// no overlaps, more than one part, under the face cap.

const MM = 0.001;
const FACE_CAP = 150;

/** Random sizes from 0.10 to 10 m (heights from 0.01 to 3 m, catalog.22) in each configuration, at random rotations. */
function randomSizes(kindId: string, count: number, seed: number): (Size & { rotation: number })[] {
  const random = stream(seed);
  const k = kind(kindId);
  const out: (Size & { rotation: number })[] = [];
  for (let i = 0; i < count; i++) {
    const c = k.configs[i % k.configs.length];
    if (!c) continue;
    const pick = (lo: number, hi: number) => lo + random() * (hi - lo);
    const w = random() < 0.3 ? pick(0.1, 0.6) : pick(0.1, 10);
    const d = random() < 0.3 ? pick(0.1, 0.6) : pick(0.1, 10);
    const h = random() < 0.2 ? pick(0.01, 0.1) : pick(0.1, 3);
    out.push({ config: c.id, w, d, h, rotation: random() * 360, label: `${kindId}.${c.id} ${w.toFixed(3)}×${d.toFixed(3)}×${h.toFixed(3)}` });
  }
  return out;
}

const allSizes = (kindId: string) => [...namedSizes(kind(kindId)).map((s) => ({ ...s, rotation: 0 })), ...randomSizes(kindId, 200, 7 + kindId.length)];

/** A part's local box (an outline fills the footprint, a ring its bounds). */
function boxOf(p: Part, w: number, d: number): Box3 {
  if (p.shape === "outline") return { x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2, z0: p.z0, z1: p.z1 };
  if (p.shape !== "ring") return p.at;
  const [xs, ys] = [p.ring.map((q) => q.x), p.ring.map((q) => q.y)];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: p.z0, z1: p.z1 };
}

/** A part's plan shape: a ring exactly, so parts along a curve don't read as overlapping; any other part its box. */
function planOf(p: Part, w: number, d: number): readonly Point[] {
  if (p.shape === "ring") return p.ring;
  const b = boxOf(p, w, d);
  return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
}

describe("furniture parts", () => {
  it("every part lies inside the piece's drawn shape and its range, at any size and rotation (AC-01)", () => {
    const bad: string[] = [];
    for (const id of PARTS_KINDS) {
      for (const s of allSizes(id)) {
        const item = pieceOf(id, s.config, s.w, s.d, s.h, s.rotation);
        // Inside one of the shape's convex parts: the drawn ring itself, or one of an `L`'s arms (catalog.16).
        const parts = placedPiece(id, { x: 5, y: 5 }, s.w, s.d, s.rotation).parts;
        for (const f of partSolids("o", item, STYLE_3D).flatMap((p) => p.faces)) {
          for (const p of f.points) {
            const off = Math.min(...parts.map((ring) => outside(ring, p)));
            if (off > MM || p.z < item.bottom - MM || p.z > item.top + MM) bad.push(`${s.label}: (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) out by ${Math.max(off, item.bottom - p.z, p.z - item.top).toFixed(4)}`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("each kind in parts has more than one part at its default size and presets, in every configuration (AC-01)", () => {
    for (const id of PARTS_KINDS) for (const s of namedSizes(kind(id))) expect(partsOf(id, s).length, s.label).toBeGreaterThan(1);
  });

  it("the every-kind rules leave out only the plain kinds and the three sets", () => {
    const out = LIVE_KINDS.map((k) => k.id).filter((id) => !PARTS_KINDS.includes(id));
    expect(out.sort()).toEqual([...PLAIN_KINDS, "deskSet", "seatedDining", "seatedRound"].sort());
    expect(PARTS_KINDS).toEqual(expect.arrayContaining(["builtInTable", "builtInDesk"]));
  });

  it("every live furniture kind but the plain ones draws more than one part, in every configuration; the plain ones one solid (AC-10)", () => {
    for (const k of LIVE_KINDS) {
      for (const s of namedSizes(k)) {
        if (PLAIN_KINDS.includes(k.id)) expect(partsOf(k.id, s).length, s.label).toBe(1);
        else expect(partsOf(k.id, s).length, s.label).toBeGreaterThan(1);
      }
    }
  });

  it("the parts fill the piece's box and no two overlap, at any size (AC-03)", () => {
    const bad: string[] = [];
    for (const id of PARTS_KINDS) {
      for (const s of allSizes(id)) {
        const parts = partsOf(id, s);
        const boxes = parts.map((p) => boxOf(p, s.w, s.d));
        const plans = parts.map((p) => planOf(p, s.w, s.d));
        const span = (lo: (b: Box3) => number, hi: (b: Box3) => number) => [Math.min(...boxes.map(lo)), Math.max(...boxes.map(hi))];
        const [x0, x1] = span((b) => b.x0, (b) => b.x1);
        const [y0, y1] = span((b) => b.y0, (b) => b.y1);
        const [z0, z1] = span((b) => b.z0, (b) => b.z1);
        const want = [-s.w / 2, s.w / 2, -s.d / 2, s.d / 2, 0, s.h];
        [x0, x1, y0, y1, z0, z1].forEach((v, i) => { if (Math.abs((v ?? NaN) - (want[i] ?? 0)) > MM) bad.push(`${s.label}: extent ${i} is ${v} not ${want[i]}`); });
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b, j) => {
          const over = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > MM && convexOverlap(plans[i] ?? [], plans[i + j + 1] ?? [], MM);
          if (over) bad.push(`${s.label}: parts ${i} and ${i + j + 1} overlap`);
        }));
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("at every step of a flip between two configurations, the target's parts lie inside the tweened box and fill it (AC-04)", () => {
    const bad: string[] = [];
    for (const id of PARTS_KINDS) {
      const k = kind(id);
      for (const from of k.configs) {
        for (const to of k.configs) {
          if (from.id === to.id) continue;
          for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            const lerp = (a: number, b: number) => a + (b - a) * t;
            const s = { config: to.id, w: lerp(from.w, to.w), d: lerp(from.d, to.d), h: lerp(from.h, to.h), label: `${id} ${from.id}→${to.id} t ${t}` };
            const boxes = partsOf(id, s).map((p) => boxOf(p, s.w, s.d));
            const lo = { x: Math.min(...boxes.map((b) => b.x0)), y: Math.min(...boxes.map((b) => b.y0)), z: Math.min(...boxes.map((b) => b.z0)) };
            const hi = { x: Math.max(...boxes.map((b) => b.x1)), y: Math.max(...boxes.map((b) => b.y1)), z: Math.max(...boxes.map((b) => b.z1)) };
            const ok = [lo.x + s.w / 2, hi.x - s.w / 2, lo.y + s.d / 2, hi.y - s.d / 2, lo.z, hi.z - s.h].every((v) => Math.abs(v) <= MM);
            const inside = boxes.every((b) => b.x0 >= -s.w / 2 - MM && b.x1 <= s.w / 2 + MM && b.y0 >= -s.d / 2 - MM && b.y1 <= s.d / 2 + MM && b.z0 >= -MM && b.z1 <= s.h + MM);
            if (!ok || !inside) bad.push(s.label);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("each configuration draws its own parts, so a misnamed configuration can't fall through to another's (the lift bed changes only height, parts.03)", () => {
    for (const id of PARTS_KINDS.filter((k) => k !== "liftBed")) {
      const k = kind(id);
      const [first] = k.configs;
      if (!first || k.configs.length < 2) continue;
      const at = { w: first.w, d: first.d, h: first.h };
      const drawn = k.configs.map((c) => JSON.stringify(partsOf(id, { ...at, config: c.id, label: c.id })));
      expect(new Set(drawn).size, id).toBe(k.configs.length);
    }
  });

  it("every kind stays under the face cap at its default size, presets and 10 m, in every configuration (AC-09); an aggregate under one cap for its table and each chair", () => {
    for (const id of APPEARANCE.keys()) {
      const k = kind(id);
      const sizes = [...namedSizes(k), ...k.configs.map((c) => ({ config: c.id, w: 10, d: 10, h: 3, label: `${id}.${c.id} 10 m` }))];
      for (const s of sizes) {
        const item = pieceOf(id, s.config, s.w, s.d, s.h);
        const worst = partSolids("o", item, STYLE_3D).flatMap((p) => p.faces).length; // every side listed (real3d.09)
        // A set is its table and loose chairs' parts (seating.15): the cap holds for each of them, as for loose pieces.
        const pieces = 1 + (aggregateLayout(id, s.w, s.d)?.chairs.length ?? 0);
        expect(worst, s.label).toBeLessThanOrEqual(FACE_CAP * pieces);
      }
    }
  });
});
