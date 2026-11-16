import { describe, expect, it } from "vitest";
import { execute, unwrap, validateDocument, type Command, type Document } from "@fm/domain";
import { objectLook } from "../src/view/furniture";
import { PALETTE_KINDS } from "../src/view/palette";
import type { Primitive } from "../src/view/scene-types";
import { view3dItems } from "../src/view3d/items";
import type { PieceItem } from "../src/view3d/types";
import { roomDoc } from "./builders";

// The wood stove (spec pieces, step 05): its symbol (pieces.07), its palette place, and its flue's top on its 3D item,
// from the ceiling or a deck's underside over it, never a solid (pieces.04, .08). roomDoc: 6 × 4, ceiling 2.50.

const D = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 3, detail: "D" }).filter((p) => p.color === "D");
const fullArcs = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "arc" && Math.abs(p.to - p.from - 2 * Math.PI) < 1e-12);
const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const stove: Command = { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "woodStove" }, at: { x: 3, y: 2 } };
const loftOver: Command = { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 }, w: 2, d: 2 };
const stoveItem = (doc: Document): PieceItem | undefined =>
  view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece" && i.objectKind === "woodStove");

describe("the wood stove (AC-03, AC-05)", () => {
  it("draws its stove's square toward the back, the glass door's line and the flue's collar", () => {
    const ps = D("woodStove", 0.75, 0.75);
    expect(fullArcs(ps)).toHaveLength(1);
    expect(ps.filter((p) => p.kind === "segment").length).toBeGreaterThanOrEqual(5); // the square's four sides and the door
  });

  it("Basic gains it after the radiator, before the electric fireplace (AC-02)", () => {
    const basic = [...new Set(PALETTE_KINDS.find((g) => g.group === "Basic")?.cards.map((c) => c.kind))];
    expect(basic).toEqual(["block", "roundBlock", "cornerBlock", "plant", "palm", "fern", "rosette", "radiator", "wheelWell", "beam", "woodStove", "electricFireplace", "wallUnit", "rug", "roundRug", "picture", "mirror", "clock"]);
  });

  it("its flue runs to the ceiling in an open room, and to a loft's underside over it", () => {
    expect(stoveItem(ok(roomDoc(), stove))?.flueTop).toBe(2.5);
    const under = stoveItem(ok(roomDoc(), stove, loftOver));
    expect(under?.flueTop).toBeCloseTo(2.15 - 0.12, 9); // the loft's slab bottom
  });

  it("only a stove's item carries a flue top", () => {
    const doc = ok(roomDoc(), stove, { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "storageChest" }, at: { x: 1, y: 1 } });
    const pieces = view3dItems(doc, "s0", null, new Set(), false).filter((i): i is PieceItem => i.item === "piece");
    expect(pieces.filter((p) => p.flueTop !== undefined).map((p) => p.objectKind)).toEqual(["woodStove"]);
  });

  it("a loft over the stove is not refused because of the flue: the flue is drawn, not a solid", () => {
    expect(validateDocument(ok(roomDoc(), stove, loftOver)).ok).toBe(true);
  });
});
