import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { canSwitchKind, defaultSize, kindConfigs, kindOf, presetOf, type Outline, type Sides } from "../src/kinds";
import { useZones } from "../src/queries/footprints";
import { rectDoc } from "./helpers";

// The kitchen modules, the living pieces, the TV unit and the nightstand (spec: layouts catalogue, furnish.11, .13, .19,
// .22), and the bed's two narrow presets (AC-17).

const NONE: Sides = { front: false, back: false, left: false, right: false };
const FRONT: Sides = { ...NONE, front: true };
const ALL: Sides = { front: true, back: true, left: true, right: true };

const KINDS: [id: string, label: string, w: number, d: number, zone: number | null, sides: Sides, semanticClass: string, outline: Outline][] = [
  ["hobUnit", "Hob unit", 0.6, 0.6, 1, FRONT, "IfcElectricAppliance ELECTRICCOOKER", "rect"],
  ["sinkUnit", "Sink unit", 0.8, 0.6, 1, FRONT, "IfcSanitaryTerminal SINK", "rect"],
  ["counter", "Counter", 0.6, 0.6, 1, FRONT, "IfcFurniture USERDEFINED", "rect"],
  ["fridge", "Fridge", 0.6, 0.65, 1, FRONT, "IfcElectricAppliance FRIDGE_FREEZER", "rect"],
  ["dishwasher", "Dishwasher", 0.6, 0.6, 1, FRONT, "IfcElectricAppliance DISHWASHER", "rect"],
  ["ovenColumn", "Oven column", 0.6, 0.6, 1, FRONT, "IfcElectricAppliance ELECTRICCOOKER", "rect"],
  ["roundTable", "Round table", 0.9, 0.9, 0.6, ALL, "IfcFurniture TABLE", "round"],
  ["armchair", "Armchair", 0.8, 0.8, 0.5, FRONT, "IfcFurniture CHAIR", "rect"],
  ["coffeeTable", "Coffee table", 1, 0.5, null, NONE, "IfcFurniture TABLE", "rect"],
  ["tvUnit", "TV unit", 1.2, 0.4, null, NONE, "IfcAudioVisualAppliance DISPLAY", "rect"],
  ["nightstand", "Nightstand", 0.45, 0.4, null, NONE, "IfcFurniture USERDEFINED", "soft"],
];

const bed = (w: number, d: number) => ({ kind: "bed", w: { standard: w }, d: { standard: d } });
type Box = [x0: number, x1: number, y0: number, y1: number];
const boxOf = (quad: readonly { x: number; y: number }[]): Box => {
  const xs = quad.map((q) => q.x);
  const ys = quad.map((q) => q.y);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};
const expectBox = (actual: Box, expected: Box, label: string) => actual.forEach((v, i) => expect(Math.abs(v - (expected[i] ?? NaN)), `${label} [${i}]`).toBeLessThan(1e-9));

describe("kitchen and living kinds (AC-13)", () => {
  it("the eleven kinds have the spec's label, default size, zone, sides, class and outline", () => {
    for (const [id, label, w, d, zone, sides, semanticClass, outline] of KINDS) {
      expect(kindConfigs(id), id).toMatchObject([{ id: "standard", label: "Standard", w, d, zone }]);
      expect(kindOf(id), id).toMatchObject({ label, sides, semanticClass, outline, retired: false, family: null });
      const sitAt = id === "roundTable";
      expect([kindOf(id)?.sitAt, kindOf(id)?.seat], id).toEqual([sitAt, null]);
    }
  });

  it("placed at (3, 2) in rectDoc(0, 0, 6, 4) at rotation 0, each kind's use zones are the spec's bands", () => {
    for (const [id, , w, d, zone, sides] of KINDS) {
      const doc = unwrap(execute(rectDoc(0, 0, 6, 4), { type: "placeObject", deck: null, opId: "o", state: "s0", object: { kind: id }, at: { x: 3, y: 2 } })).doc;
      expect(doc.objects["o/o0"], id).toMatchObject({ kind: id, w: { standard: w }, d: { standard: d } });
      expect(doc.placements["o/p0"]?.rotation, id).toBe(0);
      const bands = useZones(doc).get("o/p0");
      if (zone === null) {
        expect(bands, id).toBeUndefined();
        continue;
      }
      if (sides.back) {
        expect(bands?.map((b) => b.side), id).toEqual(["front", "back", "left", "right"]);
        const expected: Box[] = [[2.55, 3.45, 0.5, 1.1], [2.55, 3.45, 2, 2.6], [1.95, 2.55, 1.1, 2], [3.45, 4.05, 1.1, 2]];
        expected.forEach((e, k) => expectBox(boxOf(bands?.[k]?.quad ?? []), e, `${id} ${bands?.[k]?.side}`));
        continue;
      }
      expect(bands?.map((b) => b.side), id).toEqual(["front"]);
      const box = boxOf(bands?.[0]?.quad ?? []);
      expectBox(box, [3 - w / 2, 3 + w / 2, 2 - d - zone, 2 - d], id);
      if (id === "hobUnit") expectBox(box, [2.7, 3.3, 0.4, 1.4], id);
      if (id === "fridge") expectBox(box, [2.7, 3.3, 0.35, 1.35], id);
      if (id === "armchair") expectBox(box, [2.6, 3.4, 0.7, 1.2], id);
    }
  });

  it("presets: sink unit, counter, dishwasher, round table and TV unit list the spec's sizes; the default is marked by size; the single-size kinds have none", () => {
    const lists: [kind: string, ids: string[], labels: string[], marked: string][] = [
      ["sinkUnit", ["80", "120"], ["80 × 60", "120 × 60"], "80"],
      ["counter", ["30", "45", "60", "90", "120"], ["30 × 60", "45 × 60", "60 × 60", "90 × 60", "120 × 60"], "60"],
      ["dishwasher", ["45", "60"], ["45 × 60", "60 × 60"], "60"],
      ["roundTable", ["80", "90", "100", "120", "140", "170"], ["80 × 80", "90 × 90", "100 × 100", "120 × 120", "140 × 140", "170 × 170"], "90"],
      ["tvUnit", ["120", "160", "180", "200"], ["120 × 40", "160 × 40", "180 × 40", "200 × 40"], "120"],
    ];
    for (const [kind, ids, labels, marked] of lists) {
      const presets = kindOf(kind)?.presets ?? [];
      expect(presets.map((p) => p.id), kind).toEqual(ids);
      expect(presets.map((p) => p.label), kind).toEqual(labels);
      const size = defaultSize(kind);
      if (!size) throw new Error(`no default size for ${kind}`);
      expect(presetOf({ kind, ...size })?.id, kind).toBe(marked);
    }
    for (const p of kindOf("roundTable")?.presets ?? []) expect(p.w, p.id).toBe(p.d.standard);
    for (const kind of ["ovenColumn", "armchair", "nightstand"]) expect(kindOf(kind)?.presets.length, kind).toBe(0);
  });

  it("the bed lists Small single and Narrow single first; King stays the default (AC-17)", () => {
    expect(kindOf("bed")?.presets.slice(0, 3).map((p) => [p.id, p.label, p.w, p.d.standard])).toEqual([
      ["Small single", "Small single 85 × 195", 0.85, 1.95],
      ["Narrow single", "Narrow single 95 × 205", 0.95, 2.05],
      ["Single", "Single 100 × 210", 1, 2.1],
    ]);
    expect(presetOf(bed(0.85, 1.95))?.id).toBe("Small single");
    expect(presetOf(bed(0.95, 2.05))?.id).toBe("Narrow single");
    expect(presetOf({ kind: "bed", ...(defaultSize("bed") ?? { w: {}, d: {} }) })?.id).toBe("King");
  });

  it("canSwitchKind among the new kinds", () => {
    for (const [from, to] of [["counter", "hobUnit"], ["nightstand", "drawers"], ["armchair", "chair"], ["tvUnit", "roundTable"]] as const) {
      expect(canSwitchKind(from, to), `${from} → ${to}`).toBe(true);
    }
    expect(canSwitchKind("roundTable", "extendingTable")).toBe(false); // the configuration ids differ
    expect(canSwitchKind("hobUnit", "kitchenBlock")).toBe(false); // the Kitchen block is retired
    expect(canSwitchKind("tvUnit", "tvUnit")).toBe(false);
  });
});
