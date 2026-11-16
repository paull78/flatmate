import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { FakeShell } from "./fake-shell";
import { LOFT_ROOM_LOFT, loftRoomDoc, wallBetween, withCommands } from "./builders";

// Picking openings at a level (sills step 08, AC-11; sills.12): an opening is selectable at every level that draws it,
// crossed by the cut or dashed above it; the shell's walls and joints stay unselectable from a loft. loftRoomDoc: the
// 6 × 4 shell (north wall at y 4, faces 3.9 and 4.1) under 3.05; the loft at 2.15 (cut 2.60) over x 1.3–3.7, y 1.4–3.8.
// On the north wall, a window 2.40–2.90 at x 2.0–3.0 (the loft's cut crosses it) and one 0.90–2.10 at x 4.5–5.5.

const north = (doc: Document): string => wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });
function room(): Document {
  const doc = loftRoomDoc();
  const wall = north(doc);
  const a = doc.joints[doc.walls[wall]?.a ?? ""];
  const offset = (x0: number, x1: number): number => (a?.x === 0 ? x0 : (a?.x ?? 0) - x1);
  const high: Command = { type: "addOpening", opId: "hi", wall, kind: "window", offset: offset(2, 3), sill: 2.4, head: 2.9 };
  const low: Command = { type: "addOpening", opId: "lo", wall, kind: "window", offset: offset(4.5, 5.5) };
  return withCommands(doc, high, low);
}
const selected = (shell: FakeShell) => shell.state.selection.map((r) => `${r.table}:${r.id}`);
const atLoft = (): FakeShell => {
  const shell = FakeShell.withDocument(room());
  shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
  return shell;
};

describe("picking openings at a level (sills step 08)", () => {
  it("at the loft, the window its cut crosses is picked, shown in Properties and deleted", () => {
    const shell = atLoft();
    shell.click({ x: 2.5, y: 4 });
    expect(selected(shell)).toEqual(["openings:hi/d0"]);
    expect(shell.view().properties).not.toBeNull();
    shell.key("Backspace");
    expect(shell.doc().openings["hi/d0"]).toBeUndefined();
  });

  it("at the loft, the window under its cut isn't picked, nor the shell's wall", () => {
    const shell = atLoft();
    shell.click({ x: 5, y: 4 });
    expect(selected(shell)).toEqual([]);
    shell.click({ x: 1, y: 4 });
    expect(selected(shell)).toEqual([]);
  });

  // A door 0–2.10 and a window 2.40–2.90 over it at x 4.5–5.3 on the north wall; the door's ID sorts first.
  function stack(): Document {
    const doc = loftRoomDoc();
    const wall = north(doc);
    const a = doc.joints[doc.walls[wall]?.a ?? ""];
    const offset = a?.x === 0 ? 4.5 : (a?.x ?? 0) - 5.3;
    return withCommands(doc,
      { type: "addOpening", opId: "a", wall, kind: "swing", offset, width: 0.8 },
      { type: "addOpening", opId: "b", wall, kind: "window", offset, width: 0.8, sill: 2.4, head: 2.9 });
  }

  it("at the loft, a window stacked over a door under its cut is picked, whichever sorts first (sills.26)", () => {
    const shell = FakeShell.withDocument(stack());
    shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    shell.click({ x: 4.9, y: 4 });
    expect(selected(shell)).toEqual(["openings:b/d0"]);
  });

  it("at the floor, clicks on a stack cycle from the lowest: the door, the window above, the door again (sills.26)", () => {
    const shell = FakeShell.withDocument(stack());
    shell.click({ x: 4.9, y: 4 });
    expect(selected(shell)).toEqual(["openings:a/d0"]);
    shell.click({ x: 4.9, y: 4 });
    expect(selected(shell)).toEqual(["openings:b/d0"]);
    shell.click({ x: 4.9, y: 4 });
    expect(selected(shell)).toEqual(["openings:a/d0"]);
  });

  // A wall on the loft along y 2.6 over x 1.6–3.4, under a 4.20 ceiling, with a door at x 2.1–2.9; a floor partition on
  // the same line, stopping under the loft, with its own door at x 2.1–2.9: the two share a spot on the plan (the
  // walkthrough's case, sills.28).
  function loftDoorOverFloorDoor(): Document {
    return withCommands(loftRoomDoc(), { type: "setCeiling", height: 4.2 },
      { type: "addWall", opId: "k", from: { at: { x: 1.6, y: 2.6 } }, to: { at: { x: 3.4, y: 2.6 } }, base: LOFT_ROOM_LOFT },
      { type: "addOpening", opId: "up", wall: "k/w0", kind: "swing", offset: 0.5 },
      { type: "addWall", opId: "p", from: { at: { x: 1.3, y: 2.6 } }, to: { at: { x: 3.7, y: 2.6 } }, top: 2.03 }, // stops under the loft, as the studio's partition does
      { type: "addOpening", opId: "down", wall: "p/w0", kind: "swing", offset: 0.8 });
  }

  it("a door on a loft's wall belongs to the loft: the floor neither draws nor picks it; the loft does (sills.28)", () => {
    const doc = loftDoorOverFloorDoor();
    const floor = FakeShell.withDocument(doc);
    floor.click({ x: 2.5, y: 2.6 });
    expect(selected(floor)).toEqual(["openings:down/d0"]);
    floor.click({ x: 2.5, y: 2.6 });
    expect(selected(floor)).toEqual(["openings:down/d0"]); // the floor's door alone: no cycle up to the loft's
    const loft = FakeShell.withDocument(doc);
    loft.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    loft.click({ x: 2.5, y: 2.6 });
    expect(selected(loft)).toEqual(["openings:up/d0"]);
  });

  it("at the floor, the dashed window above the cut is picked, and so is the window the cut crosses", () => {
    const shell = FakeShell.withDocument(room());
    shell.click({ x: 2.5, y: 4 });
    expect(selected(shell)).toEqual(["openings:hi/d0"]);
    shell.click({ x: 5, y: 4 });
    expect(selected(shell)).toEqual(["openings:lo/d0"]);
  });
});
