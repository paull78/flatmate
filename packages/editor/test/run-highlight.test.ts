import { describe, expect, it } from "vitest";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { dividedRoomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

// Step 06 (straight.16): the run a drag will move shows before the drag, in the hover colour; the selection stays the
// one wall, drawn blue. The divided room's bottom side is two walls in line, split by the divider's T at x 3.

const fills = (shell: FakeShell, color: string): number =>
  (shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? []).filter((p: Primitive) => p.kind === "polygon" && p.color === color).length;

describe("the run highlight", () => {
  it("hovering one piece of a split side lights the whole side", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.moveTo({ x: 1, y: 0 });
    expect(fills(shell, COLORS.wallHover)).toBe(2);
  });

  it("a selected wall stays the selection, its run lit around it", () => {
    const doc = dividedRoomDoc();
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 1, y: 0 });
    shell.moveTo({ x: 3, y: 9 }); // off every wall
    expect(shell.state.selection).toEqual([{ table: "walls", id: wallBetween(doc, { x: 0, y: 0 }, { x: 3, y: 0 }) }]);
    expect(fills(shell, COLORS.wallSelected)).toBe(1);
    expect(fills(shell, COLORS.wallHover)).toBe(1);
  });

  it("while the run moves, its walls stay lit", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.moveTo({ x: 1, y: 0 });
    shell.down({ x: 1, y: 0 });
    shell.moveTo({ x: 1, y: 0.4 });
    expect(shell.state.tool.name === "select" && shell.state.tool.state.kind).toBe("moving");
    expect(fills(shell, COLORS.wallSelected) + fills(shell, COLORS.wallHover)).toBe(2);
  });

  it("a corner wall lights alone", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.moveTo({ x: 0, y: 2 });
    expect(fills(shell, COLORS.wallHover)).toBe(1);
  });
});
