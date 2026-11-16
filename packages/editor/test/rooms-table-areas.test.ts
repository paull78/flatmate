import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { roomsTable } from "../src/export/rooms-table";
import { roomDoc } from "./builders";

// Named areas in the rooms table (areas step 10, areas.12, AC-10): a row each, indented under its room, its m² and no free
// figure, by name within the room; the total counts rooms only; an unnamed room holding areas gets "Unnamed room".
// roomDoc: one 6 × 4 room, clear 5.80 × 3.80 = 22.04 m².

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const GREAT: Command = { type: "labelZone", id: "L1", at: { x: 3, y: 0.5 }, name: "Great room", finish: null };
const LIVING: Command = { type: "addArea", opId: "l", at: { x: 4.4, y: 2 }, w: 3, d: 2, name: "Living" }; // 6.00 m²
const KITCHEN: Command = { type: "addArea", opId: "k", at: { x: 1.4, y: 2 }, w: 2, d: 2, name: "Kitchen" }; // 4.00 m²
const SOFA: Command = { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 4.4, y: 2 }, deck: null };

describe("areas in the rooms table (AC-10)", () => {
  it("Kitchen and Living are rows indented under Great room, by name, with their m² and no free figure", () => {
    const t = roomsTable(run(roomDoc(), GREAT, LIVING, KITCHEN, SOFA), "s0");
    expect(t.rows.map((r) => [r.name, r.area, r.free, r.part ?? false])).toEqual([
      ["Great room", "22.04 m²", expect.any(String), false],
      ["Kitchen", "4.00 m²", null, true],
      ["Living", "6.00 m²", null, true],
    ]);
    expect(t.rows.map((r) => r.labelId)).toEqual(["L1", "k/a0", "l/a0"]);
  });

  it("the total counts the rooms alone", () => {
    expect(roomsTable(run(roomDoc(), GREAT, LIVING, KITCHEN), "s0").total).toBe("22.04 m²");
  });

  it("an unnamed room holding an area shows as Unnamed room, its area under it", () => {
    const t = roomsTable(run(roomDoc(), KITCHEN), "s0");
    expect(t.rows.map((r) => [r.name, r.area, r.part ?? false])).toEqual([["Unnamed room", "22.04 m²", false], ["Kitchen", "4.00 m²", true]]);
    expect(t.total).toBe("22.04 m²");
  });

  it("an unnamed room without areas still has no row", () => {
    expect(roomsTable(roomDoc(), "s0").rows).toEqual([]);
  });

  it("an area outside every room is left out", () => {
    const doc = run(roomDoc(), GREAT, { type: "addArea", opId: "k", at: { x: 4.4, y: 2 }, w: 3, d: 2, name: "Porch" });
    const moved = run(doc, { type: "moveJoints", moves: Object.values(doc.joints).filter((j) => Math.abs(j.x - 6) < 1e-9).map((j) => ({ jointId: j.id, to: { x: 4, y: j.y } })) });
    expect(roomsTable(moved, "s0").rows.map((r) => r.name)).toEqual(["Great room"]);
  });
});
