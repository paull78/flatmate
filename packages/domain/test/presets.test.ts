import { describe, expect, it } from "vitest";
import { shown } from "../src/format";
import { MAX_OBJECT_SIZE, MIN_OBJECT_SIZE, OBJECT_KINDS, defaultSize, kindConfigs, kindOf, presetOf } from "../src/kinds";

// Size presets (smart.11, .17): one short list per kind; nothing is stored, a piece shows the preset its sizes match.

const presets = (kind: string) => kindOf(kind)?.presets ?? [];
const bed = (w: number, d: number) => ({ kind: "bed", w: { standard: w }, d: { standard: d } });
const cm = (v: number) => String(Math.round(v * 100));

/** Each kind's default preset (spec "Size presets", marked *). */
const DEFAULT_PRESETS: Readonly<Record<string, string>> = {
  bed: "King",
  mattress: "King",
  liftBed: "King",
  loftBed: "Single",
  wallCabinet: "60",
  sofa: "3 seats",
  sofaBed: "3 seats",
  wardrobe: "120",
  drawers: "100",
  desk: "120",
  extendingTable: "4 seats",
  builtInTable: "120",
  builtInDesk: "100",
  murphyBed: "Double",
  washbasin: "60",
  vanityUnit: "100",
  showerTray: "80",
  cornerShower: "80",
  bathtub: "170",
  sinkUnit: "80",
  counter: "60",
  dishwasher: "60",
  roundTable: "90",
  deskSet: "120",
  seatedDining: "4 seats",
  seatedRound: "4 seats",
  tvUnit: "120",
  washingMachine: "Washer",
  coffeeTable: "100 × 50",
  hobUnit: "4 burners",
  fridge: "Tall",
  shelf: "Standard",
  toilet: "Wall-hung",
  cornerDesk: "160 × 120",
  cornerWardrobe: "150 × 100",
  cornerCounter: "240 × 180",
  cornerSofa: "260 × 200",
  plant: "40",
  palm: "90",
  fern: "60",
  rosette: "40",
  radiator: "80",
  rug: "200",
  roundRug: "160",
  range: "60",
  cookerHood: "Chimney",
  tallPantry: "80",
  stool: "Bar",
  barTable: "120",
  bench: "Storage bench",
  storageChest: "80",
  electricFireplace: "100",
  wallUnit: "Mini-split head",
  wheelWell: "Tandem",
  beam: "Beam",
  woodStove: "Small",
  towelRail: "Medium",
  picture: "Poster",
  mirror: "Bathroom",
  clock: "30",
  wallTv: '55"',
  pegboard: "90",
  coatHooks: "90",
  coatStand: "45",
  glassCabinet: "80",
  halfGlassCabinet: "80",
};

describe("size presets (spec Size presets, AC-08)", () => {
  it("the bed lists nine presets with their sizes; King is the default", () => {
    const list = presets("bed");
    expect(list.map((p) => p.id)).toEqual(["Small single", "Narrow single", "Single", "Small double", "Double", "King", "Super king", "US Queen", "US King"]);
    expect(list.map((p) => p.w)).toEqual([0.85, 0.95, 1.0, 1.3, 1.5, 1.7, 1.9, 1.62, 2.03]);
    expect(list.map((p) => p.d["standard"])).toEqual([1.95, 2.05, 2.1, 2.1, 2.1, 2.1, 2.1, 2.13, 2.13]);
    expect(list.map((p) => p.label)).toContain("King 170 × 210");
    expect(list.map((p) => p.label)).toContain("US Queen 162 × 213");
    expect(presetOf({ kind: "bed", ...(defaultSize("bed") ?? { w: {}, d: {} }) })?.id).toBe("King");
  });

  it("labels name a second state's depth, and leave out an id that is just the width", () => {
    expect(presets("sofaBed").map((p) => p.label)).toEqual(["2 seats 150 × 90 (bed 160)", "3 seats 210 × 90 (bed 160)"]);
    expect(presets("extendingTable")[0]?.label).toBe("4 seats 80 × 120 (extended 166)");
    expect(presets("builtInTable").map((p) => p.label)).toEqual(["120 × 35 (open 115)"]);
    expect(presets("wardrobe")[0]?.label).toBe("50 × 60");
  });

  it("every preset has a depth for exactly its kind's configuration ids, sizes within MIN_OBJECT_SIZE..MAX_OBJECT_SIZE, and a label holding its width and first depth in cm", () => {
    for (const kind of OBJECT_KINDS) {
      const configs = kindConfigs(kind.id);
      const ids = configs.map((c) => c.id);
      for (const p of kind.presets) {
        expect(Object.keys(p.d).sort(), `${kind.id} ${p.id}`).toEqual([...ids].sort());
        for (const v of [p.w, ...Object.values(p.d)]) {
          expect(v, `${kind.id} ${p.id}`).toBeGreaterThanOrEqual(MIN_OBJECT_SIZE);
          expect(v, `${kind.id} ${p.id}`).toBeLessThanOrEqual(MAX_OBJECT_SIZE);
        }
        expect(p.label, `${kind.id} ${p.id}`).toContain(`${cm(p.w)} × ${cm(p.d[ids[0] ?? ""] ?? 0)}`);
        // A second configuration's depth shows in brackets when it differs (the lift bed keeps one depth, heights.22).
        const second = configs[1];
        const differs = second !== undefined && cm(p.d[second.id] ?? 0) !== cm(p.d[ids[0] ?? ""] ?? 0);
        if (second && differs) expect(p.label, `${kind.id} ${p.id}`).toContain(`(${second.label.toLowerCase()} ${cm(p.d[second.id] ?? 0)})`);
        if (second && !differs) expect(p.label, `${kind.id} ${p.id}`).not.toContain("(");
      }
      expect(new Set(kind.presets.map((p) => p.id)).size, kind.id).toBe(kind.presets.length);
    }
  });

  it("every kind's default size is one of its presets (smart.17)", () => {
    const defaults = OBJECT_KINDS.map((k) => [k.id, presetOf({ kind: k.id, ...(defaultSize(k.id) ?? { w: {}, d: {} }) })?.id ?? null]);
    expect(Object.fromEntries(defaults.filter(([, id]) => id !== null))).toEqual(DEFAULT_PRESETS);
    const without = OBJECT_KINDS.filter((k) => k.presets.length === 0).map((k) => k.id).sort();
    expect(without).toEqual([
      "alternatingTread", "armchair", "bathroomBlock", "bidet", "block", "chair", "cornerBasin", "cornerBlock", "cot", "foldingTable", "kitchenBlock",
      "nightstand", "openStair", "ovenColumn", "roundBlock", "rungLadder", "shipsLadder", "spiralStair", "stair", "storageStair", "storageSteps", "winderStair",
    ]);
  });

  it("the mattress's presets are the bed's less the 10 cm frame, preset by preset, labelled with their own size (cleanup.07)", () => {
    const beds = presets("bed");
    const mattresses = presets("mattress");
    expect(mattresses.map((p) => p.id)).toEqual(beds.map((p) => p.id));
    beds.forEach((b, i) => {
      const m = mattresses[i];
      expect(m?.w, b.id).toBe(Math.round((b.w - 0.1) * 100) / 100);
      expect(m?.d.standard, b.id).toBe(Math.round(((b.d.standard ?? 0) - 0.1) * 100) / 100);
    });
    expect(mattresses.map((p) => p.label)).toEqual([
      "Small single 75 × 185", "Narrow single 85 × 195", "Single 90 × 200", "Small double 120 × 200", "Double 140 × 200",
      "King 160 × 200", "Super king 180 × 200", "US Queen 152 × 203", "US King 193 × 203",
    ]);
  });

  it("presetOf matches to the centimetre", () => {
    expect(presetOf(bed(1.7, 2.1))?.id).toBe("King");
    expect(presetOf(bed(1.703, 2.1))?.id).toBe("King");
    expect(presetOf(bed(1.706, 2.1))).toBeNull(); // rounds to 1.71; truncating would match
    expect(presetOf(bed(1.71, 2.1))).toBeNull();
    expect(presetOf(bed(1.7, 2.104))?.id).toBe("King");
    expect(presetOf(bed(1.7, 2.106))).toBeNull();
  });

  it("presetOf rounds as the Width and Depth fields show (shown, halves away from zero), so a half centimetre never contradicts them", () => {
    // 2.105 shows as 2.11 (cleanup.13; toFixed gave 2.10), so it is no longer the Single's 2.10; 2.104 still is.
    expect(shown(2.105)).toBe("2.11");
    expect(presetOf(bed(1, 2.105))).toBeNull();
    expect(presetOf(bed(1, 2.104))?.id).toBe("Single");
    // 0.995 shows as 1.00, so it matches what 1.00 matches.
    expect(shown(0.995)).toBe("1.00");
    expect(presetOf({ kind: "wardrobe", w: { standard: 0.995 }, d: { standard: 0.6 } })).toEqual(presetOf({ kind: "wardrobe", w: { standard: 1 }, d: { standard: 0.6 } }));
  });

  it("a sofa bed matches only when both widths and both depths match", () => {
    expect(presetOf({ kind: "sofaBed", w: { sofa: 2.1, bed: 2.1 }, d: { sofa: 0.9, bed: 1.6 } })?.id).toBe("3 seats");
    expect(presetOf({ kind: "sofaBed", w: { sofa: 2.1, bed: 1.8 }, d: { sofa: 0.9, bed: 1.6 } })).toBeNull(); // AC-11
    expect(presetOf({ kind: "sofaBed", w: { sofa: 2.1, bed: 2.1 }, d: { sofa: 0.9, bed: 1.7 } })).toBeNull();
    expect(presetOf({ kind: "sofaBed", w: { sofa: 2.1 }, d: { sofa: 0.9, bed: 1.6 } })).toBeNull(); // a missing size never matches
  });

  it("seat presets: the sofa's, sofa bed's, extending table's and the two sets' presets carry the seats their label names; no other preset has seats (library.11)", () => {
    const seated = ["sofa", "sofaBed", "extendingTable", "seatedDining", "seatedRound"];
    for (const id of seated) {
      expect(presets(id).length, id).toBeGreaterThan(0);
      for (const p of presets(id)) expect(p.seats, `${id} ${p.id}`).toBe(Number(/^(\d+) seats/.exec(p.label)?.[1]));
    }
    const others = OBJECT_KINDS.filter((k) => !seated.includes(k.id)).flatMap((k) => k.presets.map((p) => `${k.id} ${p.id} ${String(p.seats)}`));
    expect(others.filter((s) => !s.endsWith(" undefined"))).toEqual([]);
  });

  it("presetOf is null for a chair (0.45 × 0.45, no presets) and an unknown kind", () => {
    expect(presetOf({ kind: "chair", w: { standard: 0.45 }, d: { standard: 0.45 } })).toBeNull();
    expect(presetOf({ kind: "spaceship", w: { standard: 1.7 }, d: { standard: 2.1 } })).toBeNull();
  });
});
