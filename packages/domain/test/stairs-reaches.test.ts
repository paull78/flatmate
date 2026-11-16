import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { stairGeometry, stairRuleOf } from "../src";
import type { Document, LayoutObject } from "../src/model";
import { validateDocument } from "../src/validate";
import { place, tinyHouse, withDeck } from "./helpers";

// A stair reaches a deck (stairs.10, .19, stairdraw.08): the link is set explicitly (`reaches`, setStairReaches,
// placeStair), its height is the deck's top less its surface's, deck edits carry it, and it changes only when set again,
// when cleared, or when the deck goes. Touching a deck's edge links nothing (AC-09).

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/** The decks' tiny house under a 3.20 ceiling, with a hollow loft L over x 4.9–6.9 at +2.15 and a platform P. */
function house(): Document {
  let doc = run(tinyHouse(), { type: "setCeiling", height: 3.2 });
  doc = withDeck(doc, { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top: 2.15, solid: false });
  return withDeck(doc, { id: "P", name: "Platform", at: [3, 2.05], w: 1.2, d: 0.7, top: 0.45, solid: true });
}

/** A storage stair rising toward +x (rotation 270: its front faces −x) with its back edge's middle at (x, y). */
const placeAt = (opId: string, x: number, y: number, extra: Partial<Extract<Command, { type: "placeObject" }>> = {}): Command => ({
  type: "placeObject", opId, state: "s0", object: { kind: "storageStair" }, at: { x, y }, rotation: 270, deck: null, ...extra,
});
const stair = (doc: Document, id = "st/o0"): LayoutObject => {
  const o = doc.objects[id];
  if (!o) throw new Error(`no ${id}`);
  return o;
};
const risers = (o: LayoutObject): number => {
  const rule = stairRuleOf(o.kind);
  if (!rule) throw new Error("not a stair");
  return stairGeometry(rule, o.w.standard ?? 0, o.d.standard ?? 0, o.h.standard ?? 0, null).risers;
};

describe("reaching a deck", () => {
  it("placeStair on the loft's edge makes a storage stair that reaches the loft at 2.15 (10 risers)", () => {
    const doc = run(house(), { type: "placeStair", opId: "st", state: "s0", kind: "storageStair", deck: "L", at: { x: 4.9, y: 0.5 }, shape: "straight", surface: null });
    expect(stair(doc, "st/s0/o0")).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
    expect(risers(stair(doc, "st/s0/o0"))).toBe(10);
  });

  it("placed with reaches L, its back on the loft's edge, it reaches the loft at 2.15 (10 risers)", () => {
    const doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    expect(stair(doc)).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
    expect(risers(stair(doc))).toBe(10);
  });

  it("placing a stair with its back on the loft's edge and no reaches reaches nothing (AC-09)", () => {
    const doc = run(house(), placeAt("st", 4.9, 0.5));
    expect(stair(doc)).toMatchObject({ reaches: null, h: { standard: 2.15 } });
  });

  it("placed away from every deck, it reaches nothing and keeps its default height", () => {
    const doc = run(house(), placeAt("st", 4.5, 0.5));
    expect(stair(doc)).toMatchObject({ reaches: null, h: { standard: 2.15 } });
  });

  it("raising the loft to 2.40 raises the stair: 11 risers of 0.218 (AC-06)", () => {
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    doc = run(doc, { type: "setDeck", deckId: "L", top: 2.4 });
    expect(stair(doc).h.standard).toBe(2.4);
    expect(risers(stair(doc))).toBe(11);
  });

  it("moved 0.5 m away, it keeps the link and its height (stairs.19)", () => {
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 4.4, y: 0.5 }, rotation: 270 });
    expect(stair(doc)).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
  });

  it("moving a stair so its back touches another deck's edge keeps what it reaches (AC-09)", () => {
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    // The platform's right edge is x = 3.6, y 1.7–2.4; a stair rising toward −x (rotation 90) with its back edge there.
    doc = run(doc, { type: "setObjectSize", objectId: "st/o0", w: 0.6, d: { standard: 0.9 } });
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 3.6, y: 2.05 }, rotation: 90 });
    expect(stair(doc)).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
    // An unlinked stair moved there stays unlinked, at its own height.
    doc = run(doc, { type: "setStairReaches", objectId: "st/o0", deck: null });
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 4.5, y: 0.5 }, rotation: 270 });
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 3.6, y: 2.05 }, rotation: 90 });
    expect(stair(doc)).toMatchObject({ reaches: null, h: { standard: 2.15 } });
  });

  it("an explicit reaches on movePlacement links, and null unlinks keeping the height", () => {
    let doc = run(house(), placeAt("st", 4.5, 0.5));
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 4.4, y: 0.5 }, rotation: 270, reaches: "P" });
    expect(stair(doc)).toMatchObject({ reaches: "P", h: { standard: 0.45 } });
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 4.4, y: 0.5 }, rotation: 270, reaches: null });
    expect(stair(doc)).toMatchObject({ reaches: null, h: { standard: 0.45 } });
  });

  it("rotating a linked stair keeps its link and rise", () => {
    // Turned about, its front facing +x: x 2.9–4.89, its back on no deck.
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 2.9, y: 0.5 }, rotation: 90 });
    expect(doc.placements["st/p0"]?.rotation).toBe(90);
    expect(stair(doc)).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
    expect(risers(stair(doc))).toBe(10);
    // Shortened and turned to 0° with its back on the platform's bottom edge (y 1.7): it still reaches the loft.
    doc = run(doc, { type: "setObjectSize", objectId: "st/o0", w: 0.6, d: { standard: 0.9 } });
    doc = run(doc, { type: "movePlacement", placementId: "st/p0", at: { x: 3, y: 1.7 }, rotation: 0 });
    expect(stair(doc)).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
  });

  it("movePlacements and nudge onto an edge never link", () => {
    let doc = run(house(), placeAt("st", 4.85, 0.5));
    // A nudge is a movePlacements of the selection: 5 cm toward +x puts the back edge on the loft's edge.
    doc = run(doc, { type: "movePlacements", moves: [{ placementId: "st/p0", at: { x: 4.9, y: 0.5 }, rotation: 270 }] });
    expect(doc.placements["st/p0"]?.at).toEqual({ x: 4.9, y: 0.5 });
    expect(stair(doc)).toMatchObject({ reaches: null, h: { standard: 2.15 } });
    // Linked to the platform, it stays linked to the platform there.
    doc = run(doc, { type: "setStairReaches", objectId: "st/o0", deck: "P" });
    doc = run(doc, { type: "movePlacements", moves: [{ placementId: "st/p0", at: { x: 4.85, y: 0.5 }, rotation: 270 }] });
    doc = run(doc, { type: "movePlacements", moves: [{ placementId: "st/p0", at: { x: 4.9, y: 0.5 }, rotation: 270 }] });
    expect(stair(doc)).toMatchObject({ reaches: "P", h: { standard: 0.45 } });
  });

  it("setStairReaches null clears the link and keeps the height; a deck id links it", () => {
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    doc = run(doc, { type: "setStairReaches", objectId: "st/o0", deck: null });
    expect(stair(doc)).toMatchObject({ reaches: null, h: { standard: 2.15 } });
    doc = run(doc, { type: "setStairReaches", objectId: "st/o0", deck: "P" });
    expect(stair(doc)).toMatchObject({ reaches: "P", h: { standard: 0.45 } });
  });

  it("an explicit reaches on placeObject links a stair that touches nothing", () => {
    const doc = run(house(), placeAt("st", 4.5, 0.5, { reaches: "L" }));
    expect(stair(doc)).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
  });

  it("only a stair reaches a deck", () => {
    const cmd: Command = { type: "placeObject", opId: "b", state: "s0", object: { kind: "block" }, at: { x: 4, y: 1 }, deck: null, reaches: "L" };
    expect(refusal(house(), cmd)).toBe("Only a stair reaches a deck");
    expect(refusal(house(), placeAt("st", 4.5, 0.5, { reaches: "nope" }))).toBe("Deck not found");
  });

  it("deleting the deck still clears reaches and startsAt; raising it still rewrites the rise (AC-09)", () => {
    // Reaching the platform and, from a direct fixture (nothing sets startsAt before the L), starting at it too is
    // refused by I19; so the stair reaches the loft and starts at the platform, its top above the platform's.
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "P" }));
    doc = run(doc, { type: "setDeck", deckId: "P", top: 0.6 });
    expect(stair(doc)).toMatchObject({ reaches: "P", h: { standard: 0.6 } });
    doc = run(doc, { type: "setStairReaches", objectId: "st/o0", deck: "L" });
    doc = { ...doc, objects: { ...doc.objects, "st/o0": { ...stair(doc), startsAt: "P" } } };
    expect(validateDocument(doc).ok).toBe(true);
    const noPlatform = run(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "P" }] });
    expect(stair(noPlatform)).toMatchObject({ reaches: "L", startsAt: null, h: { standard: 2.15 } });
    const noLoft = run(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "L" }] });
    expect(stair(noLoft)).toMatchObject({ reaches: null, startsAt: "P", h: { standard: 2.15 } });
  });

  it("deleting the loft clears the link and keeps 2.15 (AC-06)", () => {
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    doc = run(doc, { type: "deleteEntities", ids: [{ table: "decks", id: "L" }] });
    expect(stair(doc)).toMatchObject({ reaches: null, h: { standard: 2.15 } });
  });

  it("a stair standing on the platform and reaching the loft rises 1.70; raising the platform to 0.60 makes it 1.55", () => {
    // The platform moved under the loft's left edge: x 3.7–4.9, y 0.1–0.8; a short stair on it, back edge on x = 4.9.
    let doc = run(house(), { type: "setDeck", deckId: "P", at: { x: 4.3, y: 0.45 } });
    doc = run(doc, placeAt("st", 4.9, 0.45, { deck: "P", object: { kind: "storageStair", size: { w: 0.6, d: 1.1 } }, reaches: "L" }));
    expect(stair(doc)).toMatchObject({ reaches: "L", h: { standard: 1.7 } });
    doc = run(doc, { type: "setDeck", deckId: "P", top: 0.6 });
    expect(stair(doc).h.standard).toBe(1.55);
  });

  it("raising the loft is refused when the stair's higher pitch line would hit a wall cabinet over it", () => {
    let doc = run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
    doc = place(doc, { object: "wc", kind: "wallCabinet", at: [4.6, 0.65], rotation: 0, size: { w: { standard: 0.6 }, d: { standard: 0.35 }, h: { standard: 0.6 }, z: { standard: 2.1 } } });
    expect(refusal(doc, { type: "setDeck", deckId: "L", top: 2.4 })).toContain("Storage stair");
  });
});

describe("the reaches invariant", () => {
  const linked = (): Document => run(house(), placeAt("st", 4.9, 0.5, { reaches: "L" }));
  const withStair = (doc: Document, patch: Partial<LayoutObject>): Document => ({ ...doc, objects: { ...doc.objects, "st/o0": { ...stair(doc), ...patch } } });

  it("holds for a linked stair", () => expect(validateDocument(linked()).ok).toBe(true));
  it("refuses reaches to a missing deck", () => expect(validateDocument(withStair(linked(), { reaches: "gone" })).ok).toBe(false));
  it("refuses a stale height", () => expect(validateDocument(withStair(linked(), { h: { standard: 2 } })).ok).toBe(false));
  it("refuses reaches on furniture", () => {
    const doc = place(house(), { object: "b", kind: "block", at: [4, 1] });
    const b = doc.objects.b;
    expect(validateDocument({ ...doc, objects: { ...doc.objects, b: { ...(b ?? stair(linked())), reaches: "L" } } }).ok).toBe(false);
  });
});
