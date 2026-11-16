import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, type Command, type Document } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { withCommands } from "./builders";

// The final gate's AC-13 gap: an L placed on a Glass loft draws its rail lines in the glass ink on the plan, with no posts.
// The 8 × 6 room's loft is at x 0.1–2.1, y 1.5–4.5; an l-right stair hung at (2.1, 3) has its upper flight running +x,
// y 2.55–3.45, to its landing, x 3.458–4.358, and its lower flight running +y from there, x 3.458–4.358. The rails are 0.02
// in from each flight's sides.

const LOFT = "l/k0";
const room = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
  { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "l-right" },
);
type Segment = Extract<Primitive, { kind: "segment" }>;
/** The stair's rail lines seen from the loft, which shows both flights whole, each as `<axis> <value>: <colour>`. */
function railLines(doc: Document): { lines: string[]; discs: number } {
  const loft = levels(doc).find((l) => l.deckIds.includes(LOFT));
  if (!loft) throw new Error("no loft level");
  const ps = objectsLayer(doc, viewAt("s0", loft), CANVAS_STYLE, "", 80);
  const rails = ps.filter((p): p is Segment => p.kind === "segment" && p.dash === undefined && "px" in p.width && p.width.px === CANVAS_STYLE.guard.line);
  const lines = rails.map((s) => (Math.abs(s.a.y - s.b.y) < 1e-6 ? `y ${s.a.y.toFixed(3)}` : `x ${s.a.x.toFixed(3)}`) + `: ${s.color}`).sort();
  return { lines, discs: ps.filter((p) => p.kind === "disc").length };
}
const rails = (ink: string): string[] => [`x 3.478: ${ink}`, `x 4.338: ${ink}`, `y 2.570: ${ink}`, `y 3.430: ${ink}`];

describe("an L in Glass on the plan (AC-13)", () => {
  it("draws both flights' rail lines in the glass ink, with no posts; on a Railing loft, in the guards' ink", () => {
    const glassDoc = room({ type: "setDeck", deckId: LOFT, guard: "glass" });
    expect(Object.values(glassDoc.objects).filter((o) => o.kind === "stair").map((o) => o.handrails)).toEqual([{ left: "glass", right: "glass" }, { left: "glass", right: "glass" }]);
    const glass = railLines(glassDoc);
    const railing = railLines(room());
    expect(glass.lines).toEqual(rails(CANVAS_STYLE.openingGlass));
    expect(railing.lines).toEqual(rails(CANVAS_STYLE.guard.ink));
    expect(CANVAS_STYLE.openingGlass).not.toBe(CANVAS_STYLE.guard.ink);
    expect(glass.discs).toBe(railing.discs); // Glass adds no post marks
  });
});
