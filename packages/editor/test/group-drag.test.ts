import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// 0.6 × 0.6 m blocks in Layout (s0), front facing −y: anchored at (2, 2) a/p0 spans x 1.7–2.3, y 1.4–2.0, centre
// (2, 1.7); b/p0 at (3, 2) spans x 2.7–3.3; c/p0 at (4.5, 2) spans x 4.2–4.8. The room's inner faces are at x 0.1
// and 5.9, y 0.1 and 3.9; the grid step at the default zoom is 0.2 m.
const block = (opId: string, x: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind: "block" }, at: { x, y: 2 }, rotation: 0 });
const A = { x: 2, y: 1.7 };
const B = { x: 3, y: 1.7 };
const C = { x: 4.5, y: 1.7 };
const piece = (id: string) => ({ table: "placements", id });

/** a and b (and c), with a and b selected by a click and a Shift-click. */
function group(withC = false): FakeShell {
  const shell = FakeShell.withDocument(withCommands(roomDoc(), block("a", 2), block("b", 3), ...(withC ? [block("c", 4.5)] : [])));
  shell.click(A);
  shell.click(B, { shift: true });
  return shell;
}

function attempt(shell: FakeShell) {
  const t = shell.state.tool;
  return t.name === "select" && t.state.kind === "moving" ? t.state.attempt : null;
}

function redPieces(shell: FakeShell): number {
  const overlays = shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
  return overlays.filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill).length;
}

describe("group drag (spec: tools, AC-08)", () => {
  it("dragging one piece of a selected group moves every piece by the same offset, one undo step (AC-08)", () => {
    const shell = group();
    shell.drag(A, { x: 3, y: 1.7 });
    expect(shell.doc().placements["a/p0"]).toMatchObject({ at: { x: 3, y: 2 }, rotation: 0 });
    expect(shell.doc().placements["b/p0"]).toMatchObject({ at: { x: 4, y: 2 }, rotation: 0 });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(shell.doc().placements["a/p0"]?.at).toEqual({ x: 2, y: 2 });
    expect(shell.doc().placements["b/p0"]?.at).toEqual({ x: 3, y: 2 });
  });

  it("Ctrl+drag moves the group off the grid, each anchor kept to the millimetre", () => {
    const shell = group();
    shell.drag(A, { x: 2.12345, y: 1.7 }, { ctrl: true });
    expect(shell.doc().placements["a/p0"]).toMatchObject({ at: { x: 2.123, y: 2 }, rotation: 0 });
    expect(shell.doc().placements["b/p0"]).toMatchObject({ at: { x: 3.123, y: 2 }, rotation: 0 });
  });

  it("a group move that puts one piece in a wall draws every piece red and commits nothing (AC-08)", () => {
    const shell = group();
    const before = shell.doc();
    shell.moveTo(A);
    shell.down(A);
    shell.moveTo({ x: 5, y: 1.7 }); // b would span x 5.7–6.3, across the 5.9 face
    expect(attempt(shell)?.ok).toBe(false);
    expect(redPieces(shell)).toBe(2); // a and b once each, not b again as a blocked piece
    shell.up({ x: 5, y: 1.7 });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("Custom box (0.00–1.00) overlaps a wall in Layout");
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("a group pushed onto an unselected piece draws the group and that piece red, not its own pieces twice", () => {
    const shell = group(true);
    shell.moveTo(A, { ctrl: true });
    shell.down(A, { ctrl: true });
    // b would span x 3.7–4.3, over c at 4.2–4.8; Ctrl, or b's right edge would snap flush to c's left edge (AC-13)
    shell.moveTo({ x: 3, y: 1.7 }, { ctrl: true });
    expect(attempt(shell)?.blocked).toEqual(["c/p0"]);
    expect(redPieces(shell)).toBe(3);
  });

  it("a group does not turn to a wall; a single piece still does", () => {
    const shell = group();
    shell.drag(A, { x: 2, y: 0.5 }); // a's front edge ends 0.1 m from the bottom face, inside the 10 px tolerance (0.125 m at zoom 80)
    expect(shell.doc().placements["a/p0"]).toMatchObject({ at: { x: 2, y: 0.8 }, rotation: 0 });
    expect(shell.doc().placements["b/p0"]).toMatchObject({ at: { x: 3, y: 0.8 }, rotation: 0 });

    const single = FakeShell.withDocument(withCommands(roomDoc(), block("a", 2), block("b", 3)));
    single.click(A);
    single.drag(A, { x: 2, y: 0.5 });
    expect(single.doc().placements["a/p0"]).toMatchObject({ at: { x: 2, y: 0.1 }, rotation: 180 }); // turned and flush
  });

  it("Shift+drag on a selected piece keeps the axis lock and moves the group, without toggling (direct.19)", () => {
    const shell = group();
    shell.drag(A, { x: 2.95, y: 1.9 }, { shift: true }); // (0.95, 0.2) locks to x and rounds to 1.0
    expect(shell.doc().placements["a/p0"]?.at).toEqual({ x: 3, y: 2 });
    expect(shell.doc().placements["b/p0"]?.at).toEqual({ x: 4, y: 2 });
    expect(shell.state.selection).toEqual([piece("a/p0"), piece("b/p0")]);
  });

  it("Shift+drag on an unselected piece adds it to the group it drags", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), block("a", 2), block("b", 3)));
    shell.click(A);
    shell.drag(B, { x: 3, y: 2.5 }, { shift: true });
    expect(shell.doc().placements["a/p0"]?.at).toEqual({ x: 2, y: 2.8 });
    expect(shell.doc().placements["b/p0"]?.at).toEqual({ x: 3, y: 2.8 });
    expect(shell.state.selection).toEqual([piece("a/p0"), piece("b/p0")]);
  });

  it("dragging an unselected piece without Shift moves it alone", () => {
    const shell = group(true);
    shell.drag(C, { x: 4.5, y: 2.5 });
    expect(shell.doc().placements["c/p0"]?.at).toEqual({ x: 4.5, y: 2.8 });
    expect(shell.doc().placements["a/p0"]?.at).toEqual({ x: 2, y: 2 });
    expect(shell.doc().placements["b/p0"]?.at).toEqual({ x: 3, y: 2 });
    expect(shell.state.selection).toEqual([piece("c/p0")]);
  });
});

describe("group R (spec: layouts, direct.08, AC-09)", () => {
  it("R turns the group 90° about its bounding box centre; the east piece ends north (AC-09)", () => {
    const shell = group(); // the box is x 1.7–3.3, y 1.4–2.0: centre (2.5, 1.7)
    shell.key("r");
    expect(shell.doc().placements["a/p0"]).toMatchObject({ at: { x: 2.2, y: 1.2 }, rotation: 90 }); // centre (2.5, 1.2)
    expect(shell.doc().placements["b/p0"]).toMatchObject({ at: { x: 2.2, y: 2.2 }, rotation: 90 }); // centre (2.5, 2.2)
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(shell.doc().placements["a/p0"]).toMatchObject({ at: { x: 2, y: 2 }, rotation: 0 });
    expect(shell.doc().placements["b/p0"]).toMatchObject({ at: { x: 3, y: 2 }, rotation: 0 });
  });

  it("R on a group that would not fit commits nothing", () => {
    // The box is x 0.2–4.8, centre (2.5, 1.7): turned, the pieces would be centred on (2.5, −0.3) and (2.5, 3.7).
    const shell = FakeShell.withDocument(withCommands(roomDoc(), block("a", 0.5), block("b", 4.5)));
    shell.click({ x: 0.5, y: 1.7 });
    shell.click(C, { shift: true });
    const before = shell.doc();
    shell.key("r");
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toMatch(/^Custom box (\(0\.00–1\.00\) overlaps a wall in Layout|in Layout is not inside a room)$/);
    expect(shell.state.undo.past).toHaveLength(0);
  });
});
