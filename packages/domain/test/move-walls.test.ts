import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { columnOf } from "../src/column-checks";
import type { Document } from "../src/model";
import { docOf, place, rectDoc } from "./helpers";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// moveWalls (straight.22): every joint of the listed walls moves by one delta; in-line columns go rigidly (straight.12).

const moveWalls = (walls: string[], x: number, y: number): Command => ({ type: "moveWalls", walls, by: { x, y } });

function withColumn(): Document {
  const r = execute(rectDoc(0, 0, 6, 4), { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.3 });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}

describe("moveWalls", () => {
  it("moves both joints of a wall; the walls at its ends stretch; one patch", () => {
    const r = execute(rectDoc(0, 0, 6, 4), moveWalls(["W1"], 0, 0.3));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.J1).toMatchObject({ x: 0, y: 0.3 });
    expect(r.value.doc.joints.J2).toMatchObject({ x: 6, y: 0.3 });
    expect(r.value.patch.puts.filter((p) => p.table === "joints")).toHaveLength(2);
  });

  it("carries a column in the wall's line rigidly", () => {
    const doc = withColumn();
    const run = ["W1", "c/w0", "c/w1"];
    const before = columnOf(doc, "c/w0");
    const r = execute(doc, moveWalls(run, 0, 0.3));
    if (!r.ok) throw new Error(r.error.message);
    const after = columnOf(r.value.doc, "c/w0");
    expect(after?.width).toBeCloseTo(before?.width ?? 0, 9);
    expect(after?.depth).toBe(before?.depth);
    expect(after?.line).not.toBeNull();
    expect(after?.centre.y).toBeCloseTo(0.3, 9);
  });

  it("refuses moving one half next to a column (its joint alone), naming the column", () => {
    const r = execute(withColumn(), moveWalls(["W1"], 0, 0.3));
    expect(r.ok ? "accepted" : r.error.message).toMatch(/Column c\/w0/);
  });

  it("refuses a free column row in the list", () => {
    const doc = execute(rectDoc(0, 0, 6, 4), { type: "placeColumn", opId: "f", at: { x: 3, y: 2 }, width: 0.4, depth: 0.4 });
    if (!doc.ok) throw new Error(doc.error.message);
    const r = execute(doc.value.doc, moveWalls(["f/w0"], 0.5, 0));
    expect(r.ok).toBe(false);
  });

  it("by zero returns the document unchanged", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const r = execute(doc, moveWalls(["W1"], 0, 0));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc).toBe(doc);
  });

  it("refuses a move that crosses another wall", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 2, 1], ["D", 2, 3]],
      walls: [["H", "A", "B"], ["V", "C", "D"]],
    });
    const r = execute(doc, moveWalls(["H"], 0, 2));
    expect(r.ok ? "accepted" : r.error.message).toBe("Walls can't cross");
  });

  it("moves the kinked house's top run down 1 cm with the verticals staying vertical", () => {
    const doc = kinkedHouseDoc();
    const r = execute(doc, moveWalls(["wc9b9", "wdb4fb"], 0, -0.01));
    if (!r.ok) throw new Error(r.error.message);
    for (const j of ["c9b9", "db4f", "afdbb"]) expect(r.value.doc.joints[j]?.y).toBeCloseTo(2.84, 9);
    expect(r.value.doc.joints.c9b9?.x).toBe(8.875);
  });

  it("lists the moved joints and their walls as dependencies", () => {
    const r = execute(rectDoc(0, 0, 6, 4), moveWalls(["W1"], 0, 0.3));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.dependencies).toEqual(expect.arrayContaining([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "walls", id: "W1" }, { table: "walls", id: "W2" }, { table: "walls", id: "W4" },
    ]));
  });

  it("refuses unknown walls and a non-finite delta", () => {
    expect(execute(rectDoc(0, 0, 6, 4), moveWalls(["nope"], 0, 1)).ok).toBe(false);
    expect(execute(rectDoc(0, 0, 6, 4), moveWalls(["W1"], Number.NaN, 1)).ok).toBe(false);
    expect(execute(rectDoc(0, 0, 6, 4), moveWalls([], 0, 1)).ok).toBe(false);
  });
});

// Walls and pieces in one move (straight.09, step 27). Three 4 × 4 rooms in a row (x 0..4, 4..8, 8..12), Day (s0) and
// Night. Moving the right room's walls and pieces 0.5 m left shortens the middle room; its bottom and top walls stretch.
function threeRooms(): Document {
  const doc = docOf({
    joints: [["a0", 0, 0], ["a1", 4, 0], ["a2", 8, 0], ["a3", 12, 0], ["b0", 0, 4], ["b1", 4, 4], ["b2", 8, 4], ["b3", 12, 4]],
    walls: [
      ["bot1", "a0", "a1"], ["bot2", "a1", "a2"], ["bot3", "a2", "a3"], ["top1", "b0", "b1"], ["top2", "b1", "b2"], ["top3", "b2", "b3"],
      ["v0", "a0", "b0"], ["v1", "a1", "b1"], ["v2", "a2", "b2"], ["v3", "a3", "b3"],
    ],
  });
  return { ...doc, states: { s0: { id: "s0", name: "Day", order: 0 }, night: { id: "night", name: "Night", order: 1 } } };
}
const RIGHT = ["bot3", "top3", "v2", "v3"];
const chairIn = (doc: Document, x: number, y: number, opId = "ch"): Document => {
  const r = execute(doc, { type: "placeObject", opId, state: "s0", object: { kind: "chair" }, at: { x, y }, rotation: 0, deck: null });
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};

describe("moveWalls with placements", () => {
  it("moves the walls and a linked piece in every layout, as one patch; the middle room is 0.5 m shorter (AC-20)", () => {
    const doc = chairIn(threeRooms(), 10, 2);
    const chairs = Object.values(doc.placements);
    expect(chairs).toHaveLength(2); // linked: Day and Night
    const day = chairs.find((p) => p.state === "s0");
    const r = execute(doc, { type: "moveWalls", walls: RIGHT, by: { x: -0.5, y: 0 }, placements: [day?.id ?? ""] });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.a2).toMatchObject({ x: 7.5, y: 0 });
    expect(r.value.doc.joints.a3).toMatchObject({ x: 11.5, y: 0 });
    for (const p of Object.values(r.value.doc.placements)) expect(p.at).toEqual({ x: 9.5, y: 2 });
  });

  it("without the piece, a wall that would run over it refuses the move, naming it", () => {
    const doc = chairIn(threeRooms(), 8.5, 2);
    const r = execute(doc, { type: "moveWalls", walls: RIGHT, by: { x: 0.5, y: 0 } });
    expect(r.ok ? "accepted" : r.error.message).toMatch(/Chair .* overlaps a wall in/);
  });

  it("with the piece it passes: everything moves, then one validation", () => {
    const doc = chairIn(threeRooms(), 8.5, 2);
    const day = Object.values(doc.placements).find((p) => p.state === "s0");
    expect(execute(doc, { type: "moveWalls", walls: RIGHT, by: { x: 0.5, y: 0 }, placements: [day?.id ?? ""] }).ok).toBe(true);
  });

  it("refuses when an exception piece in another layout would misfit, naming the piece and the layout (AC-22)", () => {
    // A Night-only table just right of the wall at x 8; the wall moving 0.5 right would run over it.
    const doc = place(chairIn(threeRooms(), 10, 2), { object: "nt", kind: "coffeeTable", at: [9, 2], state: "night" });
    const day = Object.values(doc.placements).find((p) => p.state === "s0" && p.object !== "nt");
    const r = execute(doc, { type: "moveWalls", walls: RIGHT, by: { x: 0.5, y: 0 }, placements: [day?.id ?? ""] });
    expect(r.ok ? "accepted" : r.error.message).toMatch(/Coffee table .* in night/i);
  });

  it("refuses placements of two layouts, an unknown one and one listed twice", () => {
    const doc = chairIn(threeRooms(), 10, 2);
    const [p, q] = Object.values(doc.placements).map((x) => x.id);
    const cmd = (placements: string[]): Command => ({ type: "moveWalls", walls: RIGHT, by: { x: -0.5, y: 0 }, placements });
    expect(execute(doc, cmd([p ?? "", q ?? ""])).ok).toBe(false);
    expect(execute(doc, cmd(["nope"])).ok).toBe(false);
    expect(execute(doc, cmd([p ?? "", p ?? ""])).ok).toBe(false);
  });
});
