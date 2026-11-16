import { describe, expect, it } from "vitest";
import { validateDocument, type Command, type Document, type LayoutObject, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { REST_TIMER } from "../src/plate";
import type { ObjectGhost } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// A new piece that fits by getting shorter (clarity.06, .10, .11; AC-07, AC-08): today's search first, and only if that
// ghost is red, a second one at the lowest allowed height. The sample room is 6 × 4 (inner faces x 0.1–5.9, y 0.1–3.9)
// under a 2.50 ceiling; the loft (hollow, top 2.15, underside 2.03) covers x 0.1–3.1, all of its depth.

const LOFT = "loft/k0";
const UNDER = { x: 1.5, y: 2 };
const CLEAR = { x: 4.5, y: 2 };

const addLoft: Command = { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.6, y: 2 }, w: 3, d: 3.8 };
/** A hollow deck over the loft's area with its top at `top` (its underside is 0.12 lower). */
const addHollow = (top: number): Command => ({ ...addLoft, opId: "low", top, solid: false });
const LOW = "low/k0";
const WALL_SHELF = "Wall shelf 80 × 25 h 30 at 150"; // the picker's label: h 0.30, z 1.50

const loftRoom = (...more: Command[]): Document => withCommands(roomDoc(), addLoft, ...more);
const ceiling = (height: number): Command => ({ type: "setCeiling", height });

function open(doc: Document, kind: string, preset?: string): FakeShell {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind });
  if (preset !== undefined) shell.ui({ type: "pickPreset", kind, preset });
  return shell;
}

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const presence = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
const plateText = (shell: FakeShell): string | null => {
  for (const p of presence(shell)) if (p.kind === "text") return p.text;
  return null;
};
const plateLine = (shell: FakeShell): unknown => presence(shell).find((p) => p.kind === "segment")?.color ?? null;

const objectsOf = (shell: FakeShell, kind: string): LayoutObject[] => Object.values(shell.doc().objects).filter((o) => o.kind === kind);
const placementOf = (shell: FakeShell, kind: string): Placement | undefined => Object.values(shell.doc().placements).find((p) => objectsOf(shell, kind).some((o) => o.id === p.object));
const heightOf = (shell: FakeShell, kind: string): number | undefined => objectsOf(shell, kind)[0]?.h.standard;
const field = (shell: FakeShell, id: string): string | undefined => {
  const { properties } = shell.view();
  return "fields" in properties ? properties.fields.find((f) => f.id === id)?.value : undefined;
};

/** Ends the Object tool and selects the piece at `at`, for Properties or a drag. */
function select(shell: FakeShell, at: Point): void {
  shell.key("Escape");
  shell.click(at);
}

describe("a piece from the library lowers to fit", () => {
  it("a wardrobe under a loft: ghost fits, label, click places 2.03 at elevation 0", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: true, surface: null, range: { bottom: 0, top: 2.03 }, lowered: { h: 2.03, from: 2.05, under: LOFT } });
    expect(plateText(shell)).toBe("H 2.03 m · default 2.05 · under Loft"); // with no rest
    expect(plateLine(shell)).toBe(COLORS.warningLine);
    shell.fireTimer(REST_TIMER); // not red, so a rest raises no refusal
    expect(shell.state.plate).toBeNull();
    shell.click(UNDER);
    expect(objectsOf(shell, "wardrobe")).toMatchObject([{ w: { standard: 1.2 }, d: { standard: 0.6 }, h: { standard: 2.03 }, z: { standard: 0 } }]);
    expect(placementOf(shell, "wardrobe")).toMatchObject({ deck: null });
    expect(shell.view().toast).toBeNull();
    select(shell, UNDER);
    expect(field(shell, "height.standard")).toBe("2.03");
  });

  it("a drawn footprint under a loft does the same", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.moveTo({ x: 0.8, y: 1.5 });
    shell.down({ x: 0.8, y: 1.5 });
    shell.moveTo({ x: 2.2, y: 2.2 });
    expect(ghost(shell)).toMatchObject({ fits: true, range: { top: 2.03 }, lowered: { h: 2.03, from: 2.05, under: LOFT } });
    expect(plateText(shell)).toBe("H 2.03 m · default 2.05 · under Loft");
    shell.up({ x: 2.2, y: 2.2 });
    const [wardrobe] = objectsOf(shell, "wardrobe");
    expect(wardrobe?.h.standard).toBe(2.03);
    expect([wardrobe?.w.standard, wardrobe?.d.standard].sort()).toEqual([0.7, 1.4]); // the drawn size, not the preset's
  });

  it("a drawn footprint too small to place stays red, even where it would fit", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.moveTo({ x: 1.5, y: 1.5 });
    shell.down({ x: 1.5, y: 1.5 });
    shell.moveTo({ x: 1.51, y: 2.2 }); // 0.01 wide, under the 0.02 minimum (hangings.03)
    expect(ghost(shell)).toMatchObject({ fits: false });
    expect(ghost(shell)?.lowered).toBeUndefined();
  });

  it("quick add's armed kind does the same", () => {
    const shell = open(loftRoom(), "wardrobe", "150 × 60"); // quick add sends pickKind and pickPreset (quick-add.ts)
    shell.click(UNDER);
    expect(objectsOf(shell, "wardrobe")).toMatchObject([{ w: { standard: 1.5 }, d: { standard: 0.6 }, h: { standard: 2.03 } }]);
  });

  it("a 2.00 m ceiling: 2.00, \"under the ceiling\"", () => {
    const shell = open(withCommands(roomDoc(), ceiling(2)), "wardrobe");
    shell.moveTo(CLEAR);
    expect(ghost(shell)).toMatchObject({ fits: true, lowered: { h: 2, from: 2.05, under: null } });
    expect(plateText(shell)).toBe("H 2.00 m · default 2.05 · under the ceiling");
    shell.click(CLEAR);
    expect(heightOf(shell, "wardrobe")).toBe(2);
  });

  it("away from the loft it keeps 2.05 with no label", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.moveTo(CLEAR);
    expect(ghost(shell)).toMatchObject({ fits: true, range: { bottom: 0, top: 2.05 } });
    expect(ghost(shell)?.lowered).toBeUndefined();
    expect(plateText(shell)).toBeNull();
    shell.click(CLEAR);
    expect(heightOf(shell, "wardrobe")).toBe(2.05);
  });

  it("straddling the loft's edge counts", () => {
    const shell = open(loftRoom(), "wardrobe");
    const edge = { x: 3.2, y: 2 }; // x 2.6–3.8, the loft ends at 3.1
    shell.moveTo(edge);
    expect(ghost(shell)).toMatchObject({ fits: true, lowered: { h: 2.03, from: 2.05, under: LOFT } });
    shell.click(edge);
    expect(heightOf(shell, "wardrobe")).toBe(2.03);
  });

  it("a preset's height is the default: a wall shelf under a 1.75 ceiling becomes 0.25, default 0.30", () => {
    const shell = open(withCommands(roomDoc(), ceiling(1.75)), "shelf", WALL_SHELF);
    shell.moveTo(CLEAR);
    expect(ghost(shell)).toMatchObject({ fits: true, range: { bottom: 1.5, top: 1.75 }, lowered: { h: 0.25, from: 0.3, under: null } });
    expect(plateText(shell)).toBe("H 0.25 m · default 0.30 · under the ceiling");
    shell.click(CLEAR);
    expect(objectsOf(shell, "shelf")).toMatchObject([{ w: { standard: 0.8 }, d: { standard: 0.25 }, h: { standard: 0.25 }, z: { standard: 1.5 } }]);
  });

  it("a preset's height is the default: under a 2.03 loft a wall shelf already fits, with no label", () => {
    const shell = open(loftRoom(), "shelf", WALL_SHELF); // top 1.80; the kind's own default (1.50 from the floor) would fit too
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: true, range: { bottom: 1.5, top: 1.8 } });
    expect(ghost(shell)?.lowered).toBeUndefined();
    shell.click(UNDER);
    expect(heightOf(shell, "shelf")).toBe(0.3);
  });

  it("the ghost tests a preset's own heights: a Bookcase, 2.00 under a 1.90 ceiling, lowers though the kind's 1.50 would fit", () => {
    const shell = open(withCommands(roomDoc(), ceiling(1.9)), "shelf", "Bookcase 80 × 30 h 200");
    shell.moveTo(CLEAR);
    expect(ghost(shell)).toMatchObject({ fits: true, lowered: { h: 1.9, from: 2, under: null } });
    shell.click(CLEAR);
    expect(heightOf(shell, "shelf")).toBe(1.9);
  });

  it("the second search never grows a piece: where it lands somewhere clear the piece keeps its default, with no label", () => {
    // The wardrobe centred on (3.55, 0.65): x 2.95–4.15, y 0.35–0.95, so 5 cm under the loft. Guides pull it 5 cm right,
    // clear of the loft (a box's left edge at x 3.0), and 10 cm up (a box's top at y 1.05), into the solid platform. At
    // 2.05 both the guided place and the pointer's are red, so that search stays at the guided one. At the lowest height the
    // pointer's fits, so the guide on one axis is tried: x alone lands clear of the loft, where 2.05 fits.
    const lower = { ...addLoft, at: { x: 1.55, y: 2 }, w: 2.9 };
    const box = (opId: string, at: Point, w: number, d: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind: "block", size: { w, d } }, at });
    const doc = withCommands(
      roomDoc(),
      lower,
      { type: "addDeck", opId: "plat", preset: "platform", at: { x: 4.2, y: 1.3 }, w: 2, d: 0.6 }, // x 3.2–5.2, y 1.0–1.6
      box("left", { x: 3.3, y: 3.4 }, 0.6, 0.5), // x 3.0–3.6, y 2.9–3.4
      box("top", { x: 5.5, y: 1.05 }, 0.5, 0.6), // x 5.25–5.75, y 0.45–1.05
    );
    const shell = open(doc, "wardrobe");
    const spot = { x: 3.55, y: 0.65 };
    shell.moveTo(spot);
    expect(ghost(shell)).toMatchObject({ fits: true, at: { x: 3.6, y: 0.95 }, range: { top: 2.05 } });
    expect(ghost(shell)?.lowered).toBeUndefined();
    expect(plateText(shell)).toBeNull();
    shell.click(spot);
    expect(heightOf(shell, "wardrobe")).toBe(2.05);
  });

  it("a wall cabinet keeps elevation 1.40 and becomes 0.63", () => {
    const shell = open(loftRoom(), "wallCabinet");
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: true, range: { bottom: 1.4 }, lowered: { h: 0.63, from: 0.75, under: LOFT } });
    expect(plateText(shell)).toBe("H 0.63 m · default 0.75 · under Loft");
    shell.click(UNDER);
    expect(objectsOf(shell, "wallCabinet")).toMatchObject([{ h: { standard: 0.63 }, z: { standard: 1.4 } }]);
  });
});

describe("every limit holds", () => {
  it("under 3/4 stays red and refused: a wardrobe (lowest 1.538) under an underside at 1.50", () => {
    const shell = open(withCommands(roomDoc(), addHollow(1.62)), "wardrobe");
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: false, range: { top: 2.05 } });
    expect(ghost(shell)?.lowered).toBeUndefined();
    expect(plateText(shell)).toBeNull();
    shell.click(UNDER);
    expect(objectsOf(shell, "wardrobe")).toEqual([]);
    expect(shell.view().toast).toMatch(/2\.05/); // today's numbers: the default height's
  });

  it("exactly at the limit: an underside at 1.538 places at 1.538", () => {
    const shell = open(withCommands(roomDoc(), addHollow(1.658)), "wardrobe");
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: true, lowered: { h: 1.538, from: 2.05, under: LOW } });
    shell.click(UNDER);
    expect(heightOf(shell, "wardrobe")).toBe(1.538);
  });

  it.each<[string, Document]>([
    ["murphyBed", loftRoom()], // 2.24 under the loft's 2.03
    ["sofaBed", withCommands(roomDoc(), ceiling(1.8), addHollow(0.97))], // 0.90 under 0.85, and too tall to stand on it
    ["stair", loftRoom()], // a rise of 2.15 under 2.03: no room to get past (riser.15)
    ["rungLadder", loftRoom()], // the same: it keeps its box
  ])("%s stays refused", (kind, doc) => {
    const shell = open(doc, kind);
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: false });
    expect(ghost(shell)?.lowered).toBeUndefined();
    shell.click(UNDER);
    expect(objectsOf(shell, kind)).toEqual([]);
  });

  it("another piece overhead still refuses: the second search lands, the final check fails, the first ghost stays", () => {
    const placed = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "shelf", state: "s0", object: { kind: "shelf", preset: "Wall shelf" }, at: { x: 3, y: 2.3 } });
    const shelf = placed.objects["shelf/o0"];
    if (!shelf) throw new Error("no shelf");
    const doc = { ...placed, objects: { ...placed.objects, [shelf.id]: { ...shelf, z: { standard: 1.8 } } } };
    const shell = open(doc, "wardrobe");
    shell.moveTo({ x: 3, y: 2 });
    expect(ghost(shell)).toMatchObject({ fits: false, range: { top: 2.05 } });
    expect(ghost(shell)?.lowered).toBeUndefined();
    shell.click({ x: 3, y: 2 });
    expect(objectsOf(shell, "wardrobe")).toEqual([]);
  });

  it("a piece that fits today lands the same: a chair (0.90) by a hollow deck with underside 0.88 stands on the deck", () => {
    const shell = open(withCommands(roomDoc(), addHollow(1)), "chair");
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: true, surface: LOW, range: { bottom: 1, top: 1.9 } });
    expect(ghost(shell)?.lowered).toBeUndefined();
    expect(plateText(shell)).toBeNull();
    shell.click(UNDER);
    expect(heightOf(shell, "chair")).toBe(0.9);
    expect(placementOf(shell, "chair")).toMatchObject({ deck: LOW });
  });

  it("at a loft level: a bed on the loft under 3.05 lowers to 0.90, standing on the loft", () => {
    const shell = open(loftRoom(ceiling(3.05)), "bed");
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.moveTo(UNDER);
    expect(ghost(shell)).toMatchObject({ fits: true, surface: LOFT, range: { bottom: 2.15, top: 3.05 }, lowered: { h: 0.9, from: 1, under: null } });
    expect(plateText(shell)).toBe("H 0.90 m · default 1.00 · under the ceiling");
    shell.click(UNDER);
    expect(heightOf(shell, "bed")).toBe(0.9);
    expect(placementOf(shell, "bed")).toMatchObject({ deck: LOFT });
  });

  it("at an upper level with no deck under it: noFloor stays as today", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.moveTo(CLEAR);
    expect(ghost(shell)).toMatchObject({ fits: false, noFloor: true });
    expect(ghost(shell)?.lowered).toBeUndefined();
    shell.click(CLEAR);
    expect(objectsOf(shell, "wardrobe")).toEqual([]);
    expect(shell.view().toast).toBe("No floor at +2.15 here");
  });

  it("a refused click's plate isn't mistaken for the label: the plate is the only one drawn", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.click(CLEAR); // a wardrobe at 2.05
    shell.click(CLEAR); // refused, on it
    const refusal = shell.state.plate?.text;
    expect(refusal).toBeTruthy();
    shell.moveTo({ x: 1.6, y: 2 }); // past 24 px: the plate goes, and the ghost under the loft is lowered
    expect(plateText(shell)).toBe("H 2.03 m · default 2.05 · under Loft");
    expect(presence(shell).filter((p) => p.kind === "text")).toHaveLength(1);
  });
});

describe("after placing, it's an ordinary height", () => {
  const placedUnder = (): FakeShell => {
    const shell = open(loftRoom(), "wardrobe");
    shell.click(UNDER);
    expect(heightOf(shell, "wardrobe")).toBe(2.03);
    return shell;
  };

  it("a lowered piece moved out from under the loft keeps 2.03", () => {
    const shell = placedUnder();
    select(shell, UNDER);
    shell.drag(UNDER, CLEAR);
    expect(placementOf(shell, "wardrobe")?.at.x).toBeGreaterThan(3.5);
    expect(heightOf(shell, "wardrobe")).toBe(2.03);
  });

  it("dragging an existing wardrobe under the loft is refused with both ranges in the words", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.click(CLEAR);
    select(shell, CLEAR);
    const before = placementOf(shell, "wardrobe")?.at;
    shell.drag(CLEAR, UNDER);
    expect(placementOf(shell, "wardrobe")?.at).toEqual(before);
    expect(heightOf(shell, "wardrobe")).toBe(2.05);
    expect(shell.view().toast).toMatch(/0\.00.*2\.05.*2\.03.*2\.15/);
  });

  it("duplicating it there is refused", () => {
    const shell = open(loftRoom(), "wardrobe");
    shell.click(CLEAR);
    select(shell, CLEAR);
    shell.key("d", { meta: true });
    shell.moveTo(UNDER);
    shell.click(UNDER);
    expect(objectsOf(shell, "wardrobe")).toHaveLength(1);
    expect(shell.view().toast).toMatch(/2\.05/);
    expect(shell.view().toast).toMatch(/2\.03/); // both ranges in the words (AC-08)
  });

  it("undo restores nothing but the placing: one command, one undo", () => {
    const r = FakeRemote.open(loftRoom());
    r.shell.ui({ type: "pickKind", kind: "wardrobe" });
    r.shell.click(UNDER);
    expect(r.submits()).toHaveLength(1);
    expect(objectsOf(r.shell, "wardrobe")).toMatchObject([{ h: { standard: 2.03 } }]);
    const shell = placedUnder();
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { ctrl: true });
    expect(objectsOf(shell, "wardrobe")).toEqual([]);
    expect(shell.doc().decks[LOFT]).toBeDefined();
    expect(shell.state.undo.past).toHaveLength(0);
  });
});
