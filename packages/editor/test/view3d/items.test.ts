import { describe, expect, it } from "vitest";
import { execute, motifDefaults, unwrap, type Command, type Document } from "@fm/domain";
import { roomFinishes } from "../../src/view/finish/rooms";
import { flipPoses } from "../../src/view/flip-poses";
import { view3dItems } from "../../src/view3d/items";
import type { Item3d } from "../../src/view3d/types";
import { labelledDoc, LOFT_ROOM_LOFT, loftRoomDoc, roomDoc } from "../builders";

/** `doc` with every opening's head at `head`: a head no longer follows a lowered wall, it's stored (sills.01, .02). */
const withHeads = (doc: Document, head: number): Document => ({ ...doc, openings: Object.fromEntries(Object.entries(doc.openings).map(([id, o]) => [id, { ...o, head }])) });

// The 3D view's items (heights.05, .29): plain data from the document, the viewed state, the flip and the selection.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const place = (opId: string, kind: string, x: number, y: number, state = "s0"): Command => ({ type: "placeObject", linked: false, deck: null, opId, state, object: { kind }, at: { x, y } });
const pieces = (items: readonly Item3d[]) => items.flatMap((i) => (i.item === "piece" ? [i] : []));
const walls = (items: readonly Item3d[]) => items.flatMap((i) => (i.item === "wall" ? [i] : []));
const floors = (items: readonly Item3d[]) => items.flatMap((i) => (i.item === "floor" ? [i] : []));

/** The room's north wall (y = 4). */
function northWall(doc: Document): string {
  const id = Object.values(doc.walls).find((w) => doc.joints[w.a]?.y === 4 && doc.joints[w.b]?.y === 4)?.id;
  if (id === undefined) throw new Error("no north wall");
  return id;
}

/** A door at x 2.0–2.8 and a window at x 3.5–4.5 on the north wall, whichever way it runs. */
function withOpenings(doc: Document): Document {
  const wall = doc.walls[northWall(doc)];
  const ax = wall ? (doc.joints[wall.a]?.x ?? 0) : 0;
  const offset = (x0: number, x1: number) => (ax === 0 ? x0 : ax - x1);
  return ok(doc, { type: "addOpening", opId: "door", wall: northWall(doc), kind: "swing", offset: offset(2, 2.8), width: 0.8 },
    { type: "addOpening", opId: "win", wall: northWall(doc), kind: "window", offset: offset(3.5, 4.5), width: 1 });
}

/** The studio: a desk under a lift bed up by Day; Night has the bed down and no desk. */
function studio(): Document {
  return ok(roomDoc(), place("t", "desk", 3, 3.9), place("l", "liftBed", 3, 3.9), { type: "addState", opId: "n", name: "Night" },
    { type: "placeObject", linked: false, deck: null, opId: "l2", state: "n/s0", object: { existing: "l/o0" }, at: { x: 3, y: 3.9 }, config: "down" });
}

describe("view3dItems", () => {
  it("one piece item per placement in the viewed state, with its resolved range", () => {
    const day = pieces(view3dItems(studio(), "s0", null, new Set(), false));
    expect(day.map((p) => [p.objectKind, p.config, p.bottom, p.top]).sort()).toEqual([["desk", "standard", 0, 0.75], ["liftBed", "up", 2.15, 2.5]]);
    const night = pieces(view3dItems(studio(), "n/s0", null, new Set(), false));
    expect(night.map((p) => [p.objectKind, p.config, p.bottom, p.top])).toEqual([["liftBed", "down", 0.2, 0.55]]);
  });

  it("shaped pieces carry their outline ring", () => {
    const doc = ok(roomDoc(), place("r", "roundTable", 3, 3.9));
    const [table] = pieces(view3dItems(doc, "s0", null, new Set(), false));
    expect(table?.ring.length).toBeGreaterThan(8);
    const rect = pieces(view3dItems(studio(), "s0", null, new Set(), false)).find((p) => p.objectKind === "desk");
    expect(rect?.ring).toHaveLength(4);
  });

  it("walls carry their range and a full flag; a half wall is not full", () => {
    const doc = ok(studio(), { type: "addWall", opId: "pen", from: { at: { x: 1, y: 1 } }, to: { at: { x: 2, y: 1 } } }, { type: "setWallTop", wallId: "pen/w0", top: 1.1 });
    const ws = walls(view3dItems(doc, "s0", null, new Set(), false));
    expect(ws).toHaveLength(5);
    expect(ws.find((w) => w.wall === "pen/w0")).toMatchObject({ bottom: 0, top: 1.1, full: false });
    expect(ws.filter((w) => w.full).every((w) => w.top === 2.5)).toBe(true);
    expect(ws.every((w) => w.outline.length >= 4)).toBe(true);
  });

  it("floors are the rooms, with holes", () => {
    let doc = roomDoc();
    const core: [number, number, number, number][] = [[2, 1, 3, 1], [3, 1, 3, 2], [3, 2, 2, 2], [2, 2, 2, 1]];
    core.forEach(([x0, y0, x1, y1], i) => {
      doc = ok(doc, { type: "addWall", opId: `core${i}`, from: { at: { x: x0, y: y0 } }, to: { at: { x: x1, y: y1 } } });
    });
    const fs = floors(view3dItems(doc, "s0", null, new Set(), false));
    expect(fs.map((f) => f.holes.length).sort()).toEqual([0, 1]); // the room around the core, and the core's own floor
    expect(fs.length).toBeGreaterThan(0);
    expect(fs.every((f) => f.ring.length >= 4)).toBe(true);
  });

  it("mid-flip, items read the same pose as the plan flip layer", () => {
    const flip = { from: "s0", to: "n/s0", t: 0.4 };
    const bed = pieces(view3dItems(studio(), "n/s0", flip, new Set(), false)).find((p) => p.objectKind === "liftBed");
    const pose = flipPoses(studio(), flip).find((p) => p.objectId === "l/o0");
    expect([bed?.bottom, bed?.top, bed?.centre, bed?.rotation]).toEqual([pose?.bottom, pose?.top, pose?.centre, pose?.rotation]);
  });

  it("a piece in one layout pops at the middle of the flip", () => {
    const desk = (t: number) => pieces(view3dItems(studio(), "n/s0", { from: "s0", to: "n/s0", t }, new Set(), false)).some((p) => p.objectKind === "desk");
    expect([desk(0.3), desk(0.7)]).toEqual([true, false]);
  });

  it("a wall lists its door and window with their stored heights (heights.69, AC-21, sills.01)", () => {
    const doc = withOpenings(roomDoc());
    const north = (d: Document) => walls(view3dItems(d, "s0", null, new Set(), false)).find((w) => w.wall === northWall(d));
    // In the wall's a → b order, whichever way it runs; sorted west to east here.
    const spans = (d: Document) => (north(d)?.openings ?? []).map((o) => [Math.min(o.start.x, o.end.x), Math.max(o.start.x, o.end.x), o.bottom, o.top, o.glass]).sort((p, q) => Number(p[0]) - Number(q[0]));
    expect(spans(doc)).toEqual([[2, 2.8, 0, 2.1, false], [3.5, 4.5, 0.9, 2.1, true]]);
    expect(north(doc)?.openings.every((o) => o.thickness === 0.2 && o.start.y === 4 && o.end.y === 4)).toBe(true);
    expect(spans(ok(withHeads(doc, 1.9), { type: "setCeiling", height: 2 }))).toEqual([[2, 2.8, 0, 1.9, false], [3.5, 4.5, 0.9, 1.9, true]]);
    expect(walls(view3dItems(doc, "s0", null, new Set(), false)).filter((w) => w.wall !== northWall(doc)).every((w) => w.openings.length === 0)).toBe(true);
  });

  it("selected pieces are marked", () => {
    const ps = pieces(view3dItems(studio(), "s0", null, new Set(["l/p0"]), false));
    expect(ps.map((p) => [p.placement, p.selected]).sort()).toEqual([["l/p0", true], ["t/p0", false]]);
  });
});

// Decks in 3D (spec "The 3D view", decks.07, AC-09). roomDoc: wall faces x 0.1–5.9, y 0.1–3.9; the ceiling raised to
// 3.05 so a loft mattress fits; a loft over the west end, a platform at the east end.
describe("view3dItems: decks", () => {
  const decks = (items: readonly Item3d[]) => items.flatMap((i) => (i.item === "deck" ? [i] : []));
  const tiny = (): Document => ok(roomDoc(), { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 2 } }, { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.9, y: 2 } });

  it("a platform is a deck item [0, 0.45] with its ring", () => {
    const platform = decks(view3dItems(tiny(), "s0", null, new Set(), false)).find((d) => d.deck === "p/k0");
    expect(platform).toMatchObject({ item: "deck", bottom: 0, top: 0.45, selected: false });
    expect(platform?.fills[0]?.ring.map((p) => [p.x, p.y])).toEqual([[3.9, 1.3], [5.9, 1.3], [5.9, 2.7], [3.9, 2.7]].map(([x, y]) => [expect.closeTo(x ?? 0, 9), expect.closeTo(y ?? 0, 9)]));
  });

  it("a loft is [2.03, 2.15]", () => {
    const loft = decks(view3dItems(tiny(), "s0", null, new Set(), false)).find((d) => d.deck === "l/k0");
    expect(loft?.bottom).toBeCloseTo(2.03, 9);
    expect(loft?.top).toBe(2.15);
  });

  it("a bed on the loft has bottom 2.15; a chair on the platform 0.45; a desk under the loft 0", () => {
    // A loft mattress (decks.44): the bed lowered to 0.35, then put on the loft through Stands on.
    const doc = ok(tiny(), place("b", "bed", 1.1, 3.9), { type: "setObjectSize", objectId: "b/o0", w: 1.4, d: { standard: 1.2 }, h: { standard: 0.35 } },
      { type: "movePlacement", placementId: "b/p0", at: { x: 1.1, y: 2.6 }, rotation: 0, deck: "l/k0" },
      { type: "placeObject", linked: false, deck: "p/k0", opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 4.9, y: 2 } },
      place("t", "desk", 1.1, 2));
    const byKind = new Map(pieces(view3dItems(doc, "s0", null, new Set(), false)).map((p) => [p.objectKind, [p.bottom, p.top]]));
    expect(byKind.get("bed")).toEqual([2.15, 2.5]);
    expect(byKind.get("chair")).toEqual([0.45, 1.35]);
    expect(byKind.get("desk")).toEqual([0, 0.75]);
  });

  it("decks come after the walls and before the pieces, sorted by ID", () => {
    const items = view3dItems(ok(tiny(), { type: "placeObject", linked: false, deck: "p/k0", opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 4.9, y: 2 } }), "s0", null, new Set(), false);
    const kinds = items.map((i) => i.item);
    expect(kinds.lastIndexOf("wall")).toBeLessThan(kinds.indexOf("deck"));
    expect(kinds.lastIndexOf("deck")).toBeLessThan(kinds.indexOf("piece"));
    expect(decks(items).map((d) => d.deck)).toEqual(["l/k0", "p/k0"]);
  });

  it("the selected deck is marked", () => {
    const ds = decks(view3dItems(tiny(), "s0", null, new Set(["p/k0"]), false));
    expect(ds.map((d) => [d.deck, d.selected])).toEqual([["l/k0", false], ["p/k0", true]]);
  });
});

describe("posts with a loft in 3D (spec \"Elsewhere\", pillars.05)", () => {
  // loftRoomDoc: ceiling 3.05, the Loft at 2.15 (underside 2.03).
  const doc = ok(loftRoomDoc(),
    { type: "placeColumn", opId: "u", at: { x: 2.4, y: 1.6 }, width: 0.2, depth: 0.2, top: LOFT_ROOM_LOFT },
    { type: "placeColumn", opId: "o", at: { x: 3.5, y: 3 }, width: 0.2, depth: 0.2, base: LOFT_ROOM_LOFT });
  const item = (id: string) => walls(view3dItems(doc, "s0", null, new Set(), false)).find((w) => w.wall === id);

  it("a post on the loft is a box from the loft's top, 2.15, to the ceiling", () => {
    expect(item("o/w0")).toEqual(expect.objectContaining({ bottom: 2.15, top: 3.05, full: true }));
  });

  it("a post under the loft is a box from the floor to the loft's underside, 2.03", () => {
    expect(item("u/w0")).toEqual(expect.objectContaining({ bottom: 0, top: expect.closeTo(2.03, 9), full: false }));
  });
});

describe("view3dItems: floor finishes (finishes.12, AC-13)", () => {
  // labelledDoc: Room 1 (L1) in planks, Room 2 (L2) in a mosaic, whose 0.025 m spacing is under 3D's 0.10 m.
  const doc = ok(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("planks") }, { type: "setFinish", id: "L2", finish: motifDefaults("mosaic") });
  const floorOf = (finishes: boolean, label: string) => {
    const room = roomFinishes(doc).find((r) => r.id === label)?.room;
    return floors(view3dItems(doc, "s0", null, new Set(), finishes)).find((f) => f.room === room);
  };

  it("a planks room's floor item carries its colour and lines; a mosaic room its colour and no lines; finishes false gives null colour and no lines", () => {
    const planks = roomFinishes(doc).find((r) => r.id === "L1")?.geometry;
    expect(planks?.lines.length).toBeGreaterThan(10);
    expect(floorOf(true, "L1")).toEqual(expect.objectContaining({ color: motifDefaults("planks").colour, lines: planks?.lines }));
    expect(floorOf(true, "L2")).toEqual(expect.objectContaining({ color: motifDefaults("mosaic").colour, lines: [] }));
    for (const label of ["L1", "L2"]) expect(floorOf(false, label)).toEqual(expect.objectContaining({ color: null, lines: [] }));
  });

  it("a cement-tile room's floor carries its shapes in their colours; planks, mosaic and finishes off carry none (shown.04)", () => {
    const cement = ok(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("cementTiles") }, { type: "setFinish", id: "L2", finish: motifDefaults("mosaic") });
    const geometry = roomFinishes(cement).find((r) => r.id === "L1")?.geometry;
    expect(geometry?.shapes.length).toBeGreaterThan(10);
    const floorIn = (d: typeof cement, finishes: boolean, label: string) =>
      floors(view3dItems(d, "s0", null, new Set(), finishes)).find((f) => f.room === roomFinishes(d).find((r) => r.id === label)?.room);
    expect(floorIn(cement, true, "L1")?.shapes).toEqual(geometry?.shapes.map((s) => ({ ring: s.points, holes: s.holes, color: s.color })));
    expect(floorIn(cement, true, "L2")?.shapes).toEqual([]);
    expect(floorIn(cement, false, "L1")?.shapes).toEqual([]);
    expect(floorOf(true, "L1")?.shapes).toEqual([]); // planks
  });

  it("lines from a spacing of 0.05 m on every surface (surfaces.12): herringbone at 0.09 draws them, mosaic at 0.025 doesn't; an unfinished room has no colour", () => {
    const tiles = ok(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("herringbone") }, { type: "setFinish", id: "L2", finish: motifDefaults("mosaic") });
    const [l1, l2] = ["L1", "L2"].map((label) => roomFinishes(tiles).find((r) => r.id === label));
    expect(l1?.geometry.spacing).toBeCloseTo(0.09, 9);
    expect(l2?.geometry.lines.length).toBeGreaterThan(0); // drawn on the plan, not in 3D
    const fs = floors(view3dItems(tiles, "s0", null, new Set(), true));
    expect(fs.find((f) => f.room === l1?.room)?.lines.length).toBeGreaterThan(0);
    expect(fs.find((f) => f.room === l2?.room)?.lines).toEqual([]);
    const plain = floors(view3dItems(labelledDoc(), "s0", null, new Set(), true));
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((f) => f.color === null && f.lines.length === 0)).toBe(true);
  });
});

describe("view3dItems: deck finishes (deck-floors.02, AC-09)", () => {
  const loft = (finish: Command[] = []): Document => {
    let doc = roomDoc();
    for (const c of [{ type: "addDeck", opId: "l", preset: "loft", at: { x: 2, y: 2 }, w: 2, d: 2 } satisfies Command, ...finish]) doc = unwrap(execute(doc, c)).doc;
    return doc;
  };
  const deckOf = (doc: Document, finishes: boolean) => view3dItems(doc, "s0", null, new Set(), finishes).find((i) => i.item === "deck");

  it("a finished deck carries its colour, lines and shapes; finishes off, or no finish, carry none", () => {
    const cement = loft([{ type: "setDeckFinish", deckId: "l/k0", finish: motifDefaults("cementTiles") }]);
    const item = deckOf(cement, true);
    expect(item?.item === "deck" ? item.finish?.color : null).toBe(motifDefaults("cementTiles").colour);
    expect(item?.item === "deck" ? item.finish?.lines.length : 0).toBeGreaterThan(5);
    expect(item?.item === "deck" ? item.finish?.shapes.length : 0).toBeGreaterThan(5);
    expect(deckOf(cement, false)).toMatchObject({ finish: null });
    expect(deckOf(loft(), true)).toMatchObject({ finish: null });
  });

  it("a mosaic deck carries its colour and no pattern (under 0.10 m)", () => {
    const mosaic = deckOf(loft([{ type: "setDeckFinish", deckId: "l/k0", finish: motifDefaults("mosaic") }]), true);
    expect(mosaic?.item === "deck" ? [mosaic.finish?.color, mosaic.finish?.lines, mosaic.finish?.shapes] : null).toEqual([motifDefaults("mosaic").colour, [], []]);
  });
});
