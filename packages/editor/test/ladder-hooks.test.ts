import { describe, expect, it } from "vitest";
import { STAIR_RULES, execute, stairGeometry, unwrap, type Command, type Document } from "@fm/domain";
import { objectFields } from "../src/properties/object";
import { stairLines, RAIL_INSET } from "../src/view/stair-lines";
import { faces3d } from "../src/view3d/faces";
import { view3dItems } from "../src/view3d/items";
import type { Face3d, PieceItem } from "../src/view3d/types";
import { roomDoc } from "./builders";

// A rung ladder hooked over a loft's edge (steps.05, .09, AC-07): with Hooks, each rail ends in a hook mark inside the
// box's back strip on the plan, and in 3D bends over the slab's edge, a hair proud of it, in place of the handhold
// posts. Drawn only. A 6 × 4 room under 3.20, the loft (top 2.15) over x 0.1–1.9; the ladder's back edge on the loft's
// right edge at (1.9, 2), rising toward −x.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const loft: Command = { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 };
const ladder = (hooks: boolean): Document => {
  const doc = ok(roomDoc(), { type: "setCeiling", height: 3.2 }, loft, { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "rungLadder" }, at: { x: 1.9, y: 2 }, rotation: 90 });
  return hooks ? ok(doc, { type: "setOption", objectId: "s/o0", option: "hooks", on: true }) : doc;
};
const pieceOf = (doc: Document): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  return item;
};
const zs = (faces: readonly Face3d[]): number[] => faces.flatMap((f) => f.points.map((p) => p.z));

describe("hooks on the plan", () => {
  const g = stairGeometry(STAIR_RULES.rungs, 0.45, 0.58, 2.15, null);

  it("add a short mark across each rail just inside the back edge; without them the lines are as before", () => {
    const plain = stairLines(STAIR_RULES.rungs, 0.45, g);
    const hooked = stairLines(STAIR_RULES.rungs, 0.45, g, false, true);
    const marks = hooked.across.filter((l) => !plain.across.some((p) => p.a === l.a && p.x0 === l.x0 && p.x1 === l.x1));
    expect(marks).toHaveLength(2);
    const rail = 0.45 / 2 - RAIL_INSET;
    for (const m of marks) {
      expect(m.a).toBeGreaterThan(0.58 - 0.1);
      expect(m.a).toBeLessThanOrEqual(0.58);
      expect(Math.abs((m.x0 + m.x1) / 2)).toBeCloseTo(rail, 9);
      expect(Math.abs(m.x0)).toBeLessThanOrEqual(0.45 / 2 + 1e-9);
      expect(Math.abs(m.x1)).toBeLessThanOrEqual(0.45 / 2 + 1e-9);
    }
  });
});

describe("hooks in 3D", () => {
  it("without hooks the rails rise 0.9 above the loft as a handhold", () => {
    expect(Math.max(...zs(faces3d(pieceOf(ladder(false)))))).toBeCloseTo(2.15 + 0.9, 9);
  });

  it("with hooks there is no handhold: the rails bend over the slab's edge, onto the loft, a hair above it", () => {
    const faces = faces3d(pieceOf(ladder(true)));
    expect(Math.max(...zs(faces))).toBeLessThan(2.15 + 0.1);
    const over = faces.filter((f) => f.points.every((p) => p.x < 1.9 - 1e-6)); // past the back edge, over the loft
    expect(over.length).toBeGreaterThan(0);
    expect(Math.min(...zs(over))).toBeGreaterThan(2.15);
  });
});

describe("the Hooks switch", () => {
  it("shows in Properties for a rung ladder, and setOption refuses it on another kind", () => {
    const props = objectFields(ladder(false), "s/p0");
    if (props.kind !== "object") throw new Error("not an object");
    expect(props.fields.filter((f) => f.section === "Object" && f.toggle === true).map((f) => [f.id, f.label])).toEqual([["hooks", "Hooks"]]);
    const stair = ok(roomDoc(), { type: "placeObject", deck: null, opId: "t", state: "s0", object: { kind: "stair" }, at: { x: 4, y: 3.8 }, rotation: 0 });
    const r = execute(stair, { type: "setOption", objectId: "t/o0", option: "hooks", on: true });
    expect(r.ok ? null : r.error.message).toBe("Only a rung ladder takes hooks");
  });
});
