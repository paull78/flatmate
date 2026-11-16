import { describe, expect, it } from "vitest";
import { canSwitchKind, defaultSize, kindOf, presetOf, type Outline } from "../src/kinds";
import { useZones } from "../src/queries/footprints";
import { place, rectDoc } from "./helpers";

// The bathroom pieces (spec: layouts catalogue, furnish.13, .19, .22): eight kinds of their own, in the spec's order.

const BATH: [id: string, w: number, d: number, zone: number, semanticClass: string, outline: Outline][] = [
  ["toilet", 0.36, 0.54, 0.6, "IfcSanitaryTerminal TOILETPAN", "pan"],
  ["bidet", 0.36, 0.54, 0.6, "IfcSanitaryTerminal BIDET", "pan"],
  ["washbasin", 0.6, 0.45, 0.7, "IfcSanitaryTerminal WASHHANDBASIN", "soft"],
  ["cornerBasin", 0.45, 0.45, 0.6, "IfcSanitaryTerminal WASHHANDBASIN", "corner"],
  ["showerTray", 0.8, 0.8, 0.7, "IfcSanitaryTerminal SHOWER", "rect"],
  ["cornerShower", 0.8, 0.8, 0.7, "IfcSanitaryTerminal SHOWER", "quarter"],
  ["bathtub", 1.7, 0.7, 0.7, "IfcSanitaryTerminal BATH", "rect"],
  ["washingMachine", 0.6, 0.6, 0.7, "IfcElectricAppliance WASHINGMACHINE", "rect"],
];

describe("bathroom kinds (AC-13)", () => {
  it("each bathroom kind has the spec's size, front zone, class and outline (AC-13, AC-15)", () => {
    for (const [id, w, d, zone, semanticClass, outline] of BATH) {
      expect(kindOf(id)?.configs, id).toMatchObject([{ id: "standard", label: "Standard", w, d, zone }]);
      expect(kindOf(id), id).toMatchObject({
        sides: { front: true, back: false, left: false, right: false }, sitAt: false, seat: null, family: null, opensInto: null, retired: false,
        semanticClass, outline,
      });
    }
  });

  it("placed at (3, 2) in rectDoc(0, 0, 6, 4), each kind's use zone is one front band, w wide and zone deep", () => {
    for (const [id, w, d, zone] of BATH) {
      const doc = place(rectDoc(0, 0, 6, 4), { object: "o", kind: id, at: [3, 2] });
      const bands = useZones(doc).get("o/s0") ?? [];
      expect(bands, id).toHaveLength(1);
      expect(bands[0]?.side, id).toBe("front");
      const xs = (bands[0]?.quad ?? []).map((q) => q.x);
      const ys = (bands[0]?.quad ?? []).map((q) => q.y);
      expect(Math.min(...xs), id).toBeCloseTo(3 - w / 2, 9);
      expect(Math.max(...xs), id).toBeCloseTo(3 + w / 2, 9);
      expect(Math.min(...ys), id).toBeCloseTo(2 - d - zone, 9);
      expect(Math.max(...ys), id).toBeCloseTo(2 - d, 9);
      if (id === "toilet") expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([2.82, 3.18, 0.86, 1.46].map((v) => expect.closeTo(v, 9)));
      if (id === "bathtub") expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([2.15, 3.85, 0.6, 1.3].map((v) => expect.closeTo(v, 9)));
    }
  });

  it("washbasin, shower tray, corner shower and bathtub list the spec's sizes; the default size is the marked preset; single-size kinds have none", () => {
    const lists: [kind: string, ids: string[], labels: string[], marked: string][] = [
      ["washbasin", ["50", "60", "80"], ["50 × 40", "60 × 45", "80 × 50"], "60"],
      ["showerTray", ["70", "80", "90", "Rectangular"], ["70 × 70", "80 × 80", "90 × 90", "Rectangular 80 × 120"], "80"],
      ["cornerShower", ["80", "90"], ["80 × 80", "90 × 90"], "80"],
      ["bathtub", ["150", "160", "170", "170 × 75", "180 × 80", "190 × 90"], ["150 × 70", "160 × 70", "170 × 70", "170 × 75", "180 × 80", "190 × 90"], "170"],
    ];
    for (const [kind, ids, labels, marked] of lists) {
      const presets = kindOf(kind)?.presets ?? [];
      expect(presets.map((p) => p.id), kind).toEqual(ids);
      expect(presets.map((p) => p.label), kind).toEqual(labels);
      const size = defaultSize(kind);
      if (!size) throw new Error(`no default size for ${kind}`);
      expect(presetOf({ kind, ...size })?.id, kind).toBe(marked);
    }
    expect(kindOf("showerTray")?.presets.find((p) => p.id === "Rectangular")).toMatchObject({ w: 0.8, d: { standard: 1.2 } });
    for (const kind of ["bidet", "cornerBasin"]) expect(kindOf(kind)?.presets.length, kind).toBe(0);
    expect(kindOf("washingMachine")?.presets.map((p) => p.label)).toEqual(["Washer 60 × 60 h 85", "Washer-dryer 60 × 60 h 170"]); // catalog.07
  });

  it("bathroom kinds switch among each other and to other standard kinds, never to the retired Bathroom block (furnish.17)", () => {
    for (const [k] of BATH.slice(1)) expect(canSwitchKind("toilet", k), k).toBe(true);
    expect(canSwitchKind("bathtub", "wardrobe")).toBe(true);
    expect(canSwitchKind("block", "cornerShower")).toBe(true);
    expect(canSwitchKind("toilet", "bathroomBlock")).toBe(false);
    expect(canSwitchKind("toilet", "toilet")).toBe(false);
    expect(canSwitchKind("showerTray", "sofaBed")).toBe(false);
  });
});
