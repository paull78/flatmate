import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, type Document } from "@fm/domain";
import { dragTry } from "../src/tools/drag";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A hole's snap says so (AC-03): landing on its deck's edge or another hole's side, a drag shows the marker and the word
// at the spot. The deck runs x 1–5, y 0.5–3.5; the hole "a" x 2–3, y 1–2, and "b" x 3.5–4.2, y 1.4–2.4.

const DECK = "d/k0";
const doc = (): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 6, 4, "r"),
  { type: "addDeck", opId: "d", preset: "loft", at: { x: 3, y: 2 }, w: 4, d: 3 },
  { type: "addDeckHole", opId: "a", deck: DECK, at: { x: 2.5, y: 1.5 }, w: 1, d: 1 },
  { type: "addDeckHole", opId: "b", deck: DECK, at: { x: 3.85, y: 1.9 }, w: 0.7, d: 1 },
);
const shell = (): FakeShell => FakeShell.withDocument(doc());
const A = "a/h0";
const texts = (s: FakeShell): string[] => s.scene().layers.flatMap((l) => l.primitives.flatMap((p) => (p.kind === "text" ? [p.text] : [])));

describe("dragging a hole", () => {
  it("its body on the deck's edge says Edge, at that side's middle", () => {
    const s = shell();
    const { snap } = dragTry(s.state, s.doc(), { kind: "hole", holeId: A }, { x: 2.5, y: 1.5 }, { x: 1.51, y: 1.5 }, 0);
    expect(snap).toMatchObject({ kind: "edge", word: "Edge", point: { x: 1, y: 1.5 } });
  });

  it("its body on another hole's side says Hole", () => {
    const s = shell();
    const { snap } = dragTry(s.state, s.doc(), { kind: "hole", holeId: A }, { x: 2.5, y: 1.5 }, { x: 2.99, y: 1.5 }, 0);
    expect(snap).toMatchObject({ kind: "edge", word: "Hole", point: { x: 3.5, y: 1.5 } });
  });

  it("its side grip on the deck's edge says Edge", () => {
    const s = shell();
    const { snap } = dragTry(s.state, s.doc(), { kind: "holeSide", holeId: A, side: "left" }, { x: 2, y: 1.5 }, { x: 1.01, y: 1.5 }, 0);
    expect(snap).toMatchObject({ kind: "edge", word: "Edge", point: { x: 1 } });
  });

  it("off the lines: no marker", () => {
    const s = shell();
    expect(dragTry(s.state, s.doc(), { kind: "hole", holeId: A }, { x: 2.5, y: 1.5 }, { x: 2.3, y: 1.5 }, 0).snap).toBeNull();
    expect(dragTry(s.state, s.doc(), { kind: "holeSide", holeId: A, side: "left" }, { x: 2, y: 1.5 }, { x: 1.7, y: 1.5 }, 0).snap).toBeNull();
  });

  it("a side grip names only the side it moves, not the flush one opposite", () => {
    const flush = withCommands(doc(), { type: "setDeckHole", holeId: A, at: { x: 1.5, y: 1.5 }, w: 1, d: 1 }); // its left is on the edge
    const s = FakeShell.withDocument(flush);
    expect(dragTry(s.state, s.doc(), { kind: "holeSide", holeId: A, side: "right" }, { x: 2, y: 1.5 }, { x: 2.3, y: 1.5 }, 0).snap).toBeNull();
  });
});

describe("drawing a hole", () => {
  const draw = (s: FakeShell, to: { x: number; y: number }, mods = {}): void => {
    s.ui({ type: "pickTool", tool: "hole" });
    s.moveTo({ x: 2, y: 2.6 });
    s.down({ x: 2, y: 2.6 });
    s.moveTo(to, mods);
  };

  it("the corner on the deck's edge shows the marker and the word in the scene", () => {
    const s = shell();
    draw(s, { x: 2.8, y: 3.49 });
    expect(s.state.snap).toMatchObject({ kind: "edge", word: "Edge", point: { y: 3.5 } });
    expect(texts(s)).toContain("Edge");
  });

  it("the corner on another hole's side says Hole", () => {
    const s = shell();
    draw(s, { x: 3.49, y: 3 });
    expect(s.state.snap).toMatchObject({ kind: "edge", word: "Hole" });
  });

  it("with Ctrl nothing snaps, so nothing says so", () => {
    const s = shell();
    draw(s, { x: 2.8, y: 3.49 }, { ctrl: true });
    expect(s.state.snap).toBeNull();
    draw(s, { x: 2.8, y: 3.5 }, { ctrl: true }); // exactly on the line, but nothing snapped it
    expect(s.state.snap).toBeNull();
  });

  it("it's gone after the release and after Esc", () => {
    const s = shell();
    draw(s, { x: 2.8, y: 3.49 });
    s.up({ x: 2.8, y: 3.49 });
    expect(s.state.snap).toBeNull();
    const t = shell();
    draw(t, { x: 2.8, y: 3.49 });
    t.key("Escape");
    expect(t.state.snap).toBeNull();
  });

  it("a Deck, not a hole, shows none", () => {
    const s = shell();
    s.ui({ type: "pickDeckPreset", preset: "platform" });
    s.moveTo({ x: 5.2, y: 1 });
    s.down({ x: 5.2, y: 1 });
    s.moveTo({ x: 5.6, y: 2 });
    expect(s.state.snap).toBeNull();
  });
});
