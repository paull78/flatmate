import { describe, expect, it } from "vitest";
import { emptyDocument, flightHandrails, levels, rectangleRoom, type Command, type Document, type Level } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { stairGhostPlan } from "../src/view/stair-plan";
import { withCommands } from "./builders";

// A handrail on the plan (AC-11): a thin line along an open long side, stopping at the break line as the flight's solid
// lines do; from the level above, whole. The 8 × 6 room's loft is at x 0.1–2.1, y 1.5–4.5; the stair's back is at (2.1, 3),
// running +x to its foot at x 5.088, y 2.55–3.45: 12 risers of 0.179, 11 goings of 0.2716. The rails are 0.02 in from its sides.

const LOFT = "l/k0";
const room = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const place = (kind = "stair"): Command => ({ type: "placeStair", opId: "ps", state: "s0", kind, surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "straight" });
const rightWall: Command = { type: "addWall", opId: "wr", from: { at: { x: 2.1, y: 3.55 } }, to: { at: { x: 5.6, y: 3.55 } } };
const loftLevel = (doc: Document): Level => {
  const up = levels(doc).find((l) => l.deckIds.includes(LOFT));
  if (!up) throw new Error("no level");
  return up;
};
const atFloor = (doc: Document, style: PlanStyle = CANVAS_STYLE, selected = "") => objectsLayer(doc, floorView(doc, "s0"), style, selected, 80);
const atLoft = (doc: Document) => objectsLayer(doc, viewAt("s0", loftLevel(doc)), CANVAS_STYLE, "", 80);
type Segment = Extract<Primitive, { kind: "segment" }>;
/** The lines along the run at world y `y`. */
const linesAt = (ps: readonly Primitive[], y: number): Segment[] =>
  ps.filter((p): p is Segment => p.kind === "segment" && Math.abs(p.a.y - y) < 1e-6 && Math.abs(p.b.y - y) < 1e-6);
const LEFT = 3 - 0.43;
const RIGHT = 3 + 0.43;
const xs = (s: Segment | undefined): number[] => [s?.a.x ?? Number.NaN, s?.b.x ?? Number.NaN].sort((a, b) => a - b);
/** Where the floor's cut breaks the flight: the first tread above 1.20 is the seventh, six goings up from the foot. */
const BREAK_X = 5.088 - 6 * (2.988 / 11);

describe("a handrail on the plan", () => {
  it("at the floor, runs along each open side from the foot and stops at the break line", () => {
    const ps = atFloor(room(place()));
    for (const y of [LEFT, RIGHT]) {
      const [line, ...rest] = linesAt(ps, y);
      expect(rest).toEqual([]);
      const [x0, x1] = xs(line);
      expect(x0).toBeCloseTo(BREAK_X, 3);
      expect(x1).toBeCloseTo(5.088, 3);
    }
  });

  it("is a thin line in the guards' ink and width", () => {
    const [line] = linesAt(atFloor(room(place())), LEFT);
    expect(line?.color).toBe(CANVAS_STYLE.guard.ink);
    expect(line?.width).toEqual({ px: CANVAS_STYLE.guard.line });
    expect(line?.dash).toBeUndefined();
  });

  it("on paper, in paper's", () => {
    const [line] = linesAt(atFloor(room(place()), PRESENTATION_STYLE), LEFT);
    expect(line?.color).toBe(PRESENTATION_STYLE.guard.ink);
    expect(line?.width).toEqual({ px: PRESENTATION_STYLE.guard.line });
  });

  it("takes the selection's colour with its stair", () => {
    const doc = room(place());
    const [line] = linesAt(atFloor(doc, CANVAS_STYLE, "ps/s0/p0"), LEFT);
    const [rest] = linesAt(atFloor(doc), LEFT);
    expect(line?.color).not.toBe(rest?.color);
  });

  it("from the loft looking down, runs the whole flight", () => {
    const ps = atLoft(room(place()));
    for (const y of [LEFT, RIGHT]) {
      const [line] = linesAt(ps, y);
      const [x0, x1] = xs(line);
      expect(x0).toBeCloseTo(2.1, 3);
      expect(x1).toBeCloseTo(5.088, 3);
    }
  });

  it("from the loft, what runs on under its slab doesn't show", () => {
    // A flight from a hole's east side running back under the slab: 3.78 long, its foot at x 2.22, the hole's west side x 2.8.
    const doc = withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"), { type: "setCeiling", height: 5.4 },
      { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2.7 },
      { type: "addDeckHole", opId: "h", deck: "floor/k0", at: { x: 4.4, y: 1.5 }, w: 3.2, d: 1 },
      { type: "placeObject", opId: "st", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 3.78 } }, at: { x: 6, y: 1.5 }, rotation: 270, deck: null, reaches: "floor/k0" },
    );
    const up = levels(doc).find((l) => l.deckIds.includes("floor/k0"));
    if (!up) throw new Error("no level");
    const lines = linesAt(objectsLayer(doc, viewAt("s0", up), CANVAS_STYLE, "", 80), 1.5 - 0.43);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(Math.min(...xs(l))).toBeGreaterThanOrEqual(2.8 - 1e-6);
    expect(Math.max(...lines.flatMap(xs))).toBeCloseTo(6, 3);
  });

  it("isn't on a side against a wall", () => {
    const ps = atFloor(room(rightWall, place()));
    expect(linesAt(ps, RIGHT)).toEqual([]);
    expect(linesAt(ps, LEFT)).toHaveLength(1);
  });

  it("on a side partly against a wall, only on the open stretch, still up to the break line", () => {
    const doc = room({ type: "addWall", opId: "wr", from: { at: { x: 3.9, y: 3.55 } }, to: { at: { x: 5.6, y: 3.55 } } }, place());
    const [line, ...rest] = linesAt(atFloor(doc), RIGHT);
    expect(rest).toEqual([]);
    expect(xs(line)[0]).toBeCloseTo(BREAK_X, 3);
    expect(xs(line)[1]).toBeCloseTo(3.9, 2);
    const [whole] = linesAt(atLoft(doc), RIGHT);
    expect(xs(whole)[0]).toBeCloseTo(2.1, 3);
    expect(xs(whole)[1]).toBeCloseTo(3.9, 2);
  });

  it("with only a stretch above the break line, none at the floor", () => {
    const doc = room({ type: "addWall", opId: "wr", from: { at: { x: 3.2, y: 3.55 } }, to: { at: { x: 5.6, y: 3.55 } } }, place());
    expect(linesAt(atFloor(doc), RIGHT)).toEqual([]);
    const [line] = linesAt(atLoft(doc), RIGHT);
    expect(xs(line)[0]).toBeCloseTo(2.1, 3);
    expect(xs(line)[1]).toBeCloseTo(3.2, 2);
  });

  it("an L's flights each have theirs", () => {
    const doc = room({ type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "l-right" });
    expect(linesAt(atLoft(doc), 3 - 0.43).length + linesAt(atLoft(doc), 3 + 0.43).length).toBeGreaterThanOrEqual(2);
    // The flight below the floor's cut, x 3.458–4.358 wide, is whole at the floor: it runs y 3.45–4.808.
    const lower = atFloor(doc).filter((p): p is Segment => p.kind === "segment" && Math.abs(p.a.x - p.b.x) < 1e-6 && Math.abs(p.a.x - (3.908 + 0.43)) < 1e-6 && p.width !== undefined && "px" in p.width && p.width.px === CANVAS_STYLE.guard.line);
    expect(lower).toHaveLength(1);
    expect(Math.min(lower[0]?.a.y ?? 0, lower[0]?.b.y ?? 0)).toBeCloseTo(3.45, 3);
    expect(Math.max(lower[0]?.a.y ?? 0, lower[0]?.b.y ?? 0)).toBeCloseTo(4.808, 3);
  });

  it.each([["rungLadder", 0.45], ["spiralStair", 1.6]] as const)("a %s has none", (kind, w) => {
    const doc = room(place(kind));
    expect([...flightHandrails(doc).values()].flat()).toEqual([]);
    const ps = atFloor(doc);
    for (const y of [3 - (w / 2 - 0.02), 3 + (w / 2 - 0.02)]) expect(linesAt(ps, y)).toEqual([]);
  });

  it("a stair's ghost has none: nothing yet stands beside it", () => {
    const ghost = stairGhostPlan("stair", 0.9, 2.988, 2.15, { x: 2.1, y: 3 }, 90, CANVAS_STYLE.objectLine, CANVAS_STYLE.objectFill, CANVAS_STYLE);
    expect(linesAt(ghost, LEFT)).toEqual([]);
    expect(linesAt(ghost, RIGHT)).toEqual([]);
  });
});
