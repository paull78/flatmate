import { describe, expect, it } from "vitest";
import type { Document, Opening } from "@fm/domain";
import { openingReason } from "../src/tools/opening-tool";
import { FakeShell } from "./fake-shell";
import { LOFT_ROOM_LOFT, loftRoomDoc, withCommands } from "./builders";

// The Opening tool at every level (sills step 09, AC-07; sills.06): it works on the walls the viewed level draws, and a
// new opening's heights start from that level. loftRoomDoc: the 6 × 4 shell (north wall at y 4) under 3.05; the loft
// at 2.15 over x 1.3–3.7, y 1.4–3.8; a knee wall on the loft along y 2.6 from x 1.6 to 3.4 (0.90 tall under 3.05).

const knee = (doc: Document): Document =>
  withCommands(doc, { type: "addWall", opId: "k", from: { at: { x: 1.6, y: 2.6 } }, to: { at: { x: 3.4, y: 2.6 } }, base: LOFT_ROOM_LOFT });
function tool(doc: Document, kind: Opening["kind"], atLoft: boolean): FakeShell {
  const shell = FakeShell.withDocument(doc);
  if (atLoft) shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
  shell.key("d");
  shell.ui({ type: "pickOpeningKind", kind });
  return shell;
}
const heights = (shell: FakeShell) => Object.values(shell.doc().openings).map((o) => [o.wall, o.sill, o.head]);
const preview = (shell: FakeShell) => (shell.state.tool.name === "opening" ? shell.state.tool.state.preview : null);
const reasonAt = (shell: FakeShell, p: { x: number; y: number }): string | null => {
  shell.moveTo(p);
  const pr = preview(shell);
  return pr && !pr.ok ? openingReason(shell.state, pr) : null;
};

describe("the Opening tool at a loft's level (sills step 09, AC-07)", () => {
  it("stays at the loft when picked there", () => {
    const shell = tool(knee(loftRoomDoc()), "window", true);
    expect(shell.view().activeTool).toBe("opening");
    expect(shell.state.viewedDeck).toBe(LOFT_ROOM_LOFT);
  });

  it("a window on the shell runs from 0.30 above the loft's top to 0.10 under the wall's top: 2.45 to 2.95", () => {
    const shell = tool(knee(loftRoomDoc()), "window", true);
    shell.click({ x: 2.5, y: 4 });
    expect(heights(shell)).toEqual([[expect.any(String), 2.45, 2.95]]);
  });

  it("a window on the loft's 0.90 m knee wall is refused, its reason in the red preview", () => {
    const shell = tool(knee(loftRoomDoc()), "window", true);
    expect(reasonAt(shell, { x: 2.5, y: 2.6 })).toBe("An opening must be at least 0.30 m tall");
    shell.click({ x: 2.5, y: 2.6 });
    expect(heights(shell)).toEqual([]);
  });

  it("a door on the shell is refused: its sill would be the floor", () => {
    const shell = tool(knee(loftRoomDoc()), "swing", true);
    expect(reasonAt(shell, { x: 2.5, y: 4 })).toBe("A door on this wall starts at the floor: place it from the floor's level");
    shell.click({ x: 2.5, y: 4 });
    expect(heights(shell)).toEqual([]);
    expect(shell.view().toast).toBe("A door on this wall starts at the floor: place it from the floor's level");
  });

  it("a door on a 1.80 m partition standing on the loft runs 0 to 1.70 above the loft's top", () => {
    const tall = withCommands(knee(withCommands(loftRoomDoc(), { type: "setCeiling", height: 4.2 })), { type: "setWallTop", wallId: "k/w0", top: 1.8 });
    const shell = tool(tall, "swing", true);
    shell.click({ x: 2.5, y: 2.6 });
    expect(heights(shell)).toEqual([["k/w0", 0, 1.7]]);
  });
});

describe("the Opening tool at the floor (sills step 09)", () => {
  it("a door on a 2.03 m partition runs 0 to 1.93, and the tool doesn't reach the loft's walls", () => {
    const doc = withCommands(knee(loftRoomDoc()), { type: "addWall", opId: "p", from: { at: { x: 5, y: 0 } }, to: { at: { x: 5, y: 4 } } }, { type: "setWallTop", wallId: "p/w0", top: 2.03 });
    const shell = tool(doc, "swing", false);
    shell.click({ x: 5, y: 1 });
    expect(heights(shell)).toEqual([["p/w0", 0, 1.93]]);
    shell.click({ x: 2.5, y: 2.6 }); // the loft's knee wall, not drawn at the floor
    expect(heights(shell)).toHaveLength(1);
  });

  it("a window placed without a level's height has the same range as Claude's add_window: one owner (defaultOpeningHeights)", () => {
    const shell = tool(loftRoomDoc(), "window", false);
    shell.click({ x: 5, y: 4 });
    expect(heights(shell).map(([, s, h]) => [s, h])).toEqual([[0.9, 2.1]]);
  });
});
