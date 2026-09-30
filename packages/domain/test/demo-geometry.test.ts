import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { zones } from "../src/queries/zones";
import { deepFreeze } from "./helpers";

// Spec §1.4 steps 2–6, driven only through the domain API (world y up, metres).
const wall = (opId: string, from: [number, number], to: [number, number]): Command => ({
  type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } },
});
const run = (doc: Document, cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
// Label id → area of the room it resolves to, so the check does not depend on zone order.
const labelAreas = (doc: Document) => Object.fromEntries(zones(doc).flatMap((z) => z.labelIds.map((id) => [id, z.area])));

const step2 = () => run(emptyDocument(), [wall("a", [0, 0], [6, 0]), wall("b", [6, 0], [6, 4]), wall("c", [6, 4], [0, 4]), wall("d", [0, 4], [0, 0])]);
const step3 = () => run(step2(), [wall("e", [3, 0], [3, 4])]);
const step4 = () => run(step3(), [
  { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" },
  { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Room 2" },
]);
const step5 = () => run(step4(), [{ type: "setWallLength", wallId: "b/w0", length: 3.5, keep: "a" }]);

describe("demo geometry (spec §1.4 steps 2–6)", () => {
  it("step 2: four walls close a 6 × 4 room: (6 − 0.2) × (4 − 0.2) = 22.04 m²", () => {
    const doc = step2();
    expect(Object.keys(doc.joints)).toHaveLength(4);
    expect(Object.keys(doc.walls)).toHaveLength(4);
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "c/j0", b: "a/j0" }); // closed on the first joint
    expect(zones(doc)).toHaveLength(1);
    expect(zones(doc)[0]?.area).toBeCloseTo(22.04, 6);
  });

  it("step 2 with existing-joint endpoints (as the editor sends a chain) gives the same document", () => {
    const doc = run(emptyDocument(), [
      wall("a", [0, 0], [6, 0]),
      { type: "addWall", opId: "b", from: { existing: "a/j1" }, to: { at: { x: 6, y: 4 } } },
      { type: "addWall", opId: "c", from: { existing: "b/j0" }, to: { at: { x: 0, y: 4 } } },
      { type: "addWall", opId: "d", from: { existing: "c/j0" }, to: { existing: "a/j0" } },
    ]);
    expect(doc).toEqual(step2());
  });

  it("step 3: the divider (3,0) → (3,4) splits the bottom and top walls into T-junctions", () => {
    const doc = step3();
    expect(doc.joints["e/j0"]).toEqual({ id: "e/j0", x: 3, y: 0 });
    expect(doc.joints["e/j1"]).toEqual({ id: "e/j1", x: 3, y: 4 });
    expect(doc.walls["e/w0"]).toEqual({ id: "e/w0", a: "e/j0", b: "e/j1" });
    expect(doc.walls["a/w0"]).toEqual({ id: "a/w0", a: "a/j0", b: "e/j0" });
    expect(doc.walls["e/w1"]).toEqual({ id: "e/w1", a: "e/j0", b: "a/j1" }); // bottom wall's right fragment
    expect(doc.walls["c/w0"]).toEqual({ id: "c/w0", a: "b/j0", b: "e/j1" });
    expect(doc.walls["e/w2"]).toEqual({ id: "e/w2", a: "e/j1", b: "c/j0" }); // top wall's left fragment
    expect(Object.keys(doc.walls)).toHaveLength(7);
    expect(Object.keys(doc.joints)).toHaveLength(6);
  });

  it("step 4: two labelled rooms of 10.64 m² each", () => {
    const doc = step4();
    expect(zones(doc)).toHaveLength(2);
    expect(labelAreas(doc)).toEqual({ L1: expect.closeTo(10.64, 6), L2: expect.closeTo(10.64, 6) });
  });

  it("step 5: resizing the right wall (a = (6,0)) to 3.5 moves (6,4) to (6,3.5) and slopes the top wall", () => {
    const doc = step5();
    expect(doc.walls["b/w0"]?.a).toBe("a/j1");
    expect(doc.joints["a/j1"]).toEqual({ id: "a/j1", x: 6, y: 0 }); // the kept end stays put
    expect(doc.joints["b/j0"]).toEqual({ id: "b/j0", x: 6, y: 3.5 });
    expect(doc.walls["c/w0"]).toEqual({ id: "c/w0", a: "b/j0", b: "e/j1" }); // (6,3.5) → (3,4)
    expect(zones(doc)).toHaveLength(2);
    // Only the right room shrinks: it spans x 3.1–5.9, the top wall's centre is 3.75 high on average and its inner
    // face is inset 0.1·√(1 + 1/36) m, so 2.8 × (3.75 − 0.1 − 0.1·√(1 + 1/36)) ≈ 9.936 m² (displayed 9.94).
    expect(labelAreas(doc)).toEqual({ L1: expect.closeTo(10.64, 6), L2: expect.closeTo(9.9361, 4) });
  });

  it("step 6: dragging that joint to (2,2) is refused: the right wall would cross the divider at (3, 1.5)", () => {
    const doc = deepFreeze(step5());
    const r = execute(doc, { type: "moveJoints", moves: [{ jointId: "b/j0", to: { x: 2, y: 2 } }] });
    expect(r).toMatchObject({ ok: false, error: { kind: "topology", message: "Walls can't cross" } });
    expect(r.ok ? [] : r.error.violations).toEqual([{
      invariant: "I5",
      message: "Walls b/w0 and e/w0 cross",
      entities: [{ table: "walls", id: "b/w0" }, { table: "walls", id: "e/w0" }],
    }]);
    expect(doc).toEqual(step5());
  });
});
