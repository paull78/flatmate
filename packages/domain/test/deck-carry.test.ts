import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { placementRange } from "../src/queries/vertical";
import { validateDocument } from "../src/validate";
import { place, tinyHouse, withDeck } from "./helpers";

// When a deck changes (spec "When a deck changes", decks.13): a move carries the pieces standing on it, in every
// layout, by the same move; resizing, raising or lowering keeps them where they are on the plan; any of these is
// refused if a piece then breaks a rule; turning or deleting a deck is refused while a piece stands on it.
//
// The tiny house's main room: x 2.1–6.9, y 0.1–2.4. The platform (0.45): x 3.5–5.5, y 0.55–1.95, a sofa on it in Day
// (x 3.6–5.4, y 1.05–1.95) and a mattress on it in Night (x 3.8–5.2, y 0.7–1.9); a chair on the floor in Day.

const PLATFORM = { id: "plat", name: "Platform", at: [4.5, 1.25] as [number, number], w: 2, d: 1.4, top: 0.45, solid: true };
const sized = (w: number, d: number, h: number) => ({ w: { standard: w }, d: { standard: d }, h: { standard: h }, z: { standard: 0 } });

function furnished(): Document {
  let doc = withDeck(tinyHouse(), PLATFORM);
  doc = place(doc, { object: "sofa", kind: "sofa", at: [4.5, 1.95], state: "Day", size: sized(1.8, 0.9, 0.8), deck: "plat" });
  doc = place(doc, { object: "bed", kind: "bed", at: [4.5, 1.9], state: "Night", size: sized(1.4, 1.2, 0.35), deck: "plat" });
  return place(doc, { object: "chair", kind: "chair", at: [6.5, 2.4], state: "Day" });
}

const text = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const after = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};

describe("moving a deck carries its pieces (decks.13)", () => {
  it("the fixture is valid", () => {
    expect(validateDocument(furnished())).toEqual({ ok: true, value: undefined });
  });

  it("moving a platform carries its sofa in Day and its bed in Night, by the same delta; the chair on the floor stays", () => {
    const doc = furnished();
    const moved = after(doc, { type: "setDeck", deckId: "plat", at: { x: 4.8, y: 1.05 } });
    expect(moved.decks.plat?.at).toEqual({ x: 4.8, y: 1.05 });
    expect(moved.placements["sofa/Day"]?.at).toEqual({ x: 4.8, y: 1.75 });
    expect(moved.placements["bed/Night"]?.at).toEqual({ x: 4.8, y: 1.7 });
    expect(moved.placements["chair/Day"]?.at).toEqual(doc.placements["chair/Day"]?.at);
    expect(moved.placements["sofa/Day"]?.deck).toBe("plat");
  });

  it("the carried anchors are kept to the millimetre", () => {
    const moved = after(furnished(), { type: "setDeck", deckId: "plat", at: { x: 4.5 + 0.1, y: 1.25 + 0.2 } });
    expect(moved.placements["sofa/Day"]?.at).toEqual({ x: 4.6, y: 2.15 });
  });

  it("a move onto a piece on the floor is refused with the piece–deck text", () => {
    // Flush with two walls (x 4.9–6.9, y 1.0–2.4), over the chair at x 6.275–6.725, y 1.95–2.4.
    expect(text(furnished(), { type: "setDeck", deckId: "plat", at: { x: 5.9, y: 1.7 } })).toBe("Chair (0.00–0.90) and Platform (0.00–0.45) overlap in Day");
  });

  it("the patch depends on the carried placements and their objects", () => {
    const r = execute(furnished(), { type: "setDeck", deckId: "plat", at: { x: 4.8, y: 1.05 } });
    if (!r.ok) throw new Error(r.error.message);
    const deps = r.value.patch.dependencies.map((k) => `${k.table}/${k.id}`);
    expect(deps).toEqual(expect.arrayContaining(["decks/plat", "placements/sofa/Day", "placements/bed/Night", "objects/sofa", "objects/bed"]));
    expect(deps).not.toContain("placements/chair/Day");
  });
});

describe("resizing, raising and turning a deck (decks.13)", () => {
  it("resizing keeps the pieces in place, lets one overhang the platform by 0.30 m and is refused past that (steps.06)", () => {
    const doc = furnished();
    // A side grip sends the new centre and size: the right side out to 6.0, the left side fixed.
    const grown = after(doc, { type: "setDeck", deckId: "plat", at: { x: 4.75, y: 1.25 }, w: 2.5, d: 1.4 });
    expect(grown.placements["sofa/Day"]?.at).toEqual({ x: 4.5, y: 1.95 });
    expect(grown.placements["bed/Night"]?.at).toEqual({ x: 4.5, y: 1.9 });
    // The left side in to 3.7 (x 3.7–5.5): the sofa, from 3.6, overhangs it by 0.10; accepted.
    expect(text(doc, { type: "setDeck", deckId: "plat", at: { x: 4.6, y: 1.25 }, w: 1.8, d: 1.4 })).toBe("accepted");
    // The left side in to 4.0 (x 4.0–5.5): the sofa would reach 0.40 past it.
    expect(text(doc, { type: "setDeck", deckId: "plat", at: { x: 4.75, y: 1.25 }, w: 1.5, d: 1.4 })).toBe("Sofa reaches more than 0.30 m past Platform in Day");
    // A typed width keeps the centre (x 4.0–5.0): the sofa reaches 0.40 past on both sides.
    expect(text(doc, { type: "setDeck", deckId: "plat", w: 1 })).toBe("Sofa reaches more than 0.30 m past Platform in Day");
  });

  it("raising a loft raises the bed and is refused when the bed passes the ceiling, with the bed's ceiling text", () => {
    let doc = withDeck(tinyHouse(), { id: "loft", name: "Loft", at: [4.5, 1.6], w: 2.4, d: 1.6, top: 2.15, solid: false });
    doc = place(doc, { object: "bed", kind: "bed", at: [4.5, 2.4], state: "Night", size: sized(1.4, 1.2, 0.3), deck: "loft" });
    const raised = after(doc, { type: "setDeck", deckId: "loft", top: 2.2 });
    expect(raised.placements["bed/Night"]?.at).toEqual({ x: 4.5, y: 2.4 });
    expect(placementRange(raised, "bed/Night")).toEqual({ bottom: 2.2, top: 2.2 + 0.3 });
    expect(text(doc, { type: "setDeck", deckId: "loft", top: 2.3 })).toBe("Bed reaches 2.60 m in Night; the ceiling is 2.50 m");
  });

  it("turning a deck with a piece on it is refused with \"carries\"; so is a move that also turns it", () => {
    expect(text(furnished(), { type: "setDeck", deckId: "plat", rotation: 90 })).toBe("Platform carries Sofa in Day; move it off first");
    expect(text(furnished(), { type: "setDeck", deckId: "plat", at: { x: 4.8, y: 1.25 }, rotation: 180 })).toBe("Platform carries Sofa in Day; move it off first");
    // The same rotation again is no turn.
    expect(text(furnished(), { type: "setDeck", deckId: "plat", rotation: 360 })).toBe("accepted");
  });

  it("deleting a deck with a piece on it is refused", () => {
    expect(text(furnished(), { type: "deleteEntities", ids: [{ table: "decks", id: "plat" }] })).toBe("Platform carries Sofa in Day; move it off first");
  });

  it("the refusal names a deck whose name is only spaces \"Deck\", as deckLabel does (spec: heights-decks)", () => {
    const doc = furnished();
    const blank = { ...doc, decks: { ...doc.decks, plat: { ...doc.decks.plat!, name: "   " } } };
    expect(text(blank, { type: "deleteEntities", ids: [{ table: "decks", id: "plat" }] })).toBe("Deck carries Sofa in Day; move it off first");
  });

  it("an empty deck turns and deletes", () => {
    const empty = withDeck(tinyHouse(), PLATFORM);
    expect(after(empty, { type: "setDeck", deckId: "plat", rotation: 90 }).decks.plat?.rotation).toBe(90);
    expect(after(empty, { type: "deleteEntities", ids: [{ table: "decks", id: "plat" }] }).decks.plat).toBeUndefined();
  });
});
