import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, defaultSize, kindOf, presetOf, presetSize, type OrCeiling } from "../src/kinds";

// The spec's "Preset lists" table (catalog.07, .22, AC-06): every list in full, with its sizes, heights and elevations.
// A row is [id, width, depth or the depths by configuration, label, height, elevation].

type Row = [id: string, w: number, d: number | Readonly<Record<string, number>>, label: string, h?: number, z?: OrCeiling];

const SPEC: Readonly<Record<string, readonly Row[]>> = {
  extendingTable: [
    ["4 seats", 0.8, { closed: 1.2, extended: 1.66 }, "4 seats 80 × 120 (extended 166)"],
    ["6 seats", 0.9, { closed: 1.6, extended: 2.06 }, "6 seats 90 × 160 (extended 206)"],
    ["8 seats", 0.9, { closed: 1.6, extended: 2.4 }, "8 seats 90 × 160 (extended 240)"],
    ["10 seats", 1, { closed: 2, extended: 3 }, "10 seats 100 × 200 (extended 300)"],
    ["12 seats", 1, { closed: 2.4, extended: 3.4 }, "12 seats 100 × 240 (extended 340)"],
  ],
  roundTable: [
    ["80", 0.8, 0.8, "80 × 80"],
    ["90", 0.9, 0.9, "90 × 90"],
    ["100", 1, 1, "100 × 100"],
    ["120", 1.2, 1.2, "120 × 120"],
    ["140", 1.4, 1.4, "140 × 140"],
    ["170", 1.7, 1.7, "170 × 170"],
  ],
  hobUnit: [
    ["2 burners", 0.3, 0.6, "2 burners 30 × 60"],
    ["4 burners", 0.6, 0.6, "4 burners 60 × 60"],
    ["5 burners", 0.75, 0.6, "5 burners 75 × 60"],
    ["6 burners", 0.9, 0.6, "6 burners 90 × 60"],
  ],
  bathtub: [
    ["150", 1.5, 0.7, "150 × 70"],
    ["160", 1.6, 0.7, "160 × 70"],
    ["170", 1.7, 0.7, "170 × 70"],
    ["170 × 75", 1.7, 0.75, "170 × 75"],
    ["180 × 80", 1.8, 0.8, "180 × 80"],
    ["190 × 90", 1.9, 0.9, "190 × 90"],
  ],
  tvUnit: [
    ["120", 1.2, 0.4, "120 × 40"],
    ["160", 1.6, 0.4, "160 × 40"],
    ["180", 1.8, 0.4, "180 × 40"],
    ["200", 2, 0.4, "200 × 40"],
  ],
  coffeeTable: [
    ["90 × 50", 0.9, 0.5, "90 × 50"],
    ["100 × 50", 1, 0.5, "100 × 50"],
    ["110 × 60", 1.1, 0.6, "110 × 60"],
    ["120 × 70", 1.2, 0.7, "120 × 70"],
  ],
  wardrobe: [
    ["50", 0.5, 0.6, "50 × 60"],
    ["100", 1, 0.6, "100 × 60"],
    ["120", 1.2, 0.6, "120 × 60"],
    ["150", 1.5, 0.6, "150 × 60"],
    ["200", 2, 0.6, "200 × 60"],
    ["250", 2.5, 0.6, "250 × 60"],
    ["300", 3, 0.6, "300 × 60"],
  ],
  fridge: [
    ["Tall", 0.6, 0.65, "Tall 60 × 65 h 190", 1.9],
    ["70 cm", 0.7, 0.65, "70 cm 70 × 65 h 200", 2],
    ["Under-counter", 0.6, 0.6, "Under-counter 60 × 60 h 85", 0.85],
    ["Compact", 0.48, 0.5, "Compact 48 × 50 h 85", 0.85],
    ["US French door", 0.91, 0.75, "US French door 91 × 75 h 178", 1.78],
    ["12 V", 0.45, 0.5, "12 V 45 × 50 h 55", 0.55],
  ],
  shelf: [
    ["Standard", 0.8, 0.4, "Standard 80 × 40 h 150", 1.5, 0],
    ["Bookcase", 0.8, 0.3, "Bookcase 80 × 30 h 200", 2, 0],
    ["Cube", 0.77, 0.39, "Cube 77 × 39 h 77", 0.77, 0],
    ["Wall shelf", 0.8, 0.25, "Wall shelf 80 × 25 h 30 at 150", 0.3, 1.5],
  ],
  toilet: [
    ["Wall-hung", 0.36, 0.54, "Wall-hung 36 × 54 h 42", 0.42],
    ["Standard", 0.4, 0.65, "Standard 40 × 65 h 90", 0.9],
    ["Composting", 0.45, 0.6, "Composting 45 × 60 h 90", 0.9],
  ],
  washingMachine: [
    ["Washer", 0.6, 0.6, "Washer 60 × 60 h 85", 0.85],
    ["Washer-dryer", 0.6, 0.6, "Washer-dryer 60 × 60 h 170", 1.7],
  ],
};

const shelf = (w: number, d: number, h: number, z: number) => ({ kind: "shelf", w: { standard: w }, d: { standard: d }, h: { standard: h }, z: { standard: z } });

describe("the spec's preset lists (AC-06)", () => {
  for (const [kind, rows] of Object.entries(SPEC)) {
    it(`${kind} lists the spec's presets with their sizes, heights and elevations`, () => {
      const presets = kindOf(kind)?.presets ?? [];
      expect(presets.map((p) => p.id)).toEqual(rows.map(([id]) => id));
      expect(presets.map((p) => p.label)).toEqual(rows.map(([, , , label]) => label));
      const fallback = defaultSize(kind);
      for (const [id, w, d, , h, z] of rows) {
        const size = presetSize(kind, id);
        expect(size?.w, id).toEqual(Object.fromEntries(Object.keys(fallback?.w ?? {}).map((c) => [c, w])));
        if (typeof d === "number") expect(Object.values(size?.d ?? {}), id).toEqual([d]);
        else expect(size?.d, id).toEqual(d);
        // A preset without a height or an elevation takes the kind's on a new piece.
        expect(size?.h, id).toEqual(h === undefined ? fallback?.h : { standard: h });
        expect(size?.z, id).toEqual(z === undefined ? fallback?.z : { standard: z });
      }
    });
  }

  it("beds and mattresses gain nothing (catalog.22)", () => {
    expect(kindOf("bed")?.presets).toHaveLength(9);
    expect(kindOf("mattress")?.presets).toHaveLength(9);
  });

  it("within a kind, heights and elevations are all or nothing, so the picker never leaves a stale one behind", () => {
    for (const kind of OBJECT_KINDS) {
      const withH = kind.presets.filter((p) => p.h !== undefined);
      const withZ = kind.presets.filter((p) => p.z !== undefined);
      if (withH.length > 0) expect(withH.map((p) => p.id), `${kind.id} h`).toEqual(kind.presets.map((p) => p.id));
      if (withZ.length > 0) expect(withZ.map((p) => p.id), `${kind.id} z`).toEqual(kind.presets.map((p) => p.id));
    }
  });

  it("labels and ids are unique per kind", () => {
    for (const kind of OBJECT_KINDS) {
      expect(new Set(kind.presets.map((p) => p.label)).size, kind.id).toBe(kind.presets.length);
      expect(new Set(kind.presets.map((p) => p.id)).size, kind.id).toBe(kind.presets.length);
    }
  });

  it("every kind with presets has its default size among them; the new kinds' defaults are the spec's", () => {
    for (const kind of OBJECT_KINDS.filter((k) => k.presets.length > 0)) {
      expect(presetOf({ kind: kind.id, ...(defaultSize(kind.id) ?? { w: {}, d: {} }) }), kind.id).not.toBeNull();
    }
    const defaultOf = (kind: string) => presetOf({ kind, ...(defaultSize(kind) ?? { w: {}, d: {} }) })?.id;
    expect(["coffeeTable", "hobUnit", "fridge", "shelf", "toilet"].map(defaultOf)).toEqual(["100 × 50", "4 burners", "Tall", "Standard", "Wall-hung"]);
  });
});

describe("presetOf with heights and elevations (catalog.47)", () => {
  it("Wall shelf reads only at its height and its elevation", () => {
    expect(presetOf(shelf(0.8, 0.25, 0.3, 1.5))?.id).toBe("Wall shelf");
    expect(presetOf(shelf(0.8, 0.25, 0.3, 1.2))).toBeNull(); // the elevation differs
    expect(presetOf(shelf(0.8, 0.25, 0.3, 0))).toBeNull();
    expect(presetOf(shelf(0.8, 0.25, 0.4, 1.5))).toBeNull(); // the height differs
    expect(presetOf({ kind: "shelf", w: { standard: 0.8 }, d: { standard: 0.25 } })).toBeNull(); // a missing size never matches
  });

  it("Standard is the default shelf: 1.50 tall on the floor; any other height or elevation reads Custom", () => {
    expect(presetOf(shelf(0.8, 0.4, 1.5, 0))?.id).toBe("Standard");
    expect(presetOf(shelf(0.8, 0.4, 2.2, 0))).toBeNull();
    expect(presetOf(shelf(0.8, 0.4, 1.5, 0.5))).toBeNull();
  });

  it("Bookcase and Cube read only on the floor", () => {
    expect(presetOf(shelf(0.8, 0.3, 2, 0))?.id).toBe("Bookcase");
    expect(presetOf(shelf(0.8, 0.3, 2, 1.5))).toBeNull();
    expect(presetOf(shelf(0.77, 0.39, 0.77, 0))?.id).toBe("Cube");
    expect(presetOf(shelf(0.77, 0.39, 0.77, 1.5))).toBeNull();
  });

  it("a fridge's preset reads by its height too", () => {
    const fridge = (w: number, d: number, h: number) => ({ kind: "fridge", w: { standard: w }, d: { standard: d }, h: { standard: h }, z: { standard: 0 } });
    expect(presetOf(fridge(0.6, 0.6, 0.85))?.id).toBe("Under-counter");
    expect(presetOf(fridge(0.6, 0.6, 1.9))).toBeNull();
    expect(presetOf(fridge(0.45, 0.5, 0.55))?.id).toBe("12 V");
  });

  it("the 6- and 8-seat extending tables, one size closed, part on their extended depth", () => {
    const table = (extended: number) => ({ kind: "extendingTable", w: { closed: 0.9, extended: 0.9 }, d: { closed: 1.6, extended } });
    expect(presetOf(table(2.06))?.id).toBe("6 seats");
    expect(presetOf(table(2.4))?.id).toBe("8 seats");
    expect(presetOf(table(2.2))).toBeNull();
  });

  it("from a wall shelf's sizes, every other shelf preset comes back to the floor at its own height", () => {
    const on = presetSize("shelf", "Wall shelf", defaultSize("shelf") ?? undefined);
    expect(on).toEqual({ w: { standard: 0.8 }, d: { standard: 0.25 }, h: { standard: 0.3 }, z: { standard: 1.5 } });
    const from = on ?? undefined;
    expect(presetSize("shelf", "Standard", from)).toEqual({ w: { standard: 0.8 }, d: { standard: 0.4 }, h: { standard: 1.5 }, z: { standard: 0 } });
    expect(presetSize("shelf", "Bookcase", from)).toEqual({ w: { standard: 0.8 }, d: { standard: 0.3 }, h: { standard: 2 }, z: { standard: 0 } });
    expect(presetSize("shelf", "Cube", from)).toEqual({ w: { standard: 0.77 }, d: { standard: 0.39 }, h: { standard: 0.77 }, z: { standard: 0 } });
  });
});
