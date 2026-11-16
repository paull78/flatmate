import { describe, expect, it } from "vitest";
import { deckView, footprints, levelOf, type Document, stairChecks } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "../src/snapping/contact";
import { catchEdge } from "../src/tools/stair-gesture";
import { deckLabelBox } from "../src/view/deck-label";
import { HELPER_FONT } from "../src/view/fonts";
import { labelBox } from "../src/view/labels";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { ON_FLOOR, cabinDoc, notchedCabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The stair gesture on a hole's side (stairwell.17, .22; AC-07): the notch's west side (x 1.40, y 2.25–2.90) catches a
// ship's ladder hanging east into the notch; the loft's east side stops at the notch, so nothing catches across it.

const LOFT = "loft/k0";
const LADDER = { state: "s0", kind: "shipsLadder", surface: null };
const prompt = (shell: FakeShell): string => shell.view().commandBar.prompt;
function shellOf(doc: Document, kind: string): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  shell.ui({ type: "pickKind", kind });
  return shell;
}
/** Many small moves from `from` to `to` (lesson: a realistic path, not a jump). */
function walk(shell: FakeShell, from: Point, to: Point, steps = 10): void {
  for (let i = 0; i <= steps; i++) shell.moveTo({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
}
const box = (doc: Document, kind: string): number[] => {
  const p = Object.values(doc.placements).find((q) => doc.objects[q.object]?.kind === kind);
  const quad = p ? footprints(doc).get(p.id) ?? [] : [];
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return [Math.min(...quad.map((q) => r(q.x))), Math.max(...quad.map((q) => r(q.x))), Math.min(...quad.map((q) => r(q.y))), Math.max(...quad.map((q) => r(q.y)))];
};

describe("the gesture on the notch (AC-07)", () => {
  it("hovering the notch's west side catches it; a click places the ladder at x 1.40–2.503, reaching the Loft", () => {
    const shell = shellOf(notchedCabinDoc(), "shipsLadder");
    // Along the north wall from the room, so the west side catches first (from the loft's east side, the hold passes to
    // the notch's south side, nearer at that moment); clicked near the wall, the 0.60 ladder slides flush to the north
    // end of the 0.65 side.
    walk(shell, { x: 3.2, y: 2.7 }, { x: 1.7, y: 2.8 });
    shell.click({ x: 1.7, y: 2.8 });
    const doc = shell.doc();
    expect(box(doc, "shipsLadder")).toEqual([1.4, 2.503, 2.3, 2.9]);
    expect(Object.values(doc.objects).find((o) => o.kind === "shipsLadder")?.reaches).toBe(LOFT);
  });

  it("the caught side's tag slides along it clear of the loft's own label", () => {
    // Behind the notch's west side the tag would sit over "Loft +2.15", in the loft's top-left corner.
    const shell = shellOf(notchedCabinDoc(), "shipsLadder");
    walk(shell, { x: 3.2, y: 2.7 }, { x: 1.7, y: 2.75 });
    const tag = shell.scene().layers.find((l) => l.name === "annotations")?.primitives.find((p) => p.kind === "text" && p.text === "Loft edge · 2.15");
    const deck = deckView(shell.doc(), LOFT);
    if (tag?.kind !== "text" || !deck) throw new Error("no tag");
    const t = labelBox(tag.text, tag.at, HELPER_FONT, shell.state.camera);
    const label = deckLabelBox(deck, CANVAS_STYLE, shell.state.camera.zoom);
    expect(t.max.x <= label.min.x || t.min.x >= label.max.x || t.max.y <= label.min.y || t.min.y >= label.max.y).toBe(true);
    expect(t.max.x).toBeLessThan(1.4); // still behind the side, over the loft
  });

    it("across the notch's open side the loft's east side catches nothing; the notch's side does", () => {
    const doc = notchedCabinDoc();
    const caught = catchEdge(doc, LADDER, { x: 2.3, y: 2.6 }, null);
    expect(caught && [caught.a.x, caught.b.x]).toEqual([1.4, 1.4]);
    expect(catchEdge(doc, LADDER, { x: 2.3, y: 1.0 }, null)?.a.x).toBe(2.1); // below the notch the east side still catches
  });

  it("a rung ladder longer than its hole hovers 'Doesn't fit'; its click is refused naming the Loft and both ranges", () => {
    // A shallow hole in the middle of the loft, x 0.60–1.60, y 1.00–1.40: from its south side a rung ladder runs 0.58 north, 0.18 under the slab.
    const shell = shellOf(withCommands(cabinDoc(), { type: "addDeckHole", opId: "mid", deck: LOFT, at: { x: 1.1, y: 1.2 }, w: 1, d: 0.4 }), "rungLadder");
    walk(shell, { x: 1.1, y: 0.6 }, { x: 1.1, y: 1.1 });
    expect(prompt(shell)).toMatch(/^Doesn't fit/); // no other kind fits so tight a hole, so no chips and no "m short"
    shell.click({ x: 1.1, y: 1.1 });
    shell.click({ x: 1.1, y: 1.1 });
    expect(shell.view().toast).toBe("Rung ladder (0.00–2.15) and Loft (2.03–2.15) overlap in Layout");
    expect(Object.values(shell.doc().objects).some((o) => o.kind === "rungLadder")).toBe(false);
  });

  it("a ship's ladder longer than its hole now places, under the slab by its pitch line (riser.08)", () => {
    const shell = shellOf(withCommands(cabinDoc(), { type: "addDeckHole", opId: "mid", deck: LOFT, at: { x: 1.1, y: 1.4 }, w: 1, d: 0.8 }), "shipsLadder");
    walk(shell, { x: 1.1, y: 0.6 }, { x: 1.1, y: 1.3 });
    shell.click({ x: 1.1, y: 1.3 });
    expect(Object.values(shell.doc().objects).some((o) => o.kind === "shipsLadder")).toBe(true);
  });

  it("a stair from a short hole's side ghosts green and places what it showed, reading as reaching (AC-03, riser.06)", () => {
    // A hole 0.85 deep, y 1.15–2.00, shorter than the 1.10 m flight: it runs south from its back on the hole's north side, its foot under the slab.
    const doc = withCommands(cabinDoc(), { type: "setCeiling", height: 5 }, { type: "addDeckHole", opId: "mid", deck: LOFT, at: { x: 1.1, y: 1.575 }, w: 1, d: 0.85 });
    const shell = shellOf(doc, "shipsLadder");
    walk(shell, { x: 1.1, y: 1.6 }, { x: 1.1, y: 1.9 });
    expect(prompt(shell)).toMatch(/^Click to place it here, up to the Loft/);
    shell.click({ x: 1.1, y: 1.9 });
    const stair = Object.values(shell.doc().objects).find((o) => o.kind === "shipsLadder");
    if (!stair) throw new Error("no ladder");
    expect(stair.reaches).toBe(LOFT);
    const checks = stairChecks(shell.doc(), stair.id);
    expect(checks.find((c) => c.id === "reach")?.ok).toBe(true);
    expect(checks.find((c) => c.id === "headroom")?.ok).toBe(false);
  });

  it("a ladder with too little room over its foot hovers 'Doesn't fit', and its click is refused (riser.15)", () => {
    const doc = withCommands(cabinDoc(), { type: "addDeckHole", opId: "mid", deck: LOFT, at: { x: 1.1, y: 1.75 }, w: 1, d: 0.4 });
    const shell = shellOf(doc, "shipsLadder");
    walk(shell, { x: 1.1, y: 1.6 }, { x: 1.1, y: 1.9 });
    expect(prompt(shell)).toMatch(/^Doesn't fit/);
    shell.click({ x: 1.1, y: 1.9 });
    shell.click({ x: 1.1, y: 1.9 });
    expect(Object.values(shell.doc().objects).some((o) => o.kind === "shipsLadder")).toBe(false);
  });

  it("a spiral attaches on a hole's side, hanging into the hole", () => {
    const shell = shellOf(withCommands(cabinDoc(), { type: "addDeckHole", opId: "big", deck: LOFT, at: { x: 1.05, y: 1.05 }, w: 1.7, d: 1.7 }), "spiralStair");
    walk(shell, { x: 3.0, y: 0.6 }, { x: 1.05, y: 1.5 });
    shell.click({ x: 1.05, y: 1.5 });
    const [, , , top] = box(shell.doc(), "spiralStair");
    expect(top).toBeCloseTo(1.9, 3);
  });
});

describe("stair snapping reads the slab's edges (AC-07)", () => {
  it("a ladder free-placed beside the notch's open side doesn't snap to the loft's east side there", () => {
    const doc = notchedCabinDoc();
    const opts = { tolerance: 0.125, free: false, kind: "shipsLadder", riser: null, heights: ON_FLOOR, surface: null, land: false as const, level: levelOf(doc, null) };
    // A 0.60 × 0.40 piece of a ladder at rotation 0, x 2.18–2.78, y 2.40–2.80: it backs onto the north wall, and its west
    // side, 8 cm from the line x 2.10, finds no face there to slide into (the loft's east side ends at y 2.25); with the
    // rectangle's sides it slid to x 2.40, flush with the notch's open side.
    const placed = contactPlace(doc, "s0", { w: 0.6, d: 0.4 }, { x: 2.48, y: 2.6 }, 0, opts);
    expect(placed).toMatchObject({ at: { x: 2.48, y: 2.9 }, rotation: 0 });
    // Below the notch the same move turns it flush to the east side, as before.
    expect(contactPlace(doc, "s0", { w: 0.6, d: 0.4 }, { x: 2.48, y: 1.0 }, 0, opts).rotation).toBe(90);
  });
});
