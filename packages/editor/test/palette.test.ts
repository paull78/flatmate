import { describe, expect, it } from "vitest";
import { MOTIFS, motifDefaults, motifsFor } from "@fm/domain";
import { MOTIF_DRAWINGS } from "../src/view/finish/motifs";
import { FLOOR_TILES, PALETTE_KINDS, floorTileLook } from "../src/view/palette";

// The palette's Floors group (finishes.08, .19): a tile per motif, drawn as a swatch in the motif's default colour.

describe("the Floors tiles", () => {
  it("FLOOR_TILES lists the floor motifs in table order; each tile look has a fill and (but plain) lines", () => {
    expect(FLOOR_TILES.map((t) => t.motif)).toEqual(motifsFor("floor"));
    expect(FLOOR_TILES.map((t) => t.label)).toEqual(motifsFor("floor").map((m) => MOTIFS[m].name));
    for (const tile of FLOOR_TILES) {
      const look = floorTileLook(tile);
      const fills = look.filter((p) => p.kind === "polygon");
      const lines = look.filter((p) => p.kind === "segment");
      expect(fills[0], tile.motif).toMatchObject({ kind: "polygon", color: motifDefaults(tile.motif).colour });
      if (tile.motif === "plain") expect(lines).toEqual([]);
      else expect(lines.length, tile.motif).toBeGreaterThan(0);
      expect(look.every((p) => p.kind !== "segment" || "px" in p.width), tile.motif).toBe(true); // a hairline on the tile, like the canvas
    }
  });

  it("each patterned tile shows a few repeats: 3 to 8 line spacings across its depth, so a mosaic still shows joints", () => {
    for (const tile of FLOOR_TILES) {
      const spacing = MOTIF_DRAWINGS[tile.motif].spacing * motifDefaults(tile.motif).size;
      if (spacing === 0) continue; // plain
      const repeats = tile.d / spacing;
      expect(repeats, tile.motif).toBeGreaterThanOrEqual(3);
      expect(repeats, tile.motif).toBeLessThanOrEqual(8);
    }
  });

  it("the look lies in footprint space (x ±w/2, y from −d to 0) and is built once per motif", () => {
    for (const tile of FLOOR_TILES) {
      const look = floorTileLook(tile);
      expect(floorTileLook(tile)).toBe(look);
      const points = look.flatMap((p) => (p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : []));
      for (const q of points) {
        expect(Math.abs(q.x)).toBeLessThanOrEqual(tile.w / 2 + 1e-9);
        expect(q.y).toBeLessThanOrEqual(1e-9);
        expect(q.y).toBeGreaterThanOrEqual(-tile.d - 1e-9);
      }
    }
  });
});

// The aggregates (spec "Seating: aggregates", AC-04): tiles in their groups, each its default size.
describe("the aggregate tiles", () => {
  const group = (name: string) => PALETTE_KINDS.find((g) => g.group === name)?.cards.map((c) => c.kind) ?? [];

  it("the dining and round sets follow the round table in Sit and eat; the desk set follows the desk in Work", () => {
    expect(group("Sit and eat")).toEqual(["foldingTable", "extendingTable", "roundTable", "seatedDining", "seatedRound", "sofa", "armchair", "chair", "stool", "barTable", "bench", "coffeeTable", "cornerSofa"]);
    expect(group("Work")).toEqual(["desk", "deskSet", "cornerDesk"]);
  });

  it("the corner wardrobe ends Storage and the corner counter ends Kitchen (catalog.05)", () => {
    expect(group("Storage")).toEqual(["wardrobe", "drawers", "storageChest", "shelf", "glassCabinet", "halfGlassCabinet", "tvUnit", "cornerWardrobe", "wallTv", "pegboard", "coatHooks", "coatStand"]);
    expect(group("Kitchen")).toEqual(["hobUnit", "range", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "tallPantry", "wallCabinet", "cookerHood", "cornerCounter"]);
  });

  it("the cot ends Sleep, the towel rail Bathroom, and Basic gains the plant, the radiator and the rugs (catalog.08, .23)", () => {
    expect(group("Sleep")).toEqual(["bed", "mattress", "liftBed", "loftBed", "murphyBed", "builtInTable", "sofaBed", "nightstand", "cot"]);
    expect(group("Bathroom")).toEqual(["toilet", "bidet", "washbasin", "vanityUnit", "cornerBasin", "showerTray", "cornerShower", "bathtub", "washingMachine", "towelRail"]);
    expect(group("Basic")).toEqual(["block", "roundBlock", "cornerBlock", "plant", "palm", "fern", "rosette", "radiator", "wheelWell", "beam", "woodStove", "electricFireplace", "wallUnit", "rug", "roundRug", "picture", "mirror", "clock"]);
  });

  it("each kind's card shows its label and default size (quick add's symbol; the palette shows the sets' presets, library.05)", () => {
    const tiles = PALETTE_KINDS.flatMap((g) => g.cards).filter((c) => ["seatedDining", "seatedRound", "deskSet"].includes(c.kind));
    expect(tiles.map((c) => [c.kind, c.name, c.config, c.w, c.d])).toEqual([
      ["seatedDining", "Dining table with chairs", "standard", 1.2, 2],
      ["seatedRound", "Round table with chairs", "standard", 2.16, 2.16],
      ["deskSet", "Desk with chair", "standard", 1.2, 0.7],
    ]);
  });
});
