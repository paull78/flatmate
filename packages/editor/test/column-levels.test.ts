import { describe, expect, it } from "vitest";
import { wallBodies, wallRange } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { viewedLevel } from "../src/state";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { LOFT_ROOM_LOFT, loftRoomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The Column tool sets base and top from where it is placed (spec "Vertical range", "The Column tool", pillars.23;
// AC-13 loft cases): at the floor under a level deck, the deck as its top; at a deck's level, on that deck up to the
// ceiling; elsewhere floor to ceiling. loftRoomDoc: ceiling 3.05, the Loft at 2.15 (underside 2.03) over x 1.3–3.7,
// y 1.4–3.8. A full-height column through the loft is refused, so a ghost that fits proves the tool chose the top.

type Polygon = Extract<Primitive, { kind: "polygon" }>;
const ghosts = (shell: FakeShell): Polygon[] =>
  (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "polygon" ? [p] : []));
const ROW = "id1/w0";

function columnTool(atLoft: boolean): FakeShell {
  const shell = FakeShell.withDocument(loftRoomDoc());
  shell.ui({ type: "setSnapStep", step: 0.01 });
  if (atLoft) shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
  shell.key("c");
  shell.ui({ type: "setColumnSize", width: "0.20", depth: "0.20" });
  return shell;
}

/** Moves to `at`, keeps the ghost, clicks; the ghost must fit and equal the committed body. */
function placeAt(shell: FakeShell, at: Point): void {
  shell.moveTo(at);
  const [ghost, ...more] = ghosts(shell);
  expect(more).toEqual([]);
  expect(ghost?.color).toBe(COLORS.preview);
  shell.click(at);
  expect(ghost?.points).toEqual(wallBodies(shell.doc()).get(ROW));
}

describe("the Column tool's base and top", () => {
  it("a click at the floor under the loft places a free post topped by the loft: 0.00–2.03", () => {
    const shell = columnTool(false);
    placeAt(shell, { x: 2.4, y: 1.6 });
    expect(shell.doc().walls[ROW]).toEqual(expect.objectContaining({ base: "floor", top: LOFT_ROOM_LOFT, column: true }));
    expect(wallRange(shell.doc(), ROW)).toEqual({ bottom: 0, top: expect.closeTo(2.03, 9) });
  });

  it("at the loft's level a click on the loft places a post on it up to the ceiling: 2.15–3.05, selected there", () => {
    const shell = columnTool(true);
    expect(shell.view().activeTool).toBe("column");
    expect(viewedLevel(shell.state)?.height).toBe(2.15);
    placeAt(shell, { x: 3.5, y: 3 });
    expect(shell.doc().walls[ROW]).toEqual(expect.objectContaining({ base: LOFT_ROOM_LOFT, top: "ceiling", column: true }));
    expect(wallRange(shell.doc(), ROW)).toEqual({ bottom: 2.15, top: 3.05 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: ROW }]);
    expect(viewedLevel(shell.state)?.height).toBe(2.15);
  });

  it("a click in open floor away from the loft places a column from the floor to the ceiling", () => {
    const shell = columnTool(false);
    placeAt(shell, { x: 5, y: 1 });
    expect(shell.doc().walls[ROW]).toEqual(expect.objectContaining({ base: "floor", top: "ceiling" }));
    expect(wallRange(shell.doc(), ROW)).toEqual({ bottom: 0, top: 3.05 });
  });

  it("at the loft's level, a click beside the loft is red and places nothing", () => {
    const shell = columnTool(true);
    shell.moveTo({ x: 5, y: 1 });
    expect(ghosts(shell)[0]?.color).toBe(COLORS.invalidFill);
    shell.click({ x: 5, y: 1 });
    expect(shell.doc().walls[ROW]).toBeUndefined();
    expect(shell.view().toast).not.toMatch(/loft\/k0|w0/);
  });

  it("the tool stays at the loft's level when picked there; Zone, Dimension and Deck still view the floor", () => {
    const shell = FakeShell.withDocument(loftRoomDoc());
    shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    shell.ui({ type: "pickTool", tool: "column" });
    expect(shell.view().activeTool).toBe("column");
    expect(viewedLevel(shell.state)?.height).toBe(2.15);
    for (const key of ["z", "m", "k"]) {
      shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
      shell.key(key);
      expect(viewedLevel(shell.state)?.height).toBe(0);
    }
  });

  it("the Column tool active at the floor stays active when the view moves up to the loft", () => {
    const shell = columnTool(false);
    shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    expect(shell.view().activeTool).toBe("column");
  });
});
