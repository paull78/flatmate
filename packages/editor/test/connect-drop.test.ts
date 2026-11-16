import { describe, expect, it } from "vitest";
import { emptyDocument, execute, incidentWalls, unwrap, type Command, type Document } from "@fm/domain";
import { FakeShell } from "./fake-shell";
import { jointAt, roomDoc, wallBetween } from "./builders";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// Step 16 (straight.06, .18): a joint drag previews and commits connectJoint, so an end dropped on a corner or a wall's
// body connects; the preview equals the commit; a refused drop stays red with its reason; the committed fragment gets
// a fresh id, never the preview's.

const selectState = (shell: FakeShell) => (shell.state.tool.name === "select" ? shell.state.tool.state : null);

/** The 6 × 4 room with a free wall inside it, (1, 1) → (3, 1), its end F loose. */
function withFree(): Document {
  const doc = roomDoc();
  doc.joints.E = { id: "E", x: 1, y: 1 };
  doc.joints.F = { id: "F", x: 3, y: 1 };
  doc.walls.FW = { id: "FW", a: "E", b: "F", thickness: 0.2, top: "ceiling", base: "floor", column: false };
  return doc;
}

describe("a joint dropped on a joint or a wall connects", () => {
  it("drags the kinked house's loose wall end onto the corner: the preview is valid and the release connects (AC-13)", () => {
    const shell = FakeShell.withDocument(kinkedHouseDoc());
    shell.ui({ type: "setSnapStep", step: 0.01 });
    shell.moveTo({ x: 10.2, y: -1.5 });
    shell.down({ x: 10.2, y: -1.5 });
    shell.moveTo({ x: 10.29, y: -1.5 }); // within 10 px of the corner at 10.298: the endpoint snap takes it
    const t = selectState(shell);
    expect(t?.kind === "moving" && t.attempt.ok).toBe(true);
    expect(t?.kind === "moving" && t.attempt.tried.kind).toBe("moves");
    expect(t?.kind === "moving" && t.attempt.doc.joints.bde4).toBeUndefined(); // the preview shows the merge
    shell.up({ x: 10.29, y: -1.5 });
    expect(shell.doc().joints.bde4).toBeUndefined();
    expect(incidentWalls(shell.doc(), "d03f").sort()).toEqual(["wbde4", "wd03fa", "wd03fb"]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("drops a free end on a wall's body: a T, the fragment with a fresh id, not the preview's", () => {
    const shell = FakeShell.withDocument(withFree());
    shell.drag({ x: 3, y: 1 }, { x: 3, y: 0.03 }); // the on-wall snap lands it on W1
    const doc = shell.doc();
    expect(incidentWalls(doc, "F")).toHaveLength(3);
    expect(Object.keys(doc.walls).some((id) => id.startsWith("preview/"))).toBe(false);
    expect(Object.keys(doc.walls)).toHaveLength(6);
  });

  it("dropping a joint on the far end of its own wall stays red with 'Wall too short' and commits nothing", () => {
    const shell = FakeShell.withDocument(withFree());
    shell.moveTo({ x: 3, y: 1 });
    shell.down({ x: 3, y: 1 });
    shell.moveTo({ x: 1.02, y: 1 });
    const t = selectState(shell);
    expect(t?.kind === "moving" && t.attempt.ok).toBe(false);
    shell.up({ x: 1.02, y: 1 });
    expect(shell.view().toast).toBe("Wall too short");
    expect(shell.doc()).toEqual(withFree());
  });

  it("a straight joint slid onto the next joint along its line is refused: the wall between would collapse", () => {
    const wall = (opId: string, from: [number, number], to: [number, number]): Command => ({ type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } } });
    const doc = [wall("w1", [0, 0], [3, 0]), wall("w2", [3, 0], [6, 0]), wall("w3", [4, 0], [4, 2])].reduce((d, cmd) => unwrap(execute(d, cmd)).doc, emptyDocument());
    // w3 T's into w2 at (4, 0): sliding the straight joint at (3, 0) onto that T lands on its own wall's far end.
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 3, y: 0 }, { x: 3.98, y: 0 });
    expect(shell.view().toast).toBe("Wall too short");
    expect(shell.doc()).toEqual(doc);
  });

  it("a plain joint drag is unchanged: the corner moves, nothing connects", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(roomDoc(), { x: 6, y: 4 });
    shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4.4 });
    expect(shell.doc().joints[corner]).toMatchObject({ x: 6.4, y: 4.4 });
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
    expect(wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6.4, y: 4.4 })).toBeDefined();
  });
});
