import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { deckFrame, deckView } from "../src/queries/decks";
import { LOFT, NOTCH, cabinDoc, notchedCabin, run } from "./cabin";

// A hole's commands and own rules (stairwell.04, .14, .20; AC-01): addDeckHole and setDeckHole take plan coordinates,
// I22 refuses a hole outside its deck's rectangle, under 0.30 a side or overlapping another of its deck.

const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const hole = (opId: string, at: { x: number; y: number }, w: number, d: number): Command => ({ type: "addDeckHole", opId, deck: LOFT, at, w, d });

describe("cutting a hole", () => {
  it("the notch is cut as notch/h0, its row in plan coordinates, to the millimetre", () => {
    const doc = run(cabinDoc(), hole("notch", { x: 1.7500004, y: 2.575 }, 0.7, 0.65));
    expect(doc.deckHoles).toEqual({ "notch/h0": { id: "notch/h0", deck: LOFT, at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65, guard: { kind: "railing", height: 1 } } });
    expect(deckView(doc, LOFT)?.holes.map((h) => h.id)).toEqual(["notch/h0"]);
  });

  it("on a deck turned by 30° the corners lie where asked, the sides along the deck's axes", () => {
    const turned = run(cabinDoc(), { type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] }, { type: "addDeck", opId: "t", preset: "platform", at: { x: 2, y: 1.5 }, w: 1.2, d: 1.2, rotation: 30, top: 0.45 });
    const doc = run(turned, { type: "addDeckHole", opId: "h", deck: "t/k0", at: { x: 2, y: 1.5 }, w: 0.4, d: 0.3 });
    const view = deckView(doc, "t/k0");
    const frame = deckFrame({ at: { x: 2, y: 1.5 }, rotation: 30 });
    const corners = (view?.holes[0]?.ring ?? []).map((p) => frame.toDeck(p)).map((q) => [Math.round(q.x * 1e9) / 1e9 + 0, Math.round(q.y * 1e9) / 1e9 + 0]);
    expect(corners).toEqual([[-0.2, -0.15], [0.2, -0.15], [0.2, 0.15], [-0.2, 0.15]]);
  });

  it("an unknown deck, a bad size or a reused operation ID is refused", () => {
    expect(refusal(cabinDoc(), { type: "addDeckHole", opId: "h", deck: "none/k0", at: { x: 1, y: 1 }, w: 0.5, d: 0.5 })).toBe("Deck not found");
    expect(refusal(cabinDoc(), hole("h", { x: 1, y: 1 }, Number.NaN, 0.5))).toBe("Invalid size");
    expect(refusal(notchedCabin(), hole("notch", { x: 1, y: 1 }, 0.5, 0.5))).toBe("Operation ID already used");
  });
});

describe("a hole's own rules (I22, AC-01)", () => {
  it("a hole past the deck's edge is refused", () => {
    expect(refusal(cabinDoc(), hole("h", { x: 2.0, y: 1.5 }, 0.4, 0.5))).toBe("A hole in Loft lies inside it");
  });

  it("a hole 0.29 wide is refused, 0.30 is cut", () => {
    expect(refusal(cabinDoc(), hole("h", { x: 1, y: 1.5 }, 0.29, 0.5))).toBe("A hole is at least 0.30 × 0.30 m");
    expect(refusal(cabinDoc(), hole("h", { x: 1, y: 1.5 }, 0.3, 0.3))).toBe("accepted");
  });

  it("a hole overlapping another of its deck is refused", () => {
    expect(refusal(notchedCabin(), hole("h", { x: 1.6, y: 2.3 }, 0.4, 0.4))).toBe("Two holes in Loft overlap");
  });

  it("a hole touching another, a notch reaching the edge and a hole as wide as the deck are cut", () => {
    expect(refusal(notchedCabin(), hole("h", { x: 1.2, y: 2.575 }, 0.4, 0.65))).toBe("accepted"); // touching the notch at x 1.40
    expect(refusal(cabinDoc(), hole("h", { x: 1.1, y: 1.5 }, 2.0, 0.4))).toBe("accepted"); // as wide as the deck: two slabs
  });
});

describe("changing a hole", () => {
  it("setDeckHole moves and resizes; an unknown hole is refused", () => {
    const doc = run(notchedCabin(), { type: "setDeckHole", holeId: "notch/h0", at: { x: 1.8, y: 2.6 }, w: 0.6, d: 0.6, guard: { kind: "railing", height: 1 } });
    expect(doc.deckHoles["notch/h0"]).toEqual({ id: "notch/h0", deck: LOFT, at: { x: 1.8, y: 2.6 }, w: 0.6, d: 0.6, guard: { kind: "railing", height: 1 } });
    expect(refusal(notchedCabin(), { type: "setDeckHole", holeId: "x/h0", w: 0.5 })).toBe("Hole not found");
    expect(refusal(notchedCabin(), { type: "setDeckHole", holeId: "notch/h0", w: 0.2 })).toBe("A hole is at least 0.30 × 0.30 m");
  });

  it("deleting a hole removes it", () => {
    expect(run(notchedCabin(), { type: "deleteEntities", ids: [{ table: "deckHoles", id: "notch/h0" }] }).deckHoles).toEqual({});
  });

  void NOTCH;
});
