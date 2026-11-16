import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { flightHandrails } from "../src/queries/handrails";
import { placementFit } from "../src/queries/fit";
import { useZones, zoneExtent } from "../src/queries/footprints";
import { stairChecks } from "../src/queries/stair-checks";
import { stairEdges, stairOnEdge } from "../src/queries/stair-edge";
import { goingFor, stairGeometry } from "../src/queries/stairs";
import { winderTreads } from "../src/queries/winders";
import { rectangleRoom } from "../src/scripts";
import { STAIR_RULES } from "../src/stairs";

// The Winder stair (steps.04, .09, AC-03 to AC-05): one rectangle, its first three treads winding through a quarter
// turn inside the square at its front (a triangle, a kite, a triangle from the inner corner), the rest a straight
// flight to its back edge. Its pitch line is level across the square at 4 risers, then rises as a flight's.
//
//          back edge (on the deck)
//     ┌──────────────────┐ a = d
//     │  straight treads │
//     ├──────────────────┤ a = w: tread 4's nosing, 4 risers up
//     │ 3 ╲        ·inner│
//     │──╲  ╲ 2   ·      │ ◀ you walk in here (right side), or the left (Enters from: Left)
//     │     ╲   ·    1   │
//     └──────────────────┘ a = 0, the front edge

const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const W = 0.9;

/** An 8 m room under 3.20 with a 2.00 × 1.40 deck at `top` over x 0.60–2.60, y 4.80–6.20: its front edge y 4.80. */
function withDeck(top: number): Document {
  const doc = run(emptyDocument(), [
    ...rectangleRoom({ x: 0.37, y: 0.21 }, 8, 8, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "d", preset: top >= 1.2 ? "loft" : "platform", at: { x: 1.6, y: 5.5 }, w: 2, d: 1.4, name: "Deck" },
  ]);
  return run(doc, [{ type: "setDeck", deckId: "d/k0", top }]);
}

/** A Winder stair drawn up to the deck's front edge at x 1.6, standing on the floor. */
function winderTo(top: number): { doc: Document; id: string } {
  const doc = withDeck(top);
  const edge = stairEdges(doc, null, W).find((e) => e.deck === "d/k0" && e.normal.y === -1);
  if (!edge) throw new Error("no edge");
  const placed = run(doc, [{ type: "placeStair", opId: "w", state: "s0", kind: "winderStair", deck: "d/k0", at: { x: 1.6, y: edge.a.y }, shape: "straight", surface: null }]);
  const object = Object.values(placed.objects).find((o) => o.kind === "winderStair");
  if (!object) throw new Error("not placed");
  return { doc: placed, id: object.id };
}

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

describe("the Winder stair at a loft (AC-03)", () => {
  const { doc, id } = winderTo(2.15);
  const o = doc.objects[id];
  const r = 2.15 / 12;
  const going = goingFor(STAIR_RULES.solid.going, r);

  it("takes 12 risers of 0.179 and a run of 0.90 plus 8 straight treads", () => {
    const g = stairGeometry(STAIR_RULES.winder, W, o?.d.standard ?? 0, 2.15, null);
    expect(g.risers).toBe(12);
    expect(g.treads).toBe(11);
    expect(o?.d.standard).toBeCloseTo(W + 8 * going, 3);
    expect(near(g.going, ((o?.d.standard ?? 0) - W) / 8)).toBe(true);
  });

  it("warns of nothing but the loft's headroom (stairs.05)", () => {
    expect(stairChecks(doc, id).filter((c) => !c.ok).map((c) => c.id)).toEqual(["headroom"]);
  });

  it("knots: level at 4 risers across the front square, rising to 11 at the last nosing", () => {
    const g = stairGeometry(STAIR_RULES.winder, W, 0.9 + 8 * going, 2.15, null);
    expect(g.knots).toHaveLength(2);
    expect(g.knots[0]?.a).toBeCloseTo(W, 9);
    expect(g.knots[0]?.z).toBeCloseTo(4 * r, 9);
    expect(g.knots[1]?.a).toBeCloseTo(W + 7 * going, 9);
    expect(g.knots[1]?.z).toBeCloseTo(11 * r, 9);
    expect(g.nosingAt(4)).toBeCloseTo(W, 9);
    expect(g.runFor(0.25)).toBeCloseTo(W + 8 * 0.25, 9);
  });

  it("both handrails start where the straight part starts", () => {
    const rails = flightHandrails(doc).get(id) ?? [];
    expect(rails).toHaveLength(2);
    for (const rail of rails) expect(rail.knots[0]?.a).toBeCloseTo(W, 6);
  });

  it("a new winder's use zone lies on its entry side (the right), along the front square only", () => {
    const p = Object.values(doc.placements).find((q) => q.object === id);
    if (!p) throw new Error("no placement");
    expect(p.sides).toEqual({ front: false, back: false, left: false, right: true });
    const z = zoneExtent(doc, p, "right");
    expect(z?.start).toBeCloseTo((o?.d.standard ?? 0) - W, 6); // from the back corner
    expect(z?.end).toBeCloseTo(0, 9);
  });
});

describe("the Winder stair's limits (AC-05)", () => {
  it("to a 0.45 m platform it takes 5 risers, so it always has a straight tread", () => {
    const { doc, id } = winderTo(0.45);
    const o = doc.objects[id];
    const g = stairGeometry(STAIR_RULES.winder, W, o?.d.standard ?? 0, 0.45, null);
    expect(g.risers).toBe(5);
    expect(g.treads - 3).toBe(1);
  });

  it("typing a going keeps the front square: the run is the width plus the straight treads", () => {
    const { doc, id } = winderTo(2.15);
    const after = run(doc, [{ type: "setStair", objectId: id, going: 0.25 }]);
    expect(after.objects[id]?.d.standard).toBeCloseTo(W + 8 * 0.25, 3);
  });

  it("a winder less than 0.05 m deeper than wide is refused, by a resize and by a kind switch", () => {
    const { doc, id } = winderTo(2.15);
    const r = execute(doc, { type: "setObjectSize", objectId: id, w: W, d: { standard: W + 0.04 } });
    expect(r.ok ? null : r.error.message).toContain("A winder stair is deeper than it is wide");
    const stair = run(withDeck(2.15), [{ type: "placeObject", opId: "s", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 0.9 } }, at: { x: 4, y: 3 }, deck: null }]);
    const k = execute(stair, { type: "setObjectKind", objectId: "s/o0", kind: "winderStair" });
    expect(k.ok ? null : k.error.message).toContain("A winder stair is deeper than it is wide");
  });

  it("a piece over the front square collides unless its bottom is 1.00 m above 4 risers", () => {
    const { doc } = winderTo(2.15);
    // The winder runs from its back edge (y 4.80) toward −y; its front square is y 1.73–2.63 (run 3.07). A 0.30 box over it.
    const box = (z: number) => placementFit(doc, { kind: "block", state: "s0", at: { x: 1.6, y: 2.3 }, rotation: 0, config: "standard", w: 0.3, d: 0.3, h: 0.1, z, surface: null });
    const four = 4 * (2.15 / 12);
    expect(box(four + 0.99).fits).toBe(false);
    expect(box(four + 1.01).fits).toBe(true);
  });
});

describe("winderTreads (AC-03)", () => {
  const area = (ring: readonly { x: number; y: number }[]): number => Math.abs(ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    return s + p.x * q.y - q.x * p.y;
  }, 0)) / 2;

  it("a triangle, a kite and a triangle, from the inner corner, tiling the front square", () => {
    const t = winderTreads(W, false);
    expect(t.map((ring) => ring.length)).toEqual([3, 4, 3]);
    expect(t.reduce((s, ring) => s + area(ring), 0)).toBeCloseTo(W * W, 9);
    for (const ring of t) expect(ring.some((p) => near(p.x, W / 2) && near(p.y, W))).toBe(true); // the inner corner, right entry
    expect(area(t[0] ?? [])).toBeCloseTo(area(t[2] ?? []), 9);
  });

  it("Enters from the left mirrors them across the stair", () => {
    const right = winderTreads(W, false);
    const left = winderTreads(W, true);
    left.forEach((ring, i) => ring.forEach((p, j) => {
      expect(p.x).toBeCloseTo(-(right[i]?.[j]?.x ?? 0), 9);
      expect(p.y).toBeCloseTo(right[i]?.[j]?.y ?? 0, 9);
    }));
  });
});

const placementsOf = (doc: Document, id: string) => Object.values(doc.placements).filter((p) => p.object === id).sort((a, b) => a.id.localeCompare(b.id));
const sidesOf = (doc: Document, id: string) => placementsOf(doc, id).map((p) => p.sides);
const RIGHT = { front: false, back: false, left: false, right: true };
const LEFT = { front: false, back: false, left: true, right: false };

describe("entering from the left (AC-12, steps.39)", () => {
  it("is an option of the Winder stair only, and takes the use zone to the left in every layout; off brings it back", () => {
    const { doc: one, id } = winderTo(2.15);
    const doc = run(one, [{ type: "addState", opId: "n", name: "Night" }]);
    expect(sidesOf(doc, id)).toEqual([RIGHT, RIGHT]);
    const after = run(doc, [{ type: "setOption", objectId: id, option: "leftEntry", on: true }]);
    expect(after.objects[id]?.options).toEqual({ leftEntry: true });
    expect(sidesOf(after, id)).toEqual([LEFT, LEFT]);
    const back = run(after, [{ type: "setOption", objectId: id, option: "leftEntry", on: false }]);
    expect(back.placements).toEqual(doc.placements);
    const stair = run(withDeck(2.15), [{ type: "placeObject", opId: "s", state: "s0", object: { kind: "stair" }, at: { x: 4, y: 5 }, deck: null }]);
    const r = execute(stair, { type: "setOption", objectId: "s/o0", option: "leftEntry", on: true });
    expect(r.ok).toBe(false);
  });

  it("the zone lands beside the front square on the left, a stored extent with it, as the right's mirror", () => {
    const { doc: placed, id } = winderTo(2.15);
    const p0 = placementsOf(placed, id)[0];
    if (!p0) throw new Error("no placement");
    const doc = run(placed, [{ type: "setZoneExtent", placementId: p0.id, side: "right", extent: { depth: 0.7, start: 2.0, end: 0.05 } }]);
    const after = run(doc, [{ type: "setOption", objectId: id, option: "leftEntry", on: true }]);
    const p = placementsOf(after, id)[0];
    if (!p) throw new Error("no placement");
    expect(zoneExtent(after, p, "left")).toEqual({ depth: 0.7, start: 2.0, end: 0.05 });
    expect(zoneExtent(after, p, "right")).toBeNull();
    // In the world: the stair stands at x 1.15–2.05 (its back's middle at x 1.6, front toward −y); the zone now lies
    // left of it, x 0.45–1.15, against the front square's end of the stair (y 4.80 − d … 4.80 − 2.0).
    const quad = useZones(after).get(p.id)?.find((z) => z.side === "left")?.quad ?? [];
    const xs = quad.map((q) => q.x);
    const ys = quad.map((q) => q.y);
    expect(Math.min(...xs)).toBeCloseTo(1.6 - W / 2 - 0.7, 6);
    expect(Math.max(...xs)).toBeCloseTo(1.6 - W / 2, 6);
    expect(Math.max(...ys)).toBeCloseTo(4.8 - 2.0, 6);
    expect(Math.min(...ys)).toBeCloseTo(4.8 - (placed.objects[id]?.d.standard ?? 0) + 0.05, 6);
  });
});

/** An 8 m room (inner faces x 0.47 / 8.27) under 3.20 with a loft over x 6.27–8.27, y 4.80–6.20, against the east wall. */
function deckByEastWall(): Document {
  return run(emptyDocument(), [
    ...rectangleRoom({ x: 0.37, y: 0.21 }, 8, 8, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "d", preset: "loft", at: { x: 7.27, y: 5.5 }, w: 2, d: 1.4, name: "Deck" },
  ]);
}

/** A 1.60 m wide room (inner faces x 0.10 / 1.50) with a loft across it, its front edge at y 4.00. */
function narrowRoom(): Document {
  return run(emptyDocument(), [
    ...rectangleRoom({ x: 0, y: 0 }, 1.6, 6, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "d", preset: "loft", at: { x: 0.8, y: 4.9 }, w: 1.4, d: 1.8, name: "Deck" },
  ]);
}

const winderAt = (doc: Document, x: number, y: number) => stairOnEdge(doc, { state: "s0", kind: "winderStair", surface: null, deck: "d/k0", at: { x, y }, shape: "straight" });

describe("a winder drawn at a deck's edge picks its entry away from a wall (AC-12, steps.39)", () => {
  it("enters from the right where its right entry is free", () => {
    const parts = winderAt(deckByEastWall(), 6.8, 4.8); // x 6.35–7.25: 1.02 m to the east wall's face
    expect(parts.ok && parts.value.flights[0]).toMatchObject({ leftEntry: false, sides: RIGHT });
  });

  it("enters from the left where its right entry would run into the wall, and is placed so", () => {
    const doc = deckByEastWall();
    const parts = winderAt(doc, 7.8, 4.8); // x 7.35–8.25: 0.02 m from the east wall's face
    expect(parts.ok && parts.value.flights[0]).toMatchObject({ leftEntry: true, sides: LEFT });
    const placed = run(doc, [{ type: "placeStair", opId: "w", state: "s0", kind: "winderStair", deck: "d/k0", at: { x: 7.8, y: 4.8 }, shape: "straight", surface: null }]);
    expect(placed.objects["w/s0/o0"]?.options).toEqual({ leftEntry: true });
    expect(sidesOf(placed, "w/s0/o0")).toEqual([LEFT]);
  });

  it("stays on the right when both entries would meet a wall", () => {
    const parts = winderAt(narrowRoom(), 0.8, 4.0);
    expect(parts.ok && parts.value.flights[0]).toMatchObject({ leftEntry: false, sides: RIGHT });
  });

  it("a straight flight has no entry: leftEntry false, its sides the kind's", () => {
    const parts = stairOnEdge(deckByEastWall(), { state: "s0", kind: "stair", surface: null, deck: "d/k0", at: { x: 7.7, y: 4.8 }, shape: "straight" });
    expect(parts.ok && parts.value.flights[0]?.leftEntry).toBe(false);
  });
});

describe("setStair with options (steps.07, AC-04, AC-07, AC-11)", () => {
  it("a riser and Enters from the left on a winder are one edit, one patch", () => {
    const { doc, id } = winderTo(2.15);
    const r = unwrap(execute(doc, { type: "setStair", objectId: id, riser: 0.18, leftEntry: true }));
    expect(r.doc.objects[id]?.options).toEqual({ leftEntry: true });
    expect(r.doc.objects[id]?.riser).toBe(0.18);
    expect(r.patch.puts.filter((p) => p.table === "objects")).toHaveLength(1);
  });

  it("setStair leftEntry swaps the zone as setOption does, and setting the side it already has changes nothing", () => {
    const { doc, id } = winderTo(2.15);
    const left = run(doc, [{ type: "setStair", objectId: id, leftEntry: true }]);
    expect(sidesOf(left, id)).toEqual([LEFT]);
    const again = unwrap(execute(left, { type: "setStair", objectId: id, leftEntry: true }));
    expect(sidesOf(again.doc, id)).toEqual([LEFT]);
    expect(again.doc.placements).toEqual(left.placements);
    const same = unwrap(execute(left, { type: "setOption", objectId: id, option: "leftEntry", on: true }));
    expect(same.doc).toBe(left);
  });

  it("refuses Enters from the left on a stair that isn't a winder, and Hooks on anything but a rung ladder", () => {
    const stair = run(withDeck(2.15), [{ type: "placeObject", opId: "s", state: "s0", object: { kind: "stair" }, at: { x: 4, y: 5 }, deck: null }]);
    const left = execute(stair, { type: "setStair", objectId: "s/o0", leftEntry: true });
    expect(left.ok ? null : left.error.message).toBe("Only a winder stair is entered from the left");
    const hooks = execute(stair, { type: "setStair", objectId: "s/o0", hooks: true });
    expect(hooks.ok ? null : hooks.error.message).toBe("Only a rung ladder takes hooks");
  });
});
