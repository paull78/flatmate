import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, type Command, type Document } from "@fm/domain";
import type { Field, ViewModel } from "../src/view/view-model-types";
import type { Primitive } from "../src/view/scene-types";
import { COLORS } from "../src/view/colors";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Reaching a hole a stair fills (riser.20, AC-13). An 8 × 3 room under 5.40; the slab over all of it, its hole h/h0 at
// x 2.8–6, y 1–2; the flight from its back at x 6 to its foot at x 2.22, y 1.05–1.95.

const FLOOR = "floor/k0";
const HOLE = "h/h0";
const STAIR_AT = { x: 4.5, y: 1.5 };
const building = (...more: Command[]): Document => buildingOf("stair", ...more);
const buildingOf = (kind: string, ...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"),
  { type: "setCeiling", height: 5.4 },
  { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2.7 },
  { type: "addDeckHole", opId: "h", deck: FLOOR, at: { x: 4.4, y: 1.5 }, w: 3.2, d: 1 },
  { type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w: 0.9, d: 3.78 } }, at: { x: 6, y: 1.5 }, rotation: 270, deck: null, reaches: FLOOR },
  ...more,
);
const fields = (vm: ViewModel): Field[] => ("fields" in vm.properties ? vm.properties.fields : []);
const links = (shell: FakeShell): Field[] => fields(shell.view()).filter((f) => f.link !== undefined);
const selected = (shell: FakeShell) => shell.state.selection.map((r) => r.table);

/** Segments of the plan's layers after the objects' layer, in the blue a hole's mark uses, on the hole's ring. */
function marks(shell: FakeShell): { after: boolean; count: number } {
  const layers = shell.scene().layers;
  const objects = layers.findIndex((l) => l.name === "objects");
  const onRing = (p: Primitive): boolean => p.kind === "segment" && p.color === COLORS.wallSelected && [p.a, p.b].every((q) => (Math.abs(q.x - 2.8) < 1e-6 || Math.abs(q.x - 6) < 1e-6) && (Math.abs(q.y - 1) < 1e-6 || Math.abs(q.y - 2) < 1e-6));
  const found = layers.flatMap((l, i) => l.primitives.filter(onRing).map(() => i));
  return { after: found.length > 0 && Math.min(...found) > objects, count: found.length };
}

describe("the rows (AC-13)", () => {
  it("the stair's Through row names the hole it overlaps, and its size", () => {
    const shell = FakeShell.withDocument(building());
    shell.click(STAIR_AT);
    expect(links(shell).map((f) => [f.label, f.value, f.link])).toEqual([["Through", "Hole 3.20 × 1.00", HOLE]]);
  });

  it("the deck's Holes row names every hole", () => {
    const doc = building({ type: "addDeckHole", opId: "two", deck: FLOOR, at: { x: 7, y: 1.5 }, w: 0.5, d: 0.5 });
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 1, y: 0.5 });
    expect(selected(shell)).toEqual(["decks"]);
    expect(links(shell).map((f) => [f.label, f.value, f.link])).toEqual([["Holes", "Hole 3.20 × 1.00", HOLE], ["", "Hole 0.50 × 0.50", "two/h0"]]);
  });

  it("a stair with no hole, and a deck with none, have no row", () => {
    const shell = FakeShell.withDocument(withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"),
      { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "floor", preset: "loft", at: { x: 7, y: 1.5 }, w: 1.8, d: 2.8 },
      { type: "placeObject", opId: "st", state: "s0", object: { kind: "stair" }, at: { x: 6.1, y: 1.5 }, rotation: 270, deck: null, reaches: FLOOR },
    ));
    shell.click({ x: 5, y: 1.5 });
    expect(selected(shell)).toEqual(["placements"]);
    expect(links(shell)).toEqual([]);
    shell.key("Escape");
    shell.click({ x: 7, y: 1.5 });
    expect(selected(shell)).toEqual(["decks"]);
    expect(links(shell)).toEqual([]);
  });

  it("clicking a row selects the hole, with its fields", () => {
    const shell = FakeShell.withDocument(building());
    shell.click(STAIR_AT);
    shell.ui({ type: "selectHole", id: HOLE });
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: HOLE }]);
    expect(shell.view().properties.kind).toBe("hole");
  });

  it("from its deck's level it stays there, where the hole can be edited too (smalls.12)", () => {
    const shell = FakeShell.withDocument(building());
    shell.ui({ type: "setViewedLevel", deck: FLOOR });
    shell.ui({ type: "selectHole", id: HOLE });
    expect(shell.state.viewedDeck).toBe(FLOOR);
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: HOLE }]);
  });

  it("ignores a hole that has gone", () => {
    const shell = FakeShell.withDocument(building());
    shell.click(STAIR_AT);
    const before = shell.state.selection;
    shell.ui({ type: "selectHole", id: "gone" });
    expect(shell.state.selection).toEqual(before);
  });
});

describe("the mark", () => {
  it("hovering a row marks the hole over the pieces, and leaving clears it", () => {
    const shell = FakeShell.withDocument(building());
    shell.click(STAIR_AT);
    expect(marks(shell).count).toBe(0);
    shell.ui({ type: "hoverHole", id: HOLE });
    expect(marks(shell)).toEqual({ after: true, count: 4 });
    shell.ui({ type: "hoverHole", id: null });
    expect(marks(shell).count).toBe(0);
  });

  it("a selected hole's outline draws over the pieces too", () => {
    const shell = FakeShell.withDocument(building());
    shell.ui({ type: "selectHole", id: HOLE });
    expect(marks(shell)).toEqual({ after: true, count: 4 });
  });
});

describe("the click cycle (AC-13)", () => {
  it("goes stair, hole, stair", () => {
    const shell = FakeShell.withDocument(building());
    shell.click(STAIR_AT);
    expect(selected(shell)).toEqual(["placements"]);
    shell.click(STAIR_AT);
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: HOLE }]);
    shell.click(STAIR_AT);
    expect(selected(shell)).toEqual(["placements"]);
  });

  it("goes through the pieces first", () => {
    const doc = buildingOf("openStair", { type: "placeObject", opId: "b", state: "s0", object: { kind: "block", size: { w: 0.4, d: 0.4 } }, at: { x: 5.4, y: 1.7 }, rotation: 0, deck: null }); // under its underside
    const shell = FakeShell.withDocument(doc);
    const at = { x: 5.4, y: 1.5 };
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      shell.click(at);
      seen.push(shell.state.selection[0]?.table ?? "none");
    }
    expect(seen.filter((t) => t === "deckHoles")).toHaveLength(1);
    expect(seen.filter((t) => t === "placements").length).toBeGreaterThan(1);
  });

  it("a drag after the cycle moves the hole, not the stair", () => {
    const shell = FakeShell.withDocument(building());
    shell.click(STAIR_AT);
    shell.click(STAIR_AT);
    const before = shell.doc().placements;
    shell.drag(STAIR_AT, { x: 4.5, y: 1.3 });
    expect(shell.doc().placements).toEqual(before);
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: HOLE }]);
  });

  it("Shift still toggles furniture, and never takes the hole", () => {
    const shell = FakeShell.withDocument(building());
    shell.click(STAIR_AT);
    shell.click(STAIR_AT, { shift: true });
    expect(shell.state.selection).toEqual([]);
  });

  it("a bare hole is selected at the first click, as ever", () => {
    const doc = withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"), { type: "setCeiling", height: 5.4 },
      { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2.7 },
      { type: "addDeckHole", opId: "h", deck: FLOOR, at: { x: 4.4, y: 1.5 }, w: 3.2, d: 1 },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click(STAIR_AT);
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: HOLE }]);
  });
});
