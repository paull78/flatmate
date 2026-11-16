import { describe, expect, it } from "vitest";
import { emptyDocument, execute, guardRuns, rectangleRoom, validateDocument, type Command, type Document, type GuardRun } from "../src";

// The final gate's AC-02 gap: a wall standing on the loft counts only if it's as tall as the guard. The cabin's loft is at
// x 0.1–2.1 over the whole depth, top 2.15 under a 3.05 ceiling: its one open edge is x 2.10, y 0.10–2.90, its rail 0.90 m.

const LOFT = "l/k0";
const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
/** The cabin with a 0.10 m wall standing on the loft along its open edge (its face on the edge), `top` above the deck. */
const withWallOnLoft = (top: number): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 },
  { type: "addWall", opId: "w", from: { at: { x: 2.05, y: 0.1 } }, to: { at: { x: 2.05, y: 2.9 } }, thickness: 0.1, base: LOFT, top },
);
const len = (r: GuardRun): number => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
const loftRail = (doc: Document): number => guardRuns(doc).filter((r) => r.deck === LOFT).reduce((sum, r) => sum + len(r), 0);

describe("a wall standing on the loft along its open edge (AC-02)", () => {
  it("a 0.50 m knee wall keeps the guard, while a wall up to the ceiling closes it", () => {
    const knee = withWallOnLoft(0.5);
    expect(validateDocument(knee).ok).toBe(true);
    expect(knee.walls["w/w0"]).toMatchObject({ base: LOFT, top: 0.5 });
    expect(loftRail(knee)).toBeCloseTo(2.8, 3);
    const full = withWallOnLoft(0.9); // 2.15 + 0.90: the ceiling
    expect(validateDocument(full).ok).toBe(true);
    expect(loftRail(full)).toBeCloseTo(0, 3);
  });
});
