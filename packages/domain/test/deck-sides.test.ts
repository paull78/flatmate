import { describe, expect, it } from "vitest";
import { deckViews } from "../src/queries/decks";
import { sideAt, sideName } from "../src/queries/deck-sides";
import { DECK_SIDES, type DeckSide, type Document } from "../src/model";
import { loftStudio, withDeck } from "./helpers";

// Each slab edge belongs to one side of its deck's rectangle or to one hole (edges.01, .09, .11), and a side is named
// by where it faces on the plan now (edges.05, AC-07).

const withTurned = (rotation: number): Document => {
  const doc = withDeck(loftStudio(), { id: "t", name: "T", at: [5, 1.25], w: 2, d: 1.6, top: 2.15, solid: false, rotation });
  // a hole meeting T's +x side in its own frame (a notch), and one inside the loft
  const notch = { x: 0.7, y: 0 }; // in T's frame
  const r = (rotation * Math.PI) / 180;
  const at = { x: 5 + notch.x * Math.cos(r) - notch.y * Math.sin(r), y: 1.25 + notch.x * Math.sin(r) + notch.y * Math.cos(r) };
  return {
    ...doc,
    deckHoles: {
      n: { id: "n", deck: "t", at: { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 }, w: 0.6, d: 0.6, guard: { kind: "railing", height: 1 } },
      h: { id: "h", deck: "loft", at: { x: 1.3, y: 1.25 }, w: 0.6, d: 0.6, guard: { kind: "railing", height: 1 } },
    },
  };
};
const view = (doc: Document, id: string) => {
  const v = deckViews(doc).find((d) => d.id === id);
  if (!v) throw new Error(`no deck ${id}`);
  return v;
};
const owners = (doc: Document, id: string): string[] =>
  view(doc, id).edges.map((e) => ("side" in e.owner ? e.owner.side : `hole ${e.owner.hole}`)).sort();

describe("which side or hole an edge is on", () => {
  it("each edge of a plain deck belongs to its side, and a hole's to the hole", () => {
    expect(owners(withTurned(0), "loft")).toEqual(["back", "front", "hole h", "hole h", "hole h", "hole h", "left", "right"]);
  });

  it.each([0, 30, 90, 200])("a notch where a hole meets the right side leaves two right pieces and gives the inner edges to the hole (turned %i°)", (rotation) => {
    expect(owners(withTurned(rotation), "t")).toEqual(["back", "front", "hole n", "hole n", "hole n", "left", "right", "right"]);
  });

  it("an edge's side agrees with its normal in the deck's frame", () => {
    const deck = view(withTurned(30), "t");
    const r = (30 * Math.PI) / 180;
    const facing: Record<DeckSide, { x: number; y: number }> = { front: { x: 0, y: -1 }, right: { x: 1, y: 0 }, back: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
    for (const e of deck.edges) {
      if (!("side" in e.owner)) continue;
      const f = facing[e.owner.side];
      expect(e.normal.x).toBeCloseTo(f.x * Math.cos(r) - f.y * Math.sin(r), 6);
      expect(e.normal.y).toBeCloseTo(f.x * Math.sin(r) + f.y * Math.cos(r), 6);
    }
  });
});

describe("a side's name on the plan", () => {
  it("an unturned deck: front lower, right right, back upper, left left", () => {
    const deck = view(withTurned(0), "t");
    expect(DECK_SIDES.map((s) => sideName(deck, s))).toEqual(["lower", "right", "upper", "left"]);
  });

  it("the +x side is right; turned 90° so it faces +y, the same side is upper (AC-07)", () => {
    expect(sideName(view(withTurned(0), "t"), "right")).toBe("right");
    expect(sideName(view(withTurned(90), "t"), "right")).toBe("upper");
  });

  it.each([0, 30, 44, 45, 46, 89, 135, 180, 225, 270, 315, 359])("at %i° each name is used once, and sideAt undoes sideName", (rotation) => {
    const deck = view(withTurned(rotation), "t");
    const names = DECK_SIDES.map((s) => sideName(deck, s));
    expect(new Set(names).size).toBe(4);
    for (const s of DECK_SIDES) expect(sideAt(deck, sideName(deck, s))).toBe(s);
  });

  it("names the side whose outward normal is nearest that plan direction", () => {
    const deck = view(withTurned(30), "t");
    expect(sideName(deck, "right")).toBe("right"); // +x turned 30° still faces mostly +x
    expect(sideName(view(withTurned(60), "t"), "right")).toBe("upper");
  });
});
