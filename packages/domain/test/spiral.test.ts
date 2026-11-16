import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { STAIR_RULES, kindOf, spiralLanding, spiralTreads, stairGeometry, stairRuleOf, stairTurn, useZones } from "../src";
import { add, inConvex, rotateAbout } from "../src/geometry";
import type { Document, LayoutObject } from "../src/model";
import { stairChecks } from "../src/queries/stair-checks";
import { newSides, spiralEntrySide } from "../src/queries/stair-edge";
import { risersFor } from "../src/queries/stairs";
import { defaultSides } from "../src/kinds";
import { footprintQuad } from "../src/queries/footprints";
import type { StairRule } from "../src/stairs";
import { validateDocument } from "../src/validate";
import { tinyHouse, withDeck } from "./helpers";

// The spiral stair (stairs.21, AC-09): a square box, its diameter the width and the depth; treads of 30° around a 0.13
// column, rising clockwise and arriving at its back edge, so it reaches a deck like any stair.

const run = (doc: Document, ...cmds: readonly Command[]): Document =>
  cmds.reduce((d, c) => {
    const r = execute(d, c);
    if (!r.ok) throw new Error(r.error.message);
    return r.value.doc;
  }, doc);

/** The decks' tiny house under a 3.20 ceiling with a hollow loft over x 4.9–6.9 at +2.15. */
const house = (): Document => withDeck(run(tinyHouse(), { type: "setCeiling", height: 3.2 }), { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top: 2.15, solid: false });
/** A spiral turned 270° (its back edge toward +x) with its back edge's middle on the loft's left edge: x 3.3–4.9, y 0.45–2.05. */
const toLoft: Command = { type: "placeObject", opId: "sp", state: "s0", object: { kind: "spiralStair" }, at: { x: 4.9, y: 1.25 }, rotation: 270, deck: null, reaches: "L" };
const spiral = (doc: Document): LayoutObject => {
  const o = doc.objects["sp/o0"];
  if (!o) throw new Error("no spiral");
  return o;
};

describe("the spiral stair", () => {
  it("is a stair kind with the spiral rule, a 1.60 square box 2.15 high, an IfcStair SPIRAL_STAIR", () => {
    expect(stairRuleOf("spiralStair")).toBe(STAIR_RULES.spiral);
    expect(kindOf("spiralStair")).toMatchObject({ label: "Spiral stair", semanticClass: "IfcStair SPIRAL_STAIR", outline: "rect" });
    expect(kindOf("spiralStair")?.configs).toEqual([{ id: "standard", label: "Standard", w: 1.6, d: 1.6, zone: 0.9, h: 2.15, z: 0 }]);
  });

  it("a 1.60 spiral to the loft has 10 risers of 0.215, 9 treads, turns 270°, clear width 0.735, walking-line tread 0.194 (AC-09)", () => {
    const doc = run(house(), toLoft);
    expect(spiral(doc)).toMatchObject({ reaches: "L", h: { standard: 2.15 } });
    const g = stairGeometry(STAIR_RULES.spiral, 1.6, 1.6, 2.15, null);
    expect(g).toMatchObject({ risers: 10, treads: 9, riser: expect.closeTo(0.215, 9), going: expect.closeTo(0.194, 3) });
    expect(stairTurn(STAIR_RULES.spiral, g.treads)).toBe(270);
    const checks = stairChecks(doc, "sp/o0");
    expect(checks.filter((c) => c.id !== "headroom").every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.id === "clearWidth")).toMatchObject({ value: expect.closeTo(0.735, 9), min: 0.66 });
    expect(checks.find((c) => c.id === "walkingTread")).toMatchObject({ value: expect.closeTo(0.194, 3), min: 0.171 });
    expect(checks.find((c) => c.id === "riser")).toMatchObject({ value: expect.closeTo(0.215, 9), max: 0.241 });
    expect(checks.find((c) => c.id === "reach")).toMatchObject({ ok: true, deck: "L" });
  });

  it("the last tread ends at the back edge (90°), rising clockwise from the first; the angles are the footprint's, so the rotation turns them", () => {
    const treads = spiralTreads(STAIR_RULES.spiral, 9);
    expect(treads).toHaveLength(9);
    // Angles in the footprint frame, counter-clockwise from +x across, 90° toward the back edge.
    expect(treads.at(-1)).toEqual({ from: 90, to: 120 });
    expect(treads[0]).toEqual({ from: 330, to: 360 });
    for (const [i, t] of treads.entries()) if (i > 0) expect(t.to).toBe(treads[i - 1]?.from); // clockwise: each tread follows the last one round
  });

  it("resizing a spiral keeps width and depth equal: by its width, by its depth and by a side grip", () => {
    const placed = run(house(), { ...toLoft, at: { x: 4.5, y: 1.25 } });
    const size = (doc: Document) => [spiral(doc).w.standard, spiral(doc).d.standard];
    expect(size(run(placed, { type: "setObjectSize", objectId: "sp/o0", w: 1.4, d: {} }))).toEqual([1.4, 1.4]);
    expect(size(run(placed, { type: "setObjectSize", objectId: "sp/o0", w: 1.6, d: { standard: 1.5 } }))).toEqual([1.5, 1.5]);
    expect(size(run(placed, { type: "setObjectSize", objectId: "sp/o0", w: 1.45, d: { standard: 1.5 } }))).toEqual([1.45, 1.45]);
    expect(size(run(placed, { type: "resizePlacement", placementId: "sp/p0", side: "right", size: 1.3 }))).toEqual([1.3, 1.3]);
    const deeper = run(placed, { type: "resizePlacement", placementId: "sp/p0", side: "front", size: 1.5 });
    expect(size(deeper)).toEqual([1.5, 1.5]);
    expect(deeper.placements["sp/p0"]?.at).toEqual({ x: 4.5, y: 1.25 }); // the back edge stays
    expect(validateDocument(deeper).ok).toBe(true);
  });

  it("other stairs keep their width and depth apart", () => {
    const doc = run(house(), { type: "placeObject", opId: "st", state: "s0", object: { kind: "storageStair" }, at: { x: 4.9, y: 0.5 }, rotation: 270, deck: null });
    const resized = run(doc, { type: "setObjectSize", objectId: "st/o0", w: 0.7, d: {} });
    expect([resized.objects["st/o0"]?.w.standard, resized.objects["st/o0"]?.d.standard]).toEqual([0.7, 1.99]);
  });
});

// A spiral's use zone at placement (stairdraw.15, AC-14; edge-catch.10, .23): every new spiral gets one zone, on the side
// of its box you walk in from to its first tread, from its rise once linked; a later change of rise doesn't move it.
describe("the spiral's use zone", () => {
  it("spiralEntrySide: the side you walk in from, a quarter turn back from where the first tread starts (edge-catch.23)", () => {
    // Footprint angles, counter-clockwise from +x: 0° right, 90° back, 180° left, 270° front. The spiral rises
    // clockwise: you step onto tread 0 across its `to` radius moving clockwise, so you come from 90° counter-clockwise of it.
    // 10 risers (2.15 m at most 0.22): 9 treads, tread 0 is 330°–360°: it starts at 0° and you come from 90°, the back.
    expect(spiralTreads(STAIR_RULES.spiral, 9)[0]).toEqual({ from: 330, to: 360 });
    expect(spiralEntrySide(STAIR_RULES.spiral, 10)).toBe("back");
    // 7 risers (1.50 m): 6 treads turning 180°, tread 0 is 240°–270°: it starts at 270°, you come from 360°, the right.
    expect(spiralTreads(STAIR_RULES.spiral, 6)[0]).toEqual({ from: 240, to: 270 });
    expect(spiralEntrySide(STAIR_RULES.spiral, 7)).toBe("right");
    // 13 risers: 12 treads, a whole turn, tread 0 is 420°–450°: it starts at 90°, you come from 180°, the left.
    expect(spiralTreads(STAIR_RULES.spiral, 12)[0]).toEqual({ from: 420, to: 450 });
    expect(spiralEntrySide(STAIR_RULES.spiral, 13)).toBe("left");
    // 8 risers: tread 0 starts at 300°, you come from 30°: 30° from the right. 9 risers: from 60°, 30° from the back.
    // 12 risers: from 150°, 30° from the left.
    expect(spiralEntrySide(STAIR_RULES.spiral, 8)).toBe("right");
    expect(spiralEntrySide(STAIR_RULES.spiral, 9)).toBe("back");
    expect(spiralEntrySide(STAIR_RULES.spiral, 12)).toBe("left");
    // 30° treads never land halfway between two sides; a 45° turn per tread would, and ties go in the order front,
    // right, left, back: 3 treads come from 315° (front or right): the front; 5 from 45° (right or back): the right;
    // 7 from 135° (back or left): the left; 1 from 225° (left or front): the front.
    const half: StairRule = { ...STAIR_RULES.spiral, going: { kind: "turn", deg: 45 } };
    expect([4, 6, 8, 2].map((r) => spiralEntrySide(half, r))).toEqual(["front", "right", "left", "front"]);
  });

  /** The loft's spiral by placeStair: its back on the loft's left edge at y 1.25, so turned 270° like `toLoft`. */
  const onEdge: Command = { type: "placeStair", opId: "ps", state: "s0", kind: "spiralStair", deck: "L", at: { x: 4.9, y: 1.24 }, shape: "straight", surface: null };
  const night = (doc: Document): Document => run(doc, { type: "addState", opId: "n", name: "Night" });
  const copies = (doc: Document, object: string) => Object.values(doc.placements).filter((p) => p.object === object);

  it("placeStair puts a spiral's back on the loft's edge, its last tread ending at the edge's middle, its only zone on the entry side, in every layout (AC-14)", () => {
    const doc = run(night(house()), onEdge);
    const p = doc.placements["ps/s0/p0"];
    expect(p).toMatchObject({ at: { x: 4.9, y: 1.24 }, rotation: 270 });
    expect(doc.objects["ps/s0/o0"]).toMatchObject({ reaches: "L", h: { standard: 2.15 }, w: { standard: 1.6 }, d: { standard: 1.6 } });
    expect(copies(doc, "ps/s0/o0")).toHaveLength(2);
    for (const c of copies(doc, "ps/s0/o0")) expect(c.sides).toEqual({ front: false, back: true, left: false, right: false });
    if (!p) throw new Error("no placement");

    // Footprint space to the world as the plan draws a symbol (placeSymbol) and as footprints are placed.
    const world = (q: { x: number; y: number }) => rotateAbout(add(q, p.at), p.at, p.rotation);
    expect(world({ x: 0.8, y: 0 })).toEqual(footprintQuad(p.at, 1.6, 1.6, p.rotation)[2]); // the back-right corner
    const centre = { x: 0, y: -0.8 };
    const radial = (deg: number, r: number) => world({ x: centre.x + r * Math.cos((deg * Math.PI) / 180), y: centre.y + r * Math.sin((deg * Math.PI) / 180) });
    const treads = spiralTreads(STAIR_RULES.spiral, 9);
    // The last tread ends on the back edge's middle, on the loft's edge.
    const top = radial(treads.at(-1)?.from ?? NaN, 0.8);
    expect([top.x, top.y].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([4.9, 1.24]);
    // The first tread starts on the radius at 360°, and you walk onto it from 90° (edge-catch.23): just past the circle
    // there lies the one zone, the back one.
    const zones = useZones(doc).get(p.id) ?? [];
    expect(zones.map((z) => z.side)).toEqual(["back"]);
    const entry = radial((treads[0]?.to ?? NaN) + 90, 0.85);
    expect(inConvex(entry, zones[0]?.quad ?? [], 0)).toBe(true);
    // In the world, turned 270°, that is past the back edge (+x), under the loft the stair climbs to.
    expect(entry.x).toBeGreaterThan(p.at.x);
    expect(validateDocument(doc).ok).toBe(true);
  });

  // Every new spiral gets its entry side, however it is placed (edge-catch.10, .15; AC-07, AC-08).
  const only = (side: "front" | "back" | "left" | "right") => ({ front: side === "front", back: side === "back", left: side === "left", right: side === "right" });
  const free: Command = { ...toLoft, reaches: undefined };
  const lofted = (top: number): Document => withDeck(run(tinyHouse(), { type: "setCeiling", height: 3.2 }), { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top, solid: false });

  it("newSides gives a spiral its entry side by height, any other kind its defaults", () => {
    for (const [h, side] of [[1.5, "right"], [2.15, "back"], [2.6, "left"]] as const) {
      expect(newSides("spiralStair", h)).toEqual(only(side));
      expect(only(spiralEntrySide(STAIR_RULES.spiral, risersFor(STAIR_RULES.spiral, h, null)))).toEqual(only(side));
    }
    expect(newSides("bed", 0.5)).toEqual(defaultSides("bed"));
    expect(newSides("stair", 2.15)).toEqual(defaultSides("stair"));
  });

  it("a spiral placed by placeObject on free floor gets its entry side, in every layout (AC-07)", () => {
    const doc = run(night(house()), free);
    expect(copies(doc, "sp/o0")).toHaveLength(2);
    for (const c of copies(doc, "sp/o0")) expect(c.sides).toEqual(only("back"));
  });

  it("placeObject with reaches takes the side from the linked rise (AC-07)", () => {
    const doc = run(night(lofted(2.6)), toLoft);
    expect(doc.objects["sp/o0"]?.h.standard).toBe(2.6);
    for (const c of copies(doc, "sp/o0")) expect(c.sides).toEqual(only("left"));
  });

  it("switching a stair to a spiral gives its entry side from its rise after the switch (AC-07)", () => {
    const unlinked = run(night(house()), free, { type: "setObjectKind", objectId: "sp/o0", kind: "stair" }, { type: "setObjectKind", objectId: "sp/o0", kind: "spiralStair" });
    for (const c of copies(unlinked, "sp/o0")) expect(c.sides).toEqual(only("back"));
    const linked = run(night(lofted(2.6)), toLoft, { type: "setObjectKind", objectId: "sp/o0", kind: "stair" }, { type: "setObjectKind", objectId: "sp/o0", kind: "spiralStair" });
    expect(linked.objects["sp/o0"]?.h.standard).toBe(2.6);
    for (const c of copies(linked, "sp/o0")) expect(c.sides).toEqual(only("left"));
  });

  it("a later change of rise keeps the zone (AC-08)", () => {
    const placed = run(night(house()), free);
    const lowered = run(placed, { type: "setObjectSize", objectId: "sp/o0", w: 1.6, d: {}, h: { standard: 1.5 } });
    expect(lowered.objects["sp/o0"]?.h.standard).toBe(1.5);
    expect(spiralEntrySide(STAIR_RULES.spiral, risersFor(STAIR_RULES.spiral, 1.5, null))).toBe("right");
    for (const c of copies(lowered, "sp/o0")) expect(c.sides).toEqual(only("back"));
  });

  it("a later setDeck raising the loft to 12 risers, whose entry is the left, doesn't move the zone (stairdraw.15)", () => {
    const raised = run(run(night(house()), onEdge), { type: "setDeck", deckId: "L", top: 2.6 });
    expect(raised.objects["ps/s0/o0"]?.h.standard).toBe(2.6);
    expect(spiralEntrySide(STAIR_RULES.spiral, 12)).toBe("left");
    for (const c of copies(raised, "ps/s0/o0")) expect(c.sides).toEqual({ front: false, back: true, left: false, right: false });
  });
});

// The spiral's top landing (edge-catch.06, .11): the quarter its treads leave open at the top, from the centre to the
// box's right and back sides, in spiralTreads' frame (centred, x to the right, +y toward the back edge).
describe("the spiral's landing", () => {
  it("spiralLanding is the back-right quarter of the box, counter-clockwise from the centre", () => {
    expect(spiralLanding(1.6, 1.6)).toEqual([{ x: 0, y: 0 }, { x: 0.8, y: 0 }, { x: 0.8, y: 0.8 }, { x: 0, y: 0.8 }]);
    expect(spiralLanding(1.2, 1.2)).toEqual([{ x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 0.6 }, { x: 0, y: 0.6 }]);
    // Between the last tread's end (90°) and the open side (0°): no tread of a 10-riser spiral lies in it.
    const angles = spiralTreads(STAIR_RULES.spiral, 9).flatMap((t) => [t.from, t.to]);
    expect(Math.min(...angles)).toBe(90);
    expect(Math.max(...angles)).toBe(360);
  });
});
