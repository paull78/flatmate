import { describe, expect, it } from "vitest";
import { helveticaWidth } from "../src/export/helvetica";
import { execute, sheetDrawings, sheetsOf, type Command, type Document, type PaperName, type SheetDrawing } from "@fm/domain";
import { MARGIN_MM, columnMm, drawingArea, type Rect } from "../src/export/paper";
import { pagesOf, sheetSet, type SheetPage } from "../src/export/sheet";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { LOFT_ROOM_LOFT, clearRoomDoc, loftRoomDoc, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// A compare sheet (sheetset.11, .12; AC-07): 2 to 4 panes at one scale and framing, named at the top, sharing edges.
//
//   side by side            stacked
//   +-------+-------+       +---------------+
//   |  DAY  | NIGHT |       |      DAY      |
//   |  plan |  plan |       |      plan     |
//   |       |       |       +---------------+
//   |       |       |       |     NIGHT     |
//   | TITLE |       |       | TITLE  plan   |
//   +-------+-------+       +---------------+

const NIGHT = "n/s0";
const GUESTS = "g/s0";
const COMPARE = "c/t0";
const addNight: Command = { type: "addState", opId: "n", name: "Night" };
const addGuests: Command = { type: "addState", opId: "g", name: "Guests" };
const rename: Command = { type: "renameState", stateId: "s0", name: "Day" };
const at = (layout: string, deck: string | null = null): SheetDrawing => ({ layout, deck });
const DAY_NIGHT = [at("s0"), at(NIGHT)];
const THREE = [at("s0"), at(NIGHT), at(GUESTS)];

type Fields = Partial<Omit<Extract<Command, { type: "addSheet" }>, "type" | "opId" | "kind" | "drawings">>;
const addCompare = (drawings: readonly SheetDrawing[], fields: Fields = {}): Command => ({ type: "addSheet", opId: "c", after: null, kind: "compare", title: "Compare", drawings, ...fields });
/** A room with Day and Night, or Guests too, and a compare sheet of those. */
const compared = (doc: Document, drawings: readonly SheetDrawing[] = DAY_NIGHT, fields: Fields = {}): Document => withCommands(doc, rename, addNight, addGuests, addCompare(drawings, fields));

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}
const options = (paper: PaperName, scale: number | "fit") => ({ projectName: "Flat", paper, scale, host: host(), finishes: true });

function comparePage(doc: Document, paper: PaperName = "A3", scale: number | "fit" = 50): { page: SheetPage; area: Rect } {
  const set = sheetSet(doc, options(paper, scale));
  const sheet = sheetsOf(doc).find((s) => s.id === COMPARE);
  if (!sheet) throw new Error("no compare sheet");
  const [page] = pagesOf(doc, sheet, set);
  if (!page) throw new Error("no page");
  return { page, area: drawingArea(paper, set.orientation) };
}
const clipsOf = (page: SheetPage) => page.clips ?? [];
const rects = (page: SheetPage) => clipsOf(page).map((c) => c.rect);
const isStacked = (page: SheetPage): boolean => {
  const [a, b] = rects(page);
  return a !== undefined && b !== undefined && a.x === b.x && a.y > b.y;
};
const isSideBySide = (page: SheetPage): boolean => {
  const [a, b] = rects(page);
  return a !== undefined && b !== undefined && a.y === b.y && a.x < b.x;
};

type Text = Extract<Primitive, { kind: "text" }>;
const texts = (page: SheetPage): Text[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
const named = (page: SheetPage, text: string): Text | undefined => texts(page).find((t) => t.text === text);
/** The walls' fills in a pane, the plan's only near-black polygons. */
function wallPoints(page: SheetPage, pane: number) {
  const clip = clipsOf(page)[pane];
  if (!clip) throw new Error(`no pane ${pane}`);
  return page.primitives.slice(clip.from, clip.to).flatMap((p) => (p.kind === "polygon" && p.color === PRESENTATION_STYLE.wall ? p.points : []));
}
const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

function opened(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
}
function rowOf(shell: FakeShell, id = COMPARE) {
  const row = shell.view().sheetsView?.sheets.find((s) => s.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}
const panesOf = (shell: FakeShell): SheetDrawing[] => sheetDrawings(sheetsOf(shell.doc()).find((s) => s.id === COMPARE) ?? missing());
function missing(): never {
  throw new Error("no compare sheet");
}
const toggle = (shell: FakeShell, layout: string, deck: string | null = null): void => shell.ui({ type: "toggleSheetPane", id: COMPARE, layout, deck });
const setGeneral = (shell: FakeShell, scale: string): void => shell.ui({ type: "setSheetSetting", key: "generalScale", value: scale });
const setPaper = (shell: FakeShell, paper: string): void => shell.ui({ type: "setSheetSetting", key: "paper", value: paper });

describe("Split (AC-07)", () => {
  it("Automatic stacks a long plan and sets a tall one side by side", () => {
    expect(isStacked(comparePage(compared(clearRoomDoc(12, 3, "r"))).page)).toBe(true);
    expect(isSideBySide(comparePage(compared(clearRoomDoc(3, 12, "r"))).page)).toBe(true);
  });

  it("Automatic reads neither the scale nor the framing, so a drag can't re-split it", () => {
    const long = (fields: Fields): boolean => isStacked(comparePage(compared(clearRoomDoc(12, 3, "r"), DAY_NIGHT, fields), "A3", 100).page);
    expect(long({})).toBe(true);
    expect(long({ cx: 40, cy: -40 })).toBe(true);
    expect(long({ scale: 20 })).toBe(true);
  });

  it("Stacked and Side by side are obeyed", () => {
    const long = clearRoomDoc(12, 3, "r");
    const tall = clearRoomDoc(3, 12, "r");
    expect(isSideBySide(comparePage(compared(long, DAY_NIGHT, { split: "sideBySide" })).page)).toBe(true);
    expect(isStacked(comparePage(compared(tall, DAY_NIGHT, { split: "stacked" })).page)).toBe(true);
  });

  it("panes are equal and fill the drawing area, under one band each", () => {
    const side = comparePage(compared(roomDoc(), THREE, { split: "sideBySide" }));
    const [a, b, c] = rects(side.page);
    if (!a || !b || !c) throw new Error("not three panes");
    expect([a.w, b.w, c.w].map((w) => w * 3)).toEqual([side.area.w, side.area.w, side.area.w]);
    expect(a.x).toBe(side.area.x);
    expect(b.x).toBeCloseTo(a.x + a.w, 9);
    expect(c.x + c.w).toBeCloseTo(side.area.x + side.area.w, 9);
    for (const r of [a, b, c]) {
      expect(r.y).toBe(side.area.y);
      expect(r.h).toBeLessThan(side.area.h);
      expect(r.h).toBe(a.h);
    }
    const stacked = comparePage(compared(roomDoc(), THREE, { split: "stacked" }));
    const [top, middle, foot] = rects(stacked.page);
    if (!top || !middle || !foot) throw new Error("not three panes");
    const paneH = stacked.area.h / 3;
    const band = paneH - top.h;
    expect(band).toBeGreaterThan(0);
    expect(top.y + top.h + band).toBeCloseTo(stacked.area.y + stacked.area.h, 9); // the first on top, its band above it
    expect(middle.y).toBeCloseTo(stacked.area.y + paneH, 9);
    expect(foot.y).toBe(stacked.area.y);
    expect(foot.w).toBe(stacked.area.w);
  });
});

describe("what a pane holds (AC-07)", () => {
  it("panes share edges: one segment at each seam", () => {
    const segmentsOn = (page: SheetPage, axis: "x" | "y", value: number, length: number): number =>
      page.primitives.filter((p) => p.kind === "segment" && Math.abs(p.a[axis] - value) < 1e-6 && Math.abs(p.b[axis] - value) < 1e-6 && Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y) >= length - 1e-6).length;
    const side = comparePage(compared(roomDoc(), THREE, { split: "sideBySide" }));
    const across = side.area.w / 3;
    expect(segmentsOn(side.page, "x", side.area.x + across, side.area.h)).toBe(1);
    expect(segmentsOn(side.page, "x", side.area.x + 2 * across, side.area.h)).toBe(1);
    const stacked = comparePage(compared(roomDoc(), THREE, { split: "stacked" }));
    const down = stacked.area.h / 3;
    expect(segmentsOn(stacked.page, "y", stacked.area.y + down, stacked.area.w)).toBe(1);
    expect(segmentsOn(stacked.page, "y", stacked.area.y + 2 * down, stacked.area.w)).toBe(1);
    // The frame itself, once: its left and shared edge with the column stay as on any page.
    expect(segmentsOn(side.page, "x", side.area.x, side.area.h)).toBe(1);
    expect(segmentsOn(side.page, "x", side.area.x + side.area.w, side.area.h)).toBe(1);
  });

  it("each pane's name prints at its top, and the plan clips to the pane", () => {
    const { page, area } = comparePage(compared(roomDoc(), THREE, { split: "sideBySide" }));
    const panes = rects(page);
    expect(panes).toHaveLength(3);
    ["DAY", "NIGHT", "GUESTS"].forEach((name, i) => {
      const text = named(page, name);
      const r = panes[i];
      if (!text || !r) throw new Error(`no ${name}`);
      expect(text.align).toBe("center");
      expect(text.at.x).toBeCloseTo(r.x + r.w / 2, 9);
      expect(text.at.y).toBeGreaterThan(r.y + r.h); // above what the plan may reach
      expect(text.at.y + text.size / 2).toBeLessThan(area.y + area.h); // and inside the frame
      expect(text.size).toBeGreaterThan(3.6); // larger than the title's
    });
    // Each pane its own run of the plan; nothing else inside a clip.
    const clips = clipsOf(page);
    clips.forEach((clip, i) => {
      expect(wallPoints(page, i).length).toBeGreaterThan(0);
      if (i > 0) expect(clip.from).toBe(clips[i - 1]?.to);
    });
    const last = clips[clips.length - 1]?.to ?? 0;
    const insideAClip = page.primitives.slice(0, last);
    expect(insideAClip.some((p) => p.kind === "text" && (p.text === "DAY" || p.text.includes("scale 1:")))).toBe(false);
  });

  it("a long name cuts inside its pane", () => {
    const doc = withCommands(roomDoc(), { type: "renameState", stateId: "s0", name: "A rather long name for a layout" }, addNight, addCompare(DAY_NIGHT, { split: "sideBySide" }));
    const page = comparePage(withCommands(doc, addGuests, { type: "setSheet", sheetId: COMPARE, drawings: [...DAY_NIGHT, at(GUESTS), at("s0", null)] })).page;
    expect(texts(page).some((t) => t.text.startsWith("A RATHER") && t.text.endsWith("…"))).toBe(true);
  });

  it("one scale and framing for all: the same offset in every pane, each true to scale", () => {
    const doc = compared(roomDoc(), THREE, { split: "stacked", scale: 100, cx: 0.5, cy: -0.25 });
    const { page } = comparePage(doc);
    expect(rects(page)).toHaveLength(3);
    const offsets = rects(page).map((r, i) => {
      const points = wallPoints(page, i);
      expect(span(points.map((p) => p.x))).toBeCloseTo(62, 6); // the 6.2 m outline, 62 mm at 1:100
      return { x: Math.min(...points.map((p) => p.x)) - r.x, y: Math.min(...points.map((p) => p.y)) - r.y };
    });
    const [first, ...rest] = offsets;
    for (const o of rest) {
      expect(o.x).toBeCloseTo(first?.x ?? NaN, 6);
      expect(o.y).toBeCloseTo(first?.y ?? NaN, 6);
    }
    // cx and cy move every pane's plan the other way, on paper, the same distance.
    const centred = comparePage(compared(roomDoc(), THREE, { split: "stacked", scale: 100 })).page;
    rects(centred).forEach((_, i) => {
      expect(Math.min(...wallPoints(page, i).map((p) => p.x)) - Math.min(...wallPoints(centred, i).map((p) => p.x))).toBeCloseTo(-5, 6);
      expect(Math.min(...wallPoints(page, i).map((p) => p.y)) - Math.min(...wallPoints(centred, i).map((p) => p.y))).toBeCloseTo(2.5, 6);
    });
  });

  it("the title and scale still print at the bottom left, once", () => {
    const stacked = comparePage(compared(roomDoc(), DAY_NIGHT, { title: "Layout options", split: "stacked" }));
    const tags = texts(stacked.page).filter((t) => t.text.includes("scale 1:"));
    expect(tags.map((t) => t.text)).toEqual(["LAYOUT OPTIONS  ·  scale 1:50"]);
    expect(tags[0]?.at.x).toBeLessThan(stacked.area.x + 5);
    expect(tags[0]?.at.y).toBeLessThan(stacked.area.y + 6);
  });

  it("the column has the scale bar and no rooms table, which would need one per layout", () => {
    const labelled = withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Living", finish: null });
    const set = comparePage(compared(labelled, DAY_NIGHT, { split: "stacked" }));
    const columnX = set.page.widthMm - MARGIN_MM - columnMm("A3");
    const inColumn = texts(set.page).filter((t) => t.at.x >= columnX);
    expect(inColumn.map((t) => t.text)).not.toContain("Living");
    expect(inColumn.some((t) => t.text.includes("Sheet 03 / 03") || t.text === "Flat")).toBe(true);
    // The bar's unit, as on a plan sheet.
    expect(inColumn.some((t) => /^\d+( m)?$/.test(t.text))).toBe(true);
  });

  it("at most 4, at least 2: the panel refuses leaving one; the domain refuses 5", () => {
    const shell = opened(withCommands(roomDoc(), rename, addNight, addGuests, addCompare(DAY_NIGHT), { type: "addState", opId: "h", name: "Hall" }, { type: "addState", opId: "k", name: "Kids" }));
    const lockedOf = () => rowOf(shell).panes.filter((p) => p.locked).map((p) => p.title);
    expect(rowOf(shell).panes.map((p) => [p.title, p.on])).toEqual([["Day", true], ["Night", true], ["Guests", false], ["Hall", false], ["Kids", false]]);
    expect(lockedOf()).toEqual(["Day", "Night"]);

    const before = panesOf(shell);
    toggle(shell, NIGHT);
    expect(panesOf(shell)).toEqual(before);

    toggle(shell, GUESTS);
    expect(lockedOf()).toEqual([]);
    toggle(shell, "h/s0");
    expect(panesOf(shell).map((d) => d.layout)).toEqual(["s0", NIGHT, GUESTS, "h/s0"]);
    expect(lockedOf()).toEqual(["Kids"]);
    toggle(shell, "k/s0");
    expect(panesOf(shell)).toHaveLength(4);

    const fifth = execute(shell.doc(), { type: "setSheet", sheetId: COMPARE, drawings: [...panesOf(shell), at("k/s0")] });
    expect(fifth).toMatchObject({ ok: false, error: { message: "A compare sheet holds 2 to 4 drawings" } });
    const lone = execute(shell.doc(), { type: "setSheet", sheetId: COMPARE, drawings: [at("s0")] });
    expect(lone).toMatchObject({ ok: false, error: { message: "A compare sheet holds 2 to 4 drawings" } });
  });

  it("a pane toggled is one undo step, in the choices' order", () => {
    const shell = opened(compared(roomDoc(), [at("s0"), at(GUESTS)]));
    const before = shell.doc();
    toggle(shell, NIGHT);
    expect(panesOf(shell).map((d) => d.layout)).toEqual(["s0", NIGHT, GUESTS]);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(before);
  });

  it("a compare pane can be a level: floor and loft", () => {
    const labelled = withCommands(loftRoomDoc(), { type: "labelZone", id: "L1", at: { x: 4.8, y: 2 }, name: "Living", finish: null });
    const doc = withCommands(labelled, rename, addCompare([at("s0"), at("s0", LOFT_ROOM_LOFT)], { split: "stacked" }));
    const { page } = comparePage(doc);
    const shell = opened(doc);
    const [floorName, loftName] = rowOf(shell).panes.filter((p) => p.on).map((p) => p.title);
    expect(floorName).toBe("Day");
    expect(loftName).toMatch(/^Day · /);
    expect(named(page, "DAY")).toBeDefined();
    expect(named(page, (loftName ?? "").toUpperCase())).toBeDefined();
    const clipTexts = (pane: number): string[] => {
      const clip = clipsOf(page)[pane];
      return clip ? page.primitives.slice(clip.from, clip.to).flatMap((p) => (p.kind === "text" ? [p.text] : [])) : [];
    };
    expect(clipTexts(0).join(" ")).toContain("Living"); // a room's tag is the floor's (levels.04)
    expect(clipTexts(1).join(" ")).not.toContain("Living");
  });

  it("a project with one layout and a loft can add a compare: its floor and its loft", () => {
    const shell = opened(withCommands(loftRoomDoc(), rename));
    expect(shell.view().sheetsView?.canCompare).toBe(true);
    shell.ui({ type: "addSheet", kind: "compare" });
    const added = sheetsOf(shell.doc()).find((s) => s.kind === "compare");
    expect(added && sheetDrawings(added)).toEqual([at("s0"), at("s0", LOFT_ROOM_LOFT)]);
    expect(added?.title).toMatch(/^Day and Day · /);
  });

  it("with Day, Night and a loft, a new compare is still Day and Night", () => {
    const shell = opened(withCommands(loftRoomDoc(), rename, addNight));
    shell.ui({ type: "addSheet", kind: "compare" });
    const added = sheetsOf(shell.doc()).find((s) => s.kind === "compare");
    expect(added && sheetDrawings(added)).toEqual(DAY_NIGHT);
    expect(added?.title).toBe("Day and Night");
  });
});

describe("a compare sheet's title follows its panes, as a plan's does", () => {
  const titled = (title: string): FakeShell => opened(compared(roomDoc(), DAY_NIGHT, { title }));
  const stored = (shell: FakeShell): string | undefined => sheetsOf(shell.doc()).find((s) => s.id === COMPARE)?.title;

  it("one still naming its panes follows them", () => {
    const shell = titled("Day and Night");
    toggle(shell, GUESTS);
    expect(stored(shell)).toBe("Day, Night and Guests");
    toggle(shell, NIGHT);
    expect(stored(shell)).toBe("Day and Guests");
  });

  it("a typed one stays", () => {
    const shell = titled("Two ways to live");
    toggle(shell, GUESTS);
    expect(stored(shell)).toBe("Two ways to live");
  });

  it("the follow is the same undo step", () => {
    const shell = titled("Day and Night");
    const before = shell.doc();
    toggle(shell, GUESTS);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(before);
  });
});

describe("what the note reads on a compare sheet (AC-06)", () => {
  /** An outward door on the bottom wall: the floor draws its swing, a loft doesn't. */
  const withDoor = (doc: Document): Document => withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2, width: 0.9, side: "right" });

  it("the note counts if any pane shows part of its plan", () => {
    const base = withCommands(withDoor(loftRoomDoc()), rename, addNight);
    // Framed up by 0.85 m at 1:50 in a stacked pane on A3, 2.99 m each way inside the inset: the walls stay in it, the floor's swing doesn't.
    const fields: Fields = { split: "stacked", scale: 50, cy: 0.85 };
    const part = (drawings: readonly SheetDrawing[]): boolean => {
      const shell = opened(withCommands(base, addCompare(drawings, fields)));
      setPaper(shell, "A3");
      return rowOf(shell).partOfPlan;
    };
    expect(part([at("s0", LOFT_ROOM_LOFT), at(NIGHT, LOFT_ROOM_LOFT)])).toBe(false);
    expect(part([at("s0", LOFT_ROOM_LOFT), at(NIGHT)])).toBe(true);
    expect(part([at("s0"), at(NIGHT, LOFT_ROOM_LOFT)])).toBe(true);
  });

  it("the frame is the pane under its name, not the page: the band counts", () => {
    // 8.2 × 6 m: landscape on A3, 120 mm tall at 1:50, in a stacked pane of 138.5 mm: 128.5 inside the inset, 119.5 under the 9 mm band.
    const doc = compared(clearRoomDoc(8, 5.8, "r"), DAY_NIGHT, { split: "stacked", scale: 50 });
    const shell = opened(doc);
    setPaper(shell, "A3");
    expect(rowOf(shell).partOfPlan).toBe(true);
    expect(rowOf(shell, "auto/0").partOfPlan).toBe(false); // the same plan and page alone holds it
    const shortcuts = rowOf(shell).shortcuts;
    expect(shortcuts).toMatchObject({ centre: false, fit: 75 });
    expect(rowOf(shell).scales.find((s) => s.scale === 50)?.nofit).toBe(true);
    expect(rowOf(shell).scales.find((s) => s.scale === 75)?.nofit).toBe(false);
  });

  it("dragging past the pane shows the note, and Centre clears it", () => {
    const shell = opened(compared(roomDoc(), DAY_NIGHT, { split: "stacked", scale: 100 }));
    setPaper(shell, "A3");
    expect(rowOf(shell).partOfPlan).toBe(false);
    shell.ui({ type: "frameSheet", id: COMPARE, dxMm: 0, dyMm: 200 });
    expect(rowOf(shell).partOfPlan).toBe(true);
    expect(rowOf(shell).shortcuts).toMatchObject({ centre: true });
    shell.ui({ type: "setSheet", id: COMPARE, fields: { cx: 0, cy: 0 } });
    expect(rowOf(shell).partOfPlan).toBe(false);
  });

  it("the chip counts a compare sheet, ticked", () => {
    const shell = opened(compared(roomDoc(), DAY_NIGHT, { split: "stacked", scale: 20 }));
    setGeneral(shell, "100");
    expect(shell.view().sheetsView?.status).toContain("1 shows part of the plan");
  });

  it("a pane's name prints bold, cut by its bold width", () => {
    const { page } = comparePage(compared(roomDoc(), DAY_NIGHT, { split: "sideBySide" }));
    const names = page.primitives.flatMap((p) => (p.kind === "text" && (p.text === "DAY" || p.text === "NIGHT") ? [p] : []));
    expect(names.map((n) => n.style)).toEqual(["bold", "bold"]);
    const long = withCommands(roomDoc(), { type: "renameState", stateId: "s0", name: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, addNight, addCompare(DAY_NIGHT, { split: "sideBySide" }));
    const { page: tight, area } = comparePage(long, "A4", 200);
    const [cut] = tight.primitives.flatMap((p) => (p.kind === "text" && p.text.startsWith("AAA") ? [p] : []));
    if (!cut) throw new Error("no name");
    expect(helveticaWidth(cut.text, cut.size, "bold")).toBeLessThanOrEqual(area.w / 2);
  });

  it("a pane's name counts for the characters the PDF can't show", () => {
    const shell = opened(withCommands(roomDoc(), { type: "renameState", stateId: "s0", name: "日本" }, addNight, addCompare(DAY_NIGHT, { title: "Plain" }), { type: "setSheet", sheetId: "auto/0", title: "Plain too" }));
    expect(shell.view().sheetsView?.warning).not.toBeNull();
  });
});

describe("the set's orientation reads a compare sheet too", () => {
  it("a tall plan's only printed sheet, a compare, turns the pages upright", () => {
    const doc = withCommands(clearRoomDoc(3, 12, "r"), rename, addNight, addCompare(DAY_NIGHT), { type: "setSheetsInPdf", on: false }, { type: "setSheet", sheetId: COMPARE, inPdf: true });
    expect(sheetSet(doc, options("A3", 50)).orientation).toBe("portrait");
  });
});
