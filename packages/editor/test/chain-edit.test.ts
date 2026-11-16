import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { chainBoxes, helperLabelAt } from "../src/view/helper";
import { jointAt, pointOf, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// roomDoc's right wall runs from a = (6, 0) to b = (6, 4): 4.00 m.
const right = (doc: Document): string => wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
/** The right wall with a 0.80 door x/d0 at 1.10: clear chain 1.00, 0.80, 2.00 (the face runs 0.10 to 3.90). */
const doorDoc = (): Document => withCommands(roomDoc(), { type: "addOpening", opId: "x", wall: right(roomDoc()), kind: "swing", offset: 1.1 });
/** The right wall with a 0.80 door x/d0 at 0.60 and a 1.00 window y/d0 at 2.00: clear chain 0.50, 0.80, 0.60, 1.00, 0.90. */
const doorAndWindowDoc = (): Document =>
  withCommands(doorDoc(), { type: "moveOpening", openingId: "x/d0", offset: 0.6 }, { type: "addOpening", opId: "y", wall: right(roomDoc()), kind: "window", offset: 2 });

const chainTexts = (shell: FakeShell): string[] => chainBoxes(shell.state, shell.doc(), right(shell.doc())).map((b) => b.text);
const opening = (shell: FakeShell, id: string) => shell.doc().openings[id];

/** Selects the right wall, clicks chain piece `index` and types `value` then Enter. */
function typeInto(shell: FakeShell, index: number, value: string): void {
  shell.click({ x: 6, y: 0.3 });
  const box = chainBoxes(shell.state, shell.doc(), right(shell.doc()))[index];
  if (!box) throw new Error(`no chain piece ${index}`);
  shell.click(box.at);
  shell.type(value);
  shell.key("Enter");
}

describe("editing a chain piece (ux-polish item 4)", () => {
  it("a click on a piece starts editing it with the helper's field look; Esc cancels", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.click({ x: 6, y: 0.3 });
    const box = chainBoxes(shell.state, shell.doc(), right(shell.doc()))[1];
    if (!box) throw new Error("no width piece");
    shell.click(box.at);
    const t = shell.state.tool;
    expect(t.name === "select" ? t.state : null).toEqual({ kind: "editingHelper", wallId: right(shell.doc()), piece: 1, value: "" });
    expect(shell.view().commandBar).toEqual({ prompt: "Opening width", value: "", unit: "m", chips: [] });
    const outline = () =>
      (shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? []).filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected);
    expect(outline()).toHaveLength(4);
    shell.type("9");
    expect(chainTexts(shell)).toEqual(["1.00", "9", "2.00"]);
    shell.key("Escape");
    expect(outline()).toHaveLength(0);
    expect(shell.doc()).toEqual(doorDoc());
  });

  it("typing 1.50 into the first piece of a 4.00 m wall with a 0.80 door at 1.10 moves the door to 1.60 (clear 1.50 from the face); the chain reads 1.50, 0.80, 1.50 (AC-05, AC-19)", () => {
    const shell = FakeShell.withDocument(doorDoc());
    typeInto(shell, 0, "1.50");
    expect(opening(shell, "x/d0")).toMatchObject({ offset: 1.6, width: 0.8 });
    expect(chainTexts(shell)).toEqual(["1.50", "0.80", "1.50"]);
    expect(shell.state.selection).toEqual([{ table: "walls", id: right(shell.doc()) }]);
    shell.ui({ type: "undo" });
    expect(opening(shell, "x/d0")?.offset).toBe(1.1);
  });

  it("typing 0.90 into the width piece makes the door 0.90 wide at offset 1.10 (AC-05)", () => {
    const shell = FakeShell.withDocument(doorDoc());
    typeInto(shell, 1, "0.90");
    expect(opening(shell, "x/d0")).toMatchObject({ offset: 1.1, width: 0.9 });
    expect(chainTexts(shell)).toEqual(["1.00", "0.90", "1.90"]);
    shell.ui({ type: "undo" });
    expect(opening(shell, "x/d0")).toMatchObject({ offset: 1.1, width: 0.8 });
  });

  it("typing into the piece next to joint b moves the door so that piece becomes the value", () => {
    const shell = FakeShell.withDocument(doorDoc());
    typeInto(shell, 2, "1.70");
    expect(opening(shell, "x/d0")).toMatchObject({ offset: 1.4, width: 0.8 });
    expect(chainTexts(shell)).toEqual(["1.30", "0.80", "1.70"]);
  });

  it("with a door at 0.60 and a window at 2.00, typing 0.30 into the gap moves the window to 1.70 (AC-06)", () => {
    const shell = FakeShell.withDocument(doorAndWindowDoc());
    expect(chainTexts(shell)).toEqual(["0.50", "0.80", "0.60", "1.00", "0.90"]);
    typeInto(shell, 2, "0.30");
    expect(opening(shell, "y/d0")?.offset).toBe(1.7);
    expect(opening(shell, "x/d0")?.offset).toBe(0.6);
    expect(chainTexts(shell)).toEqual(["0.50", "0.80", "0.30", "1.00", "1.20"]);
  });

  it("typing 3.50 into the first piece is refused with the door's I12 message and nothing changes (AC-06)", () => {
    const shell = FakeShell.withDocument(doorAndWindowDoc());
    typeInto(shell, 0, "3.50");
    expect(shell.view().toast).toBe("This door doesn't fit on its wall");
    expect(shell.doc()).toEqual(doorAndWindowDoc());
    expect(shell.state.undo.past).toHaveLength(0);
    const t = shell.state.tool;
    expect(t.name === "select" ? t.state : null).toEqual({ kind: "idle" });
  });

  it("a value that is not a number keeps editing with a toast", () => {
    const shell = FakeShell.withDocument(doorDoc());
    typeInto(shell, 0, ".");
    expect(shell.view().toast).toBe("Can't read .");
    const t = shell.state.tool;
    expect(t.name === "select" ? t.state : null).toMatchObject({ kind: "editingHelper", piece: 0, value: "." });
  });

  it("typing 4.30 into the total makes the clear length 4.30 with joint a fixed, one undo step (AC-19, tidy.45)", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.click({ x: 6, y: 0.3 });
    const at = helperLabelAt(shell.doc(), right(shell.doc()), shell.state.camera);
    if (!at) throw new Error("no total");
    shell.click(at);
    expect(shell.view().commandBar.prompt).toBe("Wall length");
    shell.type("4.30");
    shell.key("Enter");
    expect(pointOf(shell.doc(), jointAt(shell.doc(), { x: 6, y: 0 }))).toEqual({ x: 6, y: 0 });
    // 4.30 + 0.10 + 0.10 = 4.50, corrected for the sloping top wall so the clear length reads 4.30 (tidy.45).
    expect(pointOf(shell.doc(), jointAt(shell.doc(), { x: 6, y: 4.509 }))).toEqual({ x: 6, y: 4.509 });
    expect(opening(shell, "x/d0")?.offset).toBe(1.1);
    expect(shell.state.undo.past).toHaveLength(1);
    shell.ui({ type: "undo" });
    expect(shell.doc()).toEqual(doorDoc());
  });

  it("a refused total toasts in plain words and nothing changes (AC-19)", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.click({ x: 6, y: 0.3 });
    const at = helperLabelAt(shell.doc(), right(shell.doc()), shell.state.camera);
    if (!at) throw new Error("no total");
    shell.click(at);
    shell.type("1.50"); // centre 1.70: the door (1.10–1.90) no longer fits
    shell.key("Enter");
    expect(shell.view().toast).toBe("A door doesn't fit on its wall");
    expect(shell.doc()).toEqual(doorDoc());
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("each accepted edit is one undo step (AC-05)", () => {
    const shell = FakeShell.withDocument(doorAndWindowDoc());
    typeInto(shell, 0, "0.40"); // door to 0.10 + 0.40 = 0.50
    typeInto(shell, 1, "0.90"); // door 0.90 wide
    typeInto(shell, 4, "0.80"); // window to 3.90 − 0.80 − 1.00 = 2.10
    expect(shell.state.undo.past).toHaveLength(3);
    expect(chainTexts(shell)).toEqual(["0.40", "0.90", "0.70", "1.00", "0.80"]);
    shell.ui({ type: "undo" });
    expect(opening(shell, "y/d0")?.offset).toBe(2);
    shell.ui({ type: "undo" });
    expect(opening(shell, "x/d0")?.width).toBe(0.8);
    shell.ui({ type: "undo" });
    expect(shell.doc()).toEqual(doorAndWindowDoc());
  });
});

describe("a second click on the chain piece being edited (tidy C10b, AC-13)", () => {
  it("keeps the typed value, so Enter applies it", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.click({ x: 6, y: 0.3 });
    const box = () => chainBoxes(shell.state, shell.doc(), right(shell.doc()))[0];
    const first = box();
    if (!first) throw new Error("no first piece");
    shell.click(first.at);
    shell.type("1.5");
    const again = box();
    if (!again) throw new Error("no first piece");
    shell.click(again.at);
    const t = shell.state.tool;
    expect(t.name === "select" ? t.state : null).toEqual({ kind: "editingHelper", wallId: right(shell.doc()), piece: 0, value: "1.5" });
    shell.key("Enter");
    expect(opening(shell, "x/d0")?.offset).toBeCloseTo(1.6, 9);
  });

  it("a click on another plate starts a new, empty value", () => {
    const shell = FakeShell.withDocument(doorDoc());
    shell.click({ x: 6, y: 0.3 });
    const total = helperLabelAt(shell.doc(), right(shell.doc()), shell.state.camera);
    if (!total) throw new Error("no helper");
    shell.click(total);
    shell.type("3.3");
    const piece = chainBoxes(shell.state, shell.doc(), right(shell.doc()))[0];
    if (!piece) throw new Error("no first piece");
    shell.click(piece.at);
    const t = shell.state.tool;
    expect(t.name === "select" ? t.state : null).toEqual({ kind: "editingHelper", wallId: right(shell.doc()), piece: 0, value: "" });
  });
});
