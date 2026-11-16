import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { defaultSides, kindConfigs, kindOf, presetSize } from "../src/kinds";
import { placementRange } from "../src/queries/vertical";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// The plant, cot, radiator and towel rail (catalog.08, .23): one configuration each, with the spec table's sizes,
// heights, sides, presets and IFC classes. The radiator and towel rail stand at 0.15 m; none of their presets gives a
// height (catalog.50), so a preset keeps the row's range. Touch to turn against a wall: more-kinds-placing.test.ts.

const NO_SIDES = { front: false, back: false, left: false, right: false };
const FRONT_SIDE = { ...NO_SIDES, front: true };
const ROWS = [
  { id: "plant", label: "Plant", w: 0.4, d: 0.4, zone: null, h: 1.2, z: 0, sides: NO_SIDES, outline: "round", ifc: "IfcFurnishingElement USERDEFINED", presets: [["30", "30 × 30", 0.3, 0.3], ["40", "40 × 40", 0.4, 0.4], ["60", "60 × 60", 0.6, 0.6]] },
  { id: "cot", label: "Cot", w: 0.66, d: 1.26, zone: 0.6, h: 0.9, z: 0, sides: FRONT_SIDE, outline: "rect", ifc: "IfcFurniture BED", presets: [] },
  { id: "radiator", label: "Radiator", w: 0.8, d: 0.1, zone: null, h: 0.6, z: 0.15, sides: NO_SIDES, outline: "rect", ifc: "IfcSpaceHeater RADIATOR", presets: [["40", "40 × 10", 0.4, 0.1], ["60", "60 × 10", 0.6, 0.1], ["80", "80 × 10", 0.8, 0.1], ["100", "100 × 10", 1, 0.1], ["120", "120 × 10", 1.2, 0.1]] },
  { id: "towelRail", label: "Towel rail", w: 0.5, d: 0.1, zone: null, h: 1.2, z: 0.15, sides: NO_SIDES, outline: "rect", ifc: "IfcSpaceHeater RADIATOR", presets: [["Small", "Small 50 × 10 h 80 at 15", 0.5, 0.1], ["Medium", "Medium 50 × 10 h 120 at 15", 0.5, 0.1], ["Tall", "Tall 60 × 10 h 150 at 15", 0.6, 0.1]] },
] as const;

/** A room's one placement of `kind`, its back on the top wall (inner face y 3.9), with a preset when given. */
function placed(kind: string, preset?: string) {
  const object = preset === undefined ? { kind } : { kind, preset };
  const doc = unwrap(execute(rectDoc(0, 0, 4, 4), { type: "placeObject", deck: null, opId: "a", state: "s0", object, at: { x: 2, y: 3.9 } })).doc;
  const id = Object.keys(doc.placements)[0];
  if (id === undefined) throw new Error("nothing placed");
  return { doc, id };
}

describe("the plant, cot, radiator and towel rail rows (catalog.08, .23)", () => {
  for (const r of ROWS) {
    it(`${r.id}: ${r.w} × ${r.d}, ${r.h} tall at ${r.z}, zone ${r.zone}, ${r.outline}, ${r.ifc}`, () => {
      expect(kindConfigs(r.id)).toEqual([{ id: "standard", label: "Standard", w: r.w, d: r.d, zone: r.zone, h: r.h, z: r.z }]);
      expect(kindOf(r.id)).toMatchObject({ label: r.label, outline: r.outline, semanticClass: r.ifc, sitAt: false, seat: null, retired: false, stair: null, arms: null, family: null });
      expect(defaultSides(r.id)).toEqual(r.sides);
    });

    it(`${r.id}: its presets set the width and depth`, () => {
      expect(kindOf(r.id)?.presets.map((p) => [p.id, p.label, p.w, p.d.standard])).toEqual(r.presets.map((p) => [...p]));
    });

    it(`${r.id}: its default range is ${r.z}–${r.z + r.h}, in a valid drawing`, () => {
      const { doc, id } = placed(r.id);
      expect(validateDocument(doc).ok).toBe(true);
      const range = placementRange(doc, id);
      expect(range?.bottom).toBeCloseTo(r.z, 9);
      expect(range?.top).toBeCloseTo(r.z + r.h, 9);
    });
  }

  it("the radiator stands 0.15–0.75 and the towel rail 0.15–1.35", () => {
    const range = (kind: string) => {
      const { doc, id } = placed(kind);
      const r = placementRange(doc, id);
      return [r?.bottom, Number(r?.top.toFixed(9))];
    };
    expect(range("radiator")).toEqual([0.15, 0.75]);
    expect(range("towelRail")).toEqual([0.15, 1.35]);
  });

  it("a radiator's preset gives no height, so it keeps the row's 0.60 at 0.15 (catalog.50)", () => {
    for (const id of ["40", "60", "80", "100", "120"]) {
      expect(presetSize("radiator", id)?.h.standard, id).toBe(0.6);
      expect(presetSize("radiator", id)?.z.standard, id).toBe(0.15);
      expect(kindOf("radiator")?.presets.find((p) => p.id === id)?.h, id).toBeUndefined();
    }
    const { doc, id } = placed("radiator", "120");
    expect(Object.values(doc.objects)[0]).toMatchObject({ w: { standard: 1.2 }, d: { standard: 0.1 }, h: { standard: 0.6 }, z: { standard: 0.15 } });
    expect(placementRange(doc, id)?.bottom).toBe(0.15);
  });

  it("a plant's presets are round: width and depth equal", () => {
    for (const p of kindOf("plant")?.presets ?? []) expect(p.d.standard, p.id).toBe(p.w);
  });

  it("a radiator fits under a window: openings aren't solids", () => {
    const room = rectDoc(0, 0, 4, 4);
    const wall = Object.values(room.walls).find((w) => room.joints[w.a]?.y === 4 && room.joints[w.b]?.y === 4)?.id ?? "";
    const glazed = unwrap(execute(room, { type: "addOpening", opId: "win", wall, kind: "window", offset: 1.5, width: 1 })).doc;
    const doc = unwrap(execute(glazed, { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "radiator" }, at: { x: 2, y: 3.9 } })).doc;
    expect(validateDocument(doc).ok).toBe(true);
  });
});
