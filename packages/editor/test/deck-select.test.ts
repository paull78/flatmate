import { describe, expect, it } from "vitest";
import { deckView, deckViews, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { deckResize, deckSide } from "../src/tools/deck-edit";
import { hitTest } from "../src/tools/hit-test";
import { HANDLE_HIT_PX, handles } from "../src/view/handles";
import { clearRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Selecting and editing decks on the canvas (spec "The Deck tool and editing", decks.06, .13, .19, stairwell.37; AC-10). roomDoc: a
// 6 × 4 room, wall faces x 0.1–5.9, y 0.1–3.9.

const loft = (at: Point, more: Partial<Extract<Command, { type: "addDeck" }>> = {}): Command => ({ type: "addDeck", opId: "l", preset: "loft", at, ...more });
/** The room labelled "Studio" at (2.4, 1.5); a loft x 2–4, y 1.3–2.7 (l/k0); a desk under it, x 2.7–3.9, y 2.0–2.6. */
function studio(): Document {
  return withCommands(
    roomDoc(),
    { type: "labelZone", id: "L1", at: { x: 2.4, y: 1.5 }, name: "Studio", finish: null },
    loft({ x: 3, y: 2 }),
    { type: "placeObject", deck: null, opId: "desk", state: "s0", object: { kind: "desk" }, at: { x: 3.3, y: 2.6 } },
  );
}
const DECK = { table: "decks", id: "l/k0" } as const;
const box = (shell: FakeShell) => {
  const d = deckView(shell.doc(), "l/k0");
  return d ? { at: d.at, w: d.w, d: d.d } : null;
};
/** A press at `from` dragged to `to` and released, with a move between. */
function drag(shell: FakeShell, from: Point, to: Point): void {
  shell.moveTo(from);
  shell.down(from);
  shell.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  shell.moveTo(to);
  shell.up(to);
}
/** An empty room with a loft centred at (3, 2), 2.00 × 1.40, selected, snap step 0.10. */
function selectedLoft(...more: Command[]): FakeShell {
  const shell = FakeShell.withDocument(withCommands(roomDoc(), loft({ x: 3, y: 2 }), ...more));
  shell.ui({ type: "setSnapStep", step: 0.1 });
  shell.click({ x: 2.2, y: 2.5 });
  expect(shell.state.selection).toEqual([DECK]);
  return shell;
}

describe("selecting decks (decks.19)", () => {
  it("a click on a deck selects it; a click on bare floor under no deck selects the room as today", () => {
    const shell = FakeShell.withDocument(studio());
    shell.click({ x: 2.2, y: 2.5 });
    expect(shell.state.selection).toEqual([DECK]);
    shell.click({ x: 5, y: 3.5 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  });

  it("a click on a piece standing over a deck selects the piece; a second click keeps it (decks join no cycling)", () => {
    const shell = FakeShell.withDocument(studio());
    const desk = Object.keys(shell.doc().placements)[0] ?? "";
    shell.click({ x: 3.3, y: 2.3 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: desk }]);
    shell.click({ x: 3.3, y: 2.3 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: desk }]);
  });

  it("a click on a room tag inside a deck selects the tag", () => {
    const shell = FakeShell.withDocument(studio());
    expect(deckView(shell.doc(), "l/k0")?.ring.length).toBe(4);
    shell.click({ x: 2.4, y: 1.5 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  });

  it("the higher of two decks wins; walls and their joints beat a deck flush with them", () => {
    const doc = withCommands(roomDoc(), loft({ x: 1.1, y: 2 }), { type: "addDeck", opId: "p", preset: "platform", at: { x: 4, y: 2 } });
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setSnapStep", step: 0.1 });
    shell.click({ x: 0.15, y: 2 }); // inside the loft (x 0.1–2.1), 0.05 m (4 px) from the wall's face: the wall
    expect(shell.state.selection).toEqual([{ table: "walls", id: expect.any(String) }]);
    shell.click({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([DECK]);
    shell.click({ x: 4, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "decks", id: "p/k0" }]);
    expect(hitTest(shell.state, { x: 3, y: 3.8 })).toBeNull(); // no deck, no labelled room
  });

  it("an unselected deck starts a box like the floor: the box selects the pieces in it and not the deck", () => {
    const shell = FakeShell.withDocument(studio());
    drag(shell, { x: 2.1, y: 2.65 }, { x: 4.5, y: 1.9 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: Object.keys(shell.doc().placements)[0] }]);
    expect(box(shell)).toEqual({ at: { x: 3, y: 2 }, w: 2, d: 1.4 });
  });

  it("the cursor: pointer over a deck, move over the selected deck, a resize cursor on its side grips", () => {
    const shell = FakeShell.withDocument(studio());
    shell.moveTo({ x: 2.2, y: 2.5 });
    expect(shell.view().cursor).toBe("pointer");
    shell.click({ x: 2.2, y: 2.5 });
    shell.moveTo({ x: 2.25, y: 2.5 });
    expect(shell.view().cursor).toBe("move");
    shell.moveTo({ x: 4, y: 2 });
    expect(shell.view().cursor).toBe("ew-resize");
    shell.moveTo({ x: 3, y: 2.7 });
    expect(shell.view().cursor).toBe("ns-resize");
  });

  it("a selected deck has four side grips and no rotation grip", () => {
    const shell = selectedLoft();
    const hs = handles(shell.state, shell.doc());
    expect(hs.map((h) => h.kind)).toEqual(["deckSide", "deckSide", "deckSide", "deckSide"]);
    expect(hs.map((h) => h.at)).toEqual([{ x: 4, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 1.3 }, { x: 3, y: 2.7 }]);
  });

  it("grips show only in the Select tool: a deck the Deck tool just added is selected without them until V", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("k");
    shell.click({ x: 3, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "decks", id: "id1/k0" }]);
    expect(handles(shell.state, shell.doc())).toEqual([]);
    shell.key("v");
    expect(handles(shell.state, shell.doc())).toHaveLength(4);
  });
});

describe("editing decks on the canvas (AC-10)", () => {
  it("dragging a selected deck moves it by the snap step; one undo puts it back", () => {
    const shell = selectedLoft();
    drag(shell, { x: 2.2, y: 2.5 }, { x: 2.73, y: 2.77 });
    expect(box(shell)).toEqual({ at: { x: 3.5, y: 2.3 }, w: 2, d: 1.4 });
    expect(shell.state.selection).toEqual([DECK]);
    shell.key("z", { meta: true });
    expect(box(shell)).toEqual({ at: { x: 3, y: 2 }, w: 2, d: 1.4 });
  });

  it("a side brought within the tolerance of a wall face lands on it (stairwell.37)", () => {
    // By the step the left side would be at x 0.20; the west face is 0.10. The other sides are far from every line.
    const shell = selectedLoft();
    drag(shell, { x: 2.2, y: 2.5 }, { x: 0.42, y: 2.5 });
    expect(box(shell)?.at).toEqual({ x: 1.1, y: 2 });
  });

  it("a side brought near another deck's edge lands on it; with Ctrl it neither steps nor snaps", () => {
    // A platform x 4.5–5.5, y 0.5–1.5. By the step the loft's right side would be at x 4.40.
    const shell = selectedLoft({ type: "addDeck", opId: "p", preset: "platform", at: { x: 5, y: 1 }, w: 1, d: 1 });
    drag(shell, { x: 2.2, y: 2.5 }, { x: 2.62, y: 2.5 });
    expect(box(shell)?.at).toEqual({ x: 3.5, y: 2 });
    const from = { x: 2.6, y: 2.5 };
    shell.moveTo(from, { ctrl: true });
    shell.down(from, { ctrl: true });
    shell.moveTo({ x: 2.55, y: 2.5 }, { ctrl: true });
    shell.moveTo({ x: 2.53, y: 2.5 }, { ctrl: true });
    shell.up({ x: 2.53, y: 2.5 }, { ctrl: true });
    expect(box(shell)?.at).toEqual({ x: 3.43, y: 2 });
  });

  it("arrows nudge a selected deck 1 cm, Shift 10 cm, as one setDeck that carries its pieces", () => {
    const shell = selectedLoft({ type: "setCeiling", height: 3.4 }, { type: "placeObject", opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 3.5, y: 2 }, deck: "l/k0" });
    const chair = Object.keys(shell.doc().placements)[0] ?? "";
    const before = shell.doc().placements[chair]?.at;
    shell.key("ArrowRight");
    shell.key("ArrowRight");
    shell.key("ArrowDown", { shift: true });
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(box(shell)?.at).toEqual({ x: 3.02, y: 1.9 });
    expect(shell.doc().placements[chair]?.at).toEqual(before && { x: before.x + 0.02, y: before.y - 0.1 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a drag that would leave the building is refused with the I18 toast and the deck stays", () => {
    const shell = selectedLoft();
    drag(shell, { x: 2.2, y: 2.5 }, { x: 5.2, y: 2.5 });
    expect(box(shell)).toEqual({ at: { x: 3, y: 2 }, w: 2, d: 1.4 });
    expect(shell.view().toast).toBe("Loft must lie over the building");
  });

  it("the right side grip widens it with the left side fixed, to the centimetre", () => {
    const shell = selectedLoft();
    drag(shell, { x: 4, y: 2 }, { x: 4.534, y: 2.2 });
    expect(box(shell)).toEqual({ at: { x: 3.265, y: 2 }, w: 2.53, d: 1.4 });
    shell.key("z", { meta: true });
    expect(box(shell)).toEqual({ at: { x: 3, y: 2 }, w: 2, d: 1.4 });
  });

  it("the back and front grips change the depth with the opposite side fixed", () => {
    const shell = selectedLoft();
    drag(shell, { x: 3, y: 2.7 }, { x: 3.4, y: 3.2 }); // back (+y) out by 0.50
    expect(box(shell)).toEqual({ at: { x: 3, y: 2.25 }, w: 2, d: 1.9 });
    drag(shell, { x: 3, y: 1.3 }, { x: 3, y: 1.6 }); // front (−y) in by 0.30
    expect(box(shell)).toEqual({ at: { x: 3, y: 2.4 }, w: 2, d: 1.6 });
  });

  it("on a deck turned 90° the grip at its top is its right side: widening keeps the bottom side", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), loft({ x: 3, y: 2 }, { rotation: 90 })));
    shell.click({ x: 3, y: 1.5 });
    expect(shell.state.selection).toEqual([DECK]);
    drag(shell, { x: 3, y: 3 }, { x: 3.1, y: 3.4 }); // x 2.3–3.7, y 1–3 turned; its right side is y = 3
    const d = deckView(shell.doc(), "l/k0");
    expect(d && { at: d.at, w: d.w, d: d.d, rotation: d.rotation }).toEqual({ at: { x: 3, y: 2.2 }, w: 2.4, d: 1.4, rotation: 90 });
  });

  it("a side grip cannot go under 0.30", () => {
    const shell = selectedLoft();
    drag(shell, { x: 4, y: 2 }, { x: 0.5, y: 2 });
    expect(box(shell)).toEqual({ at: { x: 2.15, y: 2 }, w: 0.3, d: 1.4 });
  });

  it("Delete removes a deck; undo restores it", () => {
    const shell = selectedLoft();
    shell.key("Delete");
    expect(deckViews(shell.doc())).toEqual([]);
    expect(shell.state.selection).toEqual([]);
    shell.key("z", { meta: true });
    expect(box(shell)).toEqual({ at: { x: 3, y: 2 }, w: 2, d: 1.4 });
  });

  it("R does not turn a selected deck", () => {
    const shell = selectedLoft();
    shell.key("r");
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    const d = deckView(shell.doc(), "l/k0");
    expect(d && { at: d.at, rotation: d.rotation }).toEqual({ at: { x: 3, y: 2 }, rotation: 0 });
    expect(shell.view().canUndo).toBe(false);
  });
});

/** mulberry32, as packages/domain/test/helpers.ts `rng`: a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("deck grips at any size, angle and zoom (fuzz)", () => {
  const SIDES = ["right", "left", "front", "back"] as const;
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  it("no two grips' hit circles overlap, and the centre stays clear of them", () => {
    const random = rng(19);
    for (let i = 0; i < 400; i++) {
      const w = 0.3 + Math.round(random() * 370) / 100;
      const d = 0.3 + Math.round(random() * 370) / 100;
      const rotation = Math.floor(random() * 360);
      const zoom = 20 + random() * 380;
      const doc = withCommands(clearRoomDoc(20, 20, "r"), { type: "addDeck", opId: "k", preset: "platform", at: { x: 10, y: 10 }, w, d, rotation });
      const shell = FakeShell.withDocument(doc);
      shell.state = { ...shell.state, selection: [{ table: "decks", id: "k/k0" }], camera: { ...shell.state.camera, zoom } };
      const grips = handles(shell.state, shell.doc()).map((h) => h.at);
      const label = JSON.stringify({ w, d, rotation, zoom });
      expect(grips, label).toHaveLength(4);
      const r = HANDLE_HIT_PX / zoom;
      for (const [a, g] of grips.entries()) {
        expect(dist(g, { x: 10, y: 10 }), label).toBeGreaterThan(r);
        for (const h of grips.slice(a + 1)) expect(dist(g, h), label).toBeGreaterThanOrEqual(2 * r - 1e-9);
      }
    }
  });

  it("a side grip's drag keeps the opposite side where it was, the size to the cm and at least 0.30", () => {
    const random = rng(23);
    const opposite = { right: "left", left: "right", front: "back", back: "front" } as const;
    for (let i = 0; i < 400; i++) {
      const doc = withCommands(clearRoomDoc(20, 20, "r"), {
        type: "addDeck", opId: "k", preset: "platform", at: { x: 10, y: 10 },
        w: 0.3 + Math.round(random() * 370) / 100, d: 0.3 + Math.round(random() * 370) / 100, rotation: Math.floor(random() * 360),
      });
      const side = SIDES[Math.floor(random() * 4)] ?? "right";
      const drag = { x: (random() - 0.5) * 8, y: (random() - 0.5) * 8 };
      const before = deckView(doc, "k/k0");
      const r = deckResize(doc, "k/k0", side, drag);
      const label = JSON.stringify({ before, side, drag });
      if (!before || !r) throw new Error(label);
      const after = { ...before, ...r, ring: [] };
      const turned = deckView(withCommands(doc, { type: "setDeck", deckId: "k/k0", at: r.at, w: r.w, d: r.d }), "k/k0");
      const fixedBefore = deckSide(before, opposite[side])?.mid;
      const fixedAfter = turned ? deckSide(turned, opposite[side])?.mid : undefined;
      expect(fixedBefore && fixedAfter && dist(fixedBefore, fixedAfter), label).toBeLessThanOrEqual(0.001); // the domain keeps the centre to the mm
      for (const v of [after.w, after.d]) {
        expect(v, label).toBeGreaterThanOrEqual(0.3);
        expect(Math.abs(v * 100 - Math.round(v * 100)), label).toBeLessThan(1e-6);
      }
    }
  });
});
