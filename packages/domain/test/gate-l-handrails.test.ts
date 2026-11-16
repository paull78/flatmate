import { describe, expect, it } from "vitest";
import { emptyDocument, execute, flightHandrails, rectangleRoom, validateDocument, type Command, type Document, type Handrail } from "../src";

// The final gate's AC-11 gap: an L beside a wall has no handrail on the wall's side. The 8 × 6 room's loft is at x 0.1–2.1,
// y 1.5–4.5; an l-right stair hung at (2.1, 3) has its upper flight running +x to its landing, x 3.458–4.358, y 2.55–3.45,
// and its lower flight running +y from the landing, x 3.458–4.358, y 3.45–4.808.

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
const room = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
  { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "l-right" },
);
/** A wall along the lower flight's +x side, its face on the side (x 4.358), from beside the landing up to the room's wall. */
const besideLower: Command = { type: "addWall", opId: "w", from: { at: { x: 4.458, y: 3.3 } }, to: { at: { x: 4.458, y: 6 } } };
const UPPER = "ps/s0/o0";
const LOWER = "ps/s1/o0";
const railsOf = (doc: Document, flight: string): readonly Handrail[] => flightHandrails(doc).get(flight) ?? [];

describe("an L beside a wall (AC-11)", () => {
  it("has no handrail on the wall's side, and keeps the rest", () => {
    const open = room();
    const walled = room(besideLower);
    expect(validateDocument(walled).ok).toBe(true);
    expect(railsOf(open, LOWER).map((r) => Math.sign(r.x)).sort()).toEqual([-1, 1]);
    const lower = railsOf(walled, LOWER);
    expect(lower).toHaveLength(1);
    // At rotation 180 the flight's local +x is world −x: the rail left is the one away from the wall, at world x 3.478.
    expect(walled.placements["ps/s1/p0"]?.rotation).toBe(180);
    expect(Math.sign(lower[0]?.x ?? 0)).toBe(1);
    expect(railsOf(walled, UPPER)).toEqual(railsOf(open, UPPER));
  });
});
