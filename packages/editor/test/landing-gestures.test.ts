import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, validateDocument, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ObjectGhost } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import type { Primitive } from "../src/view/scene-types";
import { jointAt, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The landing rule in the gestures (spec "The landing rule", decks.11): the Object tool's ghost, dragging one piece and
// its rotation grip ask which surface the piece lands on, inside their contact and settle searches too, so the ghost,
// the snap and the commit agree; group drags and duplicates keep each piece's surface.
//
// The studio, 7 × 2.5 on its centre lines, 0.20 m walls: inner faces x 0.1–6.9, y 0.1–2.4; ceiling 3.05, so the cut is
// at 1.20. A partition on x = 2 (faces 1.9–2.1) lowered to 2.03 cuts off the sleeping end (x 0.1–1.9). The loft
// (loft/k0, hollow, top 2.15, underside 2.03, touching the partition's top) covers x 0.1–3.6, y 0.1–2.4, flush with
// three walls and crossing the partition; its left edge computes to 0.10000000000000009, a hair inside the end wall's
// face. The solid platform (plat/k0, top 0.45) lies by the window on the bottom wall:
// x 4.5–6.9, y 0.1–1.4. Free floor of the main room: x 3.6–6.9 above y 1.4, x 3.6–4.5 below it, and x 2.1–3.6 under
// the loft. At the default zoom the snap tolerance is 10 px = 0.125 m; the tests set the snap step to 0.10.

const LOFT = "loft/k0";
const PLAT = "plat/k0";

function studio(...more: Command[]): Document {
  let doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"), { type: "addWall", opId: "part", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 2.5 } } });
  const partition = wallBetween(doc, { x: 2, y: 0 }, { x: 2, y: 2.5 });
  const bottom = wallBetween(doc, { x: 2, y: 0 }, { x: 7, y: 0 });
  const fromLeft = doc.walls[bottom]?.a === jointAt(doc, { x: 2, y: 0 });
  doc = withCommands(
    doc,
    { type: "setWallTop", wallId: partition, top: 2.03 },
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 5.7, y: 0.75 }, w: 2.4, d: 1.3 },
    { type: "addOpening", opId: "win", wall: bottom, kind: "window", offset: fromLeft ? 3.7 : 1.3 }, // centred on x 5.7
  );
  return withCommands(doc, ...more);
}

const place = (opId: string, kind: string, at: Point, deck: string | null, rotation = 0): Command => ({ type: "placeObject", opId, state: "s0", object: { kind }, at, rotation, deck });

/**
 * A 1.30 × 1.20 mattress, 0.35 high, on the loft anchored at `at` (rotation 0, back to the top wall): placed on the
 * floor under the loft, lowered, then lifted onto it (a 1.00 m bed on the loft would reach 3.15).
 */
const bedOnLoft = (at: Point): Command[] => [
  { type: "placeObject", opId: "bed", state: "s0", object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 3, y: 2.4 }, deck: null },
  { type: "setObjectSize", objectId: "bed/o0", w: 1.3, d: { standard: 1.2 }, h: { standard: 0.35 } },
  { type: "movePlacement", placementId: "bed/p0", at, rotation: 0, deck: LOFT },
];

function shellOf(doc: Document): FakeShell {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  return shell;
}

/** `shellOf` viewing the loft: a loft's pieces are edited at its level (shown.02). */
function loftShellOf(doc: Document): FakeShell {
  const shell = shellOf(doc);
  shell.ui({ type: "setViewedLevel", deck: LOFT });
  return shell;
}

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const placed = (shell: FakeShell, kind: string): Placement[] =>
  Object.values(shell.doc().placements).filter((p) => shell.doc().objects[p.object]?.kind === kind);
const only = (shell: FakeShell, kind: string): Placement => {
  const [p, ...rest] = placed(shell, kind);
  if (!p || rest.length > 0) throw new Error(`expected one ${kind}, found ${placed(shell, kind).length}`);
  return p;
};
const pin = (p: Placement | undefined) => (p ? { at: p.at, rotation: p.rotation, deck: p.deck } : null);

describe("the Object tool lands its ghost (decks.11)", () => {
  it("› a desk dropped under the loft is stored on the floor", () => {
    // On the loft it would fit too (2.15–2.90 under the 3.05 ceiling): the floor comes first.
    const shell = shellOf(studio());
    shell.ui({ type: "pickKind", kind: "desk" });
    shell.moveTo({ x: 2.9, y: 1.25 });
    expect(ghost(shell)).toMatchObject({ fits: true, surface: null });
    shell.click({ x: 2.9, y: 1.25 });
    expect(pin(only(shell, "desk"))).toEqual({ at: { x: 2.9, y: 1.55 }, rotation: 0, deck: null });
  });

  it("› a wheel well over the platform stays on the floor, red, and a click places none (knownbugs AC-13)", () => {
    const shell = shellOf(studio());
    shell.ui({ type: "pickKind", kind: "wheelWell" });
    shell.moveTo({ x: 5.7, y: 0.9 });
    expect(ghost(shell)).toMatchObject({ fits: false, surface: null });
    shell.click({ x: 5.7, y: 0.9 });
    expect(Object.values(shell.doc().objects).filter((o) => o.kind === "wheelWell")).toEqual([]);
  });

  it("› a chair dropped on the platform is stored on the platform, and its ghost was blue there", () => {
    const shell = shellOf(studio());
    shell.ui({ type: "pickKind", kind: "chair" });
    shell.moveTo({ x: 5.7, y: 0.9 });
    expect(ghost(shell)).toMatchObject({ fits: true, surface: PLAT });
    expect(overlays(shell).filter((p) => p.kind === "polygon" && p.color === COLORS.ghostFill)).toHaveLength(1);
    expect(overlays(shell).filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill)).toEqual([]);
    shell.click({ x: 5.7, y: 0.9 });
    expect(pin(only(shell, "chair"))).toEqual({ at: { x: 5.7, y: 1.125 }, rotation: 0, deck: PLAT });
  });

  it("a chair whose side crosses the window wall on the platform turns its back to it, flush on the platform", () => {
    // x 6.475–6.925: its right side is across the face at 6.9. Turned, x 6.45–6.9, it fits only on the platform.
    const shell = shellOf(studio());
    shell.ui({ type: "pickKind", kind: "chair" });
    shell.click({ x: 6.7, y: 0.8 });
    expect(pin(only(shell, "chair"))).toEqual({ at: { x: 6.9, y: 0.8 }, rotation: 270, deck: PLAT });
  });

  it("a footprint drawn on the platform is stored on it", () => {
    const shell = shellOf(studio());
    shell.ui({ type: "pickKind", kind: "block" });
    shell.drag({ x: 5, y: 0.4 }, { x: 5.6, y: 1 });
    expect(only(shell, "block")).toMatchObject({ deck: PLAT });
  });

  it("a ghost over the partition at the floor level no longer lands on the loft: it meets the partition, refused", () => {
    // A nightstand across the partition (x 1.775–2.225) meets its wall on the floor; the loft (2.15) is the upper
    // level's, no candidate at the floor (levels.08). Before levels it landed on the loft and drew dashed, above the
    // cut; step 10 lands it there when the loft is viewed.
    const shell = shellOf(studio());
    shell.ui({ type: "pickKind", kind: "nightstand" });
    shell.moveTo({ x: 2, y: 1.2 });
    expect(ghost(shell)).toMatchObject({ fits: false, surface: null });
    shell.click({ x: 2, y: 1.2 });
    expect(placed(shell, "nightstand")).toEqual([]);
  });

  it("› with the loft viewed, the ghost over the partition stands on the loft and draws as a piece of that level", () => {
    // On the loft, 2.15–2.75 across the loft's cut at 2.60 (2.15 + half of the 0.90 left under the ceiling): filled with
    // its symbol, as the plan draws it there, not dashed as from the floor (above the floor's cut, levels.37).
    const shell = shellOf(studio());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.ui({ type: "pickKind", kind: "nightstand" });
    shell.moveTo({ x: 2, y: 1.2 });
    expect(ghost(shell)).toMatchObject({ fits: true, surface: LOFT });
    expect(overlays(shell).filter((p) => p.kind === "polygon" && p.color === COLORS.ghostFill)).toHaveLength(1);
    expect(overlays(shell).filter((p) => p.kind === "segment" && p.dash !== undefined)).toEqual([]);
    shell.click({ x: 2, y: 1.2 });
    expect(only(shell, "nightstand")).toMatchObject({ deck: LOFT });
  });
});

describe("dragging one piece lands it (decks.11)", () => {
  it("› a sofa dragged near the platform snaps flush onto it", () => {
    // The sofa on the floor above the platform, x 4.35–6.45, y 1.5–2.4. Dropped with its front 0.10 m off the window
    // wall (y 0.2–1.1), the snap turns its back to the wall and lands it flush, on the platform: only there does it fit.
    const shell = shellOf(studio(place("sofa", "sofa", { x: 5.4, y: 2.4 }, null)));
    shell.drag({ x: 5.4, y: 1.95 }, { x: 5.7, y: 0.65 });
    expect(pin(only(shell, "sofa"))).toEqual({ at: { x: 5.7, y: 0.1 }, rotation: 180, deck: PLAT });
  });

  it("› at the loft, a bed on the loft dragged along it stays on the loft", () => {
    // From x 0.35–1.65 to x 2.25–3.55, over the main room's side of the loft.
    const shell = loftShellOf(studio(...bedOnLoft({ x: 1, y: 2.4 })));
    shell.drag({ x: 1, y: 1.8 }, { x: 2.9, y: 1.8 });
    expect(pin(shell.doc().placements["bed/p0"])).toEqual({ at: { x: 2.9, y: 2.4 }, rotation: 0, deck: LOFT });
  });

  it("› a chair on the platform dragged off it over free floor lands on the floor", () => {
    // From x 5.475–5.925 on the platform to x 3.775–4.225, below y 1.4: the free floor left of the platform.
    const shell = shellOf(studio(place("c", "chair", { x: 5.7, y: 1.025 }, PLAT)));
    shell.drag({ x: 5.7, y: 0.8 }, { x: 4, y: 0.8 });
    expect(pin(shell.doc().placements["c/p0"])).toEqual({ at: { x: 4, y: 1.025 }, rotation: 0, deck: null });
  });

  it("› dragged off the platform where the floor is taken it is refused and returns", () => {
    // A nightstand on the floor at x 3.775–4.225, y 0.6–1.0 takes the free floor left of the platform.
    const shell = shellOf(studio(place("c", "chair", { x: 5.7, y: 1.025 }, PLAT), place("n", "nightstand", { x: 4, y: 1 }, null)));
    shell.moveTo({ x: 5.7, y: 0.8 });
    shell.down({ x: 5.7, y: 0.8 });
    shell.moveTo({ x: 4, y: 0.8 });
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind === "moving" ? t.state.attempt.ok : null).toBe(false);
    shell.up({ x: 4, y: 0.8 });
    expect(pin(shell.doc().placements["c/p0"])).toEqual({ at: { x: 5.7, y: 1.025 }, rotation: 0, deck: PLAT });
  });

  it("› at the loft, a bed on the loft flush with the end wall snaps flush and is accepted", () => {
    // From x 0.4–1.7 dragged 0.20 m left (x 0.2–1.5): the corner snap slides it flush with the end wall at 0.1, which is
    // also the loft's edge; its corner computes to 0.09999999999999998, inside the loft only within the tolerance.
    const shell = loftShellOf(studio(...bedOnLoft({ x: 1.05, y: 2.4 })));
    shell.drag({ x: 1.05, y: 1.8 }, { x: 0.85, y: 1.8 });
    expect(pin(shell.doc().placements["bed/p0"])).toEqual({ at: { x: 0.75, y: 2.4 }, rotation: 0, deck: LOFT });
  });
});

describe("the rotation grip lands its piece (decks.11)", () => {
  /** Selects the piece at `centre` and drags its rotation grip a quarter turn counter-clockwise about it. */
  function quarterTurn(shell: FakeShell, centre: Point): void {
    shell.click(centre);
    const grip = handles(shell.state, shell.doc()).find((h) => h.kind === "rotate")?.at;
    if (!grip) throw new Error("no rotation grip");
    const r = { x: grip.x - centre.x, y: grip.y - centre.y };
    shell.drag(grip, { x: centre.x - r.y, y: centre.y + r.x });
  }

  it("› the rotation grip of a piece on the platform keeps it there", () => {
    const shell = shellOf(studio(place("c", "chair", { x: 5.7, y: 1.025 }, PLAT)));
    quarterTurn(shell, { x: 5.7, y: 0.8 });
    expect(shell.doc().placements["c/p0"]).toMatchObject({ rotation: 90, deck: PLAT });
  });

  it("at the loft, a nightstand on the loft turned over the main room's side stays on the loft", () => {
    // x 2.775–3.225, y 1.0–1.4 on the loft, over the main room's floor. (Turned past the loft's edge it is refused:
    // landing-at-level.test.ts; the floor level doesn't grab a loft's piece, shown.02.)
    const shell = loftShellOf(studio(place("n", "nightstand", { x: 3, y: 1.4 }, LOFT)));
    quarterTurn(shell, { x: 3, y: 1.2 });
    expect(shell.doc().placements["n/p0"]).toMatchObject({ rotation: 90, deck: LOFT });
  });
});

describe("group drags, nudges and duplicates keep each piece's surface (decks.11)", () => {
  /** Two chairs on the platform, centred on (5.2, 0.8) and (6.2, 0.8), both selected. */
  function twoChairs(): FakeShell {
    const shell = shellOf(studio(place("a", "chair", { x: 5.2, y: 1.025 }, PLAT), place("b", "chair", { x: 6.2, y: 1.025 }, PLAT)));
    shell.click({ x: 5.2, y: 0.8 });
    shell.click({ x: 6.2, y: 0.8 }, { shift: true });
    return shell;
  }

  it("› a group drag of two pieces on the platform keeps both on it, and is refused when one leaves it", () => {
    const shell = twoChairs();
    shell.drag({ x: 5.2, y: 0.8 }, { x: 5.4, y: 0.9 });
    expect(pin(shell.doc().placements["a/p0"])).toEqual({ at: { x: 5.4, y: 1.125 }, rotation: 0, deck: PLAT });
    expect(pin(shell.doc().placements["b/p0"])).toEqual({ at: { x: 6.4, y: 1.125 }, rotation: 0, deck: PLAT });
    // 1.20 m left, a lies at x 3.975–4.425, wholly off the platform (from 4.5) on free floor, where it alone would land;
    // b stays on the platform.
    shell.drag({ x: 5.4, y: 0.9 }, { x: 4.2, y: 0.9 });
    expect(pin(shell.doc().placements["a/p0"])).toEqual({ at: { x: 5.4, y: 1.125 }, rotation: 0, deck: PLAT });
    expect(pin(shell.doc().placements["b/p0"])).toEqual({ at: { x: 6.4, y: 1.125 }, rotation: 0, deck: PLAT });
  });

  it("at the loft, an arrow nudge of a piece on the loft keeps it there", () => {
    // x 2.775–3.225 on the loft, over the main room's free floor.
    const shell = loftShellOf(studio(place("n", "nightstand", { x: 3, y: 1.4 }, LOFT)));
    shell.click({ x: 3, y: 1.2 });
    shell.key("ArrowLeft");
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(shell.state.undo.past).toHaveLength(1);
    const p = shell.doc().placements["n/p0"];
    expect([p?.at.x.toFixed(3), p?.at.y, p?.deck]).toEqual(["2.990", 1.4, LOFT]);
  });

  it("at the loft, a duplicate dropped off its source's deck is refused, though the floor there is free", () => {
    // The copy at x 3.975–4.425, y 1.8–2.2, beyond the loft's edge at 3.6: it keeps the loft and lies outside it.
    const shell = loftShellOf(studio(place("n", "nightstand", { x: 1, y: 2.4 }, LOFT)));
    shell.click({ x: 1, y: 2.2 });
    shell.key("d", { meta: true });
    shell.moveTo({ x: 4.2, y: 2 });
    shell.click({ x: 4.2, y: 2 });
    expect(shell.view().toast).toBe("Nightstand lies outside Loft in Layout");
    expect(placed(shell, "nightstand").map((p) => p.id)).toEqual(["n/p0"]);
  });

  it("› at the loft, a duplicate of a piece on the loft stands on the loft", () => {
    // The copy at x 0.775–1.225, y 0.8–1.2 would fit on the end's floor too.
    const shell = loftShellOf(studio(place("n", "nightstand", { x: 1, y: 2.4 }, LOFT)));
    shell.click({ x: 1, y: 2.2 });
    shell.key("d", { meta: true });
    shell.moveTo({ x: 1, y: 1 });
    // Its ghost stands on the loft too: filled, a piece of the level viewed.
    expect(overlays(shell).filter((p) => p.kind === "polygon" && p.color === COLORS.ghostFill).length).toBeGreaterThan(0);
    shell.click({ x: 1, y: 1 });
    const copies = placed(shell, "nightstand").filter((p) => p.id !== "n/p0");
    expect(copies.map(pin)).toEqual([{ at: { x: 1, y: 1.2 }, rotation: 0, deck: LOFT }]);
  });
});
