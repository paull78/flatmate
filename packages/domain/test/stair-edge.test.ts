import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { applyPatch, invertPatch } from "../src/patch";
import { emptyDocument, type Document, type Placement } from "../src/model";
import { stairEdges, stairOnEdge, type StairEdge, type StairRequest } from "../src/queries/stair-edge";
import { recommendedRun, stairGeometry } from "../src/queries/stairs";
import { rectangleRoom } from "../src/scripts";
import { STAIR_RULES } from "../src/stairs";
import { validateDocument } from "../src/validate";
import { deepFreeze, place } from "./helpers";

// A stair on a deck's edge (stairdraw.18, .20, AC-03, AC-04, AC-13): which edges a stair can go up to, the straight
// flight hanging off a point on one, and placeStair placing it in every layout.

const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

/**
 * The sample room, off the grid: inner faces x 0.47–5.47, y 0.31–5.31, under a 3.20 ceiling, with a hollow loft at
 * +2.15 in the top right corner (x 3.37–5.47, y 3.71–5.31) against the right and top walls, and a Night layout.
 */
const LOFT = "loft/k0";
const room = (): Document =>
  run(emptyDocument(), [
    ...rectangleRoom({ x: 0.37, y: 0.21 }, 5.2, 5.2, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4.42, y: 4.51 }, w: 2.1, d: 1.6, name: "Loft" },
    { type: "addState", opId: "n", name: "Night" },
  ]);

/** The room with a 2.00 × 1.40 platform at +0.45, x 0.60–2.60, y 0.80–2.20. */
const PLATFORM = "plat/k0";
const withPlatform = (doc: Document, rotation = 0, at = { x: 1.6, y: 1.5 }): Document =>
  run(doc, [{ type: "addDeck", opId: "plat", preset: "platform", at, w: 2, d: 1.4, rotation, name: "Platform" }]);

const near = (p: { x: number; y: number }, x: number, y: number): boolean => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;
const shape = (e: StairEdge) => ({ deck: e.deck, a: [round(e.a.x), round(e.a.y)], b: [round(e.b.x), round(e.b.y)], normal: [round(e.normal.x), round(e.normal.y)] });
const round = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

type Asked = Partial<Omit<StairRequest, "at">>;
const straight = (at: { x: number; y: number }, extra: Asked = {}): StairRequest => ({ state: "s0", kind: "stair", deck: LOFT, at, shape: "straight", surface: null, ...extra });
const placeCmd = (opId: string, at: { x: number; y: number }, extra: Asked = {}): Command => ({ type: "placeStair", opId, ...straight(at, extra) });
const copies = (doc: Document, object: string): Placement[] => Object.values(doc.placements).filter((p) => p.object === object).sort((a, b) => (a.state < b.state ? -1 : 1));

describe("stairEdges (AC-03)", () => {
  it("stairEdges lists the loft's free edges and leaves out the one flush on a wall", () => {
    // Ring order: bottom (y 3.71), right (x 5.47, on the wall), top (y 5.31, on the wall), left (x 3.37).
    expect(stairEdges(room(), null, 0.9).map(shape)).toEqual([
      { deck: LOFT, a: [3.37, 3.71], b: [5.47, 3.71], normal: [0, -1] },
      { deck: LOFT, a: [3.37, 5.31], b: [3.37, 3.71], normal: [-1, 0] },
    ]);
  });

  it("stairEdges leaves out an edge shorter than the stair's width, and the surface deck's own edges", () => {
    const doc = withPlatform(room());
    // The platform's 1.40 sides are shorter than a 1.60 spiral but not than a 0.90 stair; its 2.00 sides catch both.
    const decks = (w: number, surface: string | null) => stairEdges(doc, surface, w).map((e) => e.deck);
    expect(decks(0.9, null)).toEqual([LOFT, LOFT, PLATFORM, PLATFORM, PLATFORM, PLATFORM]);
    expect(decks(1.6, null)).toEqual([LOFT, LOFT, PLATFORM, PLATFORM]);
    // The loft's left edge is 1.60 long: a 1.61 stair is too wide for it.
    expect(stairEdges(doc, null, 1.61).filter((e) => e.deck === LOFT).map(shape).map((e) => e.normal)).toEqual([[0, -1]]);
    // Standing on the platform, only the loft's edges catch: never the platform's own.
    expect(decks(0.9, PLATFORM)).toEqual([LOFT, LOFT]);
    // Standing on the loft, nothing is above it.
    expect(decks(0.9, LOFT)).toEqual([]);
  });

  it("stairEdges on a deck turned 30°: the normals point away from the deck", () => {
    const centre = { x: 1.9, y: 1.7 };
    const edges = stairEdges(withPlatform(room(), 30, centre), null, 0.9).filter((e) => e.deck === PLATFORM);
    expect(edges).toHaveLength(4);
    const angles = edges.map((e) => Math.round((((Math.atan2(e.normal.y, e.normal.x) * 180) / Math.PI) + 360) % 360));
    expect(angles).toEqual([300, 30, 120, 210]);
    for (const e of edges) {
      expect(Math.hypot(e.normal.x, e.normal.y)).toBeCloseTo(1, 12);
      const mid = { x: (e.a.x + e.b.x) / 2 - centre.x, y: (e.a.y + e.b.y) / 2 - centre.y };
      expect(mid.x * e.normal.x + mid.y * e.normal.y).toBeGreaterThan(0.69); // the half depth or width out
      expect(Math.abs((e.b.x - e.a.x) * e.normal.x + (e.b.y - e.a.y) * e.normal.y)).toBeLessThan(1e-9); // across the edge
    }
  });
});

describe("stairOnEdge, straight", () => {
  it("stairOnEdge straight: a Stair at a point on the loft's front edge gives back-middle on the edge, rotation facing it, 12 risers, d = recommendedRun, h 2.15", () => {
    const parts = unwrap(stairOnEdge(room(), straight({ x: 4.237, y: 3.71 })));
    expect(parts.landing).toBeNull();
    expect(parts.flights).toHaveLength(1);
    const [f] = parts.flights;
    expect(f).toEqual({ at: { x: 4.237, y: 3.71 }, rotation: 0, w: 0.9, d: 2.988, h: 2.15, reaches: LOFT, startsAt: null, sides: null, leftEntry: false });
    expect(f?.d).toBe(Math.round(recommendedRun(STAIR_RULES.solid, 2.15, null) * 1000) / 1000);
    expect(stairGeometry(STAIR_RULES.solid, f?.w ?? 0, f?.d ?? 0, f?.h ?? 0, null).risers).toBe(12);
  });

  it("stairOnEdge projects an off-edge point onto the edge, and refuses a point more than 1 cm away (notOnEdge)", () => {
    const doc = room();
    expect(unwrap(stairOnEdge(doc, straight({ x: 4.2034, y: 3.7031 }))).flights[0]?.at).toEqual({ x: 4.203, y: 3.71 });
    expect(unwrap(stairOnEdge(doc, straight({ x: 3.3651, y: 4.5 }))).flights[0]).toMatchObject({ at: { x: 3.37, y: 4.5 }, rotation: 270 });
    expect(stairOnEdge(doc, straight({ x: 4.2, y: 3.695 }))).toEqual({ ok: false, error: "notOnEdge" });
    // On the loft's edge flush against the right wall, and a deck that isn't there.
    expect(stairOnEdge(doc, straight({ x: 5.47, y: 4.5 }))).toEqual({ ok: false, error: "notOnEdge" });
    expect(stairOnEdge(doc, straight({ x: 4.2, y: 3.71 }, { deck: "nope" }))).toEqual({ ok: false, error: "notOnEdge" });
    // Furniture doesn't go up to a deck, and a ship's ladder makes no L (the L: stair-edge-l.test.ts).
    expect(stairOnEdge(doc, straight({ x: 4.2, y: 3.71 }, { kind: "bed" }))).toEqual({ ok: false, error: "kindNotStair" });
    expect(stairOnEdge(doc, straight({ x: 4.2, y: 3.71 }, { kind: "shipsLadder", shape: "l-left" }))).toEqual({ ok: false, error: "doesNotTurn" });
  });

  it("stairOnEdge from a 0.45 platform's edge gives h 0.45 and its shorter run", () => {
    const doc = withPlatform(room());
    // The platform's right edge, x 2.60: up points toward −x, so the stair is turned 90° (its front faces +x).
    const [f] = unwrap(stairOnEdge(doc, straight({ x: 2.6, y: 1.5 }, { deck: PLATFORM }))).flights;
    expect(f).toEqual({ at: { x: 2.6, y: 1.5 }, rotation: 90, w: 0.9, d: 0.6, h: 0.45, reaches: PLATFORM, startsAt: null, sides: null, leftEntry: false });
    // Standing on the platform, a stair to the loft rises 1.70.
    expect(unwrap(stairOnEdge(doc, straight({ x: 4.2, y: 3.71 }, { surface: PLATFORM }))).flights[0]?.h).toBe(1.7);
  });

  it("stairOnEdge on the 30° deck turns the stair with the edge and keeps its back middle on it", () => {
    const doc = withPlatform(room(), 30, { x: 1.9, y: 1.7 });
    const edge = stairEdges(doc, null, 0.9).find((e) => e.deck === PLATFORM && e.normal.y > 0.49 && e.normal.x > 0.86);
    if (!edge) throw new Error("no 30° edge");
    const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    const [f] = unwrap(stairOnEdge(doc, straight(mid, { deck: PLATFORM }))).flights;
    expect(f?.rotation).toBe(120); // its front faces 30°
    expect(Math.abs(((f?.at.x ?? 0) - mid.x))).toBeLessThanOrEqual(0.0005);
    expect(Math.abs(((f?.at.y ?? 0) - mid.y))).toBeLessThanOrEqual(0.0005);
  });
});

describe("placeStair (AC-04)", () => {
  it("placeStair places the parts stairOnEdge gave, in every layout, reaching the deck", () => {
    const doc = room();
    const [f] = unwrap(stairOnEdge(doc, straight({ x: 4.237, y: 3.71 }))).flights;
    const next = unwrap(execute(doc, placeCmd("ps", { x: 4.237, y: 3.71 }))).doc;
    expect(next.objects["ps/s0/o0"]).toMatchObject({ kind: "stair", w: { standard: f?.w }, d: { standard: f?.d }, h: { standard: 2.15 }, reaches: LOFT, startsAt: null });
    expect(copies(next, "ps/s0/o0").map((p) => ({ state: p.state, at: p.at, rotation: p.rotation, deck: p.deck }))).toEqual([
      { state: "n/s0", at: f?.at, rotation: f?.rotation, deck: null },
      { state: "s0", at: f?.at, rotation: f?.rotation, deck: null },
    ]);
    expect(validateDocument(next).ok).toBe(true);
  });

  it("placeStair places on the 30° deck and from the platform's edge, at the rise", () => {
    const turned = withPlatform(room(), 30, { x: 1.9, y: 1.7 });
    const edge = stairEdges(turned, null, 0.9).find((e) => e.deck === PLATFORM && e.normal.y > 0.49 && e.normal.x > 0.86);
    if (!edge) throw new Error("no 30° edge");
    const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    const [f] = unwrap(stairOnEdge(turned, straight(mid, { deck: PLATFORM }))).flights;
    const next = unwrap(execute(turned, placeCmd("ps", mid, { deck: PLATFORM }))).doc;
    expect(copies(next, "ps/s0/o0")[0]).toMatchObject({ at: f?.at, rotation: 120 });
    expect(next.objects["ps/s0/o0"]).toMatchObject({ reaches: PLATFORM, h: { standard: 0.45 } });
  });

  it("placeStair checks the stair at its rise: under a shelf at 1.00 a 0.45 stair fits where a 2.15 one doesn't (AC-13)", () => {
    // A shelf hung at 1.00–1.30 over x 2.70–3.10, right where the platform's stair runs (x 2.60–3.20, y 1.05–1.95).
    const doc = deepFreeze(place(withPlatform(room()), { object: "sh", kind: "shelf", at: [2.9, 1.7], size: { w: { standard: 0.4 }, d: { standard: 0.4 }, h: { standard: 0.3 }, z: { standard: 1 } } }));
    expect(validateDocument(doc).ok).toBe(true);
    const tall: Command = { type: "placeObject", opId: "t", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 0.6 } }, at: { x: 2.6, y: 1.5 }, rotation: 90, deck: null, reaches: null };
    expect(execute(doc, tall)).toMatchObject({ ok: false, error: { message: "Shelf (1.00–1.30) and Stair (0.00–2.15) overlap in Layout" } });
    const next = unwrap(execute(doc, placeCmd("ps", { x: 2.6, y: 1.5 }, { deck: PLATFORM }))).doc;
    expect(next.objects["ps/s0/o0"]).toMatchObject({ reaches: PLATFORM, h: { standard: 0.45 } });
  });

  it("placeStair refuses a stair that doesn't fit, with the domain's reason, and changes nothing", () => {
    const doc = deepFreeze(room());
    // Off the loft's left edge a 2.99 run reaches x 0.38, past the left wall's face at 0.47.
    const r = execute(doc, placeCmd("ps", { x: 3.37, y: 4.5 }));
    // Its copy in Night comes first by ID.
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid", message: "Stair (0.00–2.15) overlaps a wall in Night" } });
    // The structured refusals, put into words.
    expect(execute(doc, placeCmd("ps", { x: 4.2, y: 3.6 }))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Not on an edge a stair can go up to" } });
    expect(execute(doc, placeCmd("ps", { x: 4.2, y: 3.71 }, { kind: "bed" }))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Only a stair or a ladder goes up to a deck" } });
    expect(execute(doc, placeCmd("ps", { x: 4.2, y: 3.71 }, { kind: "shipsLadder", shape: "l-right" }))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Ship's ladder doesn't turn" } });
    expect(execute(doc, placeCmd("ps", { x: 4.2, y: 3.71 }, { surface: "nope" }))).toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(execute(doc, placeCmd("ps", { x: 4.2, y: 3.71 }, { state: "nope" }))).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("placeStair refuses a used opId", () => {
    const doc = unwrap(execute(room(), placeCmd("ps", { x: 4.237, y: 3.71 }))).doc;
    expect(execute(doc, placeCmd("ps", { x: 4.8, y: 3.71 }))).toMatchObject({ ok: false, error: { message: "Operation ID already used" } });
  });

  it("placeStair is one patch", () => {
    const doc = deepFreeze(room());
    const r = unwrap(execute(doc, placeCmd("ps", { x: 4.237, y: 3.71 })));
    expect(r.patch.puts.map((p) => `${p.table}:${p.entity.id}`)).toEqual(["objects:ps/s0/o0", "placements:ps/s0/o0/n/s0", "placements:ps/s0/p0"]);
    expect(r.patch.dependencies).toEqual(expect.arrayContaining([{ table: "decks", id: LOFT }, { table: "states", id: "s0" }]));
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    expect(near(r.doc.placements["ps/s0/p0"]?.at ?? { x: 0, y: 0 }, 4.237, 3.71)).toBe(true);
  });
});
