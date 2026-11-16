import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command, CommandOf, NewPiece } from "../src/commands/types";
import { defaultSize } from "../src/kinds";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { place, rectDoc, withDeck } from "./helpers";

// The generic pieces command (seated.10): a list of new pieces, each placed in one or more layouts, and at most one object
// to take away, in one patch, all or none. The domain only checks the result: what the pieces are is the editor's.

const room = (): Document => rectDoc(0, 0, 8, 6);
const withLayout = (doc: Document): Document => unwrap(execute(doc, { type: "addState", opId: "n", name: "Night" })).doc;
const NIGHT = "n/s0";

const piece = (kind: string, x: number, y: number, more: Partial<NewPiece> = {}): NewPiece => ({
  kind,
  placements: [{ state: "s0", at: { x, y }, rotation: 0, deck: null }],
  ...more,
});

const cmd = (pieces: readonly NewPiece[], more: Partial<CommandOf<"placePieces">> = {}): Command => ({ type: "placePieces", opId: "b", pieces, ...more });

const ok = (doc: Document, c: Command) => unwrap(execute(doc, c));

const refusal = (doc: Document, c: Command): string => {
  const r = execute(doc, c);
  if (r.ok) throw new Error("expected a refusal");
  return r.error.message;
};

describe("placePieces", () => {
  it("places two pieces in one patch, with ids from the opId", () => {
    const { doc, patch } = ok(room(), cmd([piece("bed", 2, 3), piece("chair", 5, 3)]));
    expect(doc.objects["b/o0"]).toMatchObject({ kind: "bed", name: "Bed", ...defaultSize("bed") });
    expect(doc.objects["b/o1"]).toMatchObject({ kind: "chair", name: "Chair" });
    expect(doc.placements["b/p0"]).toMatchObject({ object: "b/o0", state: "s0", at: { x: 2, y: 3 }, rotation: 0, deck: null });
    expect(doc.placements["b/p1"]).toMatchObject({ object: "b/o1", at: { x: 5, y: 3 } });
    expect(patch.puts.map((c) => `${c.table}/${c.entity.id}`).sort()).toEqual(["objects/b/o0", "objects/b/o1", "placements/b/p0", "placements/b/p1"]);
    expect(patch.deletes).toEqual([]);
  });

  it("takes a name, sizes for each configuration and options, and stores positions as given", () => {
    const size = { w: { standard: 1.3 }, d: { standard: 0.7 }, h: { standard: 0.8 }, z: { standard: 0 } };
    const { doc } = ok(room(), cmd([piece("deskSet", 2.123456, 3, { name: "Mine", size, options: { computer: true } })]));
    expect(doc.objects["b/o0"]).toMatchObject({ name: "Mine", ...size, options: { computer: true } });
    expect(doc.placements["b/p0"]?.at.x).toBe(2.123456);
  });

  it("a piece stands in several layouts, each with its own place, configuration and sides of the kind", () => {
    const two = withLayout(room());
    const { doc } = ok(two, cmd([piece("extendingTable", 2, 3, {
      placements: [{ state: "s0", at: { x: 2, y: 3 }, rotation: 90, deck: null }, { state: NIGHT, at: { x: 5, y: 3 }, rotation: 0, config: "extended", deck: null }],
    })]));
    expect(doc.placements["b/p0"]).toMatchObject({ object: "b/o0", state: "s0", at: { x: 2, y: 3 }, rotation: 90, config: "closed" });
    expect(doc.placements["b/p1"]).toMatchObject({ object: "b/o0", state: NIGHT, at: { x: 5, y: 3 }, rotation: 0, config: "extended" });
  });

  it("stands a piece on a deck", () => {
    const decked = withDeck(room(), { id: "D", at: [2, 3], w: 3, d: 3 });
    const { doc } = ok(decked, cmd([piece("chair", 2, 3, { placements: [{ state: "s0", at: { x: 2, y: 3 }, rotation: 0, deck: "D" }] })]));
    expect(doc.placements["b/p0"]?.deck).toBe("D");
  });

  it("a piece that doesn't fit refuses the whole command, naming the reason", () => {
    const doc = room();
    const c = cmd([piece("bed", 2, 3), piece("wardrobe", 9, 3)]);
    expect(refusal(doc, c)).toMatch(/Wardrobe.*not inside a room/);
    expect(execute(doc, c).ok).toBe(false);
  });

  it("two of its own pieces that collide refuse it too", () => {
    expect(refusal(room(), cmd([piece("bed", 2, 3), piece("wardrobe", 2, 3)]))).toMatch(/overlap/i);
  });

  it("remove takes the object and every placement of it, and the pieces may stand where it stood", () => {
    const two = place(place(withLayout(room()), { object: "set", kind: "seatedDining", at: [3, 3] }), { object: "set", kind: "seatedDining", at: [5, 3], state: NIGHT });
    expect(Object.keys(two.placements)).toHaveLength(2);
    const { doc, patch } = ok(two, cmd([piece("chair", 3, 3)], { remove: "set" }));
    expect(doc.objects.set).toBeUndefined();
    expect(Object.values(doc.placements).map((p) => p.object)).toEqual(["b/o0"]);
    expect(patch.deletes.filter((c) => c.table === "objects").map((c) => c.id)).toEqual(["set"]);
    expect(patch.deletes.filter((c) => c.table === "placements")).toHaveLength(2);
  });

  it("undo's inverse patch restores the object and placements exactly", () => {
    const before = place(room(), { object: "set", kind: "seatedDining", at: [3, 3] });
    const { doc, patch } = ok(before, cmd([piece("chair", 3, 3), piece("chair", 4, 3)], { remove: "set" }));
    expect(unwrap(applyPatch(doc, invertPatch(patch)))).toEqual(before);
  });

  it("depends on what it reads, so a concurrent change to the set or the layout conflicts", () => {
    const before = place(room(), { object: "set", kind: "seatedDining", at: [3, 3] });
    const { patch } = ok(before, cmd([piece("chair", 3, 3)], { remove: "set" }));
    const deps = patch.dependencies.map((d) => `${d.table}/${d.id}`);
    expect(deps).toEqual(expect.arrayContaining(["states/s0", "objects/set"]));
    expect(deps.some((d) => d.startsWith("placements/"))).toBe(true);
  });

  it("sizes default from the kind's row, for every configuration", () => {
    const { doc } = ok(room(), cmd([piece("extendingTable", 3, 3)]));
    expect(doc.objects["b/o0"]).toMatchObject({ ...defaultSize("extendingTable") });
  });

  it("takes each option only if the kind lists it", () => {
    expect(refusal(room(), cmd([piece("sofa", 3, 3, { options: { computer: true } })]))).toBe("Invalid options");
  });

  it.each<[string, () => Command, string]>([
    ["an empty list", () => cmd([]), "Nothing to place"],
    ["an unknown kind", () => cmd([piece("spaceship", 3, 3)]), "Unknown kind"],
    ["a stair, which has its own rules", () => cmd([piece("stair", 3, 3)]), "A stair is placed on its own"],
    ["a used opId", () => cmd([piece("chair", 3, 3)], { opId: "used" }), "Operation ID already used"],
    ["a bad opId", () => cmd([piece("chair", 3, 3)], { opId: "" }), "Invalid operation ID"],
    ["a missing layout", () => cmd([piece("chair", 3, 3, { placements: [{ state: "nope", at: { x: 3, y: 3 }, rotation: 0, deck: null }] })]), "Layout not found"],
    ["a missing deck", () => cmd([piece("chair", 3, 3, { placements: [{ state: "s0", at: { x: 3, y: 3 }, rotation: 0, deck: "nope" }] })]), "Deck not found"],
    ["a missing object to remove", () => cmd([piece("chair", 3, 3)], { remove: "nope" }), "Object not found"],
    ["a piece with no placement", () => cmd([piece("chair", 3, 3, { placements: [] })]), "A piece needs a place"],
    ["one layout twice", () => cmd([piece("chair", 3, 3, { placements: [{ state: "s0", at: { x: 3, y: 3 }, rotation: 0, deck: null }, { state: "s0", at: { x: 5, y: 3 }, rotation: 0, deck: null }] })]), "Already placed in this state"],
    ["a bad position", () => cmd([piece("chair", Number.NaN, 3)]), "Invalid position"],
    ["a bad rotation", () => cmd([piece("chair", 3, 3, { placements: [{ state: "s0", at: { x: 3, y: 3 }, rotation: 0.5, deck: null }] })]), "Invalid rotation"],
    ["an unknown configuration", () => cmd([piece("chair", 3, 3, { placements: [{ state: "s0", at: { x: 3, y: 3 }, rotation: 0, config: "nope", deck: null }] })]), "Unknown configuration"],
    ["a size missing a configuration", () => cmd([piece("extendingTable", 3, 3, { size: { w: { closed: 1 }, d: { closed: 1 }, h: { closed: 0.7 }, z: { closed: 0 } } })]), "Invalid size"],
    ["a size out of range", () => cmd([piece("chair", 3, 3, { size: { w: { standard: -1 }, d: { standard: 1 }, h: { standard: 0.7 }, z: { standard: 0 } } })]), "Invalid size"],
    ["a height out of range", () => cmd([piece("chair", 3, 3, { size: { w: { standard: 1 }, d: { standard: 1 }, h: { standard: 0 }, z: { standard: 0 } } })]), "Invalid size"],
    ["an elevation that's no number", () => cmd([piece("chair", 3, 3, { size: { w: { standard: 1 }, d: { standard: 1 }, h: { standard: 0.7 }, z: { standard: Number.NaN } } })]), "Invalid size"],
    ["a name too long", () => cmd([piece("chair", 3, 3, { name: "x".repeat(500) })]), "Name too long"],
  ])("refuses %s", (_, c, message) => {
    const doc = ok(room(), { type: "placeObject", deck: null, opId: "used", state: "s0", object: { kind: "chair" }, at: { x: 7, y: 5 } }).doc;
    expect(refusal(doc, c())).toBe(message);
  });
});
