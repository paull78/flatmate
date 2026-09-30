import { describe, expect, it } from "vitest";
import { emptyDocument } from "@fm/domain";
import { jointAt, pointOf, roomDoc, wallBetween, wallDoc } from "./builders";
import { FakeShell } from "./fake-shell";

function corner(shell: FakeShell): string {
  return jointAt(shell.doc(), { x: 6, y: 4 });
}

describe("undo and redo (spec §7.5; a local document runs the plain stack)", () => {
  it("undoes a drag as one step", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const id = corner(shell);
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(pointOf(shell.doc(), id)).toEqual({ x: 6, y: 4 });
  });

  it("restores each intermediate state across two moves, two undos and two redos", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const id = corner(shell);
    const at = () => pointOf(shell.doc(), id);
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5.2 });
    expect(at()).toEqual({ x: 6, y: 5.2 });
    shell.key("z", { meta: true });
    expect(at()).toEqual({ x: 6, y: 4.6 });
    shell.key("z", { meta: true });
    expect(at()).toEqual({ x: 6, y: 4 });
    shell.key("z", { meta: true, shift: true });
    expect(at()).toEqual({ x: 6, y: 4.6 });
    shell.key("Z", { meta: true, shift: true });
    expect(at()).toEqual({ x: 6, y: 5.2 });
  });

  it("drives the toolbar buttons through canUndo and canRedo", () => {
    const shell = FakeShell.withDocument(roomDoc());
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([false, false]);
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([true, false]);
    shell.ui({ type: "undo" });
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([false, true]);
    shell.ui({ type: "redo" });
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([true, false]);
  });

  it("clears redo on a new edit", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    shell.key("z", { meta: true });
    shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    expect(shell.state.undo.future).toEqual([]);
    expect(shell.view().canRedo).toBe(false);
  });

  it("restores a deleted wall exactly", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 2 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().walls)).toHaveLength(3);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(roomDoc());
  });

  // Added in Task 3.13: whole-changeset undo of a delete that also removes joints, and of wall placements.
  it("restores a deleted free-standing wall with its joints and IDs, and redo deletes all three again", () => {
    const original = wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 });
    const shell = FakeShell.withDocument(original);
    shell.click({ x: 2, y: 0 });
    shell.key("Delete");
    expect(shell.doc()).toEqual(emptyDocument());
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(original);
    shell.key("z", { meta: true, shift: true });
    expect(shell.doc()).toEqual(emptyDocument());
  });

  it("undoes wall placements one at a time and drops an undone wall from the selection", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.click({ x: 0, y: 0 });
    shell.click({ x: 2, y: 0 });
    const first = shell.doc();
    shell.click({ x: 2, y: 2 });
    const second = wallBetween(shell.doc(), { x: 2, y: 0 }, { x: 2, y: 2 });
    shell.key("Escape");
    shell.key("Escape");
    shell.click({ x: 2, y: 1 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: second }]);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(first);
    expect(shell.state.selection).toEqual([]);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(emptyDocument());
  });
});
