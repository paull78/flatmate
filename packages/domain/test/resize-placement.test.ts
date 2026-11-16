import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { resizedAnchor } from "../src/commands/resize-placement";
import type { Command, ResizeSide } from "../src/commands/types";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { footprints } from "../src/queries/footprints";
import { deepFreeze, place, rectDoc, SOFA_BED_200 } from "./helpers";

// resizePlacement (AC-02, AC-03): one side grip's resize; the opposite side stays put in this layout, other layouts
// keep their back-edge middle (layout-states.49).

// A 6 × 5 room (inner faces at 0.1 and 5.9 / 4.9) with a Night state.
const room = (): Document => {
  const doc = rectDoc(0, 0, 6, 5);
  return { ...doc, states: { ...doc.states, night: { id: "night", name: "Night", order: 1 } } };
};
// Sofa beds 2.00 × 0.90: sofa/s0 with its back on the top wall (y 4.0–4.9), sofa/night in the middle (y 1.6–2.5).
const sofas = (night: { at?: [number, number]; config?: string } = {}): Document =>
  place(place(room(), { object: "sofa", kind: "sofaBed", at: [3, 4.9], size: SOFA_BED_200 }), { object: "sofa", kind: "sofaBed", at: night.at ?? [3, 2.5], state: "night", config: night.config, size: SOFA_BED_200 });
const sofa = (x: number, y: number, rotation = 0): Document => place(room(), { object: "sofa", kind: "sofaBed", at: [x, y], rotation, size: SOFA_BED_200 });
const cmd = (placementId: string, side: ResizeSide, size: number): Command => ({ type: "resizePlacement", placementId, side, size });
const r9 = (v: number): number => +v.toFixed(9);
const quad = (doc: Document, id: string): Point[] => (footprints(doc).get(id) ?? []).map((p) => ({ x: r9(p.x), y: r9(p.y) }));
const xs = (doc: Document, id: string): number[] => quad(doc, id).map((p) => p.x);
const ys = (doc: Document, id: string): number[] => quad(doc, id).map((p) => p.y);
const deps = [
  { table: "objects", id: "sofa" }, { table: "placements", id: "sofa/night" },
  { table: "placements", id: "sofa/s0" }, { table: "states", id: "s0" },
];

describe("resizePlacement", () => {
  it("right grip at rotation 0: 2.00 → 2.30 keeps the left side; Night keeps its back-edge middle (AC-02)", () => {
    const doc = deepFreeze(sofas());
    const r = unwrap(execute(doc, cmd("sofa/s0", "right", 2.3)));
    expect(r.doc.objects.sofa).toMatchObject({ w: { sofa: 2.3, bed: 2.3 }, d: { sofa: 0.9, bed: 1.6 } });
    expect(r.doc.placements["sofa/s0"]?.at).toEqual({ x: 3.15, y: 4.9 });
    expect(xs(r.doc, "sofa/s0")).toEqual([2, 4.3, 4.3, 2]);
    expect(ys(r.doc, "sofa/s0")).toEqual([4, 4, 4.9, 4.9]);
    expect(r.doc.placements["sofa/night"]).toEqual(doc.placements["sofa/night"]);
    expect(r.doc.placements["sofa/night"]?.at).toEqual({ x: 3, y: 2.5 });
    expect(xs(r.doc, "sofa/night")).toEqual([1.85, 4.15, 4.15, 1.85]);
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["objects/sofa", "placements/sofa/s0"]);
    expect(r.patch.dependencies).toEqual(deps);
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
  });

  it("right grip at rotation 90 grows along world +y; the local −x side stays at y 1.5", () => {
    const doc = sofa(0.1, 2.5, 90);
    expect(quad(doc, "sofa/s0")).toEqual([{ x: 1, y: 1.5 }, { x: 1, y: 3.5 }, { x: 0.1, y: 3.5 }, { x: 0.1, y: 1.5 }]);
    const r = unwrap(execute(doc, cmd("sofa/s0", "right", 2.3)));
    expect(r.doc.placements["sofa/s0"]?.at).toEqual({ x: 0.1, y: 2.65 });
    expect(quad(r.doc, "sofa/s0")).toEqual([{ x: 1, y: 1.5 }, { x: 1, y: 3.8 }, { x: 0.1, y: 3.8 }, { x: 0.1, y: 1.5 }]);
  });

  it("left, front, back and a shrink at rotation 0", () => {
    const doc = sofa(3, 3.0); // x 2–4, y 2.1–3.0
    const at = (r: { doc: Document }) => r.doc.placements["sofa/s0"]?.at;
    const left = unwrap(execute(doc, cmd("sofa/s0", "left", 2.3)));
    expect(at(left)).toEqual({ x: 2.85, y: 3 });
    expect(xs(left.doc, "sofa/s0")).toEqual([1.7, 4, 4, 1.7]);
    const front = unwrap(execute(doc, cmd("sofa/s0", "front", 1.2)));
    expect(at(front)).toEqual({ x: 3, y: 3 });
    expect(ys(front.doc, "sofa/s0")).toEqual([1.8, 1.8, 3, 3]);
    const back = unwrap(execute(doc, cmd("sofa/s0", "back", 1.2)));
    expect(at(back)).toEqual({ x: 3, y: 3.3 });
    expect(ys(back.doc, "sofa/s0")).toEqual([2.1, 2.1, 3.3, 3.3]);
    const shrink = unwrap(execute(doc, cmd("sofa/s0", "right", 1.5)));
    expect(at(shrink)).toEqual({ x: 2.75, y: 3 });
    expect(xs(shrink.doc, "sofa/s0")).toEqual([2, 3.5, 3.5, 2]);
  });

  it("a piece turned 45° keeps its opposite side within 1 mm and stores its anchor to the millimetre", () => {
    const doc = sofa(3, 2.5, 45);
    const r = unwrap(execute(doc, cmd("sofa/s0", "right", 2.3)));
    expect(r.doc.placements["sofa/s0"]?.at).toEqual({ x: 3.106, y: 2.606 });
    const leftSide = (d: Document): Point => {
      const q = footprints(d).get("sofa/s0") ?? [];
      const a = q[3] ?? { x: NaN, y: NaN };
      const b = q[0] ?? { x: NaN, y: NaN };
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const before = leftSide(doc);
    const after = leftSide(r.doc);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.001);
  });

  it("a width grip writes every configuration's width; Night shown as a bed widens about its back-edge middle", () => {
    const doc = sofas({ config: "bed" });
    expect(ys(doc, "sofa/night")).toEqual([0.9, 0.9, 2.5, 2.5]);
    const r = unwrap(execute(doc, cmd("sofa/s0", "right", 2.3)));
    expect(r.doc.objects.sofa).toMatchObject({ w: { sofa: 2.3, bed: 2.3 }, d: { sofa: 0.9, bed: 1.6 } });
    expect(r.doc.placements["sofa/night"]?.at).toEqual({ x: 3, y: 2.5 });
    expect(xs(r.doc, "sofa/night")).toEqual([1.85, 4.15, 4.15, 1.85]);
    expect(ys(r.doc, "sofa/night")).toEqual([0.9, 0.9, 2.5, 2.5]);
  });

  it("a width grip that makes the other configuration hit a wall in Night is refused", () => {
    const doc = sofas({ at: [4.8, 2.5], config: "bed" }); // Night bed: x 3.8–5.8; at 2.30 it would reach 5.95
    expect(execute(doc, cmd("sofa/s0", "right", 2.3))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Sofa bed (0.00–0.90) overlaps a wall in Night" } });
  });

  it("a depth grip changes only the shown configuration's depth", () => {
    const r = unwrap(execute(sofa(3, 3.0), cmd("sofa/s0", "front", 1.2)));
    expect(r.doc.objects.sofa).toMatchObject({ w: { sofa: 2, bed: 2 }, d: { sofa: 1.2, bed: 1.6 } });
    // A depth grip leaves stored widths alone, even when they differ.
    const split = place(room(), { object: "sofa", kind: "sofaBed", at: [3, 3], size: { w: { sofa: 2, bed: 1.8 }, d: { sofa: 0.9, bed: 1.6 } } });
    const s = unwrap(execute(split, cmd("sofa/s0", "front", 1.2)));
    expect(s.doc.objects.sofa).toMatchObject({ w: { sofa: 2, bed: 1.8 }, d: { sofa: 1.2, bed: 1.6 } });
  });

  it("an unchanged shown size is a no-op even when stored widths differ", () => {
    // The drag's zero move sends the current size (editor tools/drag.ts) and must stay a no-op.
    const doc = place(room(), { object: "sofa", kind: "sofaBed", at: [3, 3], size: { w: { sofa: 2, bed: 1.8 }, d: { sofa: 0.9, bed: 1.6 } } });
    expect(unwrap(execute(doc, cmd("sofa/s0", "right", 2))).doc).toBe(doc);
  });

  it("a Murphy bed's width grip in its closed state widens the open state in Night (AC-03)", () => {
    const doc = place(place(room(), { object: "m", kind: "murphyBed", at: [3, 4.9] }), { object: "m", kind: "murphyBed", at: [3, 4.9], state: "night", config: "down" });
    const r = unwrap(execute(doc, cmd("m/s0", "right", 2.4)));
    expect(r.doc.objects.m?.w).toEqual({ folded: 2.4, down: 2.4 });
    expect(r.doc.placements["m/s0"]?.at).toEqual({ x: 3.4, y: 4.9 });
    expect(r.doc.placements["m/night"]?.at).toEqual({ x: 3, y: 4.9 });
    expect(xs(r.doc, "m/night")).toEqual([1.8, 4.2, 4.2, 1.8]);
  });

  it("refused when another layout breaks fit, naming it (AC-03)", () => {
    const doc = deepFreeze(sofas({ at: [4.8, 2.5] })); // Night: x 3.8–5.8
    const r = execute(doc, cmd("sofa/s0", "right", 2.3));
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid", message: "Sofa bed (0.00–0.90) overlaps a wall in Night" } });
    const violations = r.ok ? [] : r.error.violations;
    expect(violations.some((v) => v.invariant === "I10" && v.entities[0]?.table === "placements" && v.entities[0].id === "sofa/night")).toBe(true);
  });

  it("refused when this layout breaks fit", () => {
    expect(execute(sofas(), cmd("sofa/s0", "back", 1.0))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Sofa bed (0.00–0.90) overlaps a wall in Layout" } });
    const withChair = place(sofas(), { object: "chair", kind: "chair", at: [4.6, 4.9] }); // x 4.375–4.825
    // Names in placement-ID order: chair/s0 sorts before sofa/s0.
    expect(execute(withChair, cmd("sofa/s0", "right", 2.5))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Chair (0.00–0.90) and Sofa bed (0.00–0.90) overlap in Layout" } });
  });

  it("refuses a size outside 0.02–10 m and a missing placement", () => {
    for (const size of [0.01, 10.5, Number.NaN]) {
      expect(execute(sofas(), cmd("sofa/s0", "right", size))).toMatchObject({
        ok: false, error: { kind: "invalidInput", message: "Size must be between 0.02 and 10 m" },
      });
    }
    expect(execute(sofas(), cmd("nope", "right", 2))).toMatchObject({ ok: false, error: { kind: "notFound", message: "Placement not found" } });
  });

  it("the current size is a no-op that keeps its dependencies", () => {
    const doc = sofas();
    for (const c of [cmd("sofa/s0", "right", 2), cmd("sofa/s0", "front", 0.9)]) {
      const r = unwrap(execute(doc, c));
      expect(r.doc).toBe(doc);
      expect(r.patch.puts).toEqual([]);
      expect(r.patch.deletes).toEqual([]);
      expect(r.patch.dependencies).toEqual(deps);
    }
  });

  it("resizedAnchor is the anchor the command stores, for every side and a slanted piece", () => {
    const doc = sofa(3, 3, 45);
    const p = doc.placements["sofa/s0"];
    if (!p) throw new Error("no sofa");
    for (const [side, size] of [["right", 2.3], ["left", 1.7], ["front", 1.2], ["back", 0.6]] as const) {
      const r = unwrap(execute(doc, cmd("sofa/s0", side, size)));
      expect(resizedAnchor(p, side, 2, 0.9, size)).toEqual(r.doc.placements["sofa/s0"]?.at);
    }
  });
});
