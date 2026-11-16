import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anchorAt, emptyDocument, execute, fromStored, rectangleRoom, useZones } from "@fm/domain";
import type { Command, Document, OpeningKind } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import type { Point } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { wallThrough } from "../scripts/seed-kit";
import { seedStudio } from "../scripts/seed-studio";
import { clearanceWalk, entrances, piecesOverGlass, reachableRooms, swingsCross, warnings, waysUp } from "./livable";

// The livability checks (samples.05, step 03), each proven by a fixture that passes it and one that fails it.

type Edit = Command | ((doc: Document) => Command);
const build = (...edits: Edit[]): Document => {
  let doc = emptyDocument();
  for (const e of edits) {
    const cmd = typeof e === "function" ? e(doc) : e;
    const r = execute(doc, cmd);
    if (!r.ok) throw new Error(`${cmd.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const opening = (opId: string, kind: OpeningKind, p: Point, width: number) => (doc: Document): Command => {
  const { wall, along } = wallThrough(doc, p);
  return { type: "addOpening", opId, wall, kind, offset: along - width / 2, width };
};
const place = (opId: string, kind: string, centre: Point, w: number, d: number, rotation: number, deck: string | null = null): Command => ({
  type: "placeObject", opId, state: "s0", object: { kind, size: { w, d } }, at: anchorAt(centre, d, rotation), rotation, deck,
});

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-livable-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function studio(): Promise<Document> {
  const meta = await seedStudio(createJsonFileRepository(dir));
  const state = await createJsonFileRepository(dir).load(meta.id);
  if (!state) throw new Error("the studio was not saved");
  return unwrap(fromStored(state.doc));
}

/** A 4 × 3 m room with one opening of `kind` in the middle of its south wall. */
const roomWith = (kind: OpeningKind): Document => build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", kind, { x: 2, y: 0 }, 0.9));

describe("entrances (AC-05)", () => {
  it("the Studio has none: its only door is between its two rooms", async () => {
    expect(entrances(await studio())).toEqual(["No door in an outside wall"]);
  });

  it("a door in an outside wall counts; a window or an open passage there doesn't", () => {
    expect(entrances(roomWith("swing"))).toEqual([]);
    expect(entrances(roomWith("window"))).toEqual(["No door in an outside wall"]);
    expect(entrances(roomWith("passage"))).toEqual(["No door in an outside wall"]);
  });
});

/** The 8 × 6 m room with a loft at x 0.1–2.1, y 1.5–4.5, top 2.15 (as the domain's stair tests). */
const LOFT = "l/k0";
const loftRoom = (...more: Edit[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const stair: Command = { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "straight" };

describe("ways up (AC-06)", () => {
  it("the Studio's loft and platform have none, in both layouts", async () => {
    const problems = waysUp(await studio());
    expect(problems).toHaveLength(4);
    expect(problems.every((p) => p.includes("has no stair, ladder or steps"))).toBe(true);
  });

  it("a stair linked to the deck passes; with no stair, or a stair unlinked, the deck fails", () => {
    expect(waysUp(loftRoom(stair))).toEqual([]);
    expect(waysUp(loftRoom())).toHaveLength(1);
    expect(waysUp(loftRoom(stair, { type: "setStairReaches", objectId: "ps/s0/o0", deck: null }))).toHaveLength(1);
  });

  it("checks every layout: a stair is kept in every layout, so a copied layout passes too, and fails without it", () => {
    const night = { type: "copyState", opId: "n", from: "s0", name: "Night" } as const;
    expect(waysUp(loftRoom(night, stair))).toEqual([]);
    expect(waysUp(loftRoom(night))).toEqual(["Deck Loft has no stair, ladder or steps in layout Layout", "Deck Loft has no stair, ladder or steps in layout Night"]);
  });
});

/** A 6 × 3 m house split at x 3, with an entrance door in the left room and `between` in the dividing wall. */
const twoRooms = (between: OpeningKind | null): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 6, 3, "h"),
  { type: "addWall", opId: "div", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 3 } } },
  opening("front", "swing", { x: 1.5, y: 0 }, 0.9),
  ...(between ? [opening("mid", between, { x: 3, y: 1.5 }, 0.8)] : []),
  { type: "labelZone", id: "left", at: { x: 1.5, y: 1.5 }, name: "Living", finish: null },
  { type: "labelZone", id: "right", at: { x: 4.5, y: 1.5 }, name: "Bedroom", finish: null },
);

describe("reachable rooms (AC-07)", () => {
  it("a closed room fails, named", () => {
    expect(reachableRooms(twoRooms(null))).toEqual(["Room Bedroom can't be reached from an entrance"]);
  });

  it("a door or an open passage between the rooms passes; a window doesn't", () => {
    expect(reachableRooms(twoRooms("swing"))).toEqual([]);
    expect(reachableRooms(twoRooms("passage"))).toEqual([]);
    expect(reachableRooms(twoRooms("window"))).toEqual(["Room Bedroom can't be reached from an entrance"]);
  });
});

describe("warnings (AC-08)", () => {
  // A wardrobe against the north wall (clear y 0.1–2.9), facing the room.
  const wardrobe = place("wd", "wardrobe", { x: 2, y: 2.6 }, 1, 0.6, 0);

  it("a wardrobe whose front a sofa blocks warns; the sofa against the opposite wall doesn't", () => {
    const blocked = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), wardrobe, place("so", "sofa", { x: 2, y: 1.8 }, 2, 0.9, 0));
    const clear = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), wardrobe, place("so", "sofa", { x: 2, y: 0.55 }, 2, 0.9, 180));
    expect(warnings(blocked).length).toBeGreaterThan(0);
    expect(warnings(clear)).toEqual([]);
  });

  it("a loft side with no guard warns; the same sides with a 0.40 m railing don't", () => {
    const none = { kind: "none" as const };
    const low = { kind: "railing" as const, height: 0.4 };
    const open = loftRoom(stair, { type: "setDeck", deckId: LOFT, guardFront: none, guardRight: none, guardBack: none, guardLeft: none });
    const railed = loftRoom(stair, { type: "setDeck", deckId: LOFT, guardFront: low, guardRight: low, guardBack: low, guardLeft: low });
    expect(warnings(open).some((p) => p.startsWith("No guard on"))).toBe(true);
    expect(warnings(railed)).toEqual([]);
  });
});

describe("the clearance walk", () => {
  // A 4 × 3 m room (inside x 0.1–3.9, y 0.1–2.9), its door in the middle of the south wall, a wardrobe on the north wall
  // facing south, and a counter across the room between them, 0.70 m short of the east wall or wall to wall.
  const wardrobe = place("w", "wardrobe", { x: 2, y: 2.65 }, 1.2, 0.5, 0);
  const shut = (counterW: number, ...more: Edit[]): Document => build(
    ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "swing", { x: 2, y: 0 }, 0.9), wardrobe,
    place("c", "counter", { x: 0.1 + counterW / 2, y: 1.5 }, counterW, 0.4, 0), ...more,
  );

  it("reaches the wardrobe's front round the end of a counter, with 1.20 m to pass", () => {
    expect(clearanceWalk(shut(2.6))).toEqual([]);
  });

  it("doesn't reach it past a counter from wall to wall, though the room is reachable through its door", () => {
    const doc = shut(3.79);
    expect(reachableRooms(doc)).toEqual([]);
    expect(clearanceWalk(doc)).toEqual(["Layout Layout: Wardrobe's front zone can't be reached"]);
  });

  it("doesn't reach it through a 0.50 m gap, narrower than a person", () => {
    expect(clearanceWalk(shut(3.3))).toEqual(["Layout Layout: Wardrobe's front zone can't be reached"]);
  });

  it("passes a dining set as if its chairs were pushed under the table: 0.50 m at each end, 1.00 m with them in", () => {
    // The set stands across the room, x 0.60–3.40; its table 1.20 × 1.60, chairs on its west and east sides.
    const doc = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "swing", { x: 2, y: 0 }, 0.9),
      place("t", "seatedDining", { x: 2, y: 1.5 }, 1.2, 2.8, 90));
    expect(clearanceWalk(doc)).toEqual([]);
  });

  it("passes an aisle exactly 0.60 m wide, half a grid step off the grid's lines", () => {
    // The room shifted 12.5 mm east: the aisle between the counter and the east wall, x 3.3125–3.9125, centres between two lines.
    const doc = build(...rectangleRoom({ x: 0.0125, y: 0 }, 4, 3, "r"), opening("o", "swing", { x: 2, y: 0 }, 0.9),
      place("w", "wardrobe", { x: 2.0125, y: 2.65 }, 1.2, 0.5, 0), place("c", "counter", { x: 1.7125, y: 1.5 }, 3.2, 0.4, 0));
    expect(clearanceWalk(doc)).toEqual([]);
  });

  it("doesn't pass an aisle 0.55 m wide", () => {
    expect(clearanceWalk(shut(3.25))).toEqual(["Layout Layout: Wardrobe's front zone can't be reached"]);
  });

  it("reaches a zone shallower than half a person, in open floor: the body stands in it", () => {
    const doc = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "swing", { x: 2, y: 0 }, 0.9), wardrobe,
      { type: "setZoneExtent", placementId: "w/p0", side: "front", extent: { depth: 0.2, start: 0, end: 0 } });
    expect(clearanceWalk(doc)).toEqual([]);
  });

  it("leaves out a piece hung 1.20 m or more above its surface, as the warnings do", () => {
    // A wall shelf on the north wall over a counter from wall to wall: the shelf's front zone lies over the counter.
    const doc = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "swing", { x: 2, y: 0 }, 0.9),
      place("c", "counter", { x: 2, y: 2.3 }, 3.79, 1.2, 0),
      { type: "placeObject", opId: "k", state: "s0", object: { kind: "shelf", preset: "Wall shelf" }, at: { x: 2, y: 2.9 }, rotation: 0, deck: null });
    expect(useZones(doc).get("k/p0")?.length).toBe(1);
    expect(clearanceWalk(doc)).toEqual([]);
  });

  it("passes a round set as if its chairs were pushed in: 0.42 m each side with them out", () => {
    // A 3 × 4 m room inside (x 0.1–3.1); the set 2.16 across at x 0.52–2.68, its table and backrests 1.10 across.
    const doc = build(...rectangleRoom({ x: 0, y: 0 }, 3.2, 4, "r"), opening("o", "swing", { x: 1.6, y: 0 }, 0.9),
      { type: "placeObject", opId: "t", state: "s0", object: { kind: "seatedRound", preset: "4 seats" }, at: anchorAt({ x: 1.6, y: 2.4 }, 2.16, 0), rotation: 0, deck: null });
    expect(clearanceWalk(doc)).toEqual([]);
  });

  it("walks over a rug laid across the way", () => {
    expect(clearanceWalk(shut(2.6, place("g", "rug", { x: 3.3, y: 1.5 }, 1.2, 1.6, 0)))).toEqual([]);
  });

  // An 8 × 6 m room with a 3 × 3 m platform 0.45 high (x 0.5–3.5, y 1.5–4.5) and a wardrobe on it facing south.
  const PLATFORM = "p/k0";
  const raised = (...more: Edit[]): Document => build(
    ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 }, opening("o", "swing", { x: 4, y: 0 }, 0.9),
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 2, y: 3 }, w: 3, d: 3 },
    place("w", "wardrobe", { x: 2, y: 4.2 }, 1.2, 0.6, 0, PLATFORM), ...more,
  );
  const steps: Command = { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: PLATFORM, at: { x: 3.5, y: 3 }, shape: "straight" };

  it("walks a deck from the top of the stair that reaches it, and not without one", () => {
    expect(clearanceWalk(raised(steps))).toEqual([]);
    expect(clearanceWalk(raised())).toEqual(["Layout Layout: Wardrobe's front zone on Platform can't be reached"]);
  });
});

describe("pieces over glass (showcase.04)", () => {
  // A 4 × 3 m room, a 1.0 m window (sill 0.90, head 2.10) in the middle of its south wall, whose room face is y 0.10.
  const withPiece = (kind: string, w: number, d: number, off: number) =>
    build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "window", { x: 2, y: 0 }, 1), place("p", kind, { x: 2, y: 0.1 + off + d / 2 }, w, d, 180));

  it("finds a shelf standing against the glass, and not one 0.20 m off the wall", () => {
    expect(piecesOverGlass(withPiece("shelf", 0.8, 0.4, 0))).toEqual(["Shelf over Fixed window"]);
    expect(piecesOverGlass(withPiece("shelf", 0.8, 0.4, 0.1))).toEqual(["Shelf over Fixed window"]);
    expect(piecesOverGlass(withPiece("shelf", 0.8, 0.4, 0.2))).toEqual([]);
  });

  it("lets a sofa stand under the sill (touching it)", () => {
    expect(piecesOverGlass(withPiece("sofa", 2.1, 0.9, 0))).toEqual([]);
  });

  it("lets a plant stand at a window, but not in front of a glazed door", () => {
    expect(piecesOverGlass(withPiece("plant", 0.4, 0.4, 0.05))).toEqual([]);
    const door = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "slidingGlass", { x: 2, y: 0 }, 1.6), place("p", "plant", { x: 2, y: 0.4 }, 0.4, 0.4, 180));
    expect(piecesOverGlass(door)).toEqual(["Plant over Sliding glass door"]);
  });

  it("counts a bed's headboard at its full height and the rest of it as a mattress", () => {
    // its long side under the window (turned 90°, its head to the west): only the low mattress meets the wall
    expect(piecesOverGlass(build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "window", { x: 2, y: 0 }, 1), place("p", "bed", { x: 2, y: 0.9 }, 1.6, 2.0, 90)))).toEqual([]);
    // its head against the window wall: the headboard stands in front of the glass
    expect(piecesOverGlass(withPiece("bed", 1.6, 2.0, 0))).toEqual(["Bed over Fixed window"]);
  });

  it("lets a piece stand beside the window", () => {
    const doc = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), opening("o", "window", { x: 2, y: 0 }, 1), place("p", "shelf", { x: 0.6, y: 0.3 }, 0.8, 0.4, 180));
    expect(piecesOverGlass(doc)).toEqual([]);
  });
});

describe("swings that cross (showcase.30)", () => {
  const room = rectangleRoom({ x: 0, y: 0 }, 4, 3, "r");
  const door = (id: string, p: Point, hinge?: "a" | "b") => (doc: Document): Command => {
    const { wall, along } = wallThrough(doc, p);
    return { type: "addOpening", opId: id, wall, kind: "swing", offset: along - 0.4, width: 0.8, side: "left", ...(hinge ? { hinge } : {}) };
  };

  it("finds two doors in a corner swinging into the same floor, and not two doors apart", () => {
    const corner = build(...room, door("a", { x: 0.6, y: 0 }), door("b", { x: 0, y: 0.6 }));
    const found = swingsCross(corner);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/Swing door .* and Swing door .* swing into each other/);
    expect(swingsCross(build(...room, door("a", { x: 0.6, y: 0 }), door("b", { x: 3, y: 0 })))).toEqual([]);
  });

  it("doesn't count a door on a loft's wall over a floor door, and finds two doors on the same loft (cycle home)", () => {
    // A 4 × 3 room under 5.20 m with a loft at 2.45 over all of it; a floor door in the south wall swings x 0.2–1.0, y 0.1–0.9.
    const loft: Edit[] = [...room, { type: "setCeiling", height: 5.2 }, { type: "addDeck", opId: "k", preset: "loft", at: { x: 2, y: 1.5 }, w: 3.8, d: 2.8, top: 2.45 }];
    const onLoft = (id: string, from: Point, to: Point): Command => ({ type: "addWall", opId: id, from: { at: from }, to: { at: to }, base: "k/k0" });
    const loftDoor = (id: string, wall: string, offset: number, side: "left" | "right"): Command => ({ type: "addOpening", opId: id, wall, kind: "swing", offset, width: 0.8, side });
    // A loft wall along y 1.0 with a door swinging south over the floor door's swing: one above the other on the plan.
    const over = build(...loft, door("a", { x: 0.6, y: 0 }), onLoft("u", { x: 0.1, y: 1 }, { x: 3.9, y: 1 }), loftDoor("b", "u/w0", 0.1, "right"));
    expect(swingsCross(over)).toEqual([]);
    // Two loft walls meeting at a corner, each with a door swinging into the same corner of the loft.
    const same = build(...loft, onLoft("u", { x: 0.1, y: 1 }, { x: 3.9, y: 1 }), onLoft("v", { x: 1.2, y: 1.1 }, { x: 1.2, y: 2.9 }), loftDoor("b", "u/w0", 0.2, "left"), loftDoor("c", "v/w0", 0.1, "left"));
    expect(swingsCross(same)).toHaveLength(1);
  });

  it("finds a casement window's leaf in a door's swing, and not a fixed window there", () => {
    expect(swingsCross(build(...room, door("a", { x: 0, y: 0.6 }), opening("w", "casement", { x: 0.6, y: 0 }, 0.6)))).toHaveLength(1);
    expect(swingsCross(build(...room, door("a", { x: 0, y: 0.6 }), opening("w", "window", { x: 0.6, y: 0 }, 0.6)))).toEqual([]);
  });
});
