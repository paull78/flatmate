import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { WORKTOP_HEIGHT, defaultSides, kindConfigs, kindOf } from "../src/kinds";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// The corner wardrobe, the corner counter and the corner sofa (catalog.05): `L` kinds like the corner desk, one
// configuration each, with the spec table's sizes, arms, heights, zone depths, presets and IFC classes.

const USERDEFINED = "IfcFurniture USERDEFINED";
const ROWS = [
  { id: "cornerWardrobe", label: "Corner wardrobe", w: 1.5, d: 1.0, zone: 0.6, h: 2.05, arm: 0.6, ifc: USERDEFINED, presets: [[1.0, 1.0], [1.5, 1.0], [2.0, 1.5]] },
  { id: "cornerCounter", label: "Corner counter", w: 2.4, d: 1.8, zone: 1.0, h: WORKTOP_HEIGHT, arm: 0.6, ifc: USERDEFINED, presets: [[1.8, 1.2], [2.4, 1.8], [3.0, 2.4]] },
  { id: "cornerSofa", label: "Corner sofa", w: 2.6, d: 2.0, zone: 0.5, h: 0.9, arm: 0.9, ifc: "IfcFurniture SOFA", presets: [[2.2, 1.6], [2.6, 2.0], [3.0, 2.4]] },
] as const;

const cm = (v: number) => Math.round(v * 100);

describe("the corner wardrobe, counter and sofa rows (catalog.05)", () => {
  for (const r of ROWS) {
    it(`${r.id}: ${r.w} × ${r.d} on the ell outline, ${r.h} tall, zone ${r.zone} in front, ${r.arm} arms, ${r.ifc}`, () => {
      expect(kindConfigs(r.id)).toEqual([{ id: "standard", label: "Standard", w: r.w, d: r.d, zone: r.zone, h: r.h, z: 0 }]);
      expect(kindOf(r.id)).toMatchObject({ label: r.label, outline: "ell", arms: { back: r.arm, left: r.arm }, sitAt: false, seat: null, semanticClass: r.ifc, retired: false, stair: null });
      expect(defaultSides(r.id)).toEqual({ front: true, back: false, left: false, right: false });
    });

    it(`${r.id}: its presets set the width and depth, named w × d in cm`, () => {
      expect(kindOf(r.id)?.presets.map((p) => [p.id, p.label, p.w, p.d.standard])).toEqual(
        r.presets.map(([w, d]) => [`${cm(w)} × ${cm(d)}`, `${cm(w)} × ${cm(d)}`, w, d]),
      );
    });

    it(`${r.id}: places in the back-left corner of a 4 × 4 room with its kind's arms`, () => {
      // Inner faces at 0.1 and 3.9: the back on the top wall, the left side on the left wall.
      const at = { x: 0.1 + r.w / 2, y: 3.9 };
      const doc = unwrap(execute(rectDoc(0, 0, 4, 4), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: r.id }, at })).doc;
      expect(doc.objects["a/o0"]).toMatchObject({ kind: r.id, w: { standard: r.w }, d: { standard: r.d }, h: { standard: r.h }, arms: { back: r.arm, left: r.arm } });
      expect(validateDocument(doc).ok).toBe(true);
      // Turned 180°, into the front-right corner.
      const turned = place(rectDoc(0, 0, 4, 4), { object: "k", kind: r.id, at: [3.9 - r.w / 2, 0.1], rotation: 180 });
      expect(validateDocument(turned).ok).toBe(true);
    });
  }
});
