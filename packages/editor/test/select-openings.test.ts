import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A swing door d/d0 on the bottom wall (0, 0)–(6, 0): span x 2.6–3.4, opening into the room.
const doorDoc = (): Document => {
  const doc = roomDoc();
  return withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2.6, side: "left" });
};

describe("openings with the Select tool (spec: openings)", () => {
  it("a click on a door's span selects the door, not its wall", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.click({ x: 3, y: 0.05 });
    expect(shell.state.selection).toEqual([{ table: "openings", id: "d/d0" }]);
    shell.click({ x: 1, y: 0 });
    expect(shell.state.selection[0]?.table).toBe("walls");
  });

  it("dragging a door along its wall changes its offset; dragging past the wall's end draws red and reverts (AC-19)", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.drag({ x: 3, y: 0 }, { x: 4, y: 0.3 }); // only the part along the wall counts
    expect(shell.doc().openings["d/d0"]?.offset).toBe(3.6);
    expect(shell.state.undo.past).toHaveLength(1);
    const before = shell.doc();
    shell.moveTo({ x: 4, y: 0 });
    shell.down({ x: 4, y: 0 });
    shell.moveTo({ x: 6.5, y: 0 });
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind).toBe("moving");
    expect(t.name === "select" && t.state.kind === "moving" && t.state.attempt.ok).toBe(false);
    const red = (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).filter((p) => p.kind === "polygon");
    expect(red).toHaveLength(1);
    shell.up({ x: 6.5, y: 0 });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("This door doesn't fit on its wall");
  });

  it("dragging a door along its wall redraws its chain on each move (AC-04)", () => {
    const shell = FakeShell.withDocument(doorDoc());
    const texts = () =>
      (shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? []).flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p.text] : []));
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 3.4, y: 0 }); // 0.40 along the wall (0.20 m grid at 80 px/m): offset 3.00
    expect(texts()).toEqual(["2.90", "0.80", "2.10"]); // clear, from the faces 0.10 in from each joint; no total while positioning
    shell.moveTo({ x: 4, y: 0 });
    expect(texts()).toEqual(["3.50", "0.80", "1.50"]);
    shell.moveTo({ x: 6.6, y: 0 }); // past the wall's end: red, and the chain follows the refused place
    expect(texts()).toEqual(["6.10", "0.80"]);
    shell.up({ x: 6.6, y: 0 });
    expect(texts()).toEqual(["2.50", "0.80", "2.50", "5.80"]); // refused: the selected door's chain and its clear total again
  });

  it("Delete removes the opening", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.click({ x: 3, y: 0 });
    shell.key("Delete");
    expect(shell.doc().openings).toEqual({});
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
  });
});
