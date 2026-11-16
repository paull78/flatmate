import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { openingGeometry } from "../src/queries/openings";
import { docOf, rectDoc, withOpening } from "./helpers";

// straight.15, .23: when a wall stretches (its direction unchanged, its two ends moved by different amounts), its
// openings keep their place in the world; a wall carried whole keeps its offsets, so its doors travel with it.

const move = (moves: [string, number, number][]): Command => ({ type: "moveJoints", moves: moves.map(([jointId, x, y]) => ({ jointId, to: { x, y } })) });

function run(doc: Document, cmd: Command): Document {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}

describe("openings stay put when their wall only stretches", () => {
  it("a corner dragged along a leg leaves the leg's window where it was", () => {
    // W1 runs J1 (0, 0) → J2 (6, 0); dragging J1 to (-1, 0) stretches W1 from its joint a.
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "w", wall: "W1", offset: 2, kind: "window" });
    const after = run(doc, move([["J1", -1, 0]]));
    expect(after.openings.w?.offset).toBeCloseTo(3, 9);
    expect(openingGeometry(after, "w")?.start.x).toBeCloseTo(2, 9);
  });

  it("a stretch at joint b keeps the offset (already in place)", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "w", wall: "W1", offset: 2, kind: "window" });
    expect(run(doc, move([["J2", 7, 0]])).openings.w).toEqual(doc.openings.w);
  });

  it("a wall carried whole across keeps its offsets", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1 });
    expect(run(doc, move([["J1", 0, 0.5], ["J2", 6, 0.5]])).openings.d).toEqual(doc.openings.d);
  });

  it("a free wall carried along its own line takes its door with it", () => {
    const doc = withOpening(docOf({ joints: [["A", 0, 0], ["B", 3, 0]], walls: [["F", "A", "B"]] }), { id: "d", wall: "F", offset: 1 });
    const after = run(doc, move([["A", 1, 0], ["B", 4, 0]]));
    expect(after.openings.d).toEqual(doc.openings.d);
    expect(openingGeometry(after, "d")?.start.x).toBeCloseTo(2, 9);
  });

  it("a stretch that would push a window past joint a is refused, naming it", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "w", wall: "W1", offset: 2, kind: "window" });
    const r = execute(doc, move([["J1", 2.5, 0]]));
    expect(r.ok ? "accepted" : r.error.message).toMatch(/w doesn't fit on wall W1/);
  });

  it("a pocket door counts its pocket", () => {
    // Hinge a: the pocket reaches one width before the offset, from 0.1 to 1.7.
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "p", wall: "W1", offset: 0.9, kind: "pocket", hinge: "a" });
    expect(execute(doc, move([["J1", 0.5, 0]])).ok).toBe(false);
    expect(execute(doc, move([["J1", 0.05, 0]])).ok).toBe(true);
  });

  it("setWallLength keeps the window of the wall in line beyond the moving joint in place", () => {
    // B1 J1 (0, 0) → S (3, 0), B2 S → J2 (6, 0); shortening B1 to 2 moves S, which is B2's joint a.
    const base = docOf({
      joints: [["J1", 0, 0], ["S", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
      walls: [["B1", "J1", "S"], ["B2", "S", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
    });
    const doc = withOpening(base, { id: "w", wall: "B2", offset: 1, kind: "window" });
    const after = run(doc, { type: "setWallLength", wallId: "B1", length: 2, keep: "a" });
    expect(after.openings.w?.offset).toBeCloseTo(2, 9);
    expect(openingGeometry(after, "w")?.start.x).toBeCloseTo(4, 9);
  });

  it("a wall that turns keeps its offsets, as before", () => {
    // Dragging J1 (W1's joint a) left and up turns W1: its window keeps its offset from J1.
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "w", wall: "W1", offset: 2, kind: "window" });
    expect(run(doc, move([["J1", -1, 0.5]])).openings.w).toEqual(doc.openings.w);
  });

  it("the moved openings are dependencies of the move", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "w", wall: "W1", offset: 2, kind: "window" });
    const r = execute(doc, move([["J1", -1, 0]]));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.dependencies).toContainEqual({ table: "openings", id: "w" });
  });
});
