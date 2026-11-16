import { beforeEach, describe, expect, it, vi } from "vitest";
import { levelOf, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { floorView, viewAt, type PlanView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { shownWarnings, warningMarks, warningRows } from "../src/view/warnings";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The count and the list (clarity.04): one row per mark in this layout at this level, a row selecting its piece or door.

const rings = vi.hoisted(() => ({ gone: false }));
// A real document never has a use zone without a ring (zoneShapes makes both), so this one case has to pretend.
vi.mock("@fm/domain", async (original) => {
  const domain = await original<typeof import("@fm/domain")>();
  return { ...domain, zoneRings: (doc: Document) => (rings.gone ? new Map() : domain.zoneRings(doc)) };
});
beforeEach(() => {
  rings.gone = false;
});

const place = (opId: string, kind: string, at: Point, more: Partial<Extract<Command, { type: "placeObject" }>> = {}): Command =>
  ({ type: "placeObject", linked: false, deck: null, opId, state: "s0", object: { kind }, at, rotation: 0, ...more });
const named = (opId: string, name: string): Command => ({ type: "renameObject", objectId: `${opId}/o0`, name });

/** A desk on the top wall, its front zone x 2.65–3.35, y 2.5–3.3, with a block standing in it (x 2.7–3.3, y 2.6–3.2). */
const blockedDesk = (): Document => withCommands(roomDoc(), place("desk", "desk", { x: 3, y: 3.9 }), place("b", "block", { x: 3, y: 3.2 }));
const BOX = { x: 3, y: 2.9 };
/** A door on the bottom wall (x 3–3.8, swinging up to y 0.9) with a chair in its swing. */
function blockedDoor(): Document {
  const base = roomDoc();
  return withCommands(base,
    { type: "addOpening", opId: "o", wall: wallBetween(base, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 3 },
    place("c", "chair", { x: 3.65, y: 0.7 }),
  );
}
/** roomDoc's shell with a Loft (top 2.15) on the left, away from the right side these tests use. */
const lofted = (...more: Command[]): Document =>
  withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.3, y: 2 }, w: 2.4, d: 3.8 }, ...more);
/** A wardrobe on the top wall (x 3.4–4.6, y 3.3–3.9), 2.20 tall so it rises past the loft and the loft shows it. */
const wardrobe = (): Command[] => [
  place("w", "wardrobe", { x: 4, y: 3.9 }),
  { type: "setObjectSize", objectId: "w/o0", w: 1.2, d: { standard: 0.6 }, h: { standard: 2.2 } },
];
const LOFT = "loft/k0";
const atLoft = (doc: Document): PlanView => viewAt("s0", levelOf(doc, LOFT));

const glyphs = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "text" && p.color === COLORS.warningGlyph);
const marksOf = (doc: Document, view: PlanView): number => glyphs(warningMarks(doc, view, 80)).length;
const overlays = (shell: FakeShell) => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const texts = (doc: Document, view: PlanView = floorView(doc, "s0")): string[] => warningRows(doc, view).map((r) => r.text);

describe("the count", () => {
  it("the count equals the marks", () => {
    const two = withCommands(blockedDoor(), place("desk", "desk", { x: 3, y: 3.9 }), place("b", "block", { x: 3, y: 3.2 }));
    const view = floorView(two, "s0");
    expect(warningRows(two, view)).toHaveLength(2);
    expect(marksOf(two, view)).toBe(2);
    expect(FakeShell.withDocument(two).view().warnings.rows).toHaveLength(2);

    // A zone with no ring has no mark and so no row.
    const base = lofted(...wardrobe(), place("c", "chair", { x: 4, y: 3.2 }));
    expect(warningRows(base, floorView(base, "s0"))).toHaveLength(1);
    rings.gone = true;
    const noRing = withCommands(base, place("c2", "chair", { x: 5, y: 2 })); // a new document: the memo keeps the last call
    expect(warningRows(noRing, floorView(noRing, "s0"))).toEqual([]);
    expect(marksOf(noRing, floorView(noRing, "s0"))).toBe(0);
    rings.gone = false;

    // A sofa under the loft's level has a mark at the floor and none at the loft; the count follows.
    const hidden = lofted(place("s", "sofa", { x: 4.5, y: 1 }));
    expect(warningRows(hidden, floorView(hidden, "s0"))).toHaveLength(marksOf(hidden, floorView(hidden, "s0")));
    expect(marksOf(hidden, floorView(hidden, "s0"))).toBe(1);
    expect(warningRows(hidden, atLoft(hidden))).toEqual([]);
    expect(marksOf(hidden, atLoft(hidden))).toBe(0);
  });

  it("zero rows on a clear plan", () => {
    expect(FakeShell.withDocument(roomDoc()).view().warnings.rows).toEqual([]);
    expect(FakeShell.withDocument(withCommands(roomDoc(), place("desk", "desk", { x: 3, y: 3.9 }))).view().warnings.rows).toEqual([]);
  });

  it("no drawing, no rows", () => {
    const shell = FakeShell.local();
    shell.state = { ...shell.state, document: null };
    expect(shell.view().warnings.rows).toEqual([]);
  });

  it("follows the layout and the level", () => {
    // The block stands in the desk's zone only in Day.
    const twoLayouts = withCommands(roomDoc(),
      { type: "addState", opId: "n", name: "Night" },
      place("desk", "desk", { x: 3, y: 3.9 }),
      place("b", "block", { x: 3, y: 3.2 }),
    );
    const shell = FakeShell.withDocument(twoLayouts);
    expect(shell.view().warnings.rows.map((r) => r.text)).toEqual(["Desk's front is blocked by Custom box"]);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(shell.view().warnings.rows).toEqual([]);
    expect(glyphs(overlays(shell))).toEqual([]);
    shell.ui({ type: "setActiveState", id: "s0" });
    expect(shell.view().warnings.rows).toHaveLength(1);

    // At the loft a sofa under it isn't listed; a wardrobe rising past it is, and names the chair under the loft (clarity.23).
    const doc = lofted(place("s", "sofa", { x: 4.5, y: 1 }), ...wardrobe(), place("c", "chair", { x: 4, y: 3.2 }));
    const lofty = FakeShell.withDocument(doc);
    expect(lofty.view().warnings.rows.map((r) => r.text)).toEqual(expect.arrayContaining(["Sofa's front is blocked by a wall", "Wardrobe's front is blocked by Chair"]));
    lofty.ui({ type: "setViewedLevel", deck: LOFT });
    expect(lofty.view().warnings.rows.map((r) => r.text)).toEqual(["Wardrobe's front is blocked by Chair"]);
    expect(glyphs(overlays(lofty))).toHaveLength(1);
  });

  it("a blocked zone on the loft is listed and marked at the loft, not at the floor (loft.07, AC-05)", () => {
    // Under a 3.50 ceiling, a desk on the loft against the top wall (x 0.7–1.9, y 3.3–3.9), its front zone y 2.5–3.3,
    // and a block on the loft standing in it (x 1.0–1.6, y 2.6–3.2).
    const doc = lofted({ type: "setCeiling", height: 3.5 },
      place("desk", "desk", { x: 1.3, y: 3.9 }, { deck: LOFT }), place("b", "block", { x: 1.3, y: 3.2 }, { deck: LOFT }));
    expect(texts(doc, atLoft(doc))).toEqual(["Desk's front is blocked by Custom box"]);
    expect(marksOf(doc, atLoft(doc))).toBe(1);
    expect(texts(doc)).toEqual([]);
    const shell = FakeShell.withDocument(doc);
    expect(shell.view().warnings.rows).toEqual([]);
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(shell.view().warnings.rows.map((r) => r.text)).toEqual(["Desk's front is blocked by Custom box"]);
  });

  it("during a drag it reads the preview", () => {
    const shell = FakeShell.withDocument(blockedDesk());
    shell.click(BOX);
    shell.moveTo(BOX);
    shell.down(BOX);
    shell.moveTo({ x: 5, y: 1.5 });
    expect(shell.view().warnings.rows).toEqual([]);
    expect(glyphs(overlays(shell))).toEqual([]);
    expect(shownWarnings(shell.doc(), floorView(shell.doc(), "s0"))).toHaveLength(1); // the committed document still warns

    shell.moveTo(BOX);
    expect(shell.view().warnings.rows).toHaveLength(1);
    expect(glyphs(overlays(shell))).toHaveLength(1);
  });

  it("the rows hold still while the document does, so a render doesn't rebuild them", () => {
    const doc = blockedDesk();
    const view = floorView(doc, "s0");
    expect(warningRows(doc, view)).toBe(warningRows(doc, view));
  });
});

describe("the words", () => {
  it("words a piece, a door, a wall, a column, two and three blockers", () => {
    const sofa = place("s", "sofa", { x: 3, y: 3.9 }); // on the top wall (y 3.0–3.9): its front zone is y 2.5–3.0
    const table = place("t", "coffeeTable", { x: 3, y: 2.6 });
    expect(texts(withCommands(roomDoc(), sofa, table))).toEqual(["Sofa's front is blocked by Coffee table"]);

    expect(texts(blockedDoor())).toEqual(["Door's swing is blocked by Chair"]);

    const facingWall = withCommands(roomDoc(), place("s", "sofa", { x: 3, y: 1 }));
    expect(texts(facingWall)).toEqual(["Sofa's front is blocked by a wall"]);

    const column = withCommands(roomDoc(), sofa, { type: "placeColumn", opId: "col", at: { x: 3, y: 2.6 }, width: 0.3, depth: 0.3 });
    expect(texts(column)).toEqual(["Sofa's front is blocked by a column"]);

    const box = (opId: string, x: number, name: string): Command[] => [
      place(opId, "block", { x, y: 2.9 }, { object: { kind: "block", size: { w: 0.2, d: 0.2 } } }),
      named(opId, name),
    ];
    const two = withCommands(roomDoc(), sofa, ...box("a", 2.4, "Lamp"), ...box("b", 3.6, "Plant"));
    expect(texts(two)).toEqual(["Sofa's front is blocked by Lamp and Plant"]);
    const three = withCommands(two, ...box("c", 3, "Pouf"));
    expect(texts(three)).toEqual(["Sofa's front is blocked by Lamp, Plant and 1 more"]);
    const four = withCommands(three, ...box("d", 2.7, "Stool"));
    expect(texts(four)).toEqual(["Sofa's front is blocked by Lamp, Plant and 2 more"]);
  });

  // The desk with its front and left zones on, a nightstand beside it, and the block in its front zone.
  const twoSides = (...more: Command[]): Document => withCommands(blockedDesk(),
    { type: "setZoneSides", placementId: "desk/p0", sides: { front: true, back: false, left: true, right: false } },
    place("n", "nightstand", { x: 2.1, y: 3.9 }),
    ...more,
  );

  it("names the side that's blocked and the piece's own name", () => {
    expect(texts(twoSides(named("desk", "Big desk")))).toEqual(["Big desk's front is blocked by Custom box", "Big desk's left is blocked by Nightstand"]);
  });

  it("a piece whose name was cleared reads as Object, as the domain's messages do", () => {
    expect(texts(withCommands(blockedDesk(), named("desk", ""), named("b", "")))).toEqual(["Object's front is blocked by Object"]);
  });

  it("keys a row by its zone, the side included", () => {
    const doc = twoSides();
    expect(warningRows(doc, floorView(doc, "s0")).map((r) => r.key)).toEqual(["desk/p0|front", "desk/p0|left"]);
  });
});

describe("selecting a row", () => {
  const rowRef = (shell: FakeShell, index = 0) => {
    const row = shell.view().warnings.rows[index];
    if (!row) throw new Error("no row");
    return row.ref;
  };

  it("selecting a row selects the piece", () => {
    const shell = FakeShell.withDocument(blockedDesk());
    shell.ui({ type: "pickTool", tool: "object" });
    shell.ui({ type: "selectEntity", ref: rowRef(shell) });
    expect(shell.state.tool.name).toBe("select");
    expect(shell.state.selection).toEqual([{ table: "placements", id: "desk/p0" }]);
    expect(shell.view().properties.kind).toBe("object");
    expect(shell.view().activeTool).toBe("select");
  });

  it("selecting a door's row selects the door", () => {
    const shell = FakeShell.withDocument(blockedDoor());
    shell.ui({ type: "selectEntity", ref: rowRef(shell) });
    expect(shell.state.selection).toEqual([{ table: "openings", id: "o/d0" }]);
    expect(shell.view().properties.kind).toBe("opening");
  });

  it("selecting a row replaces the selection", () => {
    const shell = FakeShell.withDocument(blockedDesk());
    shell.click(BOX);
    expect(shell.state.selection).toEqual([{ table: "placements", id: "b/p0" }]);
    shell.ui({ type: "selectEntity", ref: rowRef(shell) });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "desk/p0" }]);
  });

  it("selecting a row leaves the camera alone", () => {
    const shell = FakeShell.withDocument(blockedDesk());
    shell.wheel(40, 25);
    const camera = shell.state.camera;
    shell.ui({ type: "selectEntity", ref: rowRef(shell) });
    expect(shell.state.camera).toBe(camera);
  });

  it("a stale ref is pruned, not selected", () => {
    const shell = FakeShell.withDocument(blockedDesk());
    shell.ui({ type: "selectEntity", ref: { table: "placements", id: "gone/p0" } });
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().properties.kind).toBe("none");
  });

  it("a row the viewed level can't select selects nothing: a floor piece rising past the loft", () => {
    // The level's rule for selecting (levels.19) is narrower than for showing: the wardrobe is listed at the loft, but belongs to the floor.
    const shell = FakeShell.withDocument(lofted(...wardrobe(), place("c", "chair", { x: 4, y: 3.2 })));
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.ui({ type: "selectEntity", ref: rowRef(shell) });
    expect(shell.state.selection).toEqual([]);
  });
});
