import { describe, expect, it } from "vitest";
import { anchorAt, holeView } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import { holeResize } from "../src/tools/hole-edit";
import { emptyDocument, rectangleRoom } from "@fm/domain";
import { notchedCabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Selecting and editing a hole (stairwell.16, .19, .35; AC-10), at the floor level only. The notched cabin: the notch
// notch/h0 at x 1.40–2.10, y 2.25–2.90 in the Loft (x 0.1–2.1); a second hole mid/h0 at x 0.60–1.20, y 1.00–1.60.

const MID = "mid/h0";
const midDoc = () => withCommands(notchedCabinDoc(), { type: "addDeckHole", opId: "mid", deck: "loft/k0", at: { x: 0.9, y: 1.3 }, w: 0.6, d: 0.6 });
const hole = (shell: FakeShell, id = MID) => {
  const h = holeView(shell.doc(), id)?.hole;
  return h ? { at: h.at, w: h.w, d: h.d } : null;
};
function selected(): FakeShell {
  const shell = FakeShell.withDocument(midDoc());
  shell.ui({ type: "setSnapStep", step: 0.05 });
  shell.click({ x: 0.9, y: 1.3 });
  expect(shell.state.selection).toEqual([{ table: "deckHoles", id: MID }]);
  return shell;
}
function drag(shell: FakeShell, from: Point, to: Point): void {
  shell.moveTo(from);
  shell.down(from);
  for (let i = 1; i <= 5; i++) shell.moveTo({ x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5 });
  shell.up(to);
}

describe("selecting a hole (AC-10)", () => {
  it("at the floor a click in a hole selects it; on the slab beside it, the deck", () => {
    const shell = selected();
    shell.click({ x: 0.4, y: 2.0 });
    expect(shell.state.selection).toEqual([{ table: "decks", id: "loft/k0" }]);
  });

  it("a ladder standing in the notch is picked first", () => {
    const doc = withCommands(notchedCabinDoc(), { type: "placeObject", opId: "lad", state: "s0", object: { kind: "shipsLadder" }, at: anchorAt({ x: 1.95, y: 2.6 }, 1.1, 90), rotation: 90, deck: null, reaches: "loft/k0" });
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 1.6, y: 2.6 });
    expect(shell.state.selection[0]?.table).toBe("placements");
  });

  it("at the loft's level a click in its hole selects the hole (smalls.12)", () => {
    const shell = FakeShell.withDocument(midDoc());
    shell.ui({ type: "setViewedLevel", deck: "loft/k0" });
    shell.click({ x: 0.9, y: 1.3 });
    expect(shell.state.selection.some((r) => r.table === "deckHoles")).toBe(true);
  });
});

describe("editing a hole (AC-10)", () => {
  it("a drag moves it inside its deck by the snap step; one undo", () => {
    // Sides x 0.65–1.25, y 1.10–1.70: none within the 0.125 m tolerance (10 px at 80 px/m) of a line.
    const shell = selected();
    drag(shell, { x: 0.9, y: 1.3 }, { x: 0.93, y: 1.42 });
    expect(hole(shell)).toEqual({ at: { x: 0.95, y: 1.4 }, w: 0.6, d: 0.6 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a side brought within the tolerance of its deck's edge lands on it", () => {
    // By the step, the west side would be at 0.15; the loft's west edge is 0.10.
    const shell = selected();
    drag(shell, { x: 0.9, y: 1.3 }, { x: 0.47, y: 1.3 });
    expect(hole(shell)?.at).toEqual({ x: 0.4, y: 1.3 });
  });

  it("sides brought near another hole's sides land on their lines", () => {
    // By the step, x 0.75–1.35 and y 1.60–2.20; the notch's west side is x 1.40, its south side y 2.25.
    const shell = selected();
    drag(shell, { x: 0.9, y: 1.3 }, { x: 1.05, y: 1.9 });
    expect(hole(shell)?.at).toEqual({ x: 1.1, y: 1.95 });
  });

  it("with Ctrl it neither steps nor snaps", () => {
    const shell = selected();
    const from = { x: 0.9, y: 1.3 };
    shell.moveTo(from, { ctrl: true });
    shell.down(from, { ctrl: true });
    for (let i = 1; i <= 5; i++) shell.moveTo({ x: 0.9 - (0.43 * i) / 5, y: 1.3 }, { ctrl: true });
    shell.up({ x: 0.47, y: 1.3 }, { ctrl: true });
    expect(hole(shell)?.at).toEqual({ x: 0.47, y: 1.3 });
  });

  it("arrows nudge it by 1 cm, Shift by 10 cm, as one setDeckHole", () => {
    const shell = selected();
    for (let i = 0; i < 3; i++) shell.key("ArrowLeft");
    shell.key("ArrowUp", { shift: true });
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(hole(shell)?.at).toEqual({ x: 0.87, y: 1.4 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a drag past the deck's side is refused, and the hole stays", () => {
    const shell = selected();
    // The west side 0.25 m past the loft's edge, beyond the snap tolerance; 0.10 past would land flush on it.
    drag(shell, { x: 0.9, y: 1.3 }, { x: 0.15, y: 1.3 });
    expect(hole(shell)?.at).toEqual({ x: 0.9, y: 1.3 });
  });

  it("four side grips; the east one moves that side only, clamped to 0.30", () => {
    const shell = selected();
    const grips = handles(shell.state, shell.doc()).filter((h) => h.kind === "holeSide");
    expect(grips).toHaveLength(4);
    const east = grips.find((h) => h.kind === "holeSide" && h.side === "right");
    if (!east) throw new Error("no east grip");
    drag(shell, east.at, { x: east.at.x + 0.2, y: east.at.y });
    expect(hole(shell)).toEqual({ at: { x: 1.0, y: 1.3 }, w: 0.8, d: 0.6 });
    const east2 = handles(shell.state, shell.doc()).find((h) => h.kind === "holeSide" && h.side === "right");
    if (!east2) throw new Error("no east grip");
    drag(shell, east2.at, { x: east2.at.x - 2, y: east2.at.y });
    expect(hole(shell)?.w).toBe(0.3);
  });

  describe("a side grip snaps (riser.21)", () => {
    // mid/h0 at x 0.60–1.20, y 1.00–1.60; the Loft's west edge at x 0.10; the notch's west side at x 1.40. 10 px is 0.125 m at this zoom.
    const grip = (shell: FakeShell, side: string) => {
      const g = handles(shell.state, shell.doc()).find((h) => h.kind === "holeSide" && h.side === side);
      if (!g) throw new Error("no grip");
      return g.at;
    };
    const sideX = (shell: FakeShell, sign: 1 | -1): number => {
      const h = hole(shell);
      if (!h) throw new Error("no hole");
      return h.at.x + (sign * h.w) / 2;
    };

    it("lands on the deck's edge within the tolerance, and the opposite side stays", () => {
      const shell = selected();
      const west = grip(shell, "left");
      drag(shell, west, { x: 0.17, y: west.y });
      expect(sideX(shell, -1)).toBeCloseTo(0.1, 6);
      expect(sideX(shell, 1)).toBeCloseTo(1.2, 6);
    });

    it("further away, rounds to the centimetre", () => {
      const shell = selected();
      const west = grip(shell, "left");
      drag(shell, west, { x: 0.3, y: west.y });
      expect(sideX(shell, -1)).toBeCloseTo(0.3, 6);
    });

    it("lands on another hole's side", () => {
      const shell = selected();
      const east = grip(shell, "right");
      drag(shell, east, { x: 1.34, y: east.y });
      expect(sideX(shell, 1)).toBeCloseTo(1.4, 6);
    });

    it("works along the depth too, on a deck's north edge", () => {
      const shell = selected();
      const north = grip(shell, "back");
      const h0 = hole(shell);
      if (!h0) throw new Error("no hole");
      drag(shell, north, { x: north.x, y: 2.84 }); // the Loft's north edge at y 2.9
      const h = hole(shell);
      expect((h?.at.y ?? 0) + (h?.d ?? 0) / 2).toBeCloseTo(2.9, 6);
      expect((h?.at.y ?? 0) - (h?.d ?? 0) / 2).toBeCloseTo(h0.at.y - h0.d / 2, 6);
    });

    it("Ctrl takes it off", () => {
      const shell = selected();
      const west = grip(shell, "left");
      expect(holeResize(shell.doc(), MID, "left", { x: 0.17 - west.x, y: 0 }, 0)?.w).toBeCloseTo(1.03, 6);
      shell.moveTo(west);
      shell.down(west, { ctrl: true });
      shell.moveTo({ x: 0.17, y: west.y }, { ctrl: true });
      shell.up({ x: 0.17, y: west.y }, { ctrl: true });
      expect(sideX(shell, -1)).toBeCloseTo(0.17, 6);
    });

    it("works on a turned deck, along its own axes", () => {
      const doc = withCommands(
        emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 8, "r"),
        { type: "addDeck", opId: "t", preset: "loft", at: { x: 4, y: 4 }, w: 3, d: 2, rotation: 30 },
        { type: "addDeckHole", opId: "h", deck: "t/k0", at: { x: 4, y: 4 }, w: 1, d: 1 },
      );
      const r = (30 * Math.PI) / 180;
      const west = { x: -Math.cos(r), y: -Math.sin(r) }; // the hole's −x side, turned with the deck
      const by = (m: number) => ({ x: west.x * m, y: west.y * m });
      expect(holeResize(doc, "h/h0", "left", by(0.9), 0.125)?.w).toBeCloseTo(2, 3); // on the deck's edge, 1.50 from its centre
      expect(holeResize(doc, "h/h0", "left", by(0.5), 0.125)?.w).toBeCloseTo(1.5, 3); // nothing near
    });
  });

  it("Width typed 0.80 resizes about its centre; Depth too; one undo each", () => {
    const shell = selected();
    expect(shell.view().properties.kind).toBe("hole");
    shell.ui({ type: "setField", fieldId: "width", value: "0.80" });
    shell.ui({ type: "setField", fieldId: "depth", value: "0.5" });
    expect(hole(shell)).toEqual({ at: { x: 0.9, y: 1.3 }, w: 0.8, d: 0.5 });
    expect(shell.state.undo.past).toHaveLength(2);
  });

  it("Delete removes it", () => {
    const shell = selected();
    shell.key("Delete");
    expect(hole(shell)).toBeNull();
    expect(shell.state.selection).toEqual([]);
  });
});

describe("a selected hole on the plan", () => {
  it("outlines in the selection blue", () => {
    const shell = selected();
    const blue = (shell.scene().layers.find((l) => l.name === "overheads")?.primitives ?? []).filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected);
    expect(blue.length).toBeGreaterThanOrEqual(4);
  });
});

