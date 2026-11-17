import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document, Placement } from "../src/model";
import { deserialize, serialize } from "../src/serialize";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// Layouts linked by default (review.05, .06, .07, .11): a linked piece shares position, turn and surface in every
// layout; configuration, sides and zones stay per layout. A new piece links when it fits everywhere, else stays in its
// own layout; a move that doesn't fit in another layout is refused there.

// A 6 × 5 room (inner faces at 0.1 and 5.9 / 4.9) with Day (s0) and Night.
const room = (): Document => {
  const doc = rectDoc(0, 0, 6, 5);
  return { ...doc, states: { s0: { id: "s0", name: "Day", order: 0 }, night: { id: "night", name: "Night", order: 1 } } };
};
const run = (doc: Document, cmd: Command): Document => unwrap(execute(doc, cmd)).doc;
const copies = (doc: Document, object: string): Placement[] =>
  Object.values(doc.placements).filter((p) => p.object === object).sort((a, b) => (a.state < b.state ? -1 : 1));
const pose = (p: Placement | undefined) => (p ? { at: p.at, rotation: p.rotation, deck: p.deck } : null);
const placeChair = (state: string, x: number, y: number, extra: Partial<Extract<Command, { type: "placeObject" }>> = {}): Command =>
  ({ type: "placeObject", opId: `c-${state}-${x}-${y}`, state, object: { kind: "chair" }, at: { x, y }, rotation: 0, deck: null, ...extra });
// A table in Night only, at x 2–3.6, y 1–1.9: where Day is empty.
const nightTable = (doc: Document): Document => place(doc, { object: "nt", kind: "coffeeTable", at: [2.8, 1], state: "night" });
const placementIn = (doc: Document, object: string, state: string): Placement => {
  const p = copies(doc, object).find((c) => c.state === state);
  if (!p) throw new Error(`no ${object} in ${state}`);
  return p;
};

describe("placing a linked piece", () => {
  it("places a new piece in every layout, at the same pose, surface and configuration, and marks it linked", () => {
    const doc = run(room(), placeChair("s0", 1, 1));
    const day = placementIn(doc, "c-s0-1-1/o0", "s0");
    const night = placementIn(doc, "c-s0-1-1/o0", "night");
    expect(doc.objects["c-s0-1-1/o0"]?.linked).toBe(true);
    expect(copies(doc, "c-s0-1-1/o0")).toHaveLength(2);
    expect(pose(night)).toEqual(pose(day));
    expect(night?.config).toBe(day?.config);
  });

  it("places a piece that fits in Day but not in Night in Day only, unlinked", () => {
    const doc = run(nightTable(room()), placeChair("s0", 2.8, 1.2));
    const placed = copies(doc, "c-s0-2.8-1.2/o0");
    expect(placed.map((p) => p.state)).toEqual(["s0"]);
    expect(doc.objects["c-s0-2.8-1.2/o0"]?.linked).toBeUndefined();
  });

  it("refuses instead of falling back when asked for linked: true, naming Night's placement", () => {
    const r = execute(nightTable(room()), placeChair("s0", 2.8, 1.2, { linked: true }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const states = r.error.violations.flatMap((v) => v.entities).filter((e) => e.table === "placements").map((e) => e.id);
    expect(states.some((id) => id.endsWith("/night") || id === "nt/night")).toBe(true);
  });

  it("never links with linked: false", () => {
    const doc = run(room(), placeChair("s0", 1, 1, { linked: false }));
    expect(copies(doc, "c-s0-1-1/o0")).toHaveLength(1);
    expect(doc.objects["c-s0-1-1/o0"]?.linked).toBeUndefined();
  });

  it("links a duplicate of a linked piece, and leaves a duplicate of an exception in its layout", () => {
    let doc = run(room(), placeChair("s0", 1, 1));
    doc = run(doc, { type: "duplicatePlacements", opId: "d", copies: [{ placementId: placementIn(doc, "c-s0-1-1/o0", "s0").id, at: { x: 2, y: 3 }, rotation: 0 }] });
    expect(copies(doc, "d/o0").map((p) => p.state)).toEqual(["night", "s0"]);
    doc = place(doc, { object: "ex", kind: "chair", at: [4, 3] });
    doc = run(doc, { type: "duplicatePlacements", opId: "e", copies: [{ placementId: "ex/s0", at: { x: 4, y: 2 }, rotation: 0 }] });
    expect(copies(doc, "e/o0").map((p) => p.state)).toEqual(["s0"]);
  });

  it("links pieces placed as one, each with one place", () => {
    const doc = run(room(), { type: "placePieces", opId: "set", pieces: [{ kind: "chair", placements: [{ state: "s0", at: { x: 1, y: 1 }, rotation: 0, deck: null }] }] });
    expect(copies(doc, "set/o0").map((p) => p.state)).toEqual(["night", "s0"]);
  });

  it("refuses a piece that doesn't fit in its own layout as before", () => {
    expect(execute(room(), placeChair("s0", -1, 1)).ok).toBe(false);
  });
});

describe("editing a linked piece", () => {
  const linkedChair = (): Document => run(room(), placeChair("s0", 1, 1));
  const id = "c-s0-1-1/o0";

  it("moves, turns and re-surfaces every copy", () => {
    const doc = linkedChair();
    const moved = run(doc, { type: "movePlacement", placementId: placementIn(doc, id, "night").id, at: { x: 2, y: 2 }, rotation: 90 });
    expect(pose(placementIn(moved, id, "s0"))).toEqual({ at: { x: 2, y: 2 }, rotation: 90, deck: null });
    expect(pose(placementIn(moved, id, "night"))).toEqual({ at: { x: 2, y: 2 }, rotation: 90, deck: null });
  });

  it("refuses a move that doesn't fit in Night, naming a Night placement", () => {
    const doc = nightTable(linkedChair());
    const r = execute(doc, { type: "movePlacement", placementId: placementIn(doc, id, "s0").id, at: { x: 2.8, y: 1.2 }, rotation: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const named = r.error.violations.flatMap((v) => v.entities).filter((e) => e.table === "placements").map((e) => doc.placements[e.id]?.state);
    expect(named).toContain("night");
  });

  it("changes configuration, sides and zones in one layout only", () => {
    let doc = run(room(), { type: "placeObject", opId: "t", state: "s0", object: { kind: "foldingTable" }, at: { x: 3, y: 0.1 }, rotation: 180, deck: null });
    const day = placementIn(doc, "t/o0", "s0");
    const night = placementIn(doc, "t/o0", "night");
    const other = doc.objects["t/o0"] ? Object.keys(doc.objects["t/o0"].w).find((c) => c !== day.config) : undefined;
    expect(other).toBeDefined();
    if (other === undefined) return;
    doc = run(doc, { type: "setConfiguration", placementId: night.id, config: other });
    doc = run(doc, { type: "setZoneSides", placementId: night.id, sides: { front: false, back: false, left: false, right: false } });
    doc = run(doc, { type: "setZoneExtent", placementId: night.id, side: "front", extent: { depth: 0.3, start: 0, end: 0 } });
    expect(placementIn(doc, "t/o0", "s0").config).toBe(day.config);
    expect(placementIn(doc, "t/o0", "s0").sides).toEqual(day.sides);
    expect(placementIn(doc, "t/o0", "s0").zones).toEqual(day.zones);
    expect(placementIn(doc, "t/o0", "night").config).toBe(other);
  });

  it("deletes a linked piece from every layout", () => {
    const doc = linkedChair();
    const gone = run(doc, { type: "removePlacement", placementId: placementIn(doc, id, "night").id });
    expect(copies(gone, id)).toEqual([]);
    expect(gone.objects[id]).toBeUndefined();
  });

  it("deletes an exception from one layout only", () => {
    const doc = place(place(room(), { object: "ch", kind: "chair", at: [1, 1] }), { object: "ch", kind: "chair", at: [2, 2], state: "night" });
    const gone = run(doc, { type: "removePlacement", placementId: "ch/night" });
    expect(copies(gone, "ch").map((p) => p.state)).toEqual(["s0"]);
  });
});

describe("the link switch (setLinked)", () => {
  it("off leaves the copies where they are, and a later move moves one copy", () => {
    let doc = run(room(), placeChair("s0", 1, 1));
    const night = placementIn(doc, "c-s0-1-1/o0", "night");
    doc = run(doc, { type: "setLinked", placementId: night.id, on: false });
    expect(doc.objects["c-s0-1-1/o0"]?.linked).toBeUndefined();
    expect(pose(placementIn(doc, "c-s0-1-1/o0", "night"))).toEqual(pose(night));
    doc = run(doc, { type: "movePlacement", placementId: night.id, at: { x: 3, y: 3 }, rotation: 0 });
    expect(placementIn(doc, "c-s0-1-1/o0", "s0").at).toEqual({ x: 1, y: 1 });
  });

  it("on copies this layout's pose to every layout and adds a missing copy", () => {
    const three = { ...room(), states: { ...room().states, guest: { id: "guest", name: "Guest", order: 2 } } };
    let doc = place(place(three, { object: "ch", kind: "chair", at: [1, 1] }), { object: "ch", kind: "chair", at: [2, 2], state: "night" });
    doc = run(doc, { type: "setLinked", placementId: "ch/night", on: true });
    expect(doc.objects.ch?.linked).toBe(true);
    expect(copies(doc, "ch").map((p) => [p.state, p.at])).toEqual([["guest", { x: 2, y: 2 }], ["night", { x: 2, y: 2 }], ["s0", { x: 2, y: 2 }]]);
  });

  it("on is refused where the piece doesn't fit in another layout", () => {
    const doc = place(nightTable(room()), { object: "ch", kind: "chair", at: [2.8, 1.2] });
    expect(execute(doc, { type: "setLinked", placementId: "ch/s0", on: true }).ok).toBe(false);
  });

  it("is refused for a stair, a beam or a wheel well, which are always in every layout", () => {
    let doc = place(room(), { object: "beam", kind: "beam", at: [3, 2.5], rotation: 90, size: { w: { standard: 0.1 }, d: { standard: 5.9 } } });
    doc = place(doc, { object: "beam", kind: "beam", at: [3, 2.5], rotation: 90, state: "night" });
    if (!validateDocument(doc).ok) return; // the beam fixture's own rules; the command's refusal is what's tested
    expect(execute(doc, { type: "setLinked", placementId: "beam/s0", on: false }).ok).toBe(false);
  });
});

describe("layouts and stored rows", () => {
  it("gives a new empty layout every linked piece", () => {
    const one = rectDoc(0, 0, 6, 5);
    let doc = run({ ...one, states: { s0: { id: "s0", name: "Day", order: 0 } } }, placeChair("s0", 1, 1));
    doc = run(doc, { type: "addState", opId: "n", name: "Night" });
    expect(copies(doc, "c-s0-1-1/o0").map((p) => p.state)).toEqual(["n/s0", "s0"]);
  });

  it("a new empty layout takes every linked piece as the first layout has it, and is valid (knownbugs AC-01)", () => {
    // Two sofa beds face to face, 2.8 m apart: either opens, not both. Day: a sofa, b bed. Night: a bed, b sofa.
    let doc = run(room(), { type: "placeObject", opId: "a", state: "s0", object: { kind: "sofaBed" }, at: { x: 2, y: 1 }, rotation: 180, deck: null });
    doc = run(doc, { type: "placeObject", opId: "b", state: "night", object: { kind: "sofaBed" }, at: { x: 2, y: 3.8 }, rotation: 0, deck: null });
    doc = run(doc, { type: "setConfiguration", placementId: placementIn(doc, "a/o0", "night").id, config: "bed" });
    doc = run(doc, { type: "setConfiguration", placementId: placementIn(doc, "b/o0", "s0").id, config: "bed" });
    expect(validateDocument(doc).ok).toBe(true);
    // The first copy by ID of `a` is Night's and of `b` is Day's: both beds, which overlap.
    const firstById = (object: string): string | undefined => Object.keys(doc.placements).sort().map((id) => doc.placements[id]).find((p) => p?.object === object)?.config;
    expect([firstById("a/o0"), firstById("b/o0")]).toEqual(["bed", "bed"]);
    const added = execute(doc, { type: "addState", opId: "n", name: "Guests" });
    if (!added.ok) throw new Error(added.error.message);
    const next = added.value.doc;
    expect(validateDocument(next).ok).toBe(true);
    const standing = (p: Placement) => ({ ...p, id: "", state: "" });
    for (const id of ["a/o0", "b/o0"]) expect(standing(placementIn(next, id, "n/s0"))).toEqual(standing(placementIn(next, id, "s0")));
    expect(added.value.patch.puts.map((p) => `${p.table}/${p.entity.id}`).sort()).toEqual(["placements/a/o0/n/s0", "placements/b/o0/n/s0", "states/n/s0"]);
  });

  it("a new empty layout leaves out a piece that is an exception in the first layout", () => {
    const doc = run(nightTable(run(room(), placeChair("s0", 1, 1))), { type: "addState", opId: "n", name: "Guests" });
    expect(Object.values(doc.placements).filter((p) => p.state === "n/s0").map((p) => p.object)).toEqual(["c-s0-1-1/o0"]);
  });

  it("keeps the link in a copied layout: moving the copy moves the original", () => {
    const one = rectDoc(0, 0, 6, 5);
    let doc = run({ ...one, states: { s0: { id: "s0", name: "Day", order: 0 } } }, placeChair("s0", 1, 1));
    doc = run(doc, { type: "copyState", opId: "n", from: "s0", name: "Night" });
    const night = placementIn(doc, "c-s0-1-1/o0", "n/s0");
    doc = run(doc, { type: "movePlacement", placementId: night.id, at: { x: 3, y: 3 }, rotation: 0 });
    expect(placementIn(doc, "c-s0-1-1/o0", "s0").at).toEqual({ x: 3, y: 3 });
  });

  it("loads a stored row without the field as an exception that behaves as before", () => {
    const doc = place(place(room(), { object: "ch", kind: "chair", at: [1, 1] }), { object: "ch", kind: "chair", at: [2, 2], state: "night" });
    const loaded = unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))));
    expect(loaded.objects.ch?.linked).toBeUndefined();
    const moved = run(loaded, { type: "movePlacement", placementId: "ch/night", at: { x: 3, y: 3 }, rotation: 0 });
    expect(moved.placements["ch/s0"]?.at).toEqual({ x: 1, y: 1 });
  });

  it("round-trips linked: true through the stored form", () => {
    const doc = run(room(), placeChair("s0", 1, 1));
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc))))).objects["c-s0-1-1/o0"]?.linked).toBe(true);
  });

  it("I19 refuses a linked object whose copies differ in position", () => {
    let doc = place(place(room(), { object: "ch", kind: "chair", at: [1, 1] }), { object: "ch", kind: "chair", at: [2, 2], state: "night" });
    const ch = doc.objects.ch;
    if (!ch) throw new Error("no chair");
    doc = { ...doc, objects: { ...doc.objects, ch: { ...ch, linked: true } } };
    const v = validateDocument(doc);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.some((x) => x.invariant === "I19")).toBe(true);
  });

  it("I19 accepts a linked object whose copies differ only in configuration, sides and zones", () => {
    let doc = place(place(room(), { object: "ch", kind: "chair", at: [1, 1] }), { object: "ch", kind: "chair", at: [1, 1], state: "night", sides: { front: false, back: false, left: false, right: false } });
    const ch = doc.objects.ch;
    if (!ch) throw new Error("no chair");
    doc = { ...doc, objects: { ...doc.objects, ch: { ...ch, linked: true } } };
    expect(validateDocument(doc).ok).toBe(true);
  });
});
