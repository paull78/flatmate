import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, sortedIds, unwrap, zones, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { compareTrace, compareTraceByUnderlay, outerWallIds, truthTopLeft, type TraceReport } from "../scripts/compare-trace";
import { mulberry32 } from "./pictures";

// AC-15's comparison (import.18): same rooms, every outer wall of the truth within 0.10 m of the trace, after a given
// translation. Nothing is fitted, so an error never hides in an alignment step.

function run(doc: Document, cmds: Command[]): Document {
  return cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

/** 4.37 × 7.13 m, off the grid and away from the origin, split by a partition off centre at y = 0.94. */
const TRUTH = run(emptyDocument(), [
  ...rectangleRoom({ x: 12.31, y: -3.07 }, 4.37, 7.13, "r"),
  { type: "addWall", opId: "p", from: { at: { x: 12.31, y: 0.94 } }, to: { at: { x: 16.68, y: 0.94 } } },
  { type: "labelZone", id: "kitchen", at: { x: 14.0, y: 2.5 }, name: "Kitchen", finish: null },
  { type: "labelZone", id: "bed", at: { x: 14.0, y: -1.0 }, name: "Bed 1", finish: null },
]);
const PARTITION = "p/w0";

/** p ↦ about + (p − about)·k + t + jitter; `scale` defaults to k = 1. */
type Mapping = { t: Point; jitter: (jointId: string, p: Point) => Point; scale?: { k: number; about: Point } };

/**
 * A traced drawing built from scratch: each truth wall (in id order) from its mapped joints, with its thickness; each
 * label at its point mapped without jitter; then `extra`. Walls and labels named in `skip` are left out. A joint is
 * mapped once, so shared joints stay shared.
 */
function retrace(truth: Document, map: Mapping, extra: (mapped: (jointId: string) => Point) => Command[] = () => [], skip: string[] = []): Document {
  const cache = new Map<string, Point>();
  const { k, about } = map.scale ?? { k: 1, about: { x: 0, y: 0 } };
  const place = (p: Point): Point => ({ x: about.x + (p.x - about.x) * k + map.t.x, y: about.y + (p.y - about.y) * k + map.t.y });
  const mapped = (jointId: string): Point => {
    const hit = cache.get(jointId);
    if (hit) return hit;
    const j = truth.joints[jointId];
    if (!j) throw new Error(`no joint ${jointId}`);
    const d = map.jitter(jointId, j);
    const q = place(j);
    const p = { x: q.x + d.x, y: q.y + d.y };
    cache.set(jointId, p);
    return p;
  };
  const walls = sortedIds(truth.walls).flatMap((id, i): Command[] => {
    const w = truth.walls[id];
    if (!w || skip.includes(id)) return [];
    return [{ type: "addWall", opId: `t${i}`, from: { at: mapped(w.a) }, to: { at: mapped(w.b) }, thickness: w.thickness }];
  });
  const labels = Object.values(truth.zoneLabels).flatMap((l): Command[] => (
    skip.includes(l.id) ? [] : [{ type: "labelZone", id: l.id, at: place(l.at), name: l.name, finish: null }]
  ));
  return run(emptyDocument(), [...walls, ...labels, ...extra(mapped)]);
}

const NO_JITTER = (): Point => ({ x: 0, y: 0 });
/** Up to ±amplitude per axis, drawn once per joint in the order joints are mapped. */
function seededJitter(seed: number, amplitude: number, axes: { x: boolean; y: boolean } = { x: true, y: true }): Mapping["jitter"] {
  const random = mulberry32(seed);
  return () => ({ x: axes.x ? (random() * 2 - 1) * amplitude : 0, y: axes.y ? (random() * 2 - 1) * amplitude : 0 });
}
const negate = (p: Point): Point => ({ x: -p.x, y: -p.y });
const failing = (r: TraceReport): string[] => r.walls.filter((w) => !w.pass).map((w) => w.wallId).sort();

/** The truth's wall ids with an end at x = 16.68: the two pieces of the right side and the partition. */
const rightSide = (): string[] =>
  Object.values(TRUTH.walls)
    .filter((w) => w.id !== PARTITION && [w.a, w.b].every((j) => Math.abs((TRUTH.joints[j]?.x ?? 0) - 16.68) < 1e-9))
    .map((w) => w.id)
    .sort();

describe("compareTrace (AC-15)", () => {
  const t = { x: -15.73, y: 11.25 };

  it("outerWallIds names the six outer pieces, not the partition", () => {
    const outer = outerWallIds(TRUTH);
    expect(outer).toHaveLength(6);
    expect(outer).not.toContain(PARTITION);
    expect([...outer].sort()).toEqual(Object.keys(TRUTH.walls).filter((id) => id !== PARTITION).sort());
  });

  it("a column's walls are not outer walls", () => {
    const withColumn = run(TRUTH, rectangleRoom({ x: 15.5, y: 2.0 }, 0.6, 0.6, "c"));
    expect(zones(withColumn).some((z) => z.face.holes.length === 1)).toBe(true);
    expect(outerWallIds(withColumn)).toEqual(outerWallIds(TRUTH));
  });

  it("an empty trace fails with a reason and a finite max", () => {
    const r = compareTrace(TRUTH, emptyDocument());
    expect({ pass: r.pass, reason: r.reason, max: r.max, walls: r.walls }).toEqual({ pass: false, reason: "the trace has no walls", max: 0, walls: [] });
  });

  it("a shifted copy passes when given the opposite offset", () => {
    const traced = retrace(TRUTH, { t, jitter: seededJitter(7, 0.03) });
    const r = compareTrace(TRUTH, traced, negate(t));
    expect(r.pass).toBe(true);
    expect(r.rooms.pass).toBe(true);
    expect(r.max).toBeLessThanOrEqual(0.043);
    expect(r.walls).toHaveLength(6);
    expect(r.offset).toEqual(negate(t));
    expect(r.reason).toBeNull();
  });

  it("with offset zero the same copy fails", () => {
    const traced = retrace(TRUTH, { t, jitter: seededJitter(7, 0.03) });
    expect(compareTrace(TRUTH, traced).pass).toBe(false);
  });

  it("a split the truth doesn't have changes nothing", () => {
    // Jitter along x only keeps the traced bottom wall on the truth's line, so the spur hanging below it can never be
    // nearer to a sample than the wall itself.
    const map = { t, jitter: seededJitter(11, 0.03, { x: true, y: false }) };
    const plain = compareTrace(TRUTH, retrace(TRUTH, map), negate(t));
    const bottom = Object.values(TRUTH.walls).find((w) => [w.a, w.b].every((j) => TRUTH.joints[j]?.y === -3.07));
    if (!bottom) throw new Error("no bottom wall");
    const spur = (mapped: (jointId: string) => Point): Command[] => {
      const a = mapped(bottom.a);
      const b = mapped(bottom.b);
      const x = 14.0 + t.x;
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      return [{ type: "addWall", opId: "spur", from: { at: { x, y } }, to: { at: { x, y: y - 0.5 } } }];
    };
    const traced = retrace(TRUTH, { ...map, jitter: seededJitter(11, 0.03, { x: true, y: false }) }, spur);
    expect(Object.keys(traced.walls)).toHaveLength(Object.keys(TRUTH.walls).length + 2); // the spur and a split piece
    const split = compareTrace(TRUTH, traced, negate(t));
    expect(split.walls.map((w) => w.wallId)).toEqual(plain.walls.map((w) => w.wallId));
    split.walls.forEach((w, i) => expect(Math.abs(w.deviation - (plain.walls[i]?.deviation ?? Infinity))).toBeLessThan(1e-9));
  });

  it("one side pushed out by 0.15 m fails on exactly that side", () => {
    const pushed = (_id: string, p: Point): Point => ({ x: p.x >= 16.68 - 1e-9 ? 0.15 : 0, y: 0 });
    const r = compareTrace(TRUTH, retrace(TRUTH, { t: { x: 0, y: 0 }, jitter: pushed }));
    expect(r.pass).toBe(false);
    expect(rightSide()).toHaveLength(2);
    expect(failing(r)).toEqual(rightSide());
    for (const w of r.walls.filter((x) => !x.pass)) expect(w.deviation).toBeCloseTo(0.15, 3);
    expect(r.walls.filter((w) => w.pass)).toHaveLength(4);
    expect(r.max).toBeCloseTo(0.15, 3);
    // The bar is inclusive: a deviation equal to the tolerance passes (the rooms match, so only the walls decide).
    expect(compareTrace(TRUTH, retrace(TRUTH, { t: { x: 0, y: 0 }, jitter: pushed }), { x: 0, y: 0 }, r.max).pass).toBe(true);
    expect(compareTrace(TRUTH, retrace(TRUTH, { t: { x: 0, y: 0 }, jitter: pushed }), { x: 0, y: 0 }, r.max - 1e-6).pass).toBe(false);
  });

  it("a wrong room name, a missing room or an extra room fails rooms", () => {
    const map = { t, jitter: NO_JITTER };
    const truthNames = ["bed 1", "kitchen"];

    const renamed = run(retrace(TRUTH, map), [{ type: "renameZone", id: "bed", name: "Bed 2" }]);
    expect(compareTrace(TRUTH, renamed, negate(t)).rooms).toEqual({ truth: truthNames, traced: ["bed 2", "kitchen"], pass: false });

    // One room holds one label, so the merged room keeps the kitchen's.
    const merged = retrace(TRUTH, map, undefined, [PARTITION, "bed"]);
    const one = compareTrace(TRUTH, merged, negate(t));
    expect(one.rooms).toEqual({ truth: truthNames, traced: ["kitchen"], pass: false });
    expect(one.pass).toBe(false);

    // Commands keep one label per room when they make it, but a room can hold more (three after a merge stay): the
    // names join. Built by hand, since execute won't put a second label in the merged room.
    const bed = TRUTH.zoneLabels["bed"];
    if (!bed) throw new Error("no bed label");
    const both = { ...merged, zoneLabels: { ...merged.zoneLabels, bed: { ...bed, at: { x: bed.at.x + t.x, y: bed.at.y + t.y } } } };
    expect(compareTrace(TRUTH, both, negate(t)).rooms).toEqual({ truth: truthNames, traced: ["bed 1 / kitchen"], pass: false });

    const second = (mapped: (jointId: string) => Point): Command[] => {
      const left = Object.values(TRUTH.joints).find((j) => j.x === 12.31 && j.y === -3.07);
      const right = Object.values(TRUTH.joints).find((j) => j.x === 16.68 && j.y === -3.07);
      if (!left || !right) throw new Error("no bottom corners");
      const y = mapped(left.id).y + 1.0;
      return [{ type: "addWall", opId: "extra", from: { at: { x: mapped(left.id).x, y } }, to: { at: { x: mapped(right.id).x, y } } }];
    };
    const three = compareTrace(TRUTH, retrace(TRUTH, map, second), negate(t));
    expect(three.rooms).toEqual({ truth: truthNames, traced: ["(unnamed)", "bed 1", "kitchen"], pass: false });

    const spaced = run(retrace(TRUTH, map), [{ type: "renameZone", id: "kitchen", name: "kitchen " }]);
    expect(compareTrace(TRUTH, spaced, negate(t)).rooms.pass).toBe(true);
  });

  it("seeded fuzz: the deviation is at most the joints' largest displacement (100 seeds)", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = mulberry32(seed);
      const shift = { x: (random() * 2 - 1) * 1000, y: (random() * 2 - 1) * 1000 };
      const amplitude = random() * 0.06;
      let largest = 0;
      const jitter = (): Point => {
        const d = { x: (random() * 2 - 1) * amplitude, y: (random() * 2 - 1) * amplitude };
        largest = Math.max(largest, Math.hypot(d.x, d.y));
        return d;
      };
      const r = compareTrace(TRUTH, retrace(TRUTH, { t: shift, jitter }), negate(shift));
      const report = { seed, max: r.max, largest, pass: r.pass, rooms: r.rooms.pass };
      expect(report).toEqual({ seed, max: report.max, largest, pass: r.max <= 0.1, rooms: true });
      expect(r.max, `seed ${seed}`).toBeLessThanOrEqual(largest + 1e-9);
    }
  });
});

describe("compareTraceByUnderlay (AC-15 over a dropped picture)", () => {
  // The truth's export frame: the walls' outline (0.20 m thick) plus the 0.5 m margin, so its top-left is
  // (12.31 − 0.1 − 0.5, 4.06 + 0.1 + 0.5).
  const TL = { x: 11.71, y: 4.66 };
  const at = { x: -3.42, y: 8.18 };

  /** The truth traced over its own picture dropped with its top-left at `pictureAt`, the trace drawn at `traceAt`. */
  function underlaid(traceAt: Point, k: number, jitter: Mapping["jitter"], pictureAt: Point | null = traceAt): Document {
    const place = (): Command[] =>
      pictureAt ? [{ type: "placeUnderlay", pictureId: "p1", data: "QUFB", width: 1200, height: 1500, at: pictureAt }] : [];
    return retrace(TRUTH, { t: { x: traceAt.x - TL.x, y: traceAt.y - TL.y }, jitter, scale: { k, about: TL } }, place);
  }

  it("truthTopLeft is the export frame's corner", () => {
    const tl = truthTopLeft(TRUTH);
    expect(tl.x).toBeCloseTo(11.71, 9);
    expect(tl.y).toBeCloseTo(4.66, 9);
  });

  it("a faithful trace placed wherever the underlay landed passes", () => {
    const r = compareTraceByUnderlay(TRUTH, underlaid(at, 1, seededJitter(7, 0.03)));
    expect(r.pass).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.offset.x).toBeCloseTo(TL.x - at.x, 9);
    expect(r.offset.y).toBeCloseTo(TL.y - at.y, 9);
    expect(r.rooms.pass).toBe(true);
    expect(r.max).toBeLessThanOrEqual(0.043);
    expect(r.walls).toHaveLength(6);
  });

  it("the offset comes from the underlay, never fitted", () => {
    // The picture sits 0.15 m right of where the trace assumes it: the whole trace reads 0.15 m left. Fitting would
    // absorb that; a translation from the row shows it on every outer wall (top and bottom at their right ends).
    const r = compareTraceByUnderlay(TRUTH, underlaid(at, 1, NO_JITTER, { x: at.x + 0.15, y: at.y }));
    expect(r.pass).toBe(false);
    expect(r.offset.x).toBeCloseTo(TL.x - at.x - 0.15, 9);
    expect(r.walls).toHaveLength(6);
    for (const w of r.walls) expect(w.deviation, w.wallId).toBeCloseTo(0.15, 3);
    expect(r.rooms.pass).toBe(true);
  });

  it("a 2 % scale error fails at the far corner; 0.5 % passes", () => {
    const bottom = (id: string): boolean => {
      const w = TRUTH.walls[id];
      return !!w && [w.a, w.b].every((j) => Math.abs((TRUTH.joints[j]?.y ?? 0) + 3.07) < 1e-9);
    };
    const wrong = compareTraceByUnderlay(TRUTH, underlaid(at, 1.02, NO_JITTER));
    expect(wrong.pass).toBe(false);
    const worst = [...wrong.walls].sort((a, b) => b.deviation - a.deviation)[0];
    expect(worst && bottom(worst.wallId), worst?.wallId).toBe(true);
    expect(wrong.max).toBeCloseTo(0.02 * (TL.y + 3.07), 3);
    const close = compareTraceByUnderlay(TRUTH, underlaid(at, 1.005, NO_JITTER));
    expect(close.pass).toBe(true);
  });

  it("no underlay in the traced drawing is a failure with a reason", () => {
    const r = compareTraceByUnderlay(TRUTH, underlaid(at, 1, NO_JITTER, null));
    expect({ pass: r.pass, reason: r.reason, walls: r.walls }).toEqual({ pass: false, reason: "The traced drawing has no underlay", walls: [] });
  });

  it("seeded: wherever the underlay lands, the deviation is at most the joints' displacement (100 seeds)", () => {
    // 0.03 to 0.12 m per axis, so some seeds go past the 0.10 m bar and the fail side is checked too.
    let failed = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const random = mulberry32(seed);
      const where = { x: (random() * 2 - 1) * 1000, y: (random() * 2 - 1) * 1000 };
      const amplitude = 0.03 + random() * 0.09;
      let largest = 0;
      const jitter = (): Point => {
        const d = { x: (random() * 2 - 1) * amplitude, y: (random() * 2 - 1) * amplitude };
        largest = Math.max(largest, Math.hypot(d.x, d.y));
        return d;
      };
      const r = compareTraceByUnderlay(TRUTH, underlaid(where, 1, jitter));
      expect({ seed, pass: r.pass, rooms: r.rooms.pass }).toEqual({ seed, pass: r.max <= 0.1, rooms: true });
      expect(r.max, `seed ${seed}`).toBeLessThanOrEqual(largest + 1e-9);
      if (!r.pass) failed++;
    }
    expect(failed).toBeGreaterThan(0);
  });
});
