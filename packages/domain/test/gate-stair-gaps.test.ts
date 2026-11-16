import { describe, expect, it } from "vitest";
import { emptyDocument, execute, guardRuns, rectangleRoom, validateDocument, type Command, type Document } from "../src";

// The final gate's AC-03 gaps: moving a placed stair moves its gap, and only a stair's top end makes one, so a foot touching
// an edge leaves that edge's rail.

const LOFT = "l/k0";
const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => {
  const r = execute(d, c);
  if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
  return r.value.doc;
}, doc);
const build = (...cmds: Command[]): Document => run(emptyDocument(), cmds);
/** The loft's runs along the line `axis` = `v`, as sorted [from, to] spans on the other axis, to the mm. */
const spansOn = (doc: Document, axis: "x" | "y", v: number): number[][] => {
  const other = axis === "x" ? "y" : "x";
  return guardRuns(doc)
    .filter((r) => r.deck === LOFT && Math.abs(r.a[axis] - v) < 1e-6 && Math.abs(r.b[axis] - v) < 1e-6)
    .map((r) => [r.a[other], r.b[other]].sort((p, q) => p - q).map((n) => Math.round(n * 1000) / 1000))
    .sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0));
};

describe("moving the stair moves the gap (AC-03)", () => {
  // The cabin's loft, x 0.1–2.1, top 2.15: its open edge x 2.10, y 0.10–2.90. A 0.60 m ship's ladder hangs off it at y 1.2.
  const cabin = (): Document => build(
    ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"), { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 },
    { type: "placeStair", opId: "s", state: "s0", kind: "shipsLadder", surface: null, deck: LOFT, at: { x: 2.1, y: 1.2 }, shape: "straight" },
  );

  it("moved along the edge by the editor's move commands, its gap follows it", () => {
    const placed = cabin();
    expect(spansOn(placed, "x", 2.1)).toEqual([[0.1, 0.9], [1.5, 2.9]]);
    const p = placed.placements["s/s0/p0"];
    if (!p) throw new Error("no ladder");
    const one = run(placed, [{ type: "movePlacement", placementId: p.id, at: { x: 2.1, y: 1.6 }, rotation: p.rotation }]);
    expect(validateDocument(one).ok).toBe(true);
    expect(one.objects[p.object]?.reaches).toBe(LOFT);
    expect(spansOn(one, "x", 2.1)).toEqual([[0.1, 1.3], [1.9, 2.9]]);
    const group = run(placed, [{ type: "movePlacements", moves: [{ placementId: p.id, at: { x: 2.1, y: 2 }, rotation: p.rotation }] }]);
    expect(spansOn(group, "x", 2.1)).toEqual([[0.1, 1.7], [2.3, 2.9]]);
  });
});

describe("only a stair's top end makes a gap (AC-03)", () => {
  // An 8 × 8 loft with a hole exactly a straight stair's footprint, 0.90 × 2.988: x 4.55–5.45, y 4.012–7. The stair arrives
  // at the hole's north side (y 7) and runs south, so its foot touches the hole's south side (y 4.012).
  it("a stair whose foot touches a hole's edge leaves that edge's rail, and its long sides' too", () => {
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 10, 10, "b"), { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 5, y: 5 }, w: 8, d: 8 },
      { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 5, y: 7 - 2.988 / 2 }, w: 0.9, d: 2.988 },
      { type: "placeStair", opId: "s", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 5, y: 7 }, shape: "straight" },
    );
    expect(validateDocument(doc).ok).toBe(true);
    expect(spansOn(doc, "y", 7)).toEqual([]); // its arrival: open
    expect(spansOn(doc, "y", 4.012)).toEqual([[4.55, 5.45]]); // its foot: railed
    expect(spansOn(doc, "x", 4.55)).toEqual([[4.012, 7]]);
    expect(spansOn(doc, "x", 5.45)).toEqual([[4.012, 7]]);
  });
});
