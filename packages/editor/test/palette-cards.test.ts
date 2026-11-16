import { describe, expect, it } from "vitest";
import { defaultSize, kindOf, shown } from "@fm/domain";
import { PALETTE, PALETTE_KINDS, cardSize, tileLook, type PaletteCard } from "../src/view/palette";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { roundRects } from "./object-look-helpers";

// The palette's cards (spec "The cards", AC-02, AC-03, library.04, .05, .11): one per kind, or one per preset for a kind
// whose presets all count seats, each with its name and its size in metres.

const cards = (group: string): readonly PaletteCard[] => PALETTE.find((g) => g.group === group)?.cards ?? [];
const count = (group: string, kind: string): number => cards(group).filter((c) => c.kind === kind).length;
const card = (kind: string, preset: string | null = null): PaletteCard | undefined =>
  PALETTE.flatMap((g) => g.cards).find((c) => c.kind === kind && c.preset === preset);

describe("the palette's cards", () => {
  it("cards per preset: Sit and eat has 3 sofas, 5 extending tables, 4 dining sets, 3 round sets; Sleep 2 sofa beds; every other kind 1", () => {
    expect([count("Sit and eat", "sofa"), count("Sit and eat", "extendingTable"), count("Sit and eat", "seatedDining"), count("Sit and eat", "seatedRound")]).toEqual([3, 5, 4, 3]);
    expect(count("Sleep", "sofaBed")).toBe(2);
    expect([count("Kitchen", "hobUnit"), count("Kitchen", "fridge"), count("Storage", "shelf"), count("Bathroom", "toilet"), count("Sit and eat", "coffeeTable")]).toEqual([1, 1, 1, 1, 1]); // not seat counts
    const perPreset = new Set(["sofa", "extendingTable", "seatedDining", "seatedRound", "sofaBed"]);
    for (const c of PALETTE.flatMap((g) => g.cards).filter((c) => !perPreset.has(c.kind))) {
      expect(PALETTE.flatMap((g) => g.cards).filter((o) => o.kind === c.kind), c.kind).toEqual([c]);
      expect(c.preset, c.kind).toBeNull();
    }
  });

  it("groups and their kinds keep today's order; a kind's preset cards follow its preset order", () => {
    const kindsOf = (cs: readonly PaletteCard[]) => cs.map((c) => c.kind).filter((k, i, all) => all.indexOf(k) === i);
    expect(PALETTE.map((g) => [g.group, kindsOf(g.cards)])).toEqual(PALETTE_KINDS.map((g) => [g.group, g.cards.map((c) => c.kind)]));
    expect(cards("Sit and eat").map((c) => c.kind)).toEqual([
      "foldingTable", "extendingTable", "extendingTable", "extendingTable", "extendingTable", "extendingTable", "roundTable", "seatedDining", "seatedDining", "seatedDining", "seatedDining",
      "seatedRound", "seatedRound", "seatedRound", "sofa", "sofa", "sofa", "armchair", "chair", "stool", "barTable", "bench", "coffeeTable", "cornerSofa",
    ]);
    expect(cards("Sit and eat").filter((c) => c.kind === "sofa").map((c) => c.preset)).toEqual((kindOf("sofa")?.presets ?? []).map((p) => p.id));
    expect(cards("Sit and eat").filter((c) => c.kind === "extendingTable").map((c) => c.preset)).toEqual(["4 seats", "6 seats", "8 seats", "10 seats", "12 seats"]);
  });

  it("quick add's kinds stay one card per kind at its default size", () => {
    for (const c of PALETTE_KINDS.flatMap((g) => g.cards)) expect(c.preset, c.kind).toBeNull();
    expect(PALETTE_KINDS.flatMap((g) => g.cards).find((c) => c.kind === "sofa")).toMatchObject({ name: "Sofa", w: defaultSize("sofa")?.w.standard });
  });

  it("card text: '<kind> · <preset>' over the preset's size; a one-card kind its name over its default size", () => {
    expect(card("seatedDining", "6 seats")).toMatchObject({ name: "Dining table with chairs · 6 seats", size: "2.60 × 2.10 m", config: "standard", w: 2.6, d: 2.1 });
    expect(card("seatedRound", "6 seats")?.size).toBe("Ø 2.46 m");
    expect(card("extendingTable", "6 seats")).toMatchObject({ name: "Extending table · 6 seats", size: "0.90 × 1.60 m", config: "closed", w: 0.9, d: 1.6 });
    expect(card("extendingTable", "12 seats")).toMatchObject({ name: "Extending table · 12 seats", size: "1.00 × 2.40 m", config: "closed", w: 1, d: 2.4 });
    expect(card("bed")).toEqual({ kind: "bed", preset: null, name: "Bed", size: "1.70 × 2.10 m", config: "standard", w: 1.7, d: 2.1 });
    expect(card("builtInTable")).toMatchObject({ name: "Built-in unit", config: "down", size: "1.20 × 1.15 m" });
  });

  it("Work has the corner desk's card, 'Corner desk' over 1.60 × 1.20 m (AC-09)", () => {
    expect(cards("Work").map((c) => c.kind)).toContain("cornerDesk");
    expect(card("cornerDesk")).toMatchObject({ name: "Corner desk", size: "1.60 × 1.20 m", config: "standard", w: 1.6, d: 1.2 });
  });

  it("Storage has the corner wardrobe's card and Kitchen the corner counter's, each its default size (AC-09)", () => {
    expect(cards("Storage").map((c) => c.kind)).toContain("cornerWardrobe");
    expect(card("cornerWardrobe")).toMatchObject({ name: "Corner wardrobe", size: "1.50 × 1.00 m", config: "standard", w: 1.5, d: 1.0 });
    expect(cards("Kitchen").map((c) => c.kind)).toContain("cornerCounter");
    expect(card("cornerCounter")).toMatchObject({ name: "Corner counter", size: "2.40 × 1.80 m", config: "standard", w: 2.4, d: 1.8 });
  });

  it("Sit and eat ends with the corner sofa's one card at its default size: its presets aren't seat counts (AC-09)", () => {
    expect(cards("Sit and eat").map((c) => c.kind).at(-1)).toBe("cornerSofa");
    expect(count("Sit and eat", "cornerSofa")).toBe(1);
    expect(card("cornerSofa")).toMatchObject({ name: "Corner sofa", size: "2.60 × 2.00 m", config: "standard", w: 2.6, d: 2.0 });
  });

  it("the plant, cot, radiator and towel rail each have one card in their group, at their default size (AC-09)", () => {
    expect(count("Basic", "plant")).toBe(1);
    expect(card("plant")).toMatchObject({ name: "Plant", size: "Ø 0.40 m", config: "standard", w: 0.4, d: 0.4 });
    expect(count("Sleep", "cot")).toBe(1);
    expect(card("cot")).toMatchObject({ name: "Cot", size: "0.66 × 1.26 m", config: "standard", w: 0.66, d: 1.26 });
    expect(count("Basic", "radiator")).toBe(1);
    expect(card("radiator")).toMatchObject({ name: "Radiator", size: "0.80 × 0.10 m", config: "standard", w: 0.8, d: 0.1 });
    expect(count("Bathroom", "towelRail")).toBe(1);
    expect(card("towelRail")).toMatchObject({ name: "Towel rail", size: "0.50 × 0.10 m", config: "standard", w: 0.5, d: 0.1 });
  });

  it("the rug and the round rug each have one card in Basic, at their default size (AC-09)", () => {
    expect(count("Basic", "rug")).toBe(1);
    expect(card("rug")).toMatchObject({ name: "Rug", size: "2.00 × 1.40 m", config: "standard", w: 2, d: 1.4 });
    expect(count("Basic", "roundRug")).toBe(1);
    expect(card("roundRug")).toMatchObject({ name: "Round rug", size: "Ø 1.60 m", config: "standard", w: 1.6, d: 1.6 });
  });

  it("sizes go through the shown formatter (cleanup.13): 1.295 reads 1.30, a round outline of equal sides reads Ø", () => {
    expect(cardSize("bed", 1.295, 2)).toBe(`${shown(1.295)} × 2.00 m`);
    expect(cardSize("bed", 1.295, 2)).toBe("1.30 × 2.00 m");
    expect(cardSize("roundTable", 0.9, 0.9)).toBe("Ø 0.90 m");
    expect(cardSize("roundBlock", 0.9, 0.6)).toBe("0.90 × 0.60 m");
  });

  it("card look: a preset card's tile draws the preset's size (a 3-seat sofa three cushions, a 2-seat two)", () => {
    const cushions = (c: PaletteCard | undefined) => (c ? roundRects(tileLook(c).filter((p) => p.color === CANVAS_STYLE.objectDetail)).length : -1);
    expect(cushions(card("sofa", "2 seats"))).toBe(2);
    expect(cushions(card("sofa", "3 seats"))).toBe(3);
    expect(cushions(card("sofa", "4 seats"))).toBe(4);
  });
});
