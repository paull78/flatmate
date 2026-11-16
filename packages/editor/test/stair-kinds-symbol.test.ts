import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, type Command, type Document, type Level } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { withCommands } from "./builders";

// The stair and the open stair on the plan (stairs step 11): both draw like the storage stair; the open stair adds its
// side boards, a line 0.04 inside each long side, solid up to the break and dashed past it.
//
// A 7 × 2.5 room under a 3.05 ceiling (the floor's cut at 1.20) with a loft (top 2.15) over x 0.1–3.6; the stair stands
// with its back edge on the loft's right edge at (3.6, 1.95), turned 90°: its front (the bottom step) at x 6.59, 0.90
// wide (y 1.50–2.40). 12 risers of 0.179, 11 treads of 0.272; the first tread above 1.20 is the 7th, so the break lies
// 6 treads in, at x 6.59 − 6 × 0.2718 = 4.959.

function studio(kind: string): Document {
  const place: Command = { type: "placeObject", opId: "s", state: "s0", object: { kind }, at: { x: 3.6, y: 1.95 }, rotation: 90, deck: null, reaches: "loft/k0" };
  return withCommands(
    emptyDocument(),
    ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
    place,
  );
}

const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const texts = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const layerOf = (doc: Document) => objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
/** Lines along the run at y (world), between the back edge (3.6) and the front edge (6.59). */
const alongAt = (ps: readonly Primitive[], y: number) => segments(ps).filter((s) => near(s.a.y, y) && near(s.b.y, y) && Math.min(s.a.x, s.b.x) >= 3.6 - 1e-6 && Math.max(s.a.x, s.b.x) <= 6.59 + 1e-6);
const BREAK = 6.59 - 6 * (2.99 / 11);

describe("a stair on the plan", () => {
  const layer = layerOf(studio("stair"));

  it("is labelled UP · 12 R and draws 10 tread lines between its edges", () => {
    expect(texts(layer)).toContain("UP · 12 R");
    const treads = segments(layer).filter((s) => near(s.a.x, s.b.x) && near(Math.abs(s.a.y - s.b.y), 0.9) && s.a.x > 3.6 + 1e-6 && s.a.x < 6.59 - 1e-6);
    expect(treads).toHaveLength(10);
    expect(treads.filter((s) => s.dash !== undefined)).toHaveLength(4);
  });

  it("has no side boards", () => {
    expect(alongAt(layer, 1.54)).toEqual([]);
    expect(alongAt(layer, 2.36)).toEqual([]);
  });
});

describe("an open stair on the plan", () => {
  const layer = layerOf(studio("openStair"));

  it("is labelled like the stair", () => {
    expect(texts(layer)).toContain("UP · 12 R");
  });

  it("adds side boards 0.04 inside both long sides, solid from the bottom step to the break and dashed past it", () => {
    for (const y of [1.54, 2.36]) {
      const lines = alongAt(layer, y);
      const solid = lines.filter((s) => s.dash === undefined);
      const dashed = lines.filter((s) => s.dash !== undefined);
      expect(solid.map((s) => [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]), `y ${y}`).toEqual([[expect.closeTo(BREAK, 6), expect.closeTo(6.59, 6)]]);
      expect(dashed.map((s) => [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]), `y ${y}`).toEqual([[expect.closeTo(3.6, 6), expect.closeTo(BREAK, 6)]]);
    }
  });
});

// The steep stairs (stairs step 12), each at (3.6, 1.95) turned 90° against the loft like the stairs above: the ship's
// ladder (9 risers of 0.239, 8 goings of 0.1375, front at x 4.70) and the alternating tread (10 risers of 0.215, 9
// goings of 0.1244, front at x 4.72), 0.60 wide (y 1.65–2.25); the rung ladder (8 spaces of 0.269, 7 rungs 0.0725
// apart along the run, front at x 4.18), 0.45 wide (y 1.725–2.175). A flight breaks at its first tread above 1.20 (the
// 6th for both); the ladder where its pitch line crosses 1.20, between rungs 4 and 5.

const loftLevel = (doc: Document): Level => {
  const level = levels(doc).find((l) => l.deckIds.includes("loft/k0"));
  if (!level) throw new Error("no loft level");
  return level;
};
const atLoft = (doc: Document) => objectsLayer(doc, viewAt("s0", loftLevel(doc)), CANVAS_STYLE, "", 80);
/** Lines across the run (constant x) strictly between the back edge (3.6) and the front edge `front`. */
const acrossBetween = (ps: readonly Primitive[], front: number) => segments(ps).filter((s) => near(s.a.x, s.b.x) && !near(s.a.y, s.b.y) && s.a.x > 3.6 + 1e-6 && s.a.x < front - 1e-6);
const LADDER_GOING = 0.58 / 8;

describe("the steep stairs at both levels (AC-08)", () => {
  const cases: [kind: string, w: number, label: string, xb: number][] = [
    ["shipsLadder", 0.6, "9 R", 3.6 + 1.1 - 5 * (1.1 / 8)],
    ["alternatingTread", 0.6, "10 R", 3.6 + 1.12 - 5 * (1.12 / 9)],
    ["rungLadder", 0.45, "7 rungs", 3.6 + 0.58 - (1.2 / (2.15 / 8)) * LADDER_GOING],
  ];
  it.each(cases)("%s at the floor breaks at the cut and labels UP; at the loft it is whole and labels DN", (kind, w, label, xb) => {
    const doc = studio(kind);
    const floor = layerOf(doc);
    expect(texts(floor)).toContain(`UP · ${label}`);
    const slanted = segments(floor).filter((s) => !near(s.a.x, s.b.x) && !near(s.a.y, s.b.y) && Math.abs((s.a.x + s.b.x) / 2 - xb) < 0.12);
    expect(slanted.length).toBeGreaterThan(0);
    expect(Math.min(...slanted.flatMap((s) => [s.a.y, s.b.y]))).toBeLessThan(1.95 - w / 2);
    expect(Math.max(...slanted.flatMap((s) => [s.a.y, s.b.y]))).toBeGreaterThan(1.95 + w / 2);
    expect(segments(floor).some((s) => s.dash !== undefined)).toBe(true);
    const top = atLoft(doc);
    expect(texts(top)).toContain(`DN · ${label}`);
    expect(segments(top).filter((s) => s.dash !== undefined)).toEqual([]);
  });

  it("the ship's ladder draws its side boards 0.04 inside both long sides, like the open stair", () => {
    const top = atLoft(studio("shipsLadder"));
    for (const y of [1.69, 2.21]) expect(segments(top).filter((s) => near(s.a.y, y) && near(s.b.y, y)), `y ${y}`).toHaveLength(1);
  });

  it("the alternating tread's half nosings alternate sides of its centre line, which runs the whole flight", () => {
    const top = atLoft(studio("alternatingTread"));
    const nosings = acrossBetween(top, 4.72).sort((a, b) => b.a.x - a.a.x); // from the bottom step up
    expect(nosings.map((s) => s.a.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((k) => expect.closeTo(4.72 - k * (1.12 / 9), 6)));
    for (const s of nosings) expect(Math.abs(s.a.y - s.b.y)).toBeCloseTo(0.3, 6);
    const sides = nosings.map((s) => Math.sign((s.a.y + s.b.y) / 2 - 1.95));
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.every((side, i) => side !== 0 && (i === 0 || side === -(sides[i - 1] ?? 0)))).toBe(true);
    const centre = segments(top).filter((s) => near(s.a.y, 1.95) && near(s.b.y, 1.95));
    expect(centre.some((s) => near(Math.min(s.a.x, s.b.x), 3.6) && near(Math.max(s.a.x, s.b.x), 4.72))).toBe(true);
  });

  it("the rung ladder draws its rails 0.025 inside its long sides and 7 rungs between them, those past the cut dashed", () => {
    const floor = layerOf(studio("rungLadder"));
    const rungs = acrossBetween(floor, 4.18).sort((a, b) => b.a.x - a.a.x);
    expect(rungs.map((s) => s.a.x)).toEqual([1, 2, 3, 4, 5, 6, 7].map((k) => expect.closeTo(4.18 - k * LADDER_GOING, 6)));
    for (const s of rungs) expect(Math.abs(s.a.y - s.b.y)).toBeCloseTo(0.4, 6);
    expect(rungs.map((s) => s.dash !== undefined)).toEqual([false, false, false, false, true, true, true]);
    for (const y of [1.75, 2.15]) {
      const rail = segments(atLoft(studio("rungLadder"))).filter((s) => near(s.a.y, y) && near(s.b.y, y));
      expect(rail.map((s) => [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]), `y ${y}`).toEqual([[expect.closeTo(3.6, 6), expect.closeTo(4.18, 6)]]);
    }
  });
});
