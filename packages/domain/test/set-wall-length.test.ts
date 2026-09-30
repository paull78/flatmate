import { describe, expect, it } from "vitest";
import { addWall } from "../src/commands/add-wall";
import { setWallLength } from "../src/commands/set-wall-length";
import type { Document } from "../src/model";
import { faceAt } from "../src/queries/zones";
import { docOf, rectDoc } from "./helpers";

/** The demo room divided by a wall (3, 0) → (3, 4); W1 keeps J1 (0, 0) → d/j0 (3, 0). */
function divided(): Document {
  const r = addWall(rectDoc(0, 0, 6, 4), { type: "addWall", opId: "d", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}

describe("setWallLength", () => {
  it("keeps endpoint a and moves b along the wall; connected walls follow", () => {
    const doc = rectDoc(0, 0, 6, 4); // W2: J2(6,0) → J3(6,4)
    const r = setWallLength(doc, { type: "setWallLength", wallId: "W2", length: 3.5, keep: "a" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.J3).toEqual({ id: "J3", x: 6, y: 3.5 });
    expect(r.value.doc.walls.W3).toEqual(doc.walls.W3); // W3 still uses J3, so it follows
    expect(r.value.patch.dependencies).toEqual([
      { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "walls", id: "W2" }, { table: "walls", id: "W3" },
    ]);
  });

  it("keeps endpoint b when asked", () => {
    const r = setWallLength(rectDoc(0, 0, 6, 4), { type: "setWallLength", wallId: "W1", length: 5, keep: "b" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.J1).toEqual({ id: "J1", x: 1, y: 0 });
    // W1: J1 → J2 keeping J2, so J1 moves and W4 (J4 → J1) follows.
    expect(r.value.patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "walls", id: "W1" }, { table: "walls", id: "W4" },
    ]);
  });

  it("returns an empty patch when the length does not change", () => {
    // A diagonal wall: the float round trip kept + normalize(moving − kept) · length drifts.
    const diagonal = docOf({ joints: [["A", 0, 0], ["B", 0.5, 1.3333333333333333]], walls: [["W", "A", "B"]] });
    const first = setWallLength(diagonal, { type: "setWallLength", wallId: "W", length: 5.25, keep: "a" });
    if (!first.ok) throw new Error(first.error.message);
    const again = setWallLength(first.value.doc, { type: "setWallLength", wallId: "W", length: 5.25, keep: "a" });
    if (!again.ok) throw new Error(again.error.message);
    expect(again.value.patch.puts).toEqual([]);
    expect(again.value.patch.deletes).toEqual([]);
    expect(again.value.patch.before).toEqual([]);
    expect(again.value.doc).toBe(first.value.doc);
    expect(again.value.patch.dependencies).toEqual([
      { table: "joints", id: "A" }, { table: "joints", id: "B" }, { table: "walls", id: "W" },
    ]);
  });

  it("returns an empty patch when a diagonal wall is set to its current length", () => {
    const diagonal = docOf({ joints: [["A", 0, 0], ["B", 0.5, 1.3333333333333333]], walls: [["W", "A", "B"]] });
    const current = Math.hypot(0.5, 1.3333333333333333);
    for (const keep of ["a", "b"] as const) {
      const r = setWallLength(diagonal, { type: "setWallLength", wallId: "W", length: current, keep });
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.patch.puts).toEqual([]);
      expect(r.value.patch.deletes).toEqual([]);
      expect(r.value.doc).toBe(diagonal);
    }
  });

  it("rejects too-short, invalid and topology-breaking lengths", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(setWallLength(doc, { type: "setWallLength", wallId: "W2", length: 0.005, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "tooShort" } });
    expect(setWallLength(doc, { type: "setWallLength", wallId: "W2", length: -1, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(setWallLength(doc, { type: "setWallLength", wallId: "nope", length: 1, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "notFound" } });
    // Moving d/j0 to (7, 0) drags the divider across W2 and folds d/w1 back over W1.
    const room = divided();
    expect(setWallLength(room, { type: "setWallLength", wallId: "W1", length: 7, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "topology", message: "Walls can't cross" } });
    expect(room).toEqual(divided()); // unchanged
  });

  it("moves a label back into its own room when the resize swings the divider over it", () => {
    const room: Document = { ...divided(), zoneLabels: { L: { id: "L", at: { x: 4.5, y: 0.5 }, name: "Right" } } };
    const right = faceAt(room, { x: 4.5, y: 0.5 });
    // W1 to 5 m moves d/j0 to (5, 0): the divider now runs (5, 0) → (3, 4), left of (4.5, 0.5).
    const r = setWallLength(room, { type: "setWallLength", wallId: "W1", length: 5, keep: "a" });
    if (!r.ok) throw new Error(r.error.message);
    const label = r.value.doc.zoneLabels.L;
    expect(label && faceAt(r.value.doc, label.at)?.key).toBe(right?.key);
    expect(r.value.patch.puts).toContainEqual({ table: "zoneLabels", entity: label });
    expect(r.value.patch.dependencies).toContainEqual({ table: "zoneLabels", id: "L" });
  });

  it("refuses an ID naming an Object.prototype member as an unknown wall", () => {
    expect(setWallLength(rectDoc(0, 0, 6, 4), { type: "setWallLength", wallId: "toString", length: 1, keep: "a" }))
      .toMatchObject({ ok: false, error: { kind: "notFound", message: "Wall not found" } });
  });

  it("refuses a kept endpoint other than a or b", () => {
    const doc = rectDoc(0, 0, 6, 4);
    // Runtime values can come from outside the type system.
    for (const keep of [JSON.parse('"c"'), JSON.parse("null")]) {
      expect(setWallLength(doc, { type: "setWallLength", wallId: "W1", length: 5, keep }))
        .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    }
  });
});
