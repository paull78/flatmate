import { describe, expect, it } from "vitest";
import type { EntityRef } from "@fm/domain";
import { dividedRoomDoc, labelledDoc, wallBetween, withOrphan } from "./builders";
import { FakeShell } from "./fake-shell";

const zone = (id: string): EntityRef => ({ table: "zoneLabels", id });

describe("zone selection in the Select tool (spec §3.6, §5.6)", () => {
  it("selects a labelled room by clicking its floor", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    expect(shell.state.selection).toEqual([zone("L1")]);
    expect(shell.view().properties.kind).toBe("zone");
  });

  it("selects an orphan label through its tag", () => {
    const shell = FakeShell.withDocument(withOrphan(labelledDoc()));
    shell.click({ x: 8.5, y: 6.1 });
    expect(shell.state.selection).toEqual([zone("L9")]);
    shell.click({ x: 8.5, y: 7 }); // above the tag: empty space
    expect(shell.state.selection).toEqual([]);
  });

  it("prefers walls to tags and floors", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const divider = wallBetween(shell.doc(), { x: 3, y: 0 }, { x: 3, y: 4 });
    shell.click({ x: 3, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: divider }]);
  });

  it("clears the selection on an unlabelled floor", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.click({ x: 6, y: 1 });
    expect(shell.state.selection).toHaveLength(1);
    shell.click({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([]);
  });

  it("never drags a zone", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.drag({ x: 1, y: 3 }, { x: 2, y: 3.5 });
    expect(shell.doc()).toEqual(labelledDoc());
    expect(shell.state.selection).toEqual([zone("L1")]);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("Delete removes the selected zone's label and leaves the walls", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const walls = shell.doc().walls;
    shell.click({ x: 1, y: 3 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().zoneLabels)).toEqual(["L2"]);
    expect(shell.doc().walls).toEqual(walls);
    expect(shell.state.selection).toEqual([]);
    expect(shell.state.undo.past).toHaveLength(1);
  });
});
