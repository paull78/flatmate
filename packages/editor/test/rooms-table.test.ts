import { describe, expect, it } from "vitest";
import { emptyDocument, motifDefaults, rectangleRoom, type Command, type Document } from "@fm/domain";
import { roomsTable } from "../src/export/rooms-table";
import { dividedRoomDoc, donutDoc, narrowRoomDoc, nightBedDoc, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The rooms table (spec Behaviour "Area table", export.10; AC-03, AC-10): one row per labelled room, in name order.

/** dividedRoomDoc's two 2.8 × 3.8 m rooms, labelled "Living" (left) and "Bedroom" (right). */
function twoRooms(): Document {
  return withCommands(
    dividedRoomDoc(),
    { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Living", finish: null },
    { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Bedroom", finish: null },
  );
}

describe("roomsTable", () => {
  it("rows are labelled rooms in name order, with size, clear area and no free floor where unfurnished", () => {
    const t = roomsTable(twoRooms(), "s0");
    expect(t.rows).toEqual([
      { labelId: "L2", name: "Bedroom", detail: "2.80 × 3.80 m", area: "10.64 m²", free: null },
      { labelId: "L1", name: "Living", detail: "2.80 × 3.80 m", area: "10.64 m²", free: null },
    ]);
  });

  it("the total sums the rows' clear areas", () => {
    expect(roomsTable(twoRooms(), "s0").total).toBe("21.28 m²");
  });

  it("an unavailable area shows the short note and is not counted", () => {
    const doc = withCommands(narrowRoomDoc(), ...rectangleRoom({ x: 2, y: 0 }, 3, 3, "den"), { type: "labelZone", id: "L2", at: { x: 3.5, y: 1.5 }, name: "Den", finish: null });
    const t = roomsTable(doc, "s0");
    expect(t.rows.map((r) => [r.name, r.area])).toEqual([["Closet", "Area unavailable"], ["Den", "7.84 m²"]]);
    expect(t.total).toBe("7.84 m²");
  });

  it("free floor appears for furnished rooms, in that layout", () => {
    const doc = withCommands(nightBedDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Studio", finish: null });
    expect(roomsTable(doc, "n/s0").rows[0]?.free).toBe("18.8 m²"); // 22.04 − 1.6 × 2
    expect(roomsTable(doc, "s0").rows[0]?.free).toBe("22.0 m²"); // the bed is only in Night
  });

  it("two labelled rooms merged into one are one row, counted once", () => {
    // Two labelled rooms merge into one when their divider goes; the domain merges their labels (spec: walls-rooms).
    const labelled = withCommands(dividedRoomDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Studio", finish: null }, { type: "labelZone", id: "L2", at: { x: 5, y: 3 }, name: "Corner", finish: null });
    const doc = withCommands(labelled, { type: "deleteEntities", ids: [{ table: "walls", id: wallBetween(labelled, { x: 3, y: 0 }, { x: 3, y: 4 }) }] });
    const t = roomsTable(doc, "s0");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]?.name).toBe("Studio / Corner");
    expect(t.total).toBe("22.04 m²");
  });

  it("a labelled room nested in another is counted once", () => {
    const doc = withCommands(
      emptyDocument(),
      ...rectangleRoom({ x: 0, y: 0 }, 10, 8, "apt"),
      ...rectangleRoom({ x: 3.5, y: 2.5 }, 3, 3, "core"),
      { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Living", finish: null },
      { type: "labelZone", id: "L2", at: { x: 5, y: 4 }, name: "Stairs", finish: null },
    );
    const t = roomsTable(doc, "s0");
    expect(t.rows.map((r) => [r.name, r.area])).toEqual([["Living", "66.20 m²"], ["Stairs", "7.84 m²"]]);
    expect(t.total).toBe("74.04 m²"); // 84.28 when the core's floor was counted in both rooms
  });

  it("a room with a hole has no size; a nested room keeps its own", () => {
    const doc = withCommands(
      donutDoc(),
      { type: "labelZone", id: "L1", at: { x: 1.5, y: 4 }, name: "Living", finish: null },
      { type: "labelZone", id: "L2", at: { x: 5, y: 4 }, name: "Stairs", finish: null },
    );
    expect(roomsTable(doc, "s0").rows).toEqual([
      { labelId: "L1", name: "Living", detail: null, area: "66.20 m²", free: null },
      { labelId: "L2", name: "Stairs", detail: "2.80 × 2.80 m", area: "7.84 m²", free: null },
    ]);
  });

  it("two rooms with the same name are two rows, told apart by their label id (finishes.49)", () => {
    const doc = withCommands(twoRooms(), { type: "renameZone", id: "L2", name: "Living" });
    expect(roomsTable(doc, "s0").rows.map((r) => [r.name, r.labelId])).toEqual([["Living", "L1"], ["Living", "L2"]]);
  });

  it("the second line names the floor: \"size · Motif\" for a finished rectangle, \"Motif\" for a finished L; an unfinished rectangle its size, an unfinished L nothing (finishes.11)", () => {
    const L: Command[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }].map((p, i, ps) => ({ type: "addWall", opId: `l${i}`, from: { at: p }, to: { at: ps[(i + 1) % ps.length] ?? p } }));
    const doc = withCommands(
      emptyDocument(),
      ...L,
      ...rectangleRoom({ x: 6, y: 0 }, 2.5, 1.6, "bath"),
      { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "A hall", finish: null },
      { type: "labelZone", id: "L2", at: { x: 7, y: 0.8 }, name: "Bathroom", finish: null },
    );
    const details = (d: Document) => roomsTable(d, "s0").rows.map((r) => [r.name, r.detail]);
    expect(details(doc)).toEqual([["A hall", null], ["Bathroom", "2.30 × 1.40 m"]]);
    const finished = withCommands(doc, { type: "setFinish", id: "L1", finish: motifDefaults("widePlanks") }, { type: "setFinish", id: "L2", finish: motifDefaults("mosaic") });
    expect(details(finished)).toEqual([["A hall", "Wide planks"], ["Bathroom", "2.30 × 1.40 m · Mosaic"]]);
  });

  it("a cored room with a finish names its floor alone; the core keeps its size", () => {
    const doc = withCommands(
      donutDoc(),
      { type: "labelZone", id: "L1", at: { x: 1.5, y: 4 }, name: "Living", finish: motifDefaults("planks") },
      { type: "labelZone", id: "L2", at: { x: 5, y: 4 }, name: "Stairs", finish: null },
    );
    expect(roomsTable(doc, "s0").rows.map((r) => r.detail)).toEqual(["Planks", "2.80 × 2.80 m"]);
  });

  it("no labelled rooms: no rows and no total", () => {
    expect(roomsTable(emptyDocument(), "s0")).toEqual({ rows: [], total: null });
  });
});

describe("the Rooms section in Properties (AC-03)", () => {
  it("shows when nothing is selected, with the active layout's free floor", () => {
    const shell = FakeShell.withDocument(twoRooms());
    expect(shell.view().rooms?.rows.map((r) => r.name)).toEqual(["Bedroom", "Living"]);
    expect(shell.view().rooms?.total).toBe("21.28 m²");
  });

  it("hides when something is selected", () => {
    const shell = FakeShell.withDocument(twoRooms());
    shell.click({ x: 3, y: 2 }); // the divider wall
    expect(shell.view().properties.kind).toBe("wall");
    expect(shell.view().rooms).toBeNull();
  });

  it("is null without labelled rooms", () => {
    expect(FakeShell.withDocument(roomDoc()).view().rooms).toBeNull();
  });
});
