import { describe, expect, it } from "vitest";
import { deckView, deckViews } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { cabinDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The Hole tool (stairwell.08; AC-09): Platform | Loft | Hole in the Deck tool. A drag inside a deck draws a hole along
// its axes, corners snapping to the deck's sides and to wall faces; a click cuts 1.00 × 1.00; nothing in no deck. The
// cabin: wall faces x 0.1–3.9, y 0.1–2.9; the Loft x 0.1–2.1 over the whole depth.

const LOFT = "loft/k0";
const holes = (shell: FakeShell) => deckView(shell.doc(), LOFT)?.holes.map((h) => ({ at: h.at, w: h.w, d: h.d })) ?? [];
function holeShell(): FakeShell {
  const shell = FakeShell.withDocument(cabinDoc());
  shell.ui({ type: "pickTool", tool: "hole" });
  return shell;
}
function drag(shell: FakeShell, from: Point, to: Point): void {
  shell.moveTo(from);
  shell.down(from);
  for (let i = 1; i <= 6; i++) shell.moveTo({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
  shell.up(to);
}

describe("the Hole tool (AC-09)", () => {
  it("is its own tool, with its prompt", () => {
    const shell = holeShell();
    expect(shell.view().activeTool).toBe("hole");
    expect(shell.view().commandBar.prompt).toBe("Drag a hole in a deck · click for 1.00 × 1.00");
  });

  it("one drag cuts the notch: the far corner snaps to the north wall face and the loft's east side", () => {
    const shell = holeShell();
    drag(shell, { x: 1.4, y: 2.25 }, { x: 2.094, y: 2.893 }); // 6 mm and 7 mm short of the side and the face
    expect(holes(shell)).toEqual([{ at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 }]);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection.map((r) => r.table)).toEqual(["deckHoles"]); // the new hole is selected, as a new deck is
  });

  it("a click cuts 1.00 × 1.00 centred on it", () => {
    const shell = holeShell();
    shell.click({ x: 1.0, y: 1.5 });
    expect(holes(shell)).toEqual([{ at: { x: 1, y: 1.5 }, w: 1, d: 1 }]);
  });

  it("a drag or click in no deck previews red and is refused with the domain's text", () => {
    const shell = holeShell();
    shell.moveTo({ x: 2.8, y: 1.0 });
    shell.down({ x: 2.8, y: 1.0 });
    shell.moveTo({ x: 3.0, y: 1.2 });
    shell.moveTo({ x: 3.3, y: 1.5 });
    const tool = shell.state.tool;
    expect(tool.name === "hole" && tool.state.kind).toBe("pressing");
    expect(tool.name === "hole" && tool.state.kind === "pressing" && tool.state.ok).toBe(false);
    shell.up({ x: 3.3, y: 1.5 });
    expect(shell.view().toast).toBe("A hole is cut in a deck");
    shell.click({ x: 3.0, y: 1.0 });
    expect(shell.view().toast).toBe("A hole is cut in a deck");
    expect(deckViews(shell.doc()).flatMap((d) => d.holes)).toEqual([]);
  });

  it("a hole past the deck's side previews red and toasts the domain's reason", () => {
    const shell = holeShell();
    shell.click({ x: 1.8, y: 1.5 }); // 1.00 wide about x 1.8 passes the side at 2.10
    expect(shell.view().toast).toBe("A hole in Loft lies inside it");
  });

  it("picking Hole at the loft's level keeps the view there (smalls.12)", () => {
    const shell = FakeShell.withDocument(cabinDoc());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.ui({ type: "pickTool", tool: "hole" });
    expect(shell.state.viewedDeck).toBe(LOFT);
  });

  it("the tool stays after a cut", () => {
    const shell = holeShell();
    shell.click({ x: 1.0, y: 1.0 });
    expect(shell.view().activeTool).toBe("hole");
  });
});
