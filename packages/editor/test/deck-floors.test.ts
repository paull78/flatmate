import { describe, expect, it } from "vitest";
import { levelOf, motifDefaults, pointInPolygon, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, pictureLayers, planPicture } from "../src/view/picture";
import { floorView } from "../src/view/plan-view";
import { LAYER_ORDER } from "../src/view/scene";
import type { LayerName, Primitive, Scene } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Deck finishes on the plan and on paper (deck-floors.01, .06; AC-02, AC-08, AC-11): a deck draws its finish only where
// the viewed level owns it, in its own layer between the zone fills and the decks' edges, in place of its tint.
//
// The 5.8 × 3.8 shell (roomDoc, ceiling 2.50): a platform P (0.45) over x 0.5–2.5, y 0.3–1.7 with a hole over
// x 1.3–1.7, y 0.8–1.2; a loft A (2.15) over x 3.2–4.8, y 0.2–1.8; a loft B (2.30) over x 3.2–4.8, y 2.4–3.6.

const PLANKS = motifDefaults("planks");
const P = "p/k0";
const A = "a/k0";
const B = "b/k0";

function studio(...more: Command[]): Document {
  return withCommands(
    roomDoc(),
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 1.5, y: 1 }, w: 2, d: 1.4 },
    { type: "addDeckHole", opId: "h", deck: P, at: { x: 1.5, y: 1 }, w: 0.4, d: 0.4 },
    { type: "addDeck", opId: "a", preset: "loft", at: { x: 4, y: 1 }, w: 1.6, d: 1.6 },
    { type: "addDeck", opId: "b", preset: "loft", at: { x: 4, y: 3 }, w: 1.6, d: 1.2, top: 2.3 },
    ...more,
  );
}
const finished = (...ids: string[]): Command[] => ids.map((deckId): Command => ({ type: "setDeckFinish", deckId, finish: PLANKS }));

const layer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];
const at = (shell: FakeShell, deck: string | null): FakeShell => {
  shell.ui({ type: "setViewedLevel", deck });
  return shell;
};
const pointsOf = (p: Primitive): readonly Point[] => (p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "text" ? [p.at] : [p.center]);
const inBox = (p: Primitive, x0: number, x1: number, y0: number, y1: number): boolean => pointsOf(p).every((q) => q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && q.y >= y0 - 1e-6 && q.y <= y1 + 1e-6);
const tints = (ps: readonly Primitive[], x0: number, x1: number, y0: number, y1: number) =>
  ps.filter((p) => p.kind === "polygon" && p.color === CANVAS_STYLE.deck.tint && inBox(p, x0, x1, y0, y1));
const onP = (ps: readonly Primitive[]) => ps.filter((p) => inBox(p, 0.5, 2.5, 0.3, 1.7));
const onA = (ps: readonly Primitive[]) => ps.filter((p) => inBox(p, 3.2, 4.8, 0.2, 1.8));
const onB = (ps: readonly Primitive[]) => ps.filter((p) => inBox(p, 3.2, 4.8, 2.4, 3.6));
const HOLE: Point[] = [{ x: 1.3, y: 0.8 }, { x: 1.7, y: 0.8 }, { x: 1.7, y: 1.2 }, { x: 1.3, y: 1.2 }];

describe("deck finishes on the plan (AC-02)", () => {
  it("the fixture: the platform belongs to the floor, A and B make the +2.15 and +2.30 levels", () => {
    const doc = studio();
    expect(levelOf(doc, P).height).toBe(0);
    expect([levelOf(doc, A).height, levelOf(doc, B).height]).toEqual([2.15, 2.3]);
  });

  it("a finished platform at the floor draws its pattern and no tint, its hole cut out; unfinished, the tint", () => {
    const plain = FakeShell.withDocument(studio()).scene();
    expect(tints(layer(plain, "decks"), 0.5, 2.5, 0.3, 1.7)).toHaveLength(1); // the fixture changes the answer
    expect(onP(layer(plain, "deckFloors"))).toEqual([]);

    const scene = FakeShell.withDocument(studio(...finished(P))).scene();
    expect(tints(layer(scene, "decks"), 0.5, 2.5, 0.3, 1.7)).toEqual([]);
    const floors = onP(layer(scene, "deckFloors"));
    const fill = floors.find((p) => p.kind === "polygon" && p.color === PLANKS.colour);
    expect(fill?.kind === "polygon" ? fill.holes : []).toHaveLength(1);
    const lines = floors.filter((p) => p.kind === "segment");
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) if (l.kind === "segment") expect(pointInPolygon({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 }, HOLE)).toBe(false);
  });

  it("a finished loft draws at its own level; at the floor only its dashed outline, no pattern", () => {
    const doc = studio(...finished(A));
    expect(onA(layer(FakeShell.withDocument(doc).scene(), "deckFloors"))).toEqual([]);
    const loft = at(FakeShell.withDocument(doc), A).scene();
    expect(onA(layer(loft, "deckFloors")).length).toBeGreaterThan(0);
    expect(tints(layer(loft, "decks"), 3.2, 4.8, 0.2, 1.8)).toEqual([]);
  });

  it("a finished +2.30 loft seen from the +2.15 level keeps its tint and draws no pattern there; at its level it does", () => {
    const doc = studio(...finished(B));
    const low = at(FakeShell.withDocument(doc), A).scene();
    expect(tints(layer(low, "decks"), 3.2, 4.8, 2.4, 3.6)).toHaveLength(1);
    expect(onB(layer(low, "deckFloors"))).toEqual([]);
    expect(onB(layer(at(FakeShell.withDocument(doc), B).scene(), "deckFloors")).length).toBeGreaterThan(0);
  });

  it("the deck floors come after the ghosts and zone fills and before the decks' edges, so no ghost line crosses a loft's finish", () => {
    const order = (n: LayerName): number => LAYER_ORDER.indexOf(n);
    expect(order("ghosts")).toBeLessThan(order("deckFloors"));
    expect(order("zoneFills")).toBeLessThan(order("deckFloors"));
    expect(order("deckFloors")).toBeLessThan(order("decks"));
  });

  it("the Finishes switch off draws the tint and no pattern", () => {
    const shell = FakeShell.withDocument(studio(...finished(P)));
    shell.ui({ type: "setFinishesOn", on: false });
    expect(onP(layer(shell.scene(), "deckFloors"))).toEqual([]);
    expect(tints(layer(shell.scene(), "decks"), 0.5, 2.5, 0.3, 1.7)).toHaveLength(1);
  });
});

describe("deck finishes on paper (AC-08)", () => {
  const doc = studio(...finished(P));
  const view = floorView(doc, "s0");

  it("the PDF sheet's picture (the floor) draws the platform's pattern before the decks' edges; Without, the tint", () => {
    const pic = planPicture(doc, view, PRESENTATION_STYLE, 50, true);
    const fill = pic.deckFloors.find((p) => p.kind === "polygon" && p.color === PLANKS.colour);
    expect(fill).toBeDefined();
    const all = pictureLayers(pic);
    const firstEdge = pic.decks[0];
    if (!fill || !firstEdge) throw new Error("no fill or no deck edge");
    expect(all.indexOf(fill)).toBeLessThan(all.indexOf(firstEdge));
    const without = planPicture(doc, view, PRESENTATION_STYLE, 50, false);
    expect(without.deckFloors).toEqual([]);
    expect(without.decks.some((p) => p.kind === "polygon" && p.color === PRESENTATION_STYLE.deck.tint && inBox(p, 0.5, 2.5, 0.3, 1.7))).toBe(true);
  });

  it("look's plan draws no deck finish", () => {
    expect(planPicture(doc, view, LOOK_STYLE, 80, true).deckFloors).toEqual([]);
  });
});

describe("a furniture drag keeps the deck floors layer (AC-11)", () => {
  it("between two frames of a chair's drag the deckFloors layer is the same array", () => {
    const shell = FakeShell.withDocument(studio(...finished(P), { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 4.5, y: 2.2 } }));
    const before = layer(shell.scene(), "deckFloors");
    expect(before.length).toBeGreaterThan(0);
    shell.moveTo({ x: 4.5, y: 2 });
    shell.down({ x: 4.5, y: 2 });
    shell.moveTo({ x: 4.7, y: 2.1 });
    const first = layer(shell.scene(), "deckFloors");
    shell.moveTo({ x: 4.9, y: 2.2 });
    expect(layer(shell.scene(), "deckFloors")).toBe(first);
    expect(first).toBe(before);
  });
});
