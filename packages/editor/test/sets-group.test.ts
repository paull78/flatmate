import { describe, expect, it } from "vitest";
import { isFurnitureSet } from "../src/furniture-sets";
import { PALETTE, PALETTE_KINDS, tileLook } from "../src/view/palette";
import { searchPalette } from "../src/view/palette-search";
import { FakeShell } from "./fake-shell";
import { roomDoc } from "./builders";

// The Sets group (seated.06, AC-11): two cards, drawn from their pieces, found by quick add.

describe("the Sets group", () => {
  const group = PALETTE.find((g) => g.group === "Sets");

  it("has its two cards, named and sized by their whole box", () => {
    expect(group?.cards.map((c) => [c.kind, c.name, c.size])).toEqual([
      ["bedAndNightstands", "Bed and nightstands", "2.60 × 2.10 m"],
      ["sofaAndRug", "Sofa and rug", "2.10 × 2.35 m"],
    ]);
    expect(PALETTE_KINDS.find((g) => g.group === "Sets")?.cards).toHaveLength(2);
  });

  it("keeps tables out of it, and sits before Basic", () => {
    expect(group?.cards.some((c) => c.kind.startsWith("seated"))).toBe(false);
    const order = PALETTE.map((g) => g.group);
    expect(order.indexOf("Sets")).toBe(order.indexOf("Basic") - 1);
  });

  it("each card's symbol shows all its pieces, inside the card's box", () => {
    for (const card of group?.cards ?? []) {
      const prims = tileLook(card);
      const fills = prims.filter((p) => p.kind === "polygon");
      expect(fills.length, card.kind).toBe(card.kind === "bedAndNightstands" ? 3 : 3);
      for (const f of fills) {
        for (const q of f.kind === "polygon" ? f.points : []) {
          expect(Math.abs(q.x), card.kind).toBeLessThanOrEqual(card.w / 2 + 1e-9);
          expect(q.y, card.kind).toBeLessThanOrEqual(1e-9);
          expect(q.y, card.kind).toBeGreaterThanOrEqual(-card.d - 1e-9);
        }
      }
    }
  });

  it("isFurnitureSet knows its ids, and nothing a plain object inherits", () => {
    expect(isFurnitureSet("sofaAndRug")).toBe(true);
    expect(isFurnitureSet("sofa")).toBe(false);
    expect(isFurnitureSet("constructor")).toBe(false);
  });

  it("the armed set's card is what the view reports as armed", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickSet", set: "sofaAndRug" });
    expect(shell.view().objectKind).toBe("sofaAndRug");
    shell.ui({ type: "pickKind", kind: "bed" });
    expect(shell.view().objectKind).toBe("bed");
  });
});

describe("quick add finds the sets", () => {
  const first = (q: string) => searchPalette(q)[0]?.kind;

  it.each([["bed and nightstands", "bedAndNightstands"], ["sofa and rug", "sofaAndRug"], ["bedroom set", "bedAndNightstands"], ["living room set", "sofaAndRug"]])("%s lists %s first", (q, kind) => {
    expect(first(q)).toBe(kind);
  });

  it("a plain word still finds the plain piece first", () => {
    expect(first("bed")).toBe("bed");
    expect(first("sofa")).toBe("sofaBed"); // today's order: Sleep comes before Sit and eat
    expect(first("rug")).toBe("rug");
  });
});
