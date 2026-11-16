import { describe, expect, it } from "vitest";
import { type Command, type Document } from "@fm/domain";
import { dragTry } from "../src/tools/drag";
import { handles } from "../src/view/handles";
import { cabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The Hole tool (AC-10, AC-11, smalls.12): its own tool, on the level in view. The Loft runs x 0.1–2.1, y 0.1–2.9, top 2.15;
// the platform x 2.5–3.5, y 1–2, top 0.45, which isn't a level of its own.

const LOFT = "loft/k0";
const PLAT = "plat/k0";
const platform: Command = { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3, y: 1.5 }, w: 1, d: 1 };
const inLoft: Command = { type: "addDeckHole", opId: "a", deck: LOFT, at: { x: 1, y: 1.5 }, w: 0.6, d: 0.6 };
const inPlatform: Command = { type: "addDeckHole", opId: "p", deck: PLAT, at: { x: 3, y: 1.5 }, w: 0.4, d: 0.4 };
const shellOf = (...more: Command[]): FakeShell => FakeShell.withDocument(withCommands(cabinDoc(), platform, ...more));
const atLoft = (s: FakeShell): FakeShell => {
  s.ui({ type: "setViewedLevel", deck: LOFT });
  return s;
};
const holes = (d: Document): { id: string; deck: string; at: { x: number; y: number } }[] => Object.values(d.deckHoles);
const drag = (s: FakeShell, from: { x: number; y: number }, to: { x: number; y: number }, mods = {}): void => {
  s.moveTo(from);
  s.down(from, mods);
  s.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, mods);
  s.moveTo(to, mods);
  s.up(to, mods);
};

describe("the tool (AC-10)", () => {
  it("H picks it and the view stays on the Loft", () => {
    const s = atLoft(shellOf());
    s.key("h");
    expect(s.state.tool.name).toBe("hole");
    expect(s.state.viewedDeck).toBe(LOFT);
  });

  it("at the Loft a drag cuts that loft, selects the hole, and the view stays", () => {
    const s = atLoft(shellOf());
    s.key("h");
    drag(s, { x: 0.6, y: 0.6 }, { x: 1.2, y: 1.2 });
    const [hole] = holes(s.doc());
    expect(hole?.deck).toBe(LOFT);
    expect(s.state.selection).toEqual([{ table: "deckHoles", id: hole?.id }]);
    expect(s.state.viewedDeck).toBe(LOFT);
    expect(s.state.tool.name).toBe("hole");
  });

  it("at the Loft a press over another deck cuts nothing and says why", () => {
    const s = atLoft(shellOf());
    s.key("h");
    drag(s, { x: 2.8, y: 1.2 }, { x: 3.2, y: 1.8 });
    expect(holes(s.doc())).toEqual([]);
    expect(s.view().toast).not.toBeNull();
  });

  it("at the floor it cuts the deck under the press, a platform or a loft, and the view stays", () => {
    const s = shellOf();
    s.key("h");
    drag(s, { x: 2.8, y: 1.2 }, { x: 3.2, y: 1.8 });
    drag(s, { x: 0.6, y: 0.6 }, { x: 1.2, y: 1.2 });
    expect(holes(s.doc()).map((h) => h.deck).sort()).toEqual([LOFT, PLAT].sort());
    expect(s.state.viewedDeck).toBeNull();
  });

  it("a click cuts the 1.00 × 1.00 at the Loft too", () => {
    const s = atLoft(shellOf());
    s.key("h");
    s.click({ x: 1, y: 1.5 });
    expect(holes(s.doc())[0]?.deck).toBe(LOFT);
  });

  it("Esc drops a press, then picks Select", () => {
    const s = atLoft(shellOf());
    s.key("h");
    s.moveTo({ x: 0.6, y: 0.6 });
    s.down({ x: 0.6, y: 0.6 });
    s.moveTo({ x: 1.2, y: 1.2 });
    s.key("Escape");
    expect(s.state.tool).toMatchObject({ name: "hole", state: { kind: "idle" } });
    s.up({ x: 1.2, y: 1.2 });
    expect(holes(s.doc())).toEqual([]);
    s.key("Escape");
    expect(s.state.tool.name).toBe("select");
  });

  it("changing level keeps the tool and drops a press", () => {
    const s = shellOf();
    s.key("h");
    s.moveTo({ x: 0.6, y: 0.6 });
    s.down({ x: 0.6, y: 0.6 });
    s.moveTo({ x: 1.2, y: 1.2 });
    s.ui({ type: "setViewedLevel", deck: LOFT });
    expect(s.state.tool).toMatchObject({ name: "hole", state: { kind: "idle" } });
  });

  it("the Deck tool offers Platform and Loft, and still jumps to the floor", () => {
    const s = atLoft(shellOf());
    expect(s.view().deckPresets.map((p) => p.label)).toEqual(["Platform", "Loft"]);
    s.key("k");
    expect(s.state.tool.name).toBe("deck");
    expect(s.state.viewedDeck).toBeNull();
  });

  it("is off with no deck in the drawing: its button says so, and H does nothing", () => {
    const none = FakeShell.withDocument(withCommands(cabinDoc(), { type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] }));
    expect(none.view().tools.find((t) => t.tool === "hole")?.disabled).toBe(true);
    none.key("h");
    expect(none.state.tool.name).toBe("select");
    expect(shellOf().view().tools.find((t) => t.tool === "hole")?.disabled).toBeFalsy();
  });
});

describe("editing at the Loft (AC-11)", () => {
  it("a click selects a hole in it, with its side grips", () => {
    const s = atLoft(shellOf(inLoft));
    s.click({ x: 1, y: 1.5 });
    expect(s.state.selection).toEqual([{ table: "deckHoles", id: "a/h0" }]);
    expect(handles(s.state, s.doc()).filter((h) => h.kind === "holeSide")).toHaveLength(4);
  });

  it("a hole in another deck can't be selected from there", () => {
    const s = atLoft(shellOf(inPlatform));
    s.click({ x: 3, y: 1.5 });
    expect(s.state.selection.some((r) => r.table === "deckHoles")).toBe(false);
  });

  it("over a platform's hole directly below, a click reaches the loft's own", () => {
    const s = atLoft(FakeShell.withDocument(withCommands(cabinDoc(),
      { type: "addDeckHole", opId: "a", deck: LOFT, at: { x: 1, y: 1.5 }, w: 1.4, d: 1.4 },
      { type: "addDeck", opId: "aa", preset: "platform", at: { x: 1, y: 1.5 }, w: 1, d: 1 }, // stands in that hole; its ID sorts before the loft's
      { type: "addDeckHole", opId: "below", deck: "aa/k0", at: { x: 1, y: 1.5 }, w: 0.5, d: 0.5 },
    )));
    s.click({ x: 1, y: 1.5 });
    expect(s.state.selection).toEqual([{ table: "deckHoles", id: "a/h0" }]);
  });

  it("a selected hole drags and nudges, and the view stays", () => {
    const s = atLoft(shellOf(inLoft));
    s.click({ x: 1, y: 1.5 });
    drag(s, { x: 1, y: 1.5 }, { x: 1.2, y: 1.5 });
    expect(holes(s.doc())[0]?.at.x).toBeCloseTo(1.2, 1);
    const x = holes(s.doc())[0]?.at.x ?? 0;
    s.key("ArrowRight");
    expect(s.state.viewedDeck).toBe(LOFT);
    const tool = s.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("nudging");
    expect(x).toBeGreaterThan(1);
  });

  it("a side grip resizes it", () => {
    const s = atLoft(shellOf(inLoft));
    s.click({ x: 1, y: 1.5 });
    const grip = handles(s.state, s.doc()).find((h) => h.kind === "holeSide" && h.side === "right");
    if (!grip) throw new Error("no grip");
    drag(s, grip.at, { x: grip.at.x + 0.2, y: grip.at.y });
    const row = Object.values(s.doc().deckHoles)[0];
    expect(row?.w).toBeCloseTo(0.8, 1);
  });

  it("its snap marker shows there too", () => {
    const s = atLoft(shellOf(inLoft));
    s.click({ x: 1, y: 1.5 });
    const { snap } = dragTry(s.state, s.doc(), { kind: "hole", holeId: "a/h0" }, { x: 1, y: 1.5 }, { x: 0.41, y: 1.5 }, 0);
    expect(snap).toMatchObject({ kind: "edge", word: "Edge", point: { x: expect.closeTo(0.1, 3) } });
  });

  it("its Properties row selects it and stays at a level that can; for a platform's hole it goes to the floor", () => {
    const s = atLoft(shellOf(inLoft, inPlatform));
    s.ui({ type: "selectHole", id: "a/h0" });
    expect(s.state.selection).toEqual([{ table: "deckHoles", id: "a/h0" }]);
    expect(s.state.viewedDeck).toBe(LOFT);
    s.ui({ type: "selectHole", id: "p/h0" });
    expect(s.state.selection).toEqual([{ table: "deckHoles", id: "p/h0" }]);
    expect(s.state.viewedDeck).toBeNull();
  });

  it("the right-click list offers it there", () => {
    const s = atLoft(shellOf(inLoft));
    s.moveTo({ x: 1, y: 1.5 });
    s.down({ x: 1, y: 1.5 }, {}, 2);
    s.up({ x: 1, y: 1.5 }, {}, 2);
    expect(s.view().underPointer?.rows.map((r) => r.label)).toContain("Hole");
  });

  it("at the floor a hole stays editable, as today", () => {
    const s = shellOf(inPlatform, inLoft);
    s.click({ x: 3, y: 1.5 });
    expect(s.state.selection).toEqual([{ table: "deckHoles", id: "p/h0" }]);
  });
});
