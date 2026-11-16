import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap, type Command, type Document } from "@fm/domain";
import { FakeShell } from "./fake-shell";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// Step 14 (straight.05): a selected straight joint's Properties offers Join walls, the same as Delete; where the join
// would be refused, the action is disabled with the reason under it; a corner offers none.

/** A 6 × 4 room whose bottom wall is two pieces, B1 (0..3) and B2 (3..6), meeting at the straight joint S (3, 0). */
function split(thickness2 = 0.2): Document {
  const wall = (opId: string, from: [number, number], to: [number, number], thickness: number): Command =>
    ({ type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } }, thickness });
  return [wall("b1", [0, 0], [3, 0], 0.2), wall("b2", [3, 0], [6, 0], thickness2), wall("r", [6, 0], [6, 4], 0.2), wall("t", [6, 4], [0, 4], 0.2), wall("l", [0, 4], [0, 0], 0.2)]
    .reduce((doc, cmd) => unwrap(execute(doc, cmd)).doc, emptyDocument());
}

const fields = (shell: FakeShell) => {
  const p = shell.view().properties;
  return p.kind === "joint" ? p.fields : [];
};

describe("Join walls", () => {
  it("a straight joint's Properties has Join walls; it leaves one wall, one undo step (AC-10)", () => {
    const shell = FakeShell.withDocument(split());
    shell.click({ x: 3, y: 0 });
    expect(shell.state.selection[0]?.table).toBe("joints");
    const join = fields(shell).find((f) => f.id === "join");
    expect(join).toMatchObject({ value: "Join walls", action: true, readOnly: false });
    shell.ui({ type: "setField", fieldId: "join", value: "" });
    expect(Object.keys(shell.doc().walls).sort()).toEqual(["b1/w0", "l/w0", "r/w0", "t/w0"]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("between walls of different thickness it is disabled, the reason under it", () => {
    const shell = FakeShell.withDocument(split(0.12));
    shell.click({ x: 3, y: 0 });
    const join = fields(shell).find((f) => f.id === "join");
    expect(join).toMatchObject({ readOnly: true });
    expect(fields(shell).find((f) => f.id === "join.reason")).toMatchObject({ hint: true, value: "The walls differ in thickness (0.20 and 0.12 m)" });
  });

  it("Delete on the keyboard does the same as the action", () => {
    const shell = FakeShell.withDocument(split());
    shell.click({ x: 3, y: 0 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
  });

  it("the kinked house's 0.35° joint offers it disabled, naming the angle (AC-11)", () => {
    const shell = FakeShell.withDocument(kinkedHouseDoc());
    shell.ui({ type: "selectEntity", ref: { table: "joints", id: "372a" } });
    expect(fields(shell).find((f) => f.id === "join.reason")?.value).toBe("These walls are 0.35° out of line: move one side to line them up");
  });

  it("a corner joint shows no Join walls", () => {
    const shell = FakeShell.withDocument(split());
    shell.click({ x: 6, y: 0 });
    expect(fields(shell).some((f) => f.id === "join")).toBe(false);
  });

  it("a click on a selected piece's end handle selects that joint, so Delete joins; a drag still moves it (straight.42)", () => {
    const shell = FakeShell.withDocument(split());
    shell.click({ x: 1, y: 0 }); // the left piece
    expect(shell.state.selection[0]?.table).toBe("walls");
    shell.click({ x: 3, y: 0 }); // its end handle, on the joint between the pieces
    expect(shell.state.selection).toEqual([{ table: "joints", id: shell.state.selection[0]?.id ?? "" }]);
    expect(shell.state.selection[0]?.table).toBe("joints");
    shell.key("Delete");
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
  });

  it("hovering a wall in pieces shows a tick at the joint between them", () => {
    const shell = FakeShell.withDocument(split());
    shell.moveTo({ x: 1, y: 0 });
    const overlays = shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    expect(overlays.some((p) => p.kind === "disc" && p.center.x === 3 && p.center.y === 0)).toBe(true);
    shell.moveTo({ x: 6, y: 2 }); // the right wall: no straight joint in its run
    const after = shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    expect(after.some((p) => p.kind === "disc" && p.center.x === 3 && p.center.y === 0)).toBe(false);
  });
});
