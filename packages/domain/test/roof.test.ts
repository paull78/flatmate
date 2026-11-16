import type { Point } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { CEILING_ID, type Ceiling, type Document } from "../src/model";
import {
  ceilingAlongSegment, ceilingAtPoint, ceilingOverSpan, highSide, highestCeilingAlong, highestCeilingOver, roofBox, roofOf, solveRoof, type Falls,
} from "../src/roof";
import { ceilingOver } from "../src/queries/vertical";
import { validateDocument } from "../src/validate";
import { rectDoc, rng } from "./helpers";

// The roof module (roofs.03, .06, .15, .17): one formula behind every ceiling query, from the walls' outer box.

/** A 6.00 × 2.55 m outer box: 0.20 m walls on centrelines 0.1 in from the box. */
const house = (): Document => rectDoc(0.1, 0.1, 5.9, 2.45);
const roofed = (doc: Document, c: Omit<Ceiling, "id">): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const shed = (falls: Falls = "-y", height = 2.75, pitch = 10): Document => roofed(house(), { height, shape: "shed", pitch, falls, overhang: 0.3 });
const gable = (falls: Falls = "-y", height = 2.3, pitch = 35): Document => roofed(house(), { height, shape: "gable", pitch, falls, overhang: 0.3 });
const at = (x: number, y: number): Point => ({ x, y });

describe("the walls' box", () => {
  it("is the outer box of the floor's walls", () => {
    expect(roofBox(house())).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 2.55 });
  });

  it("ignores columns and walls on a deck", () => {
    const doc = house();
    const withColumn: Document = {
      ...doc,
      joints: { ...doc.joints, C1: { id: "C1", x: 8, y: 1 }, C2: { id: "C2", x: 8.3, y: 1 } },
      walls: { ...doc.walls, C: { id: "C", a: "C1", b: "C2", thickness: 0.3, top: "ceiling", base: "floor", column: true } },
    };
    expect(roofBox(withColumn)).toEqual(roofBox(doc));
  });

  it("is null with no floor walls", () => {
    const doc = house();
    expect(roofBox({ ...doc, walls: {} })).toBeNull();
  });
});

describe("a shed", () => {
  it("rises from 2.75 at the low outer face to 3.20 at the high one (AC-01)", () => {
    const doc = shed("-y");
    expect(ceilingAtPoint(doc, at(3, 0))).toBe(2.75);
    expect(ceilingAtPoint(doc, at(3, 2.55))).toBe(3.2);
    expect(ceilingAtPoint(doc, at(1, 1.275))).toBeCloseTo(2.975, 3);
    expect(highSide(doc)).toBe(3.2);
  });

  it.each<[Falls, Point, Point]>([
    ["+y", at(3, 2.55), at(3, 0)],
    ["-x", at(0, 1), at(6, 1)],
    ["+x", at(6, 1), at(0, 1)],
  ])("falling %s is the same turned", (falls, low, high) => {
    const doc = shed(falls);
    expect(ceilingAtPoint(doc, low)).toBe(2.75);
    expect(ceilingAtPoint(doc, high)).toBeCloseTo(falls.endsWith("x") ? 2.75 + 6 * Math.tan((10 * Math.PI) / 180) : 3.2, 3);
  });
});

describe("a gable", () => {
  it("has 2.30 at both eaves and 3.19 on the ridge (AC-01)", () => {
    const doc = gable("-y");
    expect(ceilingAtPoint(doc, at(2, 0))).toBe(2.3);
    expect(ceilingAtPoint(doc, at(2, 2.55))).toBe(2.3);
    expect(ceilingAtPoint(doc, at(2, 1.275))).toBe(3.193);
    expect(highSide(doc)).toBe(3.193);
  });

  it("falling +y is the same gable: only the axis counts", () => {
    for (const p of [at(1, 0.4), at(4, 2.1), at(5.5, 1.275)]) expect(ceilingAtPoint(gable("+y"), p)).toBe(ceilingAtPoint(gable("-y"), p));
  });
});

describe("flat and the defaults", () => {
  it("a missing shape is today's flat ceiling", () => {
    const doc = roofed(house(), { height: 2.4 });
    expect(ceilingAtPoint(doc, at(1, 1))).toBe(2.4);
    expect(highSide(doc)).toBe(2.4);
    expect(roofOf(doc)).toEqual({ shape: "flat", height: 2.4, pitch: 10, falls: "-y", overhang: 0.3 });
  });

  it("a slope with no floor walls reads its low side everywhere", () => {
    const doc = shed();
    const bare = { ...doc, walls: {} };
    expect(ceilingAtPoint(bare, at(3, 2))).toBe(2.75);
    expect(highSide(bare)).toBe(2.75);
  });

  it("every height is a whole number of millimetres", () => {
    const next = rng(11);
    for (const doc of [shed("-y", 2.731, 13.7), gable("-x", 2.317, 27.3)]) {
      for (let i = 0; i < 200; i += 1) {
        const v = ceilingAtPoint(doc, at(next() * 6, next() * 2.55)) * 1000;
        expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
      }
    }
  });
});

describe("the edit rule (roofs.03, AC-02)", () => {
  const box = { minX: 0, minY: 0, maxX: 6, maxY: 2.55 };
  const roof = roofOf(shed());

  it("a pitch keeps the low side and moves the high side", () => {
    const r = solveRoof(roof, box, { pitch: 12 });
    expect(r).toEqual({ height: 2.75, pitch: 12 });
    expect(highSide(roofed(house(), { ...roof, ...r }))).toBe(3.292);
  });

  it("a high side keeps the low side and solves the pitch", () => {
    const r = solveRoof(roof, box, { highSide: 3.4 });
    expect(r?.height).toBe(2.75);
    expect(r?.pitch).toBeCloseTo(14.3, 1);
    expect(highSide(roofed(house(), { ...roof, ...r }))).toBe(3.4);
  });

  it("a low side keeps the pitch and moves the high side by as much", () => {
    const r = solveRoof(roof, box, { height: 2.85 });
    expect(r).toEqual({ height: 2.85, pitch: 10 });
    expect(highSide(roofed(house(), { ...roof, ...r }))).toBe(3.3);
  });

  it("a gable's high side is its ridge, over half the span", () => {
    const r = solveRoof(roofOf(gable()), box, { highSide: 3.3 });
    expect(highSide(roofed(house(), { ...roofOf(gable()), ...r }))).toBe(3.3);
  });

  it("a high side can't be solved with no box or on a flat ceiling", () => {
    expect(solveRoof(roof, null, { highSide: 3.4 })).toBeNull();
    expect(solveRoof(roofOf(roofed(house(), { height: 2.5 })), box, { highSide: 3.4 })).toBeNull();
  });

  it("round-trips over random boxes, heights and pitches", () => {
    const next = rng(5);
    for (let i = 0; i < 300; i += 1) {
      const b = { minX: 0, minY: 0, maxX: 1 + next() * 9, maxY: 1 + next() * 9 };
      const falls: Falls = (["-y", "+y", "-x", "+x"] as const)[Math.floor(next() * 4)] ?? "-y";
      const r0 = { shape: next() < 0.5 ? "shed" as const : "gable" as const, height: 1 + next() * 3, pitch: 1 + next() * 50, falls, overhang: 0.3 };
      const high = 0.01 + r0.height + next() * 4;
      const r1 = solveRoof(r0, b, { highSide: high });
      expect(r1).not.toBeNull();
      const run = (falls.endsWith("y") ? b.maxY - b.minY : b.maxX - b.minX) / (r0.shape === "gable" ? 2 : 1);
      expect(r0.height + run * Math.tan(((r1?.pitch ?? 0) * Math.PI) / 180)).toBeCloseTo(high, 6);
    }
  });
});

describe("lowest and highest", () => {
  const docs = (): Document[] => [roofed(house(), { height: 2.5 }), shed("-y"), shed("+x", 2.4, 20), gable("-y"), gable("-x", 2.2, 30)];
  const sampleRange = (doc: Document, ring: readonly Point[]): { min: number; max: number } => {
    let min = Infinity;
    let max = -Infinity;
    const [a, b, c] = ring;
    if (!a || !b || !c) throw new Error("ring");
    // a parallelogram ring a, b, c, a + c − b: sample its interior and boundary densely
    for (let i = 0; i <= 60; i += 1) {
      for (let j = 0; j <= 60; j += 1) {
        const u = i / 60;
        const v = j / 60;
        const p = { x: b.x + u * (a.x - b.x) + v * (c.x - b.x), y: b.y + u * (a.y - b.y) + v * (c.y - b.y) };
        const h = ceilingAtPoint(doc, p);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    return { min, max };
  };

  it("the lowest over a footprint is a corner, and the highest includes the ridge (properties)", () => {
    const next = rng(23);
    for (let i = 0; i < 120; i += 1) {
      const cx = 0.5 + next() * 5;
      const cy = 0.4 + next() * 1.8;
      const w = 0.2 + next() * 1.5;
      const d = 0.2 + next() * 1.2;
      const t = next() * Math.PI;
      const ux = { x: Math.cos(t) * w / 2, y: Math.sin(t) * w / 2 };
      const uy = { x: -Math.sin(t) * d / 2, y: Math.cos(t) * d / 2 };
      const ring = [
        { x: cx - ux.x - uy.x, y: cy - ux.y - uy.y }, { x: cx + ux.x - uy.x, y: cy + ux.y - uy.y },
        { x: cx + ux.x + uy.x, y: cy + ux.y + uy.y }, { x: cx - ux.x + uy.x, y: cy - ux.y + uy.y },
      ];
      for (const doc of docs()) {
        const s = sampleRange(doc, ring);
        expect(ceilingOver(doc, ring)).toBeCloseTo(s.min, 3);
        expect(highestCeilingOver(doc, ring)).toBeGreaterThanOrEqual(s.max - 0.0015);
        expect(highestCeilingOver(doc, ring)).toBeLessThanOrEqual(s.max + 0.0015 + 0.002);
      }
    }
  });

  it("along a segment: the lowest at an end, the highest at an end or the ridge", () => {
    const doc = gable("-y");
    expect(ceilingAlongSegment(doc, at(1, 0), at(1, 2.55))).toBe(2.3);
    expect(highestCeilingAlong(doc, at(1, 0), at(1, 2.55))).toBe(3.193);
    expect(highestCeilingAlong(doc, at(0, 0), at(6, 0))).toBe(2.3);
    expect(ceilingOverSpan(shed(), at(1, 2.55), at(2, 2.55))).toBe(3.2);
  });

  it("widening the box never lowers the ceiling under the old box (property, pitch kept)", () => {
    const next = rng(31);
    for (const make of [shed, gable]) {
      for (const falls of ["-y", "+y", "-x", "+x"] as const) {
        const before = make(falls);
        const after = { ...before, joints: { ...before.joints, J3: { id: "J3", x: 6.4, y: 2.95 }, J2: { id: "J2", x: 6.4, y: 0.1 }, J4: { id: "J4", x: 0.1, y: 2.95 } } };
        for (let i = 0; i < 50; i += 1) {
          const p = at(next() * 6, next() * 2.55);
          expect(ceilingAtPoint(after, p)).toBeGreaterThanOrEqual(ceilingAtPoint(before, p) - 0.001);
        }
      }
    }
  });
});

describe("I17's roof limits (roofs.07)", () => {
  const messages = (doc: Document): string[] => {
    const r = validateDocument(doc);
    return r.ok ? [] : r.error.filter((v) => v.invariant === "I17").map((v) => v.message);
  };

  it("accepts the presets' values", () => {
    expect(messages(shed())).toEqual([]);
    expect(messages(gable())).toEqual([]);
  });

  it.each<[string, Partial<Ceiling>, string]>([
    ["a pitch under 1°", { pitch: 0.5 }, "The pitch must be between 1° and 60°"],
    ["a pitch over 60°", { pitch: 61 }, "The pitch must be between 1° and 60°"],
    ["an overhang over 1.00 m", { overhang: 1.2 }, "The overhang must be between 0.00 and 1.00 m"],
    ["a negative overhang", { overhang: -0.1 }, "The overhang must be between 0.00 and 1.00 m"],
    ["a high side over 10 m", { height: 9.9, pitch: 45 }, "The roof's high side is 12.45 m; it must be at most 10 m"],
  ])("refuses %s, with the values", (_name, change, message) => {
    expect(messages(roofed(house(), { ...roofOf(shed()), ...change }))).toContain(message);
  });

  it("a flat ceiling's stored pitch is never checked", () => {
    expect(messages(roofed(house(), { height: 2.5, shape: "flat", pitch: 0 }))).toEqual([]);
  });
});
