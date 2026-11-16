import { describe, expect, it } from "vitest";
import { sectionsOf, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { planPicture, PRESENTATION_STYLE } from "../src/view/picture";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { steppedValue, type Field } from "../src/view/view-model";
import { labelledDoc, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// Selecting a section and Properties (spec "Editing", "Depth", AC-04, AC-05's field and band). roomDoc is a 6 x 4 room.
//
//                  ▲ side 1 looks up, the left of a → b
//   A  ▬▬▬ ─ ─ ─ ─ ─ ─ ▬▬▬  A
//     (1,2)            (5,2)

const P = (x: number, y: number): Point => ({ x, y });
const add = (a: Point, b: Point, side: 1 | -1 = 1, depth: number | null = null): Command => ({ type: "addSection", a, b, side, depth });
const LINE = add(P(1, 2), P(5, 2));
const SELECTED = [{ table: "sections", id: "A" }];

const px = (shell: FakeShell, n: number): number => n / shell.state.camera.zoom;
const row = (shell: FakeShell) => shell.doc().sections["A"];
const past = (shell: FakeShell): number => shell.state.undo.past.length;
const fields = (shell: FakeShell): Field[] => {
  const p = shell.view().properties;
  return "fields" in p ? p.fields : [];
};
const field = (shell: FakeShell, id: string): Field | undefined => fields(shell).find((f) => f.id === id);
const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });
const marks = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "marks")?.primitives ?? [];
const bands = (ps: readonly Primitive[]): Primitive[] => ps.filter((p) => p.kind === "polygon" && p.points.length === 4);

function selected(doc: Document = withCommands(roomDoc(), LINE)): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(P(3, 2));
  expect(shell.state.selection).toEqual(SELECTED);
  return shell;
}

describe("selecting a section", () => {
  it("clicking the mark selects the section, on its line", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), LINE));
    shell.click(P(3, 2));
    expect(shell.state.selection).toEqual(SELECTED);
  });

  it("the hit tolerance is in pixels, either side of the line", () => {
    const hits = (off: number): boolean => {
      const shell = FakeShell.withDocument(withCommands(roomDoc(), LINE));
      shell.click(P(3, 2 + px(shell, off)));
      return shell.state.selection.length === 1;
    };
    expect([hits(5), hits(-5), hits(8), hits(-8)]).toEqual([true, true, false, false]);
  });

  it("the line stops at its ends", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), LINE));
    shell.click(P(1 - px(shell, 40), 2));
    shell.click(P(5 + px(shell, 40), 2));
    expect(shell.state.selection).toEqual([]);
  });

  it.each([
    ["a's arrow", (n: (v: number) => number) => P(1, 2 + n(18))],
    ["b's arrow", (n: (v: number) => number) => P(5, 2 + n(18))],
    ["a's letter", (n: (v: number) => number) => P(1 - n(14), 2)],
    ["b's letter", (n: (v: number) => number) => P(5 + n(14), 2)],
  ])("%s selects it too", (_, at) => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), LINE));
    shell.click(at((v) => px(shell, v)));
    expect(shell.state.selection).toEqual(SELECTED);
  });

  it("the arrows point at the seen side, so past the line on the other side nothing hits", () => {
    const look = FakeShell.withDocument(withCommands(roomDoc(), LINE));
    look.click(P(1, 2 - px(look, 18)));
    expect(look.state.selection).toEqual([]);
    const flipped = FakeShell.withDocument(withCommands(roomDoc(), add(P(1, 2), P(5, 2), -1)));
    flipped.click(P(1, 2 - px(flipped, 18)));
    expect(flipped.state.selection).toEqual(SELECTED);
  });

  it("of two marks in range the nearer one wins", () => {
    const doc = withCommands(roomDoc(), LINE, add(P(1, 2.1), P(5, 2.1)));
    const shell = FakeShell.withDocument(doc);
    const gap = 0.1 * shell.state.camera.zoom;
    expect(gap).toBeLessThan(12); // both in range of a point between them
    shell.click(P(3, 2 + 0.07));
    expect(shell.state.selection).toEqual([{ table: "sections", id: "B" }]);
    shell.key("Escape");
    shell.click(P(3, 2 + 0.03));
    expect(shell.state.selection).toEqual(SELECTED);
  });

  it("a click on the wall under it still selects the wall; beside the wall, the section", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), add(P(4, 2), P(8, 2))));
    shell.click(P(6, 2));
    expect(shell.state.selection.map((r) => r.table)).toEqual(["walls"]);
    shell.key("Escape");
    shell.click(P(7, 2));
    expect(shell.state.selection).toEqual(SELECTED);
  });

  it("a joint and an opening under it keep theirs", () => {
    const corner = FakeShell.withDocument(withCommands(roomDoc(), add(P(-1, 0), P(1, 0))));
    corner.click(P(0, 0));
    expect(corner.state.selection.map((r) => r.table)).toEqual(["joints"]);
    const base = roomDoc();
    const door: Command = { type: "addOpening", opId: "d", wall: wallBetween(base, P(6, 0), P(6, 4)), kind: "swing", offset: 1.5 };
    const opening = FakeShell.withDocument(withCommands(base, door, add(P(4, 2), P(8, 2))));
    opening.click(P(6, 2));
    expect(opening.state.selection.map((r) => r.table)).toEqual(["openings"]);
  });

  it("the mark wins over a piece, a deck and a room under it", () => {
    const place: Command = { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "desk" }, at: P(3, 2.3) }; // y 1.7 to 2.3
    const piece = FakeShell.withDocument(withCommands(roomDoc(), LINE, place));
    piece.click(P(3, 2));
    expect(piece.state.selection).toEqual(SELECTED);
    piece.key("Escape");
    piece.click(P(3, 2.2));
    expect(piece.state.selection.map((r) => r.table)).toEqual(["placements"]);

    const deck = FakeShell.withDocument(withCommands(roomDoc(), LINE, { type: "addDeck", opId: "p", preset: "platform", at: P(3, 2) }));
    deck.click(P(3, 2));
    expect(deck.state.selection).toEqual(SELECTED);
    deck.key("Escape");
    deck.click(P(3, 2.2));
    expect(deck.state.selection.map((r) => r.table)).toEqual(["decks"]);

    const room = FakeShell.withDocument(withCommands(labelledDoc(), add(P(1, 1), P(2.5, 1))));
    room.click(P(2, 1));
    expect(room.state.selection).toEqual(SELECTED);
    room.key("Escape");
    room.click(P(2, 1.3));
    expect(room.state.selection.map((r) => r.table)).toEqual(["zoneLabels"]);
  });

  describe("at an upper level, as a section cuts every level", () => {
    const withLoft = (): Document => withCommands(roomDoc(), LINE, { type: "addDeck", opId: "m", preset: "loft", at: P(1.2, 3) });
    const atLoft = (doc: Document = withLoft()): FakeShell => {
      const shell = FakeShell.withDocument(doc);
      shell.ui({ type: "setViewedLevel", deck: "m/k0" });
      return shell;
    };

    it("a click selects it and opens its frame", () => {
      const shell = atLoft();
      shell.click(P(3, 2));
      expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
      expect(shell.view().sectionStrip?.section).toBe("A");
      expect(shell.view().properties.kind).toBe("section");
    });

    it("a level switch keeps it selected, either way", () => {
      const shell = selected(withLoft());
      shell.ui({ type: "setViewedLevel", deck: "m/k0" });
      expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
      shell.ui({ type: "setViewedLevel", deck: null });
      expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
    });

    it("a frame's letter selects it", () => {
      const shell = atLoft();
      shell.ui({ type: "showSection", section: "A" });
      expect(shell.view().sectionStrip?.section).toBe("A");
      expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
    });

    it("hovering shows the pointer", () => {
      const shell = atLoft();
      shell.moveTo(P(3, 2));
      expect(shell.state.hover).toEqual({ table: "sections", id: "A" });
    });

    it("Delete removes it", () => {
      const shell = atLoft();
      shell.click(P(3, 2));
      shell.key("Delete");
      expect(shell.doc().sections).toEqual({});
    });
  });

  it("hovering shows the pointer; pressing and dragging the mark moves nothing", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), LINE));
    shell.moveTo(P(3, 2));
    expect(shell.view().cursor).toBe("pointer");
    const doc = shell.doc();
    shell.drag(P(3, 2), P(3, 3));
    expect(shell.state.selection).toEqual(SELECTED);
    expect(shell.doc()).toBe(doc);
  });
});

describe("a section's Properties", () => {
  it("shows the letter, the length and Depth", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), add(P(1, 0.5), P(4, 4.5))));
    shell.click(P(2.5, 2.5));
    expect(shell.view().properties.kind).toBe("section");
    expect(field(shell, "letter")).toMatchObject({ label: "Letter", value: "A", readOnly: true });
    expect(field(shell, "length")).toMatchObject({ label: "Length", value: "5.00", unit: "m", readOnly: true });
    expect(field(shell, "depth")).toMatchObject({ label: "Depth", value: "", unit: "m", readOnly: false, placeholder: "Whole" });
    expect(field(shell, "flip")).toMatchObject({ action: true, readOnly: false });
    expect(field(shell, "depthHint")?.value).toBe("Blank sees the whole drawing; 0 only the cut");
  });

  it("a section's selection shows no fields after it's gone", () => {
    const shell = selected();
    shell.key("Delete");
    expect(shell.view().properties.kind).toBe("none");
  });
});

describe("Depth", () => {
  it.each([
    ["1.5", 1.5, "1.50"],
    ["150cm", 1.5, "1.50"],
    ["1+0,5", 1.5, "1.50"],
    ["0", 0, "0.00"],
    ["0cm", 0, "0.00"],
    ["5ft", 1.524, "1.52"], // a field in metres takes feet (spec feet)
  ])("%s is stored as %s, in one undo step", (typed, stored, shown) => {
    const shell = selected();
    const before = past(shell);
    set(shell, "depth", typed);
    expect(shell.view().toast).toBeNull();
    expect(row(shell)?.depth).toBe(stored);
    expect(field(shell, "depth")?.value).toBe(shown);
    expect(past(shell)).toBe(before + 1);
    shell.key("z", { ctrl: true });
    expect(row(shell)?.depth).toBeNull();
  });

  it.each(["", "  "])("a blank (%j) goes back to Whole, which isn't Zero", (blank) => {
    const shell = selected(withCommands(roomDoc(), add(P(1, 2), P(5, 2), 1, 1.5)));
    const before = past(shell);
    set(shell, "depth", blank);
    expect(shell.view().toast).toBeNull();
    expect(row(shell)?.depth).toBeNull();
    expect(field(shell, "depth")?.value).toBe("");
    expect(past(shell)).toBe(before + 1);
  });

  it("a negative depth is refused with the reason, and nothing changes", () => {
    const shell = selected(withCommands(roomDoc(), add(P(1, 2), P(5, 2), 1, 1.5)));
    const doc = shell.doc();
    const before = past(shell);
    set(shell, "depth", "-1");
    expect(shell.view().toast).toBe("A section's depth can't be negative");
    expect(shell.doc().sections).toEqual(doc.sections);
    expect(past(shell)).toBe(before);
  });

  it.each(["abc", "2-", "1/0", "5km"])("%s is refused with the typed value's toast, and nothing changes", (typed) => {
    const shell = selected(withCommands(roomDoc(), add(P(1, 2), P(5, 2), 1, 1.5)));
    const doc = shell.doc();
    const before = past(shell);
    set(shell, "depth", typed);
    expect(shell.view().toast).toBe(`Can't read ${typed}`);
    expect(shell.doc()).toBe(doc);
    expect(past(shell)).toBe(before);
  });

  it("the stepper starts from nothing and steps by a centimetre", () => {
    const shell = selected();
    const depth = field(shell, "depth");
    if (!depth) throw new Error("no Depth");
    set(shell, "depth", steppedValue(depth, 1));
    expect(row(shell)?.depth).toBe(0.01);
  });
});

describe("Flip", () => {
  it("swaps the side in one undo step, and back", () => {
    const shell = selected();
    const before = past(shell);
    set(shell, "flip", "");
    expect(row(shell)?.side).toBe(-1);
    expect(past(shell)).toBe(before + 1);
    set(shell, "flip", "");
    expect(row(shell)?.side).toBe(1);
    shell.key("z", { ctrl: true });
    expect(row(shell)?.side).toBe(-1);
    shell.key("z", { ctrl: true });
    expect(row(shell)?.side).toBe(1);
    expect(past(shell)).toBe(before);
  });

  it("reaches the other client, and an edit of theirs reaches this one", () => {
    const r = FakeRemote.open(withCommands(roomDoc(), LINE));
    r.shell.click(P(3, 2));
    set(r.shell, "flip", "");
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.doc.sections["A"]?.side).toBe(-1);
    set(r.shell, "depth", "2");
    r.accept();
    expect(r.doc.sections["A"]?.depth).toBe(2);
    r.remote({ type: "setSection", sectionId: "A", side: 1 });
    expect(row(r.shell)?.side).toBe(1);
    expect(r.shell.state.selection).toEqual(SELECTED);
  });
});

describe("Delete", () => {
  it("removes it; undo restores it with its letter and values", () => {
    const shell = selected(withCommands(roomDoc(), add(P(1, 2), P(5, 2), -1, 1.5)));
    const before = past(shell);
    shell.key("Delete");
    expect(sectionsOf(shell.doc())).toEqual([]);
    expect(shell.state.selection).toEqual([]);
    expect(past(shell)).toBe(before + 1);
    shell.key("z", { ctrl: true });
    expect(row(shell)).toEqual({ id: "A", a: P(1, 2), b: P(5, 2), side: -1, depth: 1.5 });
  });

  it("reaches the other client; a section someone else deletes leaves the selection", () => {
    const r = FakeRemote.open(withCommands(roomDoc(), LINE, add(P(1, 3), P(5, 3))));
    r.shell.click(P(3, 2));
    r.shell.key("Delete");
    r.accept();
    expect(Object.keys(r.doc.sections)).toEqual(["B"]);
    r.shell.click(P(3, 3));
    expect(r.shell.state.selection).toEqual([{ table: "sections", id: "B" }]);
    r.remote({ type: "deleteEntities", ids: [{ table: "sections", id: "B" }] });
    expect(r.shell.state.selection).toEqual([]);
    expect(r.shell.view().properties.kind).toBe("none");
  });
});

describe("the band", () => {
  const withDepth = (depth: number | null, side: 1 | -1 = 1): Document => withCommands(roomDoc(), add(P(1, 2), P(5, 2), side, depth));
  const band = (a: Point, b: Point, c: Point, d: Point): Primitive => ({ kind: "polygon", points: [a, b, c, d], holes: [], color: COLORS.sectionBand });

  it("shades between the cut and the far line, under the mark, on the seen side", () => {
    const shell = selected(withDepth(1.5));
    expect(marks(shell)[0]).toEqual(band(P(1, 2), P(5, 2), P(5, 3.5), P(1, 3.5)));
    expect(bands(marks(shell))).toHaveLength(1);
    set(shell, "flip", "");
    expect(marks(shell)[0]).toEqual(band(P(1, 2), P(5, 2), P(5, 0.5), P(1, 0.5)));
    expect(bands(marks(shell))).toHaveLength(1);
  });

  it("shows only while selected", () => {
    const shell = FakeShell.withDocument(withDepth(1.5));
    expect(bands(marks(shell))).toEqual([]);
    shell.click(P(3, 2));
    expect(bands(marks(shell))).toHaveLength(1);
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
    expect(bands(marks(shell))).toEqual([]);
  });

  it.each([[null], [0]])("has nothing to shade with depth %s", (depth) => {
    const shell = selected(withDepth(depth));
    expect(bands(marks(shell))).toEqual([]);
    expect(marks(shell).length).toBeGreaterThan(0);
  });

  it("is only the selected section's", () => {
    const shell = FakeShell.withDocument(withCommands(withDepth(1.5), add(P(1, 1), P(5, 1), 1, 1)));
    shell.click(P(3, 1));
    expect(bands(marks(shell))).toEqual([band(P(1, 1), P(5, 1), P(5, 2), P(1, 2))]);
  });

  it("never prints", () => {
    const shell = selected(withDepth(1.5));
    expect(bands(planPicture(shell.doc(), floorView(shell.doc(), "s0"), PRESENTATION_STYLE, 20, true).marks)).toEqual([]);
  });
});
