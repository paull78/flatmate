import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { convexOverlap, rotateAbout } from "../src/geometry";
import { anchorAt, anchorAtMm, footprintOf, footprintQuad, footprints, useZones } from "../src/queries/footprints";
import { BED_160x200, place, rectDoc } from "./helpers";

const round = (pts: readonly Point[] | undefined) => (pts ?? []).map((p) => ({ x: +p.x.toFixed(9) + 0, y: +p.y.toFixed(9) + 0 }));

describe("footprints and use zones (spec: layouts)", () => {
  it("a bed anchored at (2, 3), the middle of its back edge: corners (1.2, 1) (2.8, 1) (2.8, 3) (1.2, 3); its use zones are the bands x ∈ [0.6, 1.2] and [2.8, 3.4], y ∈ [1, 2.55]", () => {
    const doc = place(rectDoc(0, 0, 6, 6), { object: "bed", kind: "bed", at: [2, 3], size: BED_160x200 });
    expect(round(footprints(doc).get("bed/s0"))).toEqual([{ x: 1.2, y: 1 }, { x: 2.8, y: 1 }, { x: 2.8, y: 3 }, { x: 1.2, y: 3 }]);
    expect(useZones(doc).get("bed/s0")?.map((z) => ({ side: z.side, quad: round(z.quad) }))).toEqual([
      { side: "left", quad: [{ x: 0.6, y: 1 }, { x: 1.2, y: 1 }, { x: 1.2, y: 2.55 }, { x: 0.6, y: 2.55 }] },
      { side: "right", quad: [{ x: 2.8, y: 1 }, { x: 3.4, y: 1 }, { x: 3.4, y: 2.55 }, { x: 2.8, y: 2.55 }] },
    ]);
  });

  it("rotations 90, 180 and 270 turn the axis-aligned footprint counter-clockwise about its centre", () => {
    const at: Point = { x: 3, y: 3 };
    const base = round(footprints(place(rectDoc(0, 0, 6, 6), { object: "b", kind: "bed", at: [3, 3] })).get("b/s0"));
    for (const rotation of [90, 180, 270]) {
      const doc = place(rectDoc(0, 0, 6, 6), { object: "b", kind: "bed", at: [3, 3], rotation });
      const turned = (footprints(doc).get("b/s0") ?? []).map((p) => ({ x: p.x, y: p.y }));
      expect(round(turned)).toEqual(base.map((p) => round([rotateAbout(p, at, rotation)])[0]));
    }
  });

  it("rotation 30 matches rotateAbout, and the use zone turns with the footprint", () => {
    const doc = place(rectDoc(0, 0, 6, 6), { object: "d", kind: "desk", at: [3, 3], rotation: 30 });
    const flat = place(rectDoc(0, 0, 6, 6), { object: "d", kind: "desk", at: [3, 3] });
    const turn = (pts: readonly Point[] | undefined) => round((pts ?? []).map((p) => rotateAbout(p, { x: 3, y: 3 }, 30)));
    expect(round(footprints(doc).get("d/s0"))).toEqual(turn(footprints(flat).get("d/s0")));
    const front = (d: typeof doc) => useZones(d).get("d/s0")?.find((z) => z.side === "front")?.quad;
    expect(useZones(doc).get("d/s0")?.map((z) => z.side)).toEqual(["front"]);
    expect(round(front(doc))).toEqual(turn(front(flat)));
  });

  it("an object without a use zone (folded murphy bed, chair) has none", () => {
    const doc = place(place(rectDoc(0, 0, 6, 6), { object: "m", kind: "murphyBed", at: [3, 1] }), { object: "c", kind: "chair", at: [1, 4] });
    expect(footprints(doc).has("c/s0")).toBe(true);
    expect(useZones(doc).has("m/s0")).toBe(false);
    expect(useZones(doc).has("c/s0")).toBe(false);
  });

  it("is cached by document identity", () => {
    const doc = place(rectDoc(0, 0, 6, 6), { object: "b", kind: "bed", at: [2, 2] });
    expect(footprints(doc)).toBe(footprints(doc));
  });
});

describe("convexOverlap", () => {
  const sq = (x: number, y: number, s = 1): Point[] => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  it("separated, touching along an edge, a corner inside, and crossing edges without a corner inside (a plus)", () => {
    expect(convexOverlap(sq(0, 0), sq(2, 0))).toBe(false);
    expect(convexOverlap(sq(0, 0), sq(1, 0))).toBe(false); // touching edges are allowed
    expect(convexOverlap(sq(0, 0), sq(1.0005, 0))).toBe(false);
    expect(convexOverlap(sq(0, 0), sq(0.5, 0.5))).toBe(true);
    const bar = (w: number, h: number): Point[] => [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }];
    expect(convexOverlap(bar(2, 0.2), bar(0.2, 2))).toBe(true);
  });

  it("is symmetric on random quads", () => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 4;
    for (let i = 0; i < 300; i++) {
      const a = sq(r(), r(), 0.2 + r() / 2).map((p) => rotateAbout(p, { x: 2, y: 2 }, Math.floor(r() * 90)));
      const b = sq(r(), r(), 0.2 + r() / 2).map((p) => rotateAbout(p, { x: 2, y: 2 }, Math.floor(r() * 90)));
      expect(convexOverlap(a, b)).toBe(convexOverlap(b, a));
    }
  });
});

describe("one footprint rule and one anchor rule (arch-review R-02)", () => {
  it.each([0, 30, 90, 137, 270])("footprintQuad matches footprintOf for a stored placement at %i°", (rotation) => {
    const doc = place(rectDoc(0, 0, 6, 6), { object: "bed", kind: "bed", at: [2.3, 3.1], rotation, size: BED_160x200 });
    const p = doc.placements["bed/s0"];
    if (!p) throw new Error("no placement");
    expect(footprintQuad(p.at, 1.6, 2, rotation)).toEqual(footprintOf(doc, p));
  });

  it("anchorAtMm is anchorAt rounded to the millimetre", () => {
    const exact = anchorAt({ x: 1.2345, y: 2.3456 }, 0.6, 30);
    const mm = anchorAtMm({ x: 1.2345, y: 2.3456 }, 0.6, 30);
    expect(mm).toEqual({ x: Math.round(exact.x * 1000) / 1000, y: Math.round(exact.y * 1000) / 1000 });
    expect(String(mm.x).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(String(mm.y).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });
});
