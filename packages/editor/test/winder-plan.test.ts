import { describe, expect, it } from "vitest";
import { STAIR_RULES, emptyDocument, rectangleRoom, stairEdges, stairGeometry, winderTreads, type Command, type Document } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { stairLines } from "../src/view/stair-lines";
import { stairGhostPlan } from "../src/view/stair-plan";
import { stairGhost } from "../src/tools/stair-gesture";
import { withCommands } from "./builders";

// A Winder stair on the plan (steps.04, .09, AC-03, AC-04): its three winders radiating from the inner corner of the
// square at its front, its straight treads, a walking line from a dot on the side you walk in from, turning through the
// square to the arrow at its back edge, "UP · 12 R"; the break never falls inside the square.

const W = 0.9;
const g = stairGeometry(STAIR_RULES.winder, W, 3.07, 2.15, null);
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

describe("a winder's lines (footprint space: x across, a up the run)", () => {
  it("its two sides along, tread 4's nosing and the straight treads' across (8 lines), and the winders' two rays", () => {
    const lines = stairLines(STAIR_RULES.winder, W, g);
    expect(lines.along).toEqual([-W / 2, W / 2]);
    expect(lines.across.map((l) => l.a)).toEqual(Array.from({ length: 8 }, (_, i) => g.nosingAt(i + 4)));
    expect(lines.across[0]?.a).toBeCloseTo(W, 9);
    const [t1, t2] = winderTreads(W, false);
    // The rays are the treads' shared sides: from the inner corner to where tread 1 meets 2, and 2 meets 3.
    expect(lines.slants).toEqual([[t1?.[0], t1?.[2]], [t2?.[0], t2?.[3]]]);
  });

  it("its walking line starts on the entry side, turns through the square and ends at the back edge on the centre line", () => {
    const right = stairLines(STAIR_RULES.winder, W, g).walk ?? [];
    expect(right[0]?.x).toBeGreaterThan(0.3);
    expect(right[0]?.y).toBeCloseTo(W / 2, 9);
    expect(near(right.at(-1)?.x ?? 1, 0)).toBe(true);
    expect(right.at(-1)?.y).toBeCloseTo(g.run, 9);
    const left = stairLines(STAIR_RULES.winder, W, g, true).walk ?? [];
    left.forEach((p, i) => expect(p.x).toBeCloseTo(-(right[i]?.x ?? 0), 9));
  });

  it("a flight has no rays and no walk of its own: its walking line stays the centre line", () => {
    const flight = stairLines(STAIR_RULES.solid, W, stairGeometry(STAIR_RULES.solid, W, 2.99, 2.15, null));
    expect(flight.slants).toEqual([]);
    expect(flight.walk).toBeNull();
  });
});

/**
 * A 7 × 2.5 studio under 3.05 (the cut at 1.20) with a loft at +2.15 over x 0.1–3.6. The winder stands with its back
 * edge on the loft's right edge at (3.6, 1.95), turned 90°: its run goes toward +x, its front at x 6.67, 0.90 wide
 * (y 1.50–2.40).
 */
function studio(...more: Command[]): Document {
  return withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"), { type: "setCeiling", height: 3.05 }, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 }, ...more);
}
const winder: Command = { type: "placeObject", opId: "w", state: "s0", object: { kind: "winderStair" }, at: { x: 3.6, y: 1.95 }, rotation: 90, deck: null, reaches: "loft/k0" };
const texts = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));

describe("a winder at the floor", () => {
  const doc = studio(winder);
  const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);

  it("is labelled UP · 12 R", () => {
    expect(texts(layer)).toContain("UP · 12 R");
  });

  it("draws its two rays as slanted lines inside the front square (x 5.77–6.67)", () => {
    const slanted = segments(layer).filter((s) => !near(s.a.x, s.b.x, 1e-6) && !near(s.a.y, s.b.y, 1e-6) && Math.min(s.a.x, s.b.x) >= 5.77 - 1e-6 && Math.max(s.a.x, s.b.x) <= 6.67 + 1e-6);
    expect(slanted.length).toBeGreaterThanOrEqual(2);
  });

  it("never breaks inside the front square: nothing in it is dashed", () => {
    // The cut at 1.20 falls at tread 7: the square (x 5.77–6.67) is wholly below it.
    const dashedInSquare = segments(layer).filter((s) => s.dash !== undefined && Math.min(s.a.x, s.b.x) > 5.77 + 1e-6);
    expect(dashedInSquare).toEqual([]);
  });
});

describe("a winder whose cut falls inside its front square (steps.09)", () => {
  // The winder stands on a 0.90 m platform (x 3.6–6.9, y 1.4–2.4) and reaches the loft: 7 risers of 0.179 from 0.90;
  // the cut at 1.20 is 0.30 above its base, at tread 2, a winder. The break moves to the square's back (x 5.77).
  const doc = studio(
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 5.25, y: 1.9 }, w: 3.3, d: 1.0, top: 0.9 },
    { ...winder, deck: "plat/k0" } as Command,
  );
  const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);

  it("draws nothing dashed inside the square, and dashes past it", () => {
    const dashed = segments(layer).filter((s) => s.dash !== undefined && Math.max(s.a.y, s.b.y) > 1.5 - 1e-6 && Math.min(s.a.y, s.b.y) < 2.4 + 1e-6);
    expect(dashed.length).toBeGreaterThan(0);
    expect(dashed.filter((s) => Math.min(s.a.x, s.b.x) > 5.77 + 1e-3)).toEqual([]);
  });
});

describe("the ghost of a winder drawn by a wall (steps.39, AC-12)", () => {
  // A 7 × 2.5 studio with a loft over x 0.1–3.6; a winder hanging off its right edge (x 3.6) with its right side
  // against the north wall's face (y 2.4) enters from the left, so the ghost shows what the click will place.
  const doc = studio();
  const edge = stairEdges(doc, null, W).find((e) => e.deck === "loft/k0" && e.normal.x === 1);
  if (!edge) throw new Error("no edge");
  const ask = { state: "s0", kind: "winderStair", surface: null };

  it("by the wall: the ghost enters from the left", () => {
    expect(stairGhost(doc, ask, edge, { x: 3.6, y: 2.4 - W / 2 })?.left).toBe(true);
  });

  it("with room on both sides: the ghost enters from the right, as before", () => {
    expect(stairGhost(doc, ask, edge, { x: 3.6, y: 1.25 })?.left).toBeUndefined();
  });

  it("stairGhostPlan draws a left entry mirrored: its slanted rays on the other side", () => {
    const style = CANVAS_STYLE;
    const raysX = (left: boolean) =>
      segments(stairGhostPlan("winderStair", W, 3.07, 2.15, { x: 0, y: 0 }, 0, "#000", "#fff", style, left))
        .filter((s) => !near(s.a.x, s.b.x, 1e-6) && !near(s.a.y, s.b.y, 1e-6))
        .map((s) => Math.sign((s.a.x + s.b.x) / 2) + 0); // + 0: no −0
    expect(raysX(false).length).toBeGreaterThan(0);
    expect(raysX(true)).toEqual(raysX(false).map((x) => -x + 0));
  });
});
