import { describe, expect, it } from "vitest";
import { anchorAtMm, deserialize, emptyDocument, execute, rectangleRoom, serialize, unwrap, type Command, type Document } from "@fm/domain";
import { MAX_LISTED_WALLS, summarize, type DrawingOverview, type DrawingSummary, type RoomSummary } from "../src/drawing";
import { perLayout, type Listing } from "./harness";
import { mulberry32 } from "./pictures";

const project = { id: "p1", name: "Apartment", status: "saved" } as const;

/** A listing, each piece's place per layout (perLayout): these tests are about the summary's facts, listing.test.ts about its shape. */
function listing(s: DrawingSummary | DrawingOverview): Listing {
  if (!("walls" in s)) throw new Error(`expected a listing, got an overview: ${s.hint}`);
  const expanded: unknown = perLayout(s);
  return expanded as Listing;
}

function overview(s: DrawingSummary | DrawingOverview): DrawingOverview {
  if ("walls" in s) throw new Error(`expected an overview, got ${s.walls.length} walls`);
  return s;
}

/** An n × n grid of 1 m rooms, one label per room: 2n(n + 1) walls. */
function grid(n: number): Document {
  const doc: Document = emptyDocument();
  const j = (x: number, y: number): string => `j${x}_${y}`;
  for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) doc.joints[j(x, y)] = { id: j(x, y), x, y };
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      if (x < n) doc.walls[`h${x}_${y}`] = { id: `h${x}_${y}`, a: j(x, y), b: j(x + 1, y), thickness: 0.2, top: "ceiling", base: "floor", column: false };
      if (y < n) doc.walls[`v${x}_${y}`] = { id: `v${x}_${y}`, a: j(x, y), b: j(x, y + 1), thickness: 0.2, top: "ceiling", base: "floor", column: false };
      if (x < n && y < n) doc.zoneLabels[`l${x}_${y}`] = { id: `l${x}_${y}`, at: { x: x + 0.5, y: y + 0.5 }, name: "Room", finish: null };
    }
  }
  return doc;
}

function run(doc: Document, cmds: Command[]): Document {
  return cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

describe("summarize", () => {
  it("lists walls with joint ids, endpoints and lengths, and one room with its clear area", () => {
    const doc = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const s = listing(summarize(project, doc));
    expect(s.project).toEqual(project);
    expect(s.units).toBe("m");
    expect(s.walls.map((w) => [w.id, w.from, w.to, w.length])).toEqual([
      ["r-1/w0", [0, 0], [4, 0], 4],
      ["r-2/w0", [4, 0], [4, 3], 3],
      ["r-3/w0", [4, 3], [0, 3], 4],
      ["r-4/w0", [0, 3], [0, 0], 3],
    ]);
    expect(s.joints).toHaveLength(4);
    expect(s.rooms).toHaveLength(1);
    expect(s.rooms[0]).toMatchObject({ labels: [], area: 10.64 }); // (4 − 0.2) × (3 − 0.2)
    expect(s.rooms[0]?.outline).toHaveLength(4);
    expect(s.unplacedLabels).toEqual([]);
  });

  it("names rooms by their labels and lists labels outside every room", () => {
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const doc = run(room, [{ type: "labelZone", id: "L1", at: { x: 2, y: 1.5 }, name: "Bathroom", finish: null }]);
    const withOrphan: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, L2: { id: "L2", at: { x: 9, y: 9 }, name: "Lost", finish: null } } };
    const s = listing(summarize(project, withOrphan));
    expect(s.rooms[0]?.labels).toEqual([{ id: "L1", name: "Bathroom", finish: null }]);
    expect(s.unplacedLabels).toEqual([{ id: "L2", name: "Lost", at: [9, 9], finish: null }]);
  });

  it("get_drawing lists each label's finish (null or its five fields) beside its name (finishes.14, AC-10)", () => {
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const mosaic = { motif: "mosaic", colour: "#a9c9d6", strength: 50, size: 0.025, angle: 0 };
    const planks = { motif: "planks", colour: "#d8bc94", strength: 45, size: 0.2, angle: 90 };
    const doc = run(room, [{ type: "labelZone", id: "L1", at: { x: 2, y: 1.5 }, name: "Bathroom", finish: mosaic }]);
    const withOrphan: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, L2: { id: "L2", at: { x: 9, y: 9 }, name: "Lost", finish: planks } } };
    const s = listing(summarize(project, withOrphan));
    expect(s.rooms[0]?.labels).toEqual([{ id: "L1", name: "Bathroom", finish: mosaic }]);
    expect(s.unplacedLabels).toEqual([{ id: "L2", name: "Lost", at: [9, 9], finish: planks }]);
  });

  it("get_drawing prints the thickness of a 0.30 wall and omits it for 0.20", () => {
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const doc = run(room, [{ type: "setWallThickness", wallId: "r-1/w0", thickness: 0.3 }]);
    const s = listing(summarize(project, doc));
    expect(s.walls.map((w) => [w.id, w.thickness])).toEqual([
      ["r-1/w0", 0.3],
      ["r-2/w0", undefined],
      ["r-3/w0", undefined],
      ["r-4/w0", undefined],
    ]);
    expect(Object.keys(s.walls[1] ?? {})).toEqual(["id", "a", "b", "from", "to", "length"]);
  });

  it("rounds coordinates to millimetres and areas to hundredths", () => {
    const doc = run(emptyDocument(), [{ type: "addWall", opId: "w", from: { at: { x: 0.12345, y: 0 } }, to: { at: { x: 1, y: 0 } } }]);
    const s = listing(summarize(project, doc));
    expect(s.walls[0]).toMatchObject({ from: [0.123, 0], length: 0.877 });
  });

  it("get_drawing lists two states, a bed with its placement per state, and free floor per room per state", () => {
    // A 4 × 5 room (clear 3.8 × 4.8 = 18.24 m²); a default 1.70 × 2.10 bed anchored at (2, 3.5), the middle of its
    // back edge: centred at (2, 2.45). An empty second state; a second room with nothing in it.
    const room = run(emptyDocument(), [...rectangleRoom({ x: 0, y: 0 }, 4, 5, "r"), ...rectangleRoom({ x: 10, y: 0 }, 2, 2, "q")]);
    const doc = run(room, [
      { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 2, y: 3.5 }, linked: false },
      { type: "addState", opId: "e", name: "Empty" },
    ]);
    const s = listing(summarize(project, doc));
    expect(s.layouts).toEqual([{ id: "s0", name: "Layout", blocked: [] }, { id: "e/s0", name: "Empty", blocked: [] }]);
    expect(s.objects).toEqual([
      {
        id: "b/o0",
        kind: "bed",
        name: "Bed",
        sizes: { standard: { width: 1.7, depth: 2.1, height: 1, elevation: 0 } },
        placements: { s0: { centre: [2, 2.45], rotation: 0, config: "standard", on: "floor", sides: ["left", "right"], zones: { left: { depth: 0.6, start: 0.45, end: 0 }, right: { depth: 0.6, start: 0.45, end: 0 } } }, "e/s0": null },
        linked: false, // an exception, in Layout only (review.07)
      },
    ]);
    const big = s.rooms.find((r) => r.area === 18.24);
    expect(big?.freeFloor).toEqual({ s0: 14.67, "e/s0": 18.24 }); // 18.24 − 3.57
    expect(s.rooms.find((r) => r.area !== 18.24)).not.toHaveProperty("freeFloor"); // nothing placed there in any state
    expect(s.counts.objects).toBe(1);
  });

  it("get_drawing lists stored and default zones; a placement stored before this cycle lists the defaults (AC-21)", () => {
    const room = run(emptyDocument(), [...rectangleRoom({ x: 0, y: 0 }, 4, 5, "r"), ...rectangleRoom({ x: 10, y: 0 }, 2, 2, "q")]);
    const doc = run(room, [{ type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 2, y: 3.5 } }]);
    const zonesOf = (d: Document) => listing(summarize(project, d)).objects[0]?.placements["s0"]?.zones;
    const DEFAULT = { depth: 0.6, start: 0.45, end: 0 };
    const stored = run(doc, [{ type: "setZoneExtent", placementId: "b/p0", side: "right", extent: { depth: 0.3, start: 0.2, end: 0.1 } }]);
    expect(zonesOf(stored)).toEqual({ left: DEFAULT, right: { depth: 0.3, start: 0.2, end: 0.1 } });
    // A drawing saved before zones existed: the load fill gives each placement the defaults.
    const json = serialize(doc);
    const dropZones = (p: unknown): unknown => (typeof p === "object" && p !== null ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== "zones")) : p);
    const placements = Object.fromEntries(Object.entries(doc.placements).map(([id, p]) => [id, dropZones(p)]));
    const old = { ...json, placements };
    expect(JSON.stringify(placements)).not.toContain("zones");
    expect(zonesOf(unwrap(deserialize(JSON.parse(JSON.stringify(old)))))).toEqual({ left: DEFAULT, right: DEFAULT });
  });

  it("the glazed flag appears in the door line", () => {
    // Under the 4 m wall r-1/w0, by offset: a glazed sliding door at 2.5, a plain swing door at 0.5; a window on r-2/w0.
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const doc = run(room, [
      { type: "addOpening", opId: "g", wall: "r-1/w0", kind: "sliding", offset: 2.5, width: 1, side: "right", glazed: true },
      { type: "addOpening", opId: "d", wall: "r-1/w0", kind: "swing", offset: 0.5, hinge: "b" },
      { type: "addOpening", opId: "w", wall: "r-2/w0", kind: "window", offset: 1 },
    ]);
    const s = listing(summarize(project, doc));
    expect(s.walls.find((w) => w.id === "r-1/w0")?.openings).toEqual([
      { id: "d/d0", kind: "swing", name: "Swing door", offset: 0.5, width: 0.8, side: "left", hinge: "b", glazed: false, height: 2.1 },
      { id: "g/d0", kind: "sliding", name: "Sliding door", offset: 2.5, width: 1, side: "right", hinge: "a", glazed: true, height: 2.1 },
    ]);
    expect(s.walls.find((w) => w.id === "r-2/w0")?.openings).toEqual([{ id: "w/d0", kind: "window", name: "Fixed window", offset: 1, width: 1, sill: 0.9, height: 1.2 }]);
    expect(s.walls.find((w) => w.id === "r-3/w0")).not.toHaveProperty("openings");
    expect(s.counts.openings).toBe(3);
    expect(listing(summarize(project, doc, { min: { x: 3.5, y: 1 }, max: { x: 4.5, y: 2 } })).walls).toEqual([
      expect.objectContaining({ id: "r-2/w0", openings: [{ id: "w/d0", kind: "window", name: "Fixed window", offset: 1, width: 1, sill: 0.9, height: 1.2 }] }),
    ]);
  });
});

describe("blocked clearances per layout (smart.13, .20, AC-10)", () => {
  // A 4 × 5 room (inner faces x 0.1–3.9, y 0.1–4.9):
  // - a wardrobe against the top wall (x 0.4–1.6, y 4.3–4.9) with a block in its front zone (block y 3.6–4.2);
  // - a desk turned 315° facing the bottom-left corner, anchored at (1, 1): its 0.70 m front zone (furnish.15) reaches
  //   past both inner faces (outer corners (−0.237, 0.258) and (0.258, −0.237));
  // - a door on the bottom wall at offset 2.5 (swing x 2.5–3.3, y 0.1–0.9) with a block in its swing.
  const doc = (): Document =>
    run(run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 5, "r")), [
      { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 1, y: 4.9 } },
      { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "block" }, at: { x: 1, y: 4.2 } },
      { type: "placeObject", deck: null, opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 1, y: 1 }, rotation: 315 },
      { type: "addOpening", opId: "o", wall: "r-1/w0", kind: "swing", offset: 2.5 },
      { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "block", name: "Crate" }, at: { x: 2.9, y: 0.9 } },
    ]);
  const layout = (s: DrawingSummary) => s.layouts.find((st) => st.id === "s0");

  it("lists the blocked swing of a door on a loft's wall (cycle home, AC-04), and not for a piece under the loft", () => {
    // The room under 5.20 m with a loft at 2.45 over x 0.1–2.1; a wall on it at x 1.5 with a door (y 1.6–2.4) swinging
    // west over x 0.6–1.4.
    const loft = (deck: string | null): Document =>
      run(run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 5, "r")), [
        { type: "setCeiling", height: 5.2 },
        { type: "addDeck", opId: "k", preset: "loft", at: { x: 1.1, y: 2.5 }, w: 2, d: 4.8, top: 2.45 },
        { type: "addWall", opId: "lw", from: { at: { x: 1.5, y: 0.1 } }, to: { at: { x: 1.5, y: 4.9 } }, base: "k/k0" },
        { type: "addOpening", opId: "ld", wall: "lw/w0", kind: "swing", offset: 1.5, width: 0.8 },
        { type: "placeObject", deck, opId: "st", state: "s0", object: { kind: "stool" }, at: { x: 1, y: 2.2 } },
      ]);
    expect(layout(listing(summarize(project, loft("k/k0"))))?.blocked).toEqual([{ zone: "Door ld/d0 swing", by: "Stool (st/o0)" }]);
    expect(layout(listing(summarize(project, loft(null))))?.blocked).toEqual([]);
  });

  it("names zones and swings with ids, reads a wall as \"wall\", and lists a zone touching two walls once", () => {
    // clearanceWarnings' order: by table (openings first), then zone id; the desk zone overlaps walls r-1 and r-4.
    expect(layout(listing(summarize(project, doc())))?.blocked).toEqual([
      { zone: "Door o/d0 swing", by: "Crate (c/o0)" },
      { zone: "Desk (d/o0) front zone", by: "wall" },
      { zone: "Wardrobe (w/o0) front zone", by: "Custom box (b/o0)" },
    ]);
  });

  it("with a region, lists a zone of a listed piece or a swing of a door on a listed wall", () => {
    const wardrobe = listing(summarize(project, doc(), { min: { x: 0.5, y: 4.5 }, max: { x: 1.5, y: 4.8 } }));
    expect(wardrobe.objects.map((o) => o.id)).toEqual(["w/o0"]);
    expect(layout(wardrobe)?.blocked).toEqual([{ zone: "Wardrobe (w/o0) front zone", by: "Custom box (b/o0)" }]);
    const bottom = listing(summarize(project, doc(), { min: { x: 2.4, y: -0.05 }, max: { x: 2.45, y: 0.05 } }));
    expect(bottom.walls.map((w) => w.id)).toEqual(["r-1/w0"]);
    expect(bottom.objects).toEqual([]);
    expect(layout(bottom)?.blocked).toEqual([{ zone: "Door o/d0 swing", by: "Crate (c/o0)" }]);
  });

  it("the overview's states have no blocked field", () => {
    const s = overview(summarize(project, grid(12)));
    expect(s.layouts[0]).not.toHaveProperty("blocked");
  });
});

describe("dimensions and floor outlines (dims, AC-15)", () => {
  const sorted = (ps: readonly [number, number][] | undefined): [number, number][] =>
    [...(ps ?? [])].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const triangle: Command[] = [
    { type: "addWall", opId: "t1", from: { at: { x: 0, y: 0 } }, to: { at: { x: 5, y: 0 } } },
    { type: "addWall", opId: "t2", from: { at: { x: 5, y: 0 } }, to: { at: { x: 0, y: 2 } } },
    { type: "addWall", opId: "t3", from: { at: { x: 0, y: 2 } }, to: { at: { x: 0, y: 0 } } },
  ];

  function jointAt(doc: Document, x: number, y: number): string {
    const j = Object.values(doc.joints).find((p) => p.x === x && p.y === y);
    if (!j) throw new Error(`no joint at ${x},${y}`);
    return j.id;
  }

  it("rooms list their clear floor outline, rounded to the millimetre", () => {
    const room = listing(summarize(project, run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"))));
    expect(sorted(room.rooms[0]?.floor)).toEqual([[0.1, 0.1], [0.1, 2.9], [3.9, 0.1], [3.9, 2.9]]);
    // The hypotenuse 2x + 5y = 10 moves in by 0.1·√29: corners (4.480742, 0.1) and (0.1, 1.852297).
    const tri = listing(summarize(project, run(emptyDocument(), triangle)));
    expect(sorted(tri.rooms[0]?.floor)).toEqual([[0.1, 0.1], [0.1, 1.852], [4.481, 0.1]]);
  });

  it("lists dimensions with their worked-out ends and length, left out when there are none", () => {
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    expect(listing(summarize(project, room))).not.toHaveProperty("dimensions");
    const doc = run(room, [{ type: "addDimension", opId: "m", a: { x: 3.9, y: 0.1 }, b: { x: 0.1, y: 0.1 }, offset: 0.5 }]);
    const s = listing(summarize(project, doc));
    expect(s.dimensions).toEqual([{ id: "m/m0", from: [3.9, 0.1], to: [0.1, 0.1], offset: 0.5, length: 3.8 }]);
    expect(s.counts.dimensions).toBe(1);
    // The mitred inner corner follows the joint to (4.285782, 0.1): not the stored point (3.8), nor a fixed offset from the centre (4.2).
    const moved = run(doc, [{ type: "moveJoints", moves: [{ jointId: jointAt(doc, 4, 0), to: { x: 4.4, y: 0 } }] }]);
    expect(listing(summarize(project, moved)).dimensions).toEqual([{ id: "m/m0", from: [4.286, 0.1], to: [0.1, 0.1], offset: 0.5, length: 4.186 }]);
    const far = listing(summarize(project, doc, { min: { x: 10, y: 10 }, max: { x: 11, y: 11 } }));
    expect(far).not.toHaveProperty("dimensions");
    expect(far.counts.dimensions).toBe(1);
    const near = listing(summarize(project, doc, { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } }));
    expect(near.dimensions).toEqual([{ id: "m/m0", from: [3.9, 0.1], to: [0.1, 0.1], offset: 0.5, length: 3.8 }]);
  });

  it("get_drawing lists decks with corners and ranges, each placement's on, and counts.decks", () => {
    // A 4 × 3 room; a platform turned 90° at (2, 1.5), 1.00 × 0.60 before turning; a hollow loft at the left end.
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    expect(listing(summarize(project, room)).decks).toEqual([]);
    const doc = run(room, [
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 2, y: 1.5 }, w: 1, d: 0.6, rotation: 90 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 0.6, y: 1.5 }, w: 1, d: 2.8 },
      { type: "placeObject", opId: "c", state: "s0", object: { kind: "chair" }, at: anchorAtMm({ x: 2, y: 1.5 }, 0.45, 0), deck: "p/k0" },
      { type: "placeObject", opId: "n", state: "s0", object: { kind: "nightstand" }, at: anchorAtMm({ x: 3.5, y: 2.5 }, 0.4, 0), deck: null },
    ]);
    const s = listing(summarize(project, doc));
    expect(s.counts.decks).toBe(2);
    expect(s.decks).toEqual([
      {
        id: "l/k0", name: "Loft", centre: [0.6, 1.5], width: 1, depth: 2.8, rotation: 0,
        corners: [[0.1, 0.1], [1.1, 0.1], [1.1, 2.9], [0.1, 2.9]], top: 2.15, solid: false, range: { bottom: 2.03, top: 2.15 }, holes: [], slabArea: 2.8, finish: null, guards: { upper: { kind: "railing", height: 1 }, right: { kind: "railing", height: 1 }, lower: { kind: "railing", height: 1 }, left: { kind: "railing", height: 1 } },
      },
      {
        id: "p/k0", name: "Platform", centre: [2, 1.5], width: 1, depth: 0.6, rotation: 90,
        corners: [[2.3, 1], [2.3, 2], [1.7, 2], [1.7, 1]], top: 0.45, solid: true, range: { bottom: 0, top: 0.45 }, holes: [], slabArea: 0.6, finish: null, guards: { upper: { kind: "none", height: 1 }, right: { kind: "none", height: 1 }, lower: { kind: "none", height: 1 }, left: { kind: "none", height: 1 } },
      },
    ]);
    expect(s.objects.map((o) => [o.id, o.placements["s0"]?.on])).toEqual([["c/o0", "p/k0"], ["n/o0", "floor"]]);
    // A region lists the decks touching it; the count stays the drawing's.
    const right = listing(summarize(project, doc, { min: { x: 1.5, y: 0 }, max: { x: 4, y: 3 } }));
    expect(right.decks.map((d) => d.id)).toEqual(["p/k0"]);
    expect(right.counts.decks).toBe(2);
    expect(overview(summarize(project, { ...grid(12), decks: doc.decks })).counts.decks).toBe(2);
  });
});

describe("large drawings (spec: mcp)", () => {
  it("lists a drawing of up to 300 walls in full, with the counts", () => {
    const doc = grid(11); // 264 walls
    const s = listing(summarize(project, doc));
    expect(s.walls).toHaveLength(264);
    expect(s.counts).toEqual({ walls: 264, joints: 144, rooms: 121, labels: 121, unplacedLabels: 0, objects: 0, openings: 0, dimensions: 0, decks: 0, columns: 0 });
  });

  it("summarizes a larger drawing: counts, bounds and a hint, no lists, a small reply", () => {
    const doc = grid(12); // 312 walls
    const s = overview(summarize(project, doc));
    expect(MAX_LISTED_WALLS).toBe(300);
    expect(s.project).toEqual(project);
    expect(s.counts).toEqual({ walls: 312, joints: 169, rooms: 144, labels: 144, unplacedLabels: 0, objects: 0, openings: 0, dimensions: 0, decks: 0, columns: 0 });
    expect(s.layouts).toEqual([{ id: "s0", name: "Layout" }]);
    expect(s.bounds).toEqual({ min: [0, 0], max: [12, 12] });
    expect(s.hint).toContain("region");
    expect(JSON.stringify(overview(summarize(project, grid(50)))).length).toBeLessThan(2_000);
  });

  it("lists only what touches a region, with the whole drawing's counts", () => {
    const doc = grid(12);
    const s = listing(summarize(project, doc, { min: { x: 2.5, y: 2.5 }, max: { x: 3.5, y: 3.5 } }));
    // The box covers joint (3, 3) and parts of the four rooms around it.
    expect(s.joints.map((j) => j.id)).toEqual(["j3_3"]);
    expect(s.walls.map((w) => w.id).sort()).toEqual(["h2_3", "h3_3", "v3_2", "v3_3"]);
    expect(s.rooms).toHaveLength(4);
    expect(s.counts.walls).toBe(312);
    const edge = listing(summarize(project, doc, { min: { x: 12, y: 0 }, max: { x: 13, y: 0 } })); // touches one corner
    expect(edge.joints.map((j) => j.id)).toEqual(["j12_0"]);
    expect(edge.walls.map((w) => w.id).sort()).toEqual(["h11_0", "v12_0"]);
  });

  it("lists unplaced labels inside the region only", () => {
    const doc: Document = { ...grid(12), zoneLabels: { far: { id: "far", at: { x: 50, y: 50 }, name: "Lost", finish: null }, near: { id: "near", at: { x: -1, y: -1 }, name: "Out", finish: null } } };
    const s = listing(summarize(project, doc, { min: { x: 40, y: 40 }, max: { x: 60, y: 60 } }));
    expect(s.unplacedLabels).toEqual([{ id: "far", name: "Lost", at: [50, 50], finish: null }]);
    expect(s.walls).toEqual([]);
  });

  it("summarizes a region holding more than 300 walls, asking to narrow it", () => {
    const s = overview(summarize(project, grid(20), { min: { x: 0, y: 0 }, max: { x: 15, y: 15 } }));
    expect(s.hint).toContain("narrow");
  });
});

describe("rooms with holes (holes, AC-10)", () => {
  const sorted = (ps: readonly [number, number][] | undefined): [number, number][] =>
    [...(ps ?? [])].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const donut = (): Document =>
    run(emptyDocument(), [...rectangleRoom({ x: 0, y: 0 }, 10, 8, "a"), ...rectangleRoom({ x: 3.5, y: 2.5 }, 3, 3, "c")]);
  const roomWith = (s: DrawingSummary, x: number, y: number): RoomSummary => {
    const r = s.rooms.find((room) => room.outline.some(([px, py]) => px === x && py === y));
    if (!r) throw new Error(`no room with an outline corner at ${x},${y}`);
    return r;
  };
  const apartment = (s: DrawingSummary): RoomSummary => roomWith(s, 0, 0);

  it("lists the apartment with one hole (outline and floor) and net area 66.20; the core's interior is a room without holes (AC-10)", () => {
    const s = listing(summarize(project, donut()));
    expect(s.rooms).toHaveLength(2);
    expect(s.counts.rooms).toBe(2);
    const a = apartment(s);
    expect(a.area).toBe(66.2); // 76.44 − 10.24, not 76.44
    expect(sorted(a.floor)).toEqual([[0.1, 0.1], [0.1, 7.9], [9.9, 0.1], [9.9, 7.9]]);
    expect(a.holes).toHaveLength(1);
    expect(sorted(a.holes?.[0]?.outline)).toEqual([[3.5, 2.5], [3.5, 5.5], [6.5, 2.5], [6.5, 5.5]]);
    expect(sorted(a.holes?.[0]?.floor)).toEqual([[3.4, 2.4], [3.4, 5.6], [6.6, 2.4], [6.6, 5.6]]);
    const core = s.rooms.find((r) => r !== a);
    expect(core?.area).toBe(7.84);
    expect(core).not.toHaveProperty("holes");
  });

  it("a room without holes has no holes field", () => {
    const s = listing(summarize(project, run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"))));
    expect(s.rooms[0]).not.toHaveProperty("holes");
    expect(JSON.stringify(s)).not.toContain('"holes"');
    const region = listing(summarize(project, grid(50), { min: { x: 0, y: 0 }, max: { x: 3, y: 3 } }));
    expect(region.rooms.length).toBeGreaterThan(0);
    expect(JSON.stringify(region)).not.toContain('"holes"'); // large-drawing replies do not grow
  });

  it("a hole belongs to the innermost room only: three levels (AC-03)", () => {
    const s = listing(summarize(project, run(donut(), rectangleRoom({ x: 4.7, y: 3.7 }, 0.6, 0.6, "k", 0.1))));
    expect(s.rooms).toHaveLength(3);
    const a = apartment(s);
    expect(a.area).toBe(66.2);
    expect(a.holes).toHaveLength(1);
    expect(sorted(a.holes?.[0]?.outline)).toEqual([[3.5, 2.5], [3.5, 5.5], [6.5, 2.5], [6.5, 5.5]]);
    const core = roomWith(s, 3.5, 2.5);
    expect(core.area).toBe(7.35); // 7.84 − 0.49
    expect(core.holes).toHaveLength(1);
    expect(sorted(core.holes?.[0]?.outline)).toEqual([[4.7, 3.7], [4.7, 4.3], [5.3, 3.7], [5.3, 4.3]]);
    expect(sorted(core.holes?.[0]?.floor)).toEqual([[4.65, 3.65], [4.65, 4.35], [5.35, 3.65], [5.35, 4.35]]);
    const column = roomWith(s, 4.7, 3.7);
    expect(column.area).toBe(0.25);
    expect(column).not.toHaveProperty("holes");
  });

  it("two cores give two holes (AC-04)", () => {
    const doc = run(emptyDocument(), [
      ...rectangleRoom({ x: 0, y: 0 }, 10, 8, "a"),
      ...rectangleRoom({ x: 2, y: 2 }, 1, 1, "c1"),
      ...rectangleRoom({ x: 7, y: 5 }, 1, 1, "c2"),
    ]);
    const a = apartment(listing(summarize(project, doc)));
    expect(a.area).toBe(73.56); // 76.44 − 2 × 1.44
    expect(a.holes).toHaveLength(2);
    const firstX = (h: { floor?: [number, number][] }): number => Math.min(...(h.floor ?? []).map(([x]) => x));
    expect((a.holes ?? []).map(firstX).sort((p, q) => p - q)).toEqual([1.9, 6.9]);
  });

  it("an unavailable room still lists its holes' outlines, without floors (AC-05)", () => {
    const doc = run(emptyDocument(), [...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), ...rectangleRoom({ x: 0.3, y: 1 }, 1, 1, "g", 0.5)]);
    const outer = roomWith(listing(summarize(project, doc)), 0, 0);
    expect(outer.area).toBeNull();
    expect(outer.note).toBe("Area unavailable: unsupported geometry");
    expect(outer).not.toHaveProperty("floor");
    expect(outer.holes).toHaveLength(1);
    expect(sorted(outer.holes?.[0]?.outline)).toEqual([[0.3, 1], [0.3, 2], [1.3, 1], [1.3, 2]]);
    expect(outer.holes?.[0]).not.toHaveProperty("floor");
  });
});

describe("a logo (sheetset.21)", () => {
  const BYTES = `/9j/${"logoBytes".repeat(100)}`;
  const logo: Command = { type: "setLogo", data: BYTES, width: 600, height: 200 };

  it("neither a listing nor an overview carries its bytes, or says anything of it", () => {
    for (const s of [listing(summarize(project, run(grid(1), [logo]))), overview(summarize(project, run(grid(12), [logo])))]) {
      expect(JSON.stringify(s)).not.toContain("logoBytes");
      expect(s).not.toHaveProperty("logos");
    }
  });
});

describe("the underlay block (import.08, .11; AC-10)", () => {
  // Opaque to summarize: the domain never decodes it, and no reply may carry it.
  const data = `/9j/${"UExBTi1QSUNUVVJF".repeat(40)}`;
  const place = (width: number, height: number, at: { x: number; y: number }): Command => ({ type: "placeUnderlay", pictureId: "p-1", data, width, height, at });

  it("summarize lists the underlay block, null without one", () => {
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    expect(listing(summarize(project, room)).underlay).toBeNull();
    const s = listing(summarize(project, run(room, [place(640, 360, { x: -2.37, y: 5.81 })])));
    expect(s.underlay).toEqual({ bounds: { min: [-2.37, 2.21], max: [4.03, 5.81] }, metresPerPixel: 0.01, scaled: false });
    expect(JSON.stringify(s)).not.toContain(data);
    expect(JSON.stringify(s)).not.toContain("UExBTi1QSUNUVVJF");
  });

  it("the overview carries the underlay block too", () => {
    const plain = overview(summarize(project, grid(12))); // 312 walls
    expect(plain.underlay).toBeNull();
    const o = overview(summarize(project, run(grid(12), [place(640, 360, { x: -2.37, y: 5.81 })])));
    expect(o.underlay).toEqual({ bounds: { min: [-2.37, 2.21], max: [4.03, 5.81] }, metresPerPixel: 0.01, scaled: false });
    expect(o.bounds).toEqual(plain.bounds); // joints only
    expect(o.bounds).toEqual({ min: [0, 0], max: [12, 12] });
    expect(JSON.stringify(o)).not.toContain("UExBTi1QSUNUVVJF");
  });

  it("underlay bounds match an independent computation (seeded fuzz)", () => {
    const random = mulberry32(42);
    const between = (lo: number, hi: number): number => lo + (hi - lo) * random();
    for (let i = 0; i < 200; i++) {
      const width = 1 + Math.floor(random() * 2000);
      const height = 1 + Math.floor(random() * 2000);
      const at = { x: between(-500, 500), y: between(-500, 500) };
      const a = { x: between(-500, 500), y: between(-500, 500) };
      const angle = between(0, 2 * Math.PI);
      const len = between(0.1, 50);
      const b = { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) };
      const distance = len * between(0.5, 20); // at least 5 mm a pixel: a 1 px side stays apart after rounding
      const doc = run(emptyDocument(), [place(width, height, at), { type: "scaleUnderlay", a, b, distance }]);
      const row = doc.underlays["underlay"];
      if (!row) throw new Error("no row");
      const block = listing(summarize(project, doc)).underlay;
      if (!block) throw new Error("no block");
      const m = row.metresPerPixel;
      const want = { min: [row.at.x, row.at.y - height * m], max: [row.at.x + width * m, row.at.y] };
      for (const corner of ["min", "max"] as const) {
        for (const k of [0, 1]) expect(Math.abs((block.bounds[corner][k] ?? NaN) - (want[corner][k] ?? NaN)), `case ${i}`).toBeLessThanOrEqual(0.0005);
      }
      expect(block.bounds.min[0]).toBeLessThan(block.bounds.max[0]);
      expect(block.bounds.min[1]).toBeLessThan(block.bounds.max[1]);
      expect(block.metresPerPixel).toBe(m);
      expect(block.scaled).toBe(true);
    }
  });
});

describe("the class legend (furnish.19, AC-15)", () => {
  it("lists each kind among the listed objects once, in kinds-table order, region-aware; none without objects", () => {
    // An 8 × 5 room (inner faces 0.1 / 7.9 and 0.1 / 4.9): beds b1 (x 0.15–1.85) and b2 (x 2.15–3.85) and a wardrobe
    // (x 4.4–5.6, y 4.25–4.85) against the top wall; a kitchen block at x 4.8–7.2, y 1.4–2.0.
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 8, 5, "r"));
    const doc = run(room, [
      { type: "placeObject", deck: null, opId: "b1", state: "s0", object: { kind: "bed" }, at: { x: 1, y: 4.85 } },
      { type: "placeObject", deck: null, opId: "b2", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 4.85 } },
      { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 5, y: 4.85 } },
      { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "kitchenBlock" }, at: { x: 6, y: 2 } },
    ]);
    const s = listing(summarize(project, doc));
    // The semantic classes left the listing (mcp.01): the domain's tests keep each kind's class.
    expect("classes" in s).toBe(false);
    expect(JSON.stringify(s)).not.toContain("IfcFurniture");
    expect("classes" in listing(summarize(project, doc, { min: { x: 4.5, y: 4.5 }, max: { x: 5.5, y: 4.8 } }))).toBe(false);
  });
});
