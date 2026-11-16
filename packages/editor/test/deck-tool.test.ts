import { describe, expect, it } from "vitest";
import { deckViews, type DeckView, sameGuards } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { CANVAS_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The Deck tool (spec "The Deck tool and editing", decks.06, .13; AC-01, AC-10). roomDoc: a 6 × 4 room of 0.20 m
// walls on centrelines, so its wall faces run x 0.1–5.9, y 0.1–3.9.

type Segment = Extract<Primitive, { kind: "segment" }>;
const overlays = (shell: FakeShell): Segment[] =>
  (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "segment" ? [p] : []));
/** The decks as stored, without their derived ring and range. */
const decks = (shell: FakeShell): Omit<DeckView, "ring" | "range" | "holes" | "cells" | "edges" | "fills">[] =>
  deckViews(shell.doc()).map(({ ring: _r, range: _g, holes: _h, cells: _c, edges: _e, fills: _f, ...row }) => row);

/** K, then a press at `from` dragged to `to` (not yet released). */
function pressAndDrag(shell: FakeShell, from: Point, to: Point, ctrl = false): void {
  shell.moveTo(from, { ctrl });
  shell.down(from, { ctrl });
  shell.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { ctrl });
  shell.moveTo(to, { ctrl });
}

describe("the Deck tool (AC-10)", () => {
  it("K selects the Deck tool; the floating bar lists it after Dimension, with its prompt", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    expect(shell.view().activeTool).toBe("deck");
    expect(shell.view().tools.at(-2)).toEqual({ tool: "deck", label: "Deck", key: "K" });
    expect(shell.view().commandBar.prompt).toBe("Drag a deck · click for 2.00 × 1.40");
    expect(shell.view().cursor).toBe("crosshair");
  });

  it("dragging from wall-face corner to corner adds a deck flush with the faces, in either direction (AC-01)", () => {
    for (const [from, to] of [
      [{ x: 0.13, y: 0.12 }, { x: 5.87, y: 3.88 }],
      [{ x: 5.87, y: 3.88 }, { x: 0.13, y: 0.12 }],
      [{ x: 0.12, y: 3.87 }, { x: 5.88, y: 0.13 }],
    ] as const) {
      const shell = FakeShell.withDocument(roomDoc());
      shell.key("k");
      pressAndDrag(shell, from, to);
      // The valid preview: the deck style's dashed outline, four edges on the room's faces.
      const preview = overlays(shell);
      expect(preview).toHaveLength(4);
      for (const s of preview) {
        expect(s.color).toBe(CANVAS_STYLE.deck.line.color);
        expect(s.dash).toEqual(CANVAS_STYLE.deck.dash);
      }
      expect(preview.flatMap((s) => [s.a.x, s.a.y]).every((v) => [0.1, 5.9, 3.9].some((f) => Math.abs(v - f) < 1e-9))).toBe(true);
      shell.up(to);
      // The room's clear size, 5.80 × 3.80 (unsnapped, the cm corners would give 5.74 × 3.76).
      expect(decks(shell)).toEqual([{ id: "id1/k0", name: "Platform", at: { x: 3, y: 2 }, w: 5.8, d: 3.8, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") }]);
      expect(overlays(shell)).toEqual([]);
      expect(shell.view().activeTool).toBe("deck");
    }
  });

  it("with Ctrl the corners don't snap to the faces, only to the centimetre", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    pressAndDrag(shell, { x: 0.1312, y: 0.1196 }, { x: 5.8712, y: 3.8804 }, true);
    shell.up({ x: 5.8712, y: 3.8804 }, { ctrl: true });
    expect(decks(shell)).toEqual([expect.objectContaining({ at: { x: 3, y: 2 }, w: 5.74, d: 3.76 })]);
  });

  it("a click adds 2.00 × 1.40 centred on the cursor (to the centimetre)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    shell.click({ x: 2.5037, y: 1.9962 });
    expect(decks(shell)).toEqual([{ id: "id1/k0", name: "Platform", at: { x: 2.5, y: 2 }, w: 2, d: 1.4, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") }]);
  });

  it("a press moved under 4 px is still a click", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3.04, y: 2 }); // 3.2 px at the default zoom
    expect(overlays(shell)).toEqual([]);
    shell.up({ x: 3.04, y: 2 });
    expect(decks(shell)).toEqual([expect.objectContaining({ at: { x: 3.04, y: 2 }, w: 2, d: 1.4 })]);
  });

  it("the Loft setting adds a hollow deck at 2.15; the setting stays with the viewer and picks the Deck tool", () => {
    const shell = FakeShell.withDocument(roomDoc());
    expect(shell.view().deckPreset).toBe("platform");
    expect(shell.view().deckPresets).toEqual([{ preset: "platform", label: "Platform" }, { preset: "loft", label: "Loft" }]);
    shell.ui({ type: "pickDeckPreset", preset: "loft" });
    expect(shell.view().activeTool).toBe("deck");
    expect(shell.view().deckPreset).toBe("loft");
    shell.click({ x: 3, y: 2 });
    expect(decks(shell)).toEqual([expect.objectContaining({ name: "Loft", top: 2.15, solid: false, w: 2, d: 1.4 })]);
    shell.key("v");
    shell.key("k");
    expect(shell.view().deckPreset).toBe("loft");
  });

  it("a drag outside the building shows a red preview and adds nothing, with the toast \"Platform must lie over the building\"", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    pressAndDrag(shell, { x: 4, y: 1 }, { x: 7, y: 3 });
    const preview = overlays(shell);
    expect(preview).toHaveLength(4);
    for (const s of preview) expect(s.color).toBe(COLORS.invalid);
    shell.up({ x: 7, y: 3 });
    expect(decks(shell)).toEqual([]);
    expect(shell.view().toast).toBe("Platform must lie over the building");
    expect(shell.view().activeTool).toBe("deck");
  });

  it("Escape cancels a drag; a second Escape returns to Select", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    pressAndDrag(shell, { x: 1, y: 1 }, { x: 3, y: 2 });
    expect(overlays(shell)).toHaveLength(4);
    shell.key("Escape");
    expect(overlays(shell)).toEqual([]);
    expect(shell.view().activeTool).toBe("deck");
    shell.up({ x: 3, y: 2 });
    expect(decks(shell)).toEqual([]);
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("the pointer leaving the canvas drops the press: its release adds nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    pressAndDrag(shell, { x: 1, y: 1 }, { x: 3, y: 2 });
    shell.send({ type: "pointerLeave" });
    expect(overlays(shell)).toEqual([]);
    shell.up({ x: 3, y: 2 });
    expect(decks(shell)).toEqual([]);
  });

  it("the new deck is selected and one undo removes it", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    shell.click({ x: 2, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "decks", id: "id1/k0" }]);
    expect(shell.view().activeTool).toBe("deck");
    shell.click({ x: 4.5, y: 2 }); // the next deck takes the selection
    expect(shell.state.selection).toEqual([{ table: "decks", id: "id3/k0" }]);
    shell.key("z", { meta: true });
    expect(decks(shell).map((d) => d.id)).toEqual(["id1/k0"]);
    expect(shell.state.selection).toEqual([]);
    shell.key("z", { meta: true });
    expect(decks(shell)).toEqual([]);
  });

  it("a refused click keeps the selection as it was", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    shell.click({ x: 2, y: 2 });
    shell.click({ x: 2.5, y: 2 }); // overlaps the first
    expect(decks(shell)).toHaveLength(1);
    expect(shell.view().toast).toBe("Platform and Platform 2 overlap");
    expect(shell.state.selection).toEqual([{ table: "decks", id: "id1/k0" }]);
  });
});
