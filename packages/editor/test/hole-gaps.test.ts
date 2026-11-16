import { describe, expect, it } from "vitest";
import { deckView, holeView, type Document } from "@fm/domain";
import { deckLabelBox } from "../src/view/deck-label";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { handles } from "../src/view/handles";
import { holeGapBoxes } from "../src/view/hole-gaps";
import { notchedCabinDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A selected hole's gaps (stairwell.36): one editable dimension from each side to its deck's edge, along the deck's axes,
// as a door's chain on its wall. The notched cabin's Loft is x 0.10–2.10, y 0.10–2.90; mid/h0 is x 0.60–1.20,
// y 1.00–1.60; the notch x 1.40–2.10, y 2.25–2.90 (flush north and east).

const MID = "mid/h0";
const midDoc = (): Document => withCommands(notchedCabinDoc(), { type: "addDeckHole", opId: "mid", deck: "loft/k0", at: { x: 0.9, y: 1.3 }, w: 0.6, d: 0.6 });
const gaps = (shell: FakeShell): Record<string, string> => Object.fromEntries(holeGapBoxes(shell.state, shell.doc()).map((b) => [b.side, b.text]));
const at = (shell: FakeShell, id = MID) => holeView(shell.doc(), id)?.hole.at;

function selected(doc = midDoc(), click = { x: 0.9, y: 1.3 }): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(click);
  expect(shell.state.selection[0]?.table).toBe("deckHoles");
  return shell;
}

/** Clicks the plate of `side` and types `value`, then Enter. */
function typeGap(shell: FakeShell, side: string, value: string): void {
  const box = holeGapBoxes(shell.state, shell.doc()).find((b) => b.side === side);
  if (!box) throw new Error(`no ${side} gap`);
  shell.click(box.at);
  shell.type(value);
  shell.key("Enter");
}

describe("a selected hole's gaps (stairwell.36)", () => {
  it("one selected hole shows its four gaps to its deck's edges; nothing selected, none", () => {
    expect(gaps(FakeShell.withDocument(midDoc()))).toEqual({});
    expect(gaps(selected())).toEqual({ left: "0.50", right: "0.90", front: "0.90", back: "1.30" });
  });

  it("a side flush with its deck's edge shows none", () => {
    expect(gaps(selected(notchedCabinDoc(), { x: 1.75, y: 2.575 }))).toEqual({ left: "1.30", front: "2.15" });
  });

  it("a plate whose line runs under its deck's label moves along the line clear of it", () => {
    // The notch's west gap runs at y 2.575 from x 1.40 to the edge at 0.10, under "Loft +2.15" in the top-left corner.
    const shell = selected(notchedCabinDoc(), { x: 1.75, y: 2.575 });
    const deck = deckView(shell.doc(), "loft/k0");
    if (!deck) throw new Error("no loft");
    const label = deckLabelBox(deck, CANVAS_STYLE, shell.state.camera.zoom);
    const west = holeGapBoxes(shell.state, shell.doc()).find((b) => b.side === "left");
    if (!west) throw new Error("no west gap");
    const apart = west.max.x <= label.min.x || west.min.x >= label.max.x || west.max.y <= label.min.y || west.min.y >= label.max.y;
    expect(apart).toBe(true);
    expect(west.at.y).toBeCloseTo(2.575);
  });

  it("a click on a gap starts typing into it; Enter moves the hole so the gap reads the value; its size stays; one undo", () => {
    const shell = selected();
    typeGap(shell, "left", "0.75");
    expect(holeView(shell.doc(), MID)?.hole).toMatchObject({ at: { x: 1.15, y: 1.3 }, w: 0.6, d: 0.6 });
    expect(gaps(shell)).toEqual({ left: "0.75", right: "0.65", front: "0.90", back: "1.30" });
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: MID }]);
    shell.ui({ type: "undo" });
    expect(at(shell)).toEqual({ x: 0.9, y: 1.3 });
  });

  it("the plate shows the typed value and the command bar asks for it; Esc leaves the hole as it was", () => {
    const shell = selected();
    const box = holeGapBoxes(shell.state, shell.doc()).find((b) => b.side === "back");
    shell.click(box?.at ?? { x: 0, y: 0 });
    shell.type("1");
    expect(gaps(shell).back).toBe("1");
    expect(shell.view().commandBar).toMatchObject({ prompt: "Distance to the deck's edge", value: "1", unit: "m" });
    shell.key("Escape");
    expect(at(shell)).toEqual({ x: 0.9, y: 1.3 });
  });

  it("a value that takes the hole out of its deck is refused with the domain's words; the hole stays", () => {
    const shell = selected();
    typeGap(shell, "left", "2");
    expect(shell.view().toast).toBe("A hole in Loft lies inside it");
    expect(at(shell)).toEqual({ x: 0.9, y: 1.3 });
  });

  it("a gap too short for its plate puts the plate beyond the deck's edge, so a press on the side grip still resizes", () => {
    const shell = selected();
    typeGap(shell, "right", "0.2"); // the east side at x 1.90, 0.20 from the edge: 16 px at 80 px/m
    const east = holeGapBoxes(shell.state, shell.doc()).find((b) => b.side === "right");
    expect(east?.text).toBe("0.20");
    expect(east?.min.x).toBeGreaterThan(2.1);
    const grip = handles(shell.state, shell.doc()).find((h) => h.kind === "holeSide" && h.side === "right");
    shell.drag(grip?.at ?? { x: 0, y: 0 }, { x: 1.8, y: 1.3 });
    expect(holeView(shell.doc(), MID)?.hole.w).toBe(0.5);
  });

  it("on a deck turned 90° the gaps run along its axes", () => {
    // A Loft 1.00 × 2.00 turned 90°: x 2.00–4.00, y 1.50–2.50. Its hole 0.40 × 0.60 at (3, 2) spans y 1.80–2.20 and
    // x 2.70–3.30; the deck's left (its −x) faces plan −y, its front (its −y) plan +x.
    const doc = withCommands(roomDoc(),
      { type: "addDeck", opId: "t", preset: "loft", at: { x: 3, y: 2 }, w: 1, d: 2, rotation: 90 },
      { type: "addDeckHole", opId: "th", deck: "t/k0", at: { x: 3, y: 2 }, w: 0.4, d: 0.6 });
    const shell = selected(doc, { x: 3, y: 2 });
    expect(gaps(shell)).toEqual({ left: "0.30", right: "0.30", front: "0.70", back: "0.70" });
    typeGap(shell, "left", "0.1");
    expect(at(shell, "th/h0")).toEqual({ x: 3, y: 1.8 });
  });
});
