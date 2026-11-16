import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap, type Command, type Document } from "@fm/domain";
import { jointAt, pointOf, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

// Step 28 (straight.09, .16, .24): walls join the selection. Three 4 × 4 rooms in a row (x 0..4, 4..8, 8..12) with a
// chair in the left and the right room. Boxing the right room and dragging it 0.5 m left shortens the middle room.

const wall = (opId: string, from: [number, number], to: [number, number]): Command => ({ type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } } });
const chair = (opId: string, x: number, y: number): Command => ({ type: "placeObject", opId, state: "s0", object: { kind: "chair" }, at: { x, y }, rotation: 0, deck: null });
function threeRooms(): Document {
  return [wall("b", [0, 0], [12, 0]), wall("r", [12, 0], [12, 4]), wall("t", [12, 4], [0, 4]), wall("l", [0, 4], [0, 0]), wall("d1", [4, 0], [4, 4]), wall("d2", [8, 0], [8, 4]), chair("c1", 2, 2), chair("c3", 10, 2)]
    .reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument());
}
function shellOn(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  return shell;
}
const tables = (shell: FakeShell) => shell.state.selection.map((r) => r.table).sort();
const boxRight = (shell: FakeShell): void => shell.drag({ x: 12.5, y: -0.5 }, { x: 7, y: 4.5 }); // from empty canvas

describe("walls in the selection", () => {
  it("a box takes the walls wholly inside and the furniture; dragging it 0.5 m left shortens the middle room, one undo step (AC-20)", () => {
    const doc = threeRooms();
    const shell = shellOn(doc);
    boxRight(shell);
    expect(tables(shell)).toEqual(["placements", "walls", "walls", "walls", "walls"]);
    shell.drag({ x: 12, y: 2 }, { x: 11.5, y: 2.03 });
    const after = shell.doc();
    expect(pointOf(after, jointAt(doc, { x: 8, y: 0 }))).toEqual({ x: 7.5, y: 0 });
    expect(pointOf(after, jointAt(doc, { x: 12, y: 4 }))).toEqual({ x: 11.5, y: 4 });
    expect(pointOf(after, jointAt(doc, { x: 4, y: 0 }))).toEqual({ x: 4, y: 0 });
    expect(Object.values(after.placements).map((p) => p.at.x).sort()).toEqual([2, 9.5]);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection).toHaveLength(5); // the group stays selected
  });

  it("a typed distance moves the group exactly, along the drag's larger axis", () => {
    const doc = threeRooms();
    const shell = shellOn(doc);
    boxRight(shell);
    shell.moveTo({ x: 12, y: 2 });
    shell.down({ x: 12, y: 2 });
    shell.moveTo({ x: 11.8, y: 2 });
    shell.type("0.75");
    shell.up({ x: 11.8, y: 2 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 8, y: 0 }))).toEqual({ x: 7.25, y: 0 });
  });

  it("two partitions Shift-clicked move together with no furniture; a piece in their path refuses the move, named (AC-21)", () => {
    const doc = threeRooms();
    const shell = shellOn(doc);
    shell.click({ x: 4, y: 2 });
    shell.click({ x: 8, y: 2 }, { shift: true });
    expect(tables(shell)).toEqual(["walls", "walls"]);
    shell.drag({ x: 8, y: 2 }, { x: 8.5, y: 2 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 4, y: 0 }))).toEqual({ x: 4.5, y: 0 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 8, y: 0 }))).toEqual({ x: 8.5, y: 0 });
    expect(Object.values(shell.doc().placements).map((p) => p.at.x).sort()).toEqual([10, 2]);
    // 1.3 m further the second partition would run over the chair at x 10 (9.775 .. 10.225).
    shell.drag({ x: 8.5, y: 2 }, { x: 9.8, y: 2 });
    expect(shell.view().toast).toMatch(/Chair .* overlaps a wall/);
    expect(pointOf(shell.doc(), jointAt(doc, { x: 4, y: 0 }))).toEqual({ x: 4.5, y: 0 });
  });

  it("Shift-click takes a wall out again; one wall left drags its run, across only", () => {
    const doc = threeRooms();
    const shell = shellOn(doc);
    shell.click({ x: 4, y: 2 });
    shell.click({ x: 8, y: 2 }, { shift: true });
    shell.click({ x: 8, y: 2 }, { shift: true });
    expect(shell.state.selection).toEqual([{ table: "walls", id: wallBetween(doc, { x: 4, y: 0 }, { x: 4, y: 4 }) }]);
    shell.drag({ x: 4, y: 2 }, { x: 4.5, y: 2.4 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 4, y: 0 }))).toEqual({ x: 4.5, y: 0 });
  });

  it("R and the arrows on a group with walls do nothing and say why", () => {
    const shell = shellOn(threeRooms());
    boxRight(shell);
    const before = shell.doc();
    shell.key("r");
    expect(shell.view().toast).toBe("Walls don't turn");
    shell.key("ArrowLeft");
    expect(shell.view().toast).toBe("Arrow keys move furniture only");
    expect(shell.doc()).toEqual(before);
  });

  it("a box over only furniture, and a click on a wall, behave as before", () => {
    const shell = shellOn(threeRooms());
    shell.drag({ x: 1, y: 1 }, { x: 3, y: 3 });
    expect(tables(shell)).toEqual(["placements"]);
    shell.click({ x: 4, y: 2 });
    expect(tables(shell)).toEqual(["walls"]);
  });

  it("a mixed group's Properties has its counts and why Duplicate is off; furniture alone has neither (AC-23)", () => {
    const shell = shellOn(threeRooms());
    boxRight(shell);
    expect(shell.view().properties).toEqual({ kind: "group", count: 5, walls: 4, duplicate: "Walls can't be duplicated" });
    shell.ui({ type: "duplicate" });
    expect(shell.state.tool.name === "select" && shell.state.tool.state.kind).toBe("idle");
    const chairs = shellOn(threeRooms());
    chairs.drag({ x: 1, y: 1 }, { x: 3, y: 3 });
    chairs.drag({ x: 9, y: 1 }, { x: 11, y: 3 }, { shift: true });
    expect(chairs.view().properties).toEqual({ kind: "group", count: 2 });
  });

  it("Delete removes a mixed group in one step", () => {
    const shell = shellOn(threeRooms());
    boxRight(shell);
    shell.key("Delete");
    expect(Object.values(shell.doc().placements)).toHaveLength(1);
    expect(shell.state.undo.past).toHaveLength(1);
  });
});
