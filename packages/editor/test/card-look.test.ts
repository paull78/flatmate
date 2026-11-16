import { describe, expect, it } from "vitest";
import { OBJECT_KINDS } from "@fm/domain";
import { CARD_STYLE, cardPieceColour } from "../src/view/card-look";
import { onFinishes, pieceFill, CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import { STYLE_3D } from "../src/view3d/style";

// A card's plan: each kind in a colour from the 3D view's materials (AC-03).

const { fabric, linen, metal, ceramic } = STYLE_3D.slots;
const WOOD = "#b98f63";

describe("a kind's colour on a card", () => {
  it("every kind has one, or is a rug", () => {
    for (const k of OBJECT_KINDS) {
      const colour = cardPieceColour(k.id);
      if (k.id === "rug" || k.id === "roundRug") expect(colour, k.id).toBeNull();
      else expect(colour, k.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("an unknown kind is plain", () => {
    expect(cardPieceColour("not-a-kind")).toBe("#e0e0de");
  });

  it.each([
    ["sofa", fabric.top],
    ["armchair", fabric.top],
    ["bed", linen.top],
    ["mattress", linen.top],
    ["extendingTable", WOOD],
    ["fridge", metal.top],
    ["toilet", ceramic.top],
    ["showerTray", ceramic.top],
  ])("%s is the material you see from above", (kind, colour) => {
    expect(cardPieceColour(kind)).toBe(colour);
  });
});

describe("the card's style", () => {
  it("colours a piece, over a finish too", () => {
    expect(pieceFill(CARD_STYLE, "sofa")).toBe(fabric.top);
    expect(pieceFill(onFinishes(CARD_STYLE), "sofa")).toBe(fabric.top);
  });

  it("keeps a rug's fill", () => {
    expect(pieceFill(CARD_STYLE, "rug")).toBe(CARD_STYLE.rugFill);
  });

  it("has lines wide enough for a card, over a finish too", () => {
    expect(onFinishes(CARD_STYLE).objectLineWidth).toBeGreaterThan(1);
    expect(CARD_STYLE.objectLineWidth).toBeGreaterThan(PRESENTATION_STYLE.objectLineWidth * 5);
  });

  it("leaves the other styles' fills alone", () => {
    for (const style of [PRESENTATION_STYLE, CANVAS_STYLE, LOOK_STYLE]) {
      expect(pieceFill(style, "sofa")).toBe(style.objectFill);
      expect(pieceFill(onFinishes(style), "sofa")).toBe(onFinishes(style).objectFill);
      expect(pieceFill(style, "rug")).toBe(style.rugFill);
    }
  });
});
