import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { CEILING_ID, type Document, type Wall, sameGuards } from "../src/model";
import { parseDeck, parseWall } from "../src/shape";
import { validateDocument } from "../src/validate";
import { wallRange, type Range } from "../src/queries/vertical";
import { docOf, loftStudio as studio, withDeck } from "./helpers";

// Base and top references (pillars.05, .19, .23; AC-05, AC-10, AC-11): wallRange turns a row's base (the floor or a
// deck's top) and top (the ceiling, a height from the base, or a deck's underside) into metres; validation keeps them
// sensible.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
type Place = Extract<Command, { type: "placeColumn" }>;
const post = (opId: string, x: number, y: number, extra: Partial<Place> = {}): Place => ({ type: "placeColumn", opId, at: { x, y }, width: 0.2, depth: 0.2, ...extra });
const raise = (top: number): Command => ({ type: "setDeck", deckId: "loft", top });

/** The range to the millimetre, so float sums (2.15 + 0.9) compare exactly. */
function mm(range: Range | null): Range | null {
  return range && { bottom: Math.round(range.bottom * 1000) / 1000, top: Math.round(range.top * 1000) / 1000 };
}

/** A copy of `doc` with a free-standing wall row K from (x, y0) to (x, y1), as a loft wall would be stored. */
function withRow(doc: Document, row: Partial<Wall>, x: number, y0: number, y1: number): Document {
  const wall: Wall = { id: "K", a: "Ka", b: "Kb", thickness: 0.1, top: "ceiling", base: "floor", column: false, ...row };
  return { ...doc, joints: { ...doc.joints, Ka: { id: "Ka", x, y: y0 }, Kb: { id: "Kb", x, y: y1 } }, walls: { ...doc.walls, K: wall } };
}

const messages = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => v.message);
};

describe("wallRange with bases and tops (AC-05)", () => {
  // Under the loft's open edge (body x 2.3–2.5, flush with the loft's east edge), and on the loft clear of the mattress.
  const under = run(studio(), post("u", 2.4, 1.6, { top: "loft" }));
  const both = run(under, post("o", 2.35, 0.3, { base: "loft", top: "ceiling" }));

  it("the studio fixture is valid", () => {
    expect(validateDocument(studio()).ok).toBe(true);
  });

  it("a free post under the loft with top Loft spans 0.00–2.03; one on the loft spans 2.15–3.05", () => {
    expect(both.walls["u/w0"]).toMatchObject({ base: "floor", top: "loft", column: true });
    expect(both.walls["o/w0"]).toMatchObject({ base: "loft", top: "ceiling", column: true });
    expect(mm(wallRange(both, "u/w0"))).toEqual({ bottom: 0, top: 2.03 });
    expect(mm(wallRange(both, "o/w0"))).toEqual({ bottom: 2.15, top: 3.05 });
  });

  it("after raising the loft to 2.30, 0.00–2.18 and 2.30–3.05", () => {
    const raised = run(both, raise(2.3));
    expect(mm(wallRange(raised, "u/w0"))).toEqual({ bottom: 0, top: 2.18 });
    expect(mm(wallRange(raised, "o/w0"))).toEqual({ bottom: 2.3, top: 3.05 });
  });

  it("a numeric top is a height from the base: a 0.60 post on the loft spans 2.15–2.75; setColumn sets a free column's top", () => {
    const short = run(studio(), post("o", 2.35, 0.3, { base: "loft", top: 0.6 }));
    expect(mm(wallRange(short, "o/w0"))).toEqual({ bottom: 2.15, top: 2.75 });
    const taller = run(short, { type: "setColumn", wallId: "o/w0", top: 0.8 });
    expect(mm(wallRange(taller, "o/w0"))).toEqual({ bottom: 2.15, top: 2.95 });
    expect(mm(wallRange(run(taller, { type: "setColumn", wallId: "o/w0", top: "ceiling" }), "o/w0"))).toEqual({ bottom: 2.15, top: 3.05 });
  });

  it("a row on a missing deck has no range, and validation refuses it", () => {
    const gone = withRow(studio(), { base: "gone", top: 0.9 }, 2.45, 0.6, 2);
    expect(wallRange(gone, "K")).toBeNull();
    expect(messages(gone)).toContain("Wall K stands on a missing deck");
    expect(wallRange(withRow(studio(), { top: "gone", column: true, thickness: 0.2 }, 2.4, 1.5, 1.7), "K")).toBeNull();
    expect(refusal(studio(), post("o", 2.35, 0.3, { base: "gone" }))).toBe("Deck not found");
  });
});

describe("a wall on the loft and the ceiling (AC-11)", () => {
  // A knee wall along the loft's open edge, flush with it: body x 2.40–2.50, y 0.6–2.0.
  const knee = withRow(studio(), { base: "loft", top: 0.9 }, 2.45, 0.6, 2);

  it("a 0.90 wall on the loft spans 2.15–3.05 and is valid", () => {
    expect(messages(knee)).toEqual([]);
    expect(mm(wallRange(knee, "K"))).toEqual({ bottom: 2.15, top: 3.05 });
  });

  it("raising the loft to 2.20 is refused, naming 3.10 and 3.05", () => {
    expect(refusal(knee, raise(2.2))).toBe("Wall K reaches 3.10 m; the ceiling is 3.05 m");
    const r = execute(knee, raise(2.2));
    expect(r.ok ? null : r.error.violations.find((v) => v.message.startsWith("Wall K"))?.plain).toBe("A wall reaches 3.10 m; the ceiling is 3.05 m");
  });

  it("lowering the loft moves the wall down with it", () => {
    expect(mm(wallRange(run(knee, raise(2.1)), "K"))).toEqual({ bottom: 2.1, top: 3 });
  });

  it("a floor wall keeps its old refusal against the ceiling", () => {
    expect(refusal(studio(), { type: "setWallTop", wallId: "W1", top: 3.1 })).toBe("A wall can't be taller than the 3.05 m ceiling");
  });
});

describe("on its deck (AC-10)", () => {
  it("a column on the loft reaching past its edge is refused; one flush with the edge is accepted", () => {
    expect(refusal(studio(), post("o", 2.45, 0.3, { base: "loft" }))).toBe("Column o/w0 reaches past Loft's edge");
    expect(refusal(studio(), post("o", 2.4, 0.3, { base: "loft" }))).toBe("accepted");
  });

  it("a free column on a deck stands with its centre on it; the room check is replaced", () => {
    expect(refusal(studio(), post("o", 2.65, 0.3, { base: "loft" }))).toBe("A column on Loft stands inside Loft");
  });

  it("a wall on the loft reaching past its edge is refused", () => {
    expect(messages(withRow(studio(), { base: "loft", top: 0.9 }, 2.5, 0.6, 2))).toContain("Wall K reaches past Loft's edge");
  });

  it("a post under the loft with top Loft reaching past the loft's edge is refused", () => {
    expect(refusal(studio(), post("u", 2.45, 1.6, { top: "loft" }))).toBe("Column u/w0 reaches past Loft's edge");
  });
});

describe("base and top refusals", () => {
  it("a row under 0.10 tall from its base is refused", () => {
    expect(refusal(studio(), post("o", 2.35, 0.3, { base: "loft", top: 0.05 }))).toBe("Column o/w0 is 0.05 m tall; a column is at least 0.10 m tall");
    expect(messages(withRow(studio(), { base: "loft", top: 0.05 }, 2.45, 0.6, 2))).toContain("Wall K is 0.05 m tall; a wall is at least 0.10 m tall");
  });

  it("a platform as a base is refused: it is not a level", () => {
    const doc = withDeck(studio(), { id: "plat", name: "Platform", at: [5, 1.25], w: 1, d: 1, top: 0.45, solid: true });
    expect(refusal(doc, post("p", 5, 1.25, { base: "plat" }))).toBe("Column p/w0 can't stand on Platform: only a deck at or above the 1.20 m cut holds walls and columns");
  });

  it("a platform as a top is refused: it is not a level", () => {
    const doc = withDeck(studio(), { id: "plat", name: "Platform", at: [5, 1.25], w: 1, d: 1, top: 0.45, solid: false });
    expect(refusal(doc, post("p", 5, 1.25, { top: "plat" }))).toBe("Column p/w0 can't reach up to Platform: only a deck at or above the 1.20 m cut holds walls and columns");
  });

  it("a wall with a deck top is refused, by validation and by setWallTop", () => {
    expect(messages(withRow(studio(), { top: "loft" }, 2.45, 0.6, 2))).toContain("Wall K can't reach up to a deck; only a free column on the floor can");
    // A deck ID arriving in JSON, as from MCP.
    expect(refusal(studio(), { type: "setWallTop", wallId: "W1", top: JSON.parse('"loft"') })).toBe("Only a free column on the floor reaches up to a deck");
  });

  it("a column on a deck with a deck top is refused", () => {
    expect(refusal(studio(), post("o", 2.35, 0.3, { base: "loft", top: "loft" }))).toBe("Column o/w0 can't reach up to a deck; only a free column on the floor can");
  });

  it("a deck top on an in-line column is refused; an in-line column keeps its wall's base and top", () => {
    const inLine = docOf({
      joints: [["J1", 0, 0], ["Ka", 3.85, 0], ["Kb", 4.15, 0], ["J2", 7, 0], ["J3", 7, 2.5], ["J4", 0, 2.5]],
      walls: [["W1a", "J1", "Ka"], ["W1b", "Kb", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
      columns: [["C", "Ka", "Kb", 0.3]],
    });
    const doc = withDeck({ ...inLine, ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 3.05 } } }, { id: "loft", name: "Loft", at: [1.3, 1.25], w: 2.4, d: 2.3, top: 2.15, solid: false });
    expect(validateDocument(doc).ok).toBe(true);
    expect(refusal(doc, { type: "setColumn", wallId: "C", top: "loft" })).toBe("A column in a wall's line keeps its wall's base and top");
    expect(refusal(doc, { type: "setColumn", wallId: "C", top: 2 })).toBe("A column in a wall's line keeps its wall's base and top");
    expect(refusal(doc, { type: "setColumn", wallId: "C", top: "ceiling" })).toBe("accepted");
    const column = doc.walls.C;
    if (!column) throw new Error("no column");
    expect(messages({ ...doc, walls: { ...doc.walls, C: { ...column, top: "loft" } } })).toContain("Column C can't reach up to a deck; only a free column on the floor can");
    expect(messages({ ...doc, walls: { ...doc.walls, C: { ...column, top: 2 } } })).toContain("Column C keeps the base and top of its wall's line");
  });

  it("placeColumn into a wall's line ignores base and top: it takes its wall's", () => {
    const doc = run(studio(), post("c", 4, 0, { width: 0.3, depth: 0.3, top: 2 }));
    expect(doc.walls["c/w0"]).toMatchObject({ base: "floor", top: "ceiling", column: true });
  });

  it("deck IDs are never \"ceiling\" or \"floor\": addDeck makes `<opId>/k0`, and a stored deck row named so is refused", () => {
    expect(Object.keys(run(studio(), { type: "addDeck", opId: "ceiling", preset: "platform", at: { x: 5, y: 1.25 }, w: 1, d: 1 }).decks)).toContain("ceiling/k0");
    const deck = { name: "Loft", at: { x: 1, y: 1 }, w: 1, d: 1, rotation: 0, top: 2.15, solid: false, finish: null, ...sameGuards("railing") };
    expect(parseDeck({ id: "ceiling", ...deck })).toBeNull();
    expect(parseDeck({ id: "floor", ...deck })).toBeNull();
  });

  it("a stored row's top parses as \"ceiling\", a number or a deck's ID; \"floor\" is no top", () => {
    const row = { id: "K", a: "Ka", b: "Kb", thickness: 0.2, base: "floor", column: true };
    expect(parseWall({ ...row, top: "loft/k0" })).toEqual({ ...row, top: "loft/k0" });
    expect(parseWall({ ...row, top: "floor" })).toBeNull();
  });
});
