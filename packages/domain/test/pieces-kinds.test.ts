import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { OBJECT_KINDS, defaultSides, kindConfigs, kindOf } from "../src/kinds";
import type { OrCeiling } from "../src/kind-rows";
import { placementRange } from "../src/queries/vertical";
import { rectDoc } from "./helpers";

// The pieces for small homes (spec pieces, AC-01): each row holds the spec's table, sizes, heights, elevations, front
// zone and presets. Steps 03 to 05 add their kinds to ROWS.

const NONE = { front: false, back: false, left: false, right: false };
const FRONT = { ...NONE, front: true };
type PresetRow = readonly [id: string, w: number, d: number, h?: number, z?: OrCeiling];
type Row = { id: string; label: string; w: number; d: number; h: number; z: OrCeiling; zone: number | null; sides: typeof NONE; ifc: string; outline?: string; presets: readonly PresetRow[] };

export const ROWS: readonly Row[] = [
  { id: "range", label: "Range", w: 0.6, d: 0.6, h: 0.9, z: 0, zone: 1, sides: FRONT, ifc: "IfcElectricAppliance ELECTRICCOOKER", presets: [["50", 0.5, 0.6], ["60", 0.6, 0.6], ["76", 0.76, 0.6]] },
  { id: "cookerHood", label: "Cooker hood", w: 0.6, d: 0.5, h: 0.9, z: "ceiling", zone: null, sides: NONE, ifc: "IfcElectricAppliance USERDEFINED", presets: [["Chimney", 0.6, 0.5, 0.9, "ceiling"], ["Wide chimney", 0.9, 0.5, 0.9, "ceiling"], ["Slim", 0.6, 0.48, 0.15, 1.25]] },
  { id: "tallPantry", label: "Tall pantry", w: 0.8, d: 0.6, h: 2.1, z: 0, zone: 0.6, sides: FRONT, ifc: "IfcFurniture USERDEFINED", presets: [["60", 0.6, 0.6, 2.1], ["80", 0.8, 0.6, 2.1], ["100", 1, 0.6, 2.1], ["Tall", 0.8, 0.6, 2.4]] },
  { id: "stool", label: "Stool", w: 0.4, d: 0.4, h: 0.75, z: 0, zone: null, sides: NONE, ifc: "IfcFurniture CHAIR", outline: "round", presets: [["Counter", 0.4, 0.4, 0.65], ["Bar", 0.4, 0.4, 0.75]] },
  { id: "barTable", label: "Bar table", w: 1.2, d: 0.6, h: 1.05, z: 0, zone: 0.6, sides: FRONT, ifc: "IfcFurniture TABLE", presets: [["120", 1.2, 0.6, 1.05, 0], ["150", 1.5, 0.6, 1.05, 0], ["Counter height", 1.2, 0.6, 0.9, 0], ["Wall ledge", 1.2, 0.3, 0.05, 1]] },
  { id: "bench", label: "Bench", w: 1.2, d: 0.45, h: 0.45, z: 0, zone: null, sides: NONE, ifc: "IfcFurniture USERDEFINED", presets: [["Storage bench", 1.2, 0.45], ["Window seat", 1.2, 0.5]] },
  { id: "storageChest", label: "Storage chest", w: 0.8, d: 0.45, h: 0.5, z: 0, zone: null, sides: NONE, ifc: "IfcFurniture USERDEFINED", presets: [["80", 0.8, 0.45], ["100", 1, 0.5]] },
  { id: "electricFireplace", label: "Electric fireplace", w: 1, d: 0.2, h: 0.55, z: 0.3, zone: null, sides: NONE, ifc: "IfcSpaceHeater USERDEFINED", presets: [["100", 1, 0.2], ["120", 1.2, 0.2], ["150", 1.5, 0.2]] },
  { id: "wallUnit", label: "Wall unit", w: 0.8, d: 0.2, h: 0.28, z: 2, zone: null, sides: NONE, ifc: "IfcUnitaryEquipment USERDEFINED", presets: [["Mini-split head", 0.8, 0.2, 0.28, 2], ["Water heater", 0.35, 0.2, 0.55, 0.5], ["Electrical panel", 0.35, 0.1, 0.5, 1.4], ["Wall heater", 0.5, 0.12, 0.5, 0.3], ["Through-wall AC", 0.6, 0.25, 0.4, 1]] },
  { id: "woodStove", label: "Wood stove", w: 0.75, d: 0.75, h: 0.65, z: 0, zone: 0.3, sides: FRONT, ifc: "IfcSpaceHeater USERDEFINED", presets: [["Small", 0.75, 0.75, 0.65], ["Medium", 0.95, 0.95, 0.75]] },
];

describe("the pieces for small homes (spec pieces, AC-01)", () => {
  for (const r of ROWS) {
    it(`${r.id}: ${r.w} × ${r.d} × ${r.h} at ${r.z}, zone ${r.zone}, ${r.ifc}`, () => {
      expect(kindConfigs(r.id)).toEqual([{ id: "standard", label: "Standard", w: r.w, d: r.d, zone: r.zone, h: r.h, z: r.z }]);
      expect(kindOf(r.id)).toMatchObject({ label: r.label, semanticClass: r.ifc, outline: r.outline ?? "rect", retired: false, stair: null, family: null });
      expect(defaultSides(r.id)).toEqual(r.sides);
    });

    it(`${r.id}: its presets`, () => {
      const presets = kindOf(r.id)?.presets ?? [];
      expect(presets.map((p) => p.id)).toEqual(r.presets.map((p) => p[0]));
      for (const [id, w, d, h, z] of r.presets) {
        const p = presets.find((x) => x.id === id);
        expect([p?.w, p?.d.standard, p?.h?.standard, p?.z?.standard], `${r.id} ${id}`).toEqual([w, d, h, z]);
      }
    });
  }

  it("a stool is a seat with no backrest, round and without a front; the bar table is sat at (pieces.05, .09)", () => {
    expect(kindOf("stool")).toMatchObject({ seat: 0, outline: "round", front: false, sitAt: false });
    expect(kindOf("barTable")).toMatchObject({ seat: null, sitAt: true, seatsUnder: ["standard"] });
  });

  it("the wood stove alone has a flue (pieces.04, .08)", () => {
    expect(OBJECT_KINDS.filter((k) => k.flue).map((k) => k.id)).toEqual(["woodStove"]);
  });

  it("a hood placed by default hangs against the ceiling, its top at 2.50; the slim one from 1.25 to 1.40", () => {
    const at = (preset?: string) => {
      const object = preset === undefined ? { kind: "cookerHood" } : { kind: "cookerHood", preset };
      const doc = unwrap(execute(rectDoc(0, 0, 4, 4), { type: "placeObject", deck: null, opId: "a", state: "s0", object, at: { x: 2, y: 3.9 } })).doc;
      const id = Object.keys(doc.placements)[0] ?? "";
      return placementRange(doc, id);
    };
    expect(at()).toMatchObject({ bottom: 1.6, top: 2.5 });
    expect(at("Slim")).toMatchObject({ bottom: 1.25, top: 1.4 });
  });
});
