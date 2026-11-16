import { describe, expect, it } from "vitest";
import { sheetsOf, type Command, type Document, type PaperName } from "@fm/domain";
import { helveticaWidth } from "../src/export/helvetica";
import { MARGIN_MM, columnMm, drawingArea, type Rect } from "../src/export/paper";
import { pagesOf, sheetSet, type SheetPage } from "../src/export/sheet";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { clearRoomDoc, labelledDoc, nightBedDoc, roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// A Section sheet's page (spec "On paper", AC-10): its section to scale in 1 to 4 panes, at one framing, in metres along
// the cut and up, centred on the section's own bounds. Paper millimetres, y up.
//
//    ┌─────────────────────────┐ ▲
//    │           DAY           │ │ 9 mm: the band
//    ├─────────────────────────┤ ┴
//    │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓── +2.50 │    the box: the picture's bounds centre at its centre
//    │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓── ±0.00 │
//    └─────────────────────────┘

const NIGHT = "n/s0";
const SHEET = "s/t0";
const addNight: Command = { type: "addState", opId: "n", name: "Night" };
const line = (length = 4, y = 1, fromX = 1): Command => ({ type: "addSection", a: { x: fromX, y }, b: { x: fromX + length, y }, side: 1 });
type Fields = Partial<Omit<Extract<Command, { type: "addSheet" }>, "type" | "opId" | "kind" | "drawings" | "section" | "title">>;
const sectionSheet = (layouts: readonly string[], fields: Fields = {}): Command => ({
  type: "addSheet", opId: "s", after: null, kind: "section", section: "A", title: "Section A–A", drawings: layouts.map((layout) => ({ layout, deck: null })), ...fields,
});

const options = (paper: PaperName = "A4") => ({ projectName: "Flat", paper, scale: 50, host: new FakeHost(), finishes: true });
function drawn(doc: Document, id = SHEET, paper: PaperName = "A4"): { page: SheetPage; area: Rect } {
  const set = sheetSet(doc, options(paper));
  const sheet = sheetsOf(doc).find((s) => s.id === id);
  if (!sheet) throw new Error(`no sheet ${id}`);
  const [page] = pagesOf(doc, sheet, set);
  if (!page) throw new Error("no page");
  return { page, area: drawingArea(paper, set.orientation) };
}
const clipsOf = (page: SheetPage) => page.clips ?? [];
function paneOf(page: SheetPage, pane: number): Primitive[] {
  const clip = clipsOf(page)[pane];
  if (!clip) throw new Error(`no pane ${pane}`);
  return page.primitives.slice(clip.from, clip.to);
}
type Text = Extract<Primitive, { kind: "text" }>;
const textsIn = (primitives: readonly Primitive[]): Text[] => primitives.flatMap((p) => (p.kind === "text" ? [p] : []));

/** Where the cut's dark fill reaches in a pane: the bands run the line's whole length, below 0.00 and above the ceiling. */
function cutBox(page: SheetPage, pane: number) {
  const points = paneOf(page, pane).flatMap((p) => (p.kind === "polygon" && p.color === PRESENTATION_STYLE.section.cut ? p.points : []));
  expect(points.length).toBeGreaterThan(0);
  const [xs, ys] = [points.map((p) => p.x), points.map((p) => p.y)];
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}
/** The y of each height's plain line, by its value, in a pane. */
function heightLines(page: SheetPage, pane: number): Map<string, number> {
  const primitives = paneOf(page, pane);
  const lines = primitives.flatMap((p) => (p.kind === "segment" && p.color === PRESENTATION_STYLE.section.heightLine ? [p.a.y] : []));
  const values = textsIn(primitives).map((t) => t.text);
  expect(values.length).toBe(lines.length);
  return new Map(values.map((v, i) => [v, lines[i] ?? NaN]));
}
function rowOf(shell: FakeShell, id = SHEET) {
  const row = shell.view().sheetsView?.sheets.find((s) => s.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}
function opened(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
}

describe("to scale", () => {
  const at = (scale: number) => drawn(withCommands(roomDoc(), { type: "setCeiling", height: 3.05 }, line(), sectionSheet(["s0"], { scale }))).page;

  it("a section page is to scale: a 3.05 m ceiling measures right at 1:50, a 4 m line too", () => {
    const heights = heightLines(at(50), 0);
    expect((heights.get("+3.05") ?? NaN) - (heights.get("±0.00") ?? NaN)).toBeCloseTo(61, 6);
    const cut = cutBox(at(50), 0);
    expect(cut.right - cut.left).toBeCloseTo(80, 6);
    expect(cut.top - cut.bottom).toBeCloseTo(65, 6); // with its two 0.10 m bands
  });

  it("and at another scale", () => {
    const heights = heightLines(at(100), 0);
    expect((heights.get("+3.05") ?? NaN) - (heights.get("±0.00") ?? NaN)).toBeCloseTo(30.5, 6);
    expect(cutBox(at(100), 0).right - cutBox(at(100), 0).left).toBeCloseTo(40, 6);
  });

  it("its text keeps paper sizes, whatever the scale", () => {
    const sizes = (scale: number) => textsIn(paneOf(at(scale), 0)).map((t) => t.size);
    expect(sizes(50)).toEqual(sizes(200));
    expect(sizes(50)[0]).toBe(PRESENTATION_STYLE.section.heightSize);
  });
});

describe("where it sits", () => {
  // A 4 m line under a 2.50 m ceiling at 1:50: its bounds are x −0.1 to 5.3 and y −0.2 to 2.7, so their centre, at the
  // box's centre, is 2.6 m along and 1.25 m up, and 0.00 at the line's start is that far left of and below it.
  const CENTRE = { x: 2.6 * 20, y: 1.25 * 20 };

  it("alone, centred in what's under its band, with the band across the area's top", () => {
    const { page, area } = drawn(withCommands(roomDoc(), line(), sectionSheet(["s0"], { scale: 50 })));
    expect(clipsOf(page)).toHaveLength(1);
    const box = clipsOf(page)[0]?.rect;
    expect(box).toEqual({ x: area.x, y: area.y, w: area.w, h: area.h - 9 });
    const cut = cutBox(page, 0);
    expect(cut.left).toBeCloseTo(area.x + area.w / 2 - CENTRE.x, 6);
    expect(cut.bottom).toBeCloseTo(area.y + (area.h - 9) / 2 - CENTRE.y - 0.1 * 20, 6);
  });

  it("stacked, each in its own box under its own band, by the area's edges", () => {
    const { page, area } = drawn(withCommands(roomDoc(), addNight, line(), sectionSheet(["s0", NIGHT], { scale: 50, split: "stacked" })));
    const paneH = area.h / 2;
    expect(clipsOf(page).map((c) => c.rect)).toEqual([
      { x: area.x, y: area.y + paneH, w: area.w, h: paneH - 9 },
      { x: area.x, y: area.y, w: area.w, h: paneH - 9 },
    ]);
    [area.y + paneH, area.y].forEach((y, i) => {
      const cut = cutBox(page, i);
      expect(cut.left).toBeCloseTo(area.x + area.w / 2 - CENTRE.x, 6);
      expect(cut.bottom).toBeCloseTo(y + (paneH - 9) / 2 - CENTRE.y - 0.1 * 20, 6);
    });
  });

  it("side by side, the same", () => {
    const { page, area } = drawn(withCommands(roomDoc(), addNight, line(1), sectionSheet(["s0", NIGHT], { scale: 100, split: "sideBySide" })));
    const paneW = area.w / 2;
    expect(clipsOf(page).map((c) => c.rect)).toEqual([
      { x: area.x, y: area.y, w: paneW, h: area.h - 9 },
      { x: area.x + paneW, y: area.y, w: paneW, h: area.h - 9 },
    ]);
    [area.x, area.x + paneW].forEach((x, i) => {
      // A 1 m line: bounds x −0.1 to 2.3, so 1.1 m along is the centre, at 10 mm per metre.
      expect(cutBox(page, i).left).toBeCloseTo(x + paneW / 2 - 11, 6);
    });
  });

  it("a 3.05 m studio at 1:50 fits a stacked pane on A4, its title tag clear of the floor", () => {
    // Bounds 3.45 m high: 69 mm of the 76 a pane holds. The title that the page leaves out takes no room in them.
    const shell = opened(withCommands(roomDoc(), addNight, { type: "setCeiling", height: 3.05 }, line(8), sectionSheet(["s0", NIGHT], { scale: 50, split: "stacked" })));
    expect(rowOf(shell).partOfPlan).toBe(false);
    const { page } = drawn(shell.doc());
    const tag = textsIn(page.primitives).find((t) => t.text.includes("scale 1:"));
    if (!tag) throw new Error("no tag");
    expect(cutBox(page, 1).bottom).toBeGreaterThan(tag.at.y + tag.size);
  });

  it("its name sits in the band, above all its picture can reach", () => {
    const { page, area } = drawn(withCommands(roomDoc(), addNight, { type: "renameState", stateId: "s0", name: "Day" }, line(), sectionSheet(["s0", NIGHT], { scale: 50, split: "stacked" })));
    const [day, night] = clipsOf(page).map((c) => c.rect);
    if (!day || !night) throw new Error("not two panes");
    const named = (name: string) => textsIn(page.primitives).find((t) => t.text === name)?.at.y;
    expect(named("DAY")).toBeCloseTo(area.y + area.h - 4.5, 6);
    expect(named("NIGHT")).toBeCloseTo(night.y + night.h + 4.5, 6);
    expect(cutBox(page, 0).top).toBeLessThan(day.y + day.h);
    expect(cutBox(page, 1).top).toBeLessThan(night.y + night.h);
  });

  it("doesn't depend on where the section lies on the plan", () => {
    const here = withCommands(roomDoc(), line(), sectionSheet(["s0"], { scale: 50 }));
    const there = withCommands(clearRoomDoc(30, 12, "r"), line(4, 9, 22), sectionSheet(["s0"], { scale: 50 }));
    expect(cutBox(drawn(there).page, 0).left).toBeCloseTo(cutBox(drawn(here).page, 0).left, 6);
    expect(cutBox(drawn(there).page, 0).bottom).toBeCloseTo(cutBox(drawn(here).page, 0).bottom, 6);
  });
});

describe("one framing", () => {
  it("its panes share one framing, whatever the layouts: a bed in one moves neither", () => {
    const { page } = drawn(withCommands(nightBedDoc(), line(4, 2), sectionSheet(["s0", NIGHT], { scale: 50, split: "stacked", cx: 0.5, cy: -0.25 })));
    const rects = clipsOf(page).map((c) => c.rect);
    expect(rects).toHaveLength(2);
    const fills = (pane: number) => paneOf(page, pane).filter((p) => p.kind === "polygon" && p.color === PRESENTATION_STYLE.section.furniture).length;
    expect(fills(0)).toBe(0); // the panes do differ
    expect(fills(1)).toBeGreaterThan(0);
    const offsets = rects.map((r, i) => ({ x: cutBox(page, i).left - r.x, y: cutBox(page, i).bottom - r.y }));
    expect(offsets[1]?.x).toBeCloseTo(offsets[0]?.x ?? NaN, 6);
    expect(offsets[1]?.y).toBeCloseTo(offsets[0]?.y ?? NaN, 6);
  });

  it("cx and cy are metres along the cut and up: they move every pane's picture the other way", () => {
    const framed = (cx: number, cy: number) => drawn(withCommands(roomDoc(), addNight, line(), sectionSheet(["s0", NIGHT], { scale: 50, split: "stacked", cx, cy }))).page;
    [0, 1].forEach((pane) => {
      expect(cutBox(framed(0.5, -0.25), pane).left - cutBox(framed(0, 0), pane).left).toBeCloseTo(-10, 6);
      expect(cutBox(framed(0.5, -0.25), pane).bottom - cutBox(framed(0, 0), pane).bottom).toBeCloseTo(5, 6);
    });
  });

  it("a framing drag moves it as far on paper, and Centre clears it", () => {
    const shell = opened(withCommands(roomDoc(), line(), sectionSheet(["s0"], { scale: 50 })));
    const before = cutBox(drawn(shell.doc()).page, 0);
    shell.ui({ type: "frameSheet", id: SHEET, dxMm: 7, dyMm: -3 });
    const after = cutBox(drawn(shell.doc()).page, 0);
    expect(after.left - before.left).toBeCloseTo(7, 6);
    expect(after.bottom - before.bottom).toBeCloseTo(-3, 6);
    expect(rowOf(shell).centred).toBe(false);
    shell.ui({ type: "setSheet", id: SHEET, fields: { cx: 0, cy: 0 } });
    expect(cutBox(drawn(shell.doc()).page, 0).left).toBeCloseTo(before.left, 6);
  });
});

describe("what prints beside it", () => {
  const rename: Command = { type: "renameState", stateId: "s0", name: "Day" };

  it("its column has no north or rooms table", () => {
    const doc = withCommands(labelledDoc(), line(), { type: "setProjectField", key: "north", value: "90" }, sectionSheet(["s0"]));
    const { page } = drawn(doc);
    expect(clipsOf(page)).toHaveLength(1);
    expect(textsIn(paneOf(page, 0)).length).toBeGreaterThan(0); // the page does draw
    const columnX = page.widthMm - MARGIN_MM - columnMm("A4");
    const column = textsIn(page.primitives).filter((t) => t.at.x >= columnX).map((t) => t.text);
    expect(column.length).toBeGreaterThan(0);
    expect(column).not.toContain("ROOM");
    expect(column).not.toContain("N");
    const plan = textsIn(drawn(doc, "auto/0").page.primitives).map((t) => t.text);
    expect(plan).toContain("ROOM"); // what those two would have looked like
    expect(plan).toContain("N");
  });

  it("a compare-style section sheet shows band names without a doubled title", () => {
    const { page } = drawn(withCommands(roomDoc(), rename, addNight, line(), sectionSheet(["s0", NIGHT], { split: "stacked" })));
    const all = textsIn(page.primitives).map((t) => t.text);
    expect(all.filter((t) => t === "DAY")).toHaveLength(1);
    expect(all.filter((t) => t === "NIGHT")).toHaveLength(1);
    expect(all.filter((t) => t.includes("scale 1:"))).toEqual(["SECTION A–A  ·  scale 1:50"]);
    expect(all.filter((t) => t.includes("A–A · "))).toEqual([]); // the picture's own title stays out
    expect(all.filter((t) => t.includes("A–A"))).toHaveLength(1);
    // Nothing but heights in the clips: names and the title sit outside them, where a framing can't hide them.
    const inside = [0, 1].flatMap((pane) => textsIn(paneOf(page, pane)).map((t) => t.text));
    expect(inside).toHaveLength(4);
    expect(inside.every((t) => t === "±0.00" || t === "+2.50")).toBe(true);
  });

  it("with one layout it's still named, as a section sheet has no other place to say which", () => {
    const { page } = drawn(withCommands(roomDoc(), rename, line(), sectionSheet(["s0"])));
    expect(textsIn(page.primitives).map((t) => t.text)).toContain("DAY");
  });

  it("a section someone just deleted leaves a blank page, not a broken one", () => {
    const doc = withCommands(roomDoc(), line(), sectionSheet(["s0"]));
    const gone: Document = { ...doc, sections: {} }; // only a race can leave this: a delete takes its sheets (I23)
    const { page } = drawn(gone);
    expect(clipsOf(page)).toEqual([]);
    expect(page.primitives.length).toBeGreaterThan(0);
  });
});

describe("its fit", () => {
  it("a scale that doesn't fit is refused like a plan's: a dot on the grid, a note and a way out; the page still prints", () => {
    // 8 m along: 9.4 m of bounds, 470 mm at 1:20 in a frame holding 207: not whole. 188 mm at 1:50: whole.
    const shell = opened(withCommands(roomDoc(), line(8), sectionSheet(["s0"], { scale: 20 })));
    const row = rowOf(shell);
    expect(row.partOfPlan).toBe(true);
    expect(row.shortcuts).toMatchObject({ centre: false, fit: 50 });
    expect(row.scales.filter((s) => s.scale !== null && s.nofit).map((s) => s.scale)).toEqual([20, 25]);
    expect(drawn(shell.doc()).page.clips).toHaveLength(1);

    shell.ui({ type: "setSheet", id: SHEET, fields: { scale: 50 } });
    expect(rowOf(shell).partOfPlan).toBe(false);
    expect(rowOf(shell).shortcuts).toBeNull();
  });

  it("the frame is the pane under its band, not the page", () => {
    // A 3 m line under 2.50 m: bounds 4.4 × 2.9 m, 176 × 116 mm at 1:25. Alone, the box holds 207 × 171 inside its inset; a stacked pane 207 × 76.
    const alone = opened(withCommands(roomDoc(), line(3), sectionSheet(["s0"], { scale: 25 })));
    expect(rowOf(alone).partOfPlan).toBe(false);
    const stacked = opened(withCommands(roomDoc(), addNight, line(3), sectionSheet(["s0", NIGHT], { scale: 25, split: "stacked" })));
    expect(rowOf(stacked).partOfPlan).toBe(true);
    expect(rowOf(stacked).scales.find((s) => s.scale === 25)?.nofit).toBe(true);
  });

  it("the band counts: exactly what the box under it holds", () => {
    // Bounds 0.40 m higher than the ceiling, at 40 mm per metre. The page alone would hold 180 mm inside its inset, the box under the band 171.
    const fits = (height: number) => {
      const shell = opened(withCommands(roomDoc(), { type: "setCeiling", height }, line(3), sectionSheet(["s0"], { scale: 25 })));
      return !rowOf(shell).partOfPlan;
    };
    expect(fits(3.8)).toBe(true); // 168 mm
    expect(fits(4.1)).toBe(false); // 180 mm
  });

  it("a section's own size decides, not the plan's: a short cut of a long plan fits, and a long cut of a small one doesn't", () => {
    const short = opened(withCommands(clearRoomDoc(30, 3, "r"), line(), sectionSheet(["s0"], { scale: 50 })));
    expect(rowOf(short).partOfPlan).toBe(false);
    expect(rowOf(short).scales.find((s) => s.scale === 50)?.nofit).toBe(false);
    expect(rowOf(short, "auto/0").scales.find((s) => s.scale === 50)?.nofit).toBe(true); // that plan, on its own sheet at the same scale
    const long = opened(withCommands(roomDoc(), line(30), sectionSheet(["s0"], { scale: 50 })));
    expect(rowOf(long).partOfPlan).toBe(true);
    expect(rowOf(long, "auto/0").partOfPlan).toBe(false);
  });

  it("dragging past the frame shows the note, and Centre clears it", () => {
    const shell = opened(withCommands(roomDoc(), line(), sectionSheet(["s0"], { scale: 50 })));
    expect(rowOf(shell).partOfPlan).toBe(false);
    shell.ui({ type: "frameSheet", id: SHEET, dxMm: 200, dyMm: 0 });
    expect(rowOf(shell).partOfPlan).toBe(true);
    expect(rowOf(shell).shortcuts).toMatchObject({ centre: true });
    shell.ui({ type: "setSheet", id: SHEET, fields: { cx: 0, cy: 0 } });
    expect(rowOf(shell).partOfPlan).toBe(false);
  });

  it("Automatic stacks a wide section and sets a narrow, tall one side by side", () => {
    const split = (doc: Document) => {
      const [a, b] = clipsOf(drawn(doc).page).map((c) => c.rect);
      if (!a || !b) throw new Error("not two panes");
      return a.x === b.x ? "stacked" : "sideBySide";
    };
    expect(split(withCommands(roomDoc(), addNight, line(8), sectionSheet(["s0", NIGHT])))).toBe("stacked");
    expect(split(withCommands(roomDoc(), addNight, { type: "setCeiling", height: 9 }, line(1), sectionSheet(["s0", NIGHT])))).toBe("sideBySide");
  });

  it("Fit, the set's general scale, reads plans alone", () => {
    const shell = opened(withCommands(roomDoc(), line(40), sectionSheet(["s0"], { scale: 20 })));
    expect(shell.view().sheetsView?.scales[0]?.label).toBe("Fit (1:50)"); // a 40 m section doesn't drag the set's Fit down
  });
});

describe("the heights' labels at the smallest scale (section.27)", () => {
  /** Each label's right end, against the box it's clipped to, when its sheet fits at its tightest. */
  function labelClearance(ceiling: number, length: number): number {
    const shell = opened(withCommands(roomDoc(), { type: "setCeiling", height: ceiling }, line(length, 1, 0), sectionSheet(["s0"], { scale: 200 })));
    expect(rowOf(shell).partOfPlan).toBe(false); // the fit test calls it whole
    const { page } = drawn(shell.doc());
    const box = clipsOf(page)[0]?.rect;
    if (!box) throw new Error("no pane");
    const labels = textsIn(paneOf(page, 0));
    expect(labels.length).toBeGreaterThanOrEqual(2);
    return box.x + box.w - Math.max(...labels.map((t) => t.at.x + helveticaWidth(t.text, t.size)));
  }

  it("a sheet the fit test calls whole shows them whole at 1:200, on its widest line", () => {
    // A 40 m line has 41.4 m of bounds, 207 mm at 1:200: exactly what a frame on A4 holds inside its inset.
    expect(labelClearance(2.5, 40)).toBeGreaterThanOrEqual(0);
  });

  it("also with the widest value, a 10 m ceiling's", () => {
    expect(labelClearance(10, 40)).toBeGreaterThanOrEqual(0);
  });

  it("past that line, the note speaks", () => {
    const shell = opened(withCommands(roomDoc(), line(40.5, 1, 0), sectionSheet(["s0"], { scale: 200 })));
    expect(rowOf(shell).partOfPlan).toBe(true);
  });
});

describe("the rest of the set", () => {
  /** A plan sheet's page, what fits it and what the set does with it, with no marks: only what a section could move. */
  function planFacts(doc: Document, id = "auto/0") {
    const shell = opened(doc);
    const { page } = drawn(doc, id);
    const row = rowOf(shell, id);
    const walls = page.primitives.filter((p) => p.kind === "polygon" && p.color === PRESENTATION_STYLE.wall);
    expect(walls.length).toBeGreaterThan(0);
    return { walls, clips: page.clips?.map((c) => c.rect), width: page.widthMm, height: page.heightMm, partOfPlan: row.partOfPlan, scale: row.scale, scales: row.scales, shortcuts: row.shortcuts };
  }
  const FAR: Command = { type: "addSection", a: { x: 40, y: 40 }, b: { x: 90, y: 40 }, side: 1 };

  it("adding a section moves no existing sheet: framing and fit of a plan sheet identical", () => {
    const base = clearRoomDoc(8, 5.8, "r");
    expect(planFacts(withCommands(base, FAR))).toEqual(planFacts(base));
  });

  it("nor does adding its sheet: a long section never turns the set's pages", () => {
    const tall = clearRoomDoc(3, 9, "t");
    const layout = Object.keys(tall.states)[0] ?? "";
    expect(sheetSet(tall, options()).orientation).toBe("portrait");
    const withSheet = withCommands(tall, FAR, sectionSheet([layout], { scale: 20 }));
    expect(sheetSet(withSheet, options()).orientation).toBe("portrait");
    expect(planFacts(withSheet)).toEqual(planFacts(tall));
  });

  it("nor does printing it on stored rows: a plan's own framing stays", () => {
    const stored = withCommands(clearRoomDoc(8, 5.8, "r"), { type: "setSheet", sheetId: "auto/0", cx: 0.3, cy: 0.2, scale: 75 });
    expect(planFacts(withCommands(stored, FAR, sectionSheet(["s0"])))).toEqual(planFacts(stored));
  });
});

describe("offered like a missing layout", () => {
  const offered = (shell: FakeShell) => shell.view().sheetsView?.missingSections;

  it("each section with no sheet, on an automatic list too; a layout's own offer stays apart", () => {
    const doc = withCommands(roomDoc(), line(), line(4, 2));
    const shell = opened(doc);
    expect(sheetsOf(doc).every((s) => s.id.startsWith("auto/"))).toBe(true);
    expect(offered(shell)).toEqual([{ section: "A", label: "A–A" }, { section: "B", label: "B–B" }]);
    expect(shell.view().sheetsView?.missing).toEqual([]);
  });

  it("a section's sheet takes it off the list; another section's doesn't; a plan never does", () => {
    const shell = opened(withCommands(roomDoc(), line(), line(4, 2), sectionSheet(["s0"])));
    expect(offered(shell)).toEqual([{ section: "B", label: "B–B" }]);
  });

  it("a project with no sections offers none", () => {
    expect(offered(opened(roomDoc()))).toEqual([]);
  });

  it("Add makes that section's sheet for the viewed layout, selected, one undo step", () => {
    const doc = withCommands(roomDoc(), addNight, line(), line(4, 2));
    const shell = opened(doc);
    shell.ui({ type: "setActiveState", id: NIGHT });
    shell.ui({ type: "addMissingSection", section: "B" });
    const id = shell.view().sheetsView?.selected ?? "";
    const added = sheetsOf(shell.doc()).find((s) => s.id === id);
    expect(added).toMatchObject({ kind: "section", section: "B", title: "Section B–B" });
    expect(added?.drawings).toEqual(sheetsOf(withCommands(doc, sectionSheet([NIGHT]))).find((s) => s.id === SHEET)?.drawings);
    expect(offered(shell)).toEqual([{ section: "A", label: "A–A" }]);
    shell.key("z", { meta: true });
    expect(offered(shell)).toEqual([{ section: "A", label: "A–A" }, { section: "B", label: "B–B" }]);
  });

  it("a new section sheet that General would cut opens at the largest scale showing it whole", () => {
    // The room's Fit on A4 is 1:50. A 12 m line has 13.4 m of bounds: 268 mm at 1:50, 179 mm at 1:75, in a frame holding 207.
    const shell = opened(withCommands(roomDoc(), line(12)));
    shell.ui({ type: "addMissingSection", section: "A" });
    const id = shell.view().sheetsView?.selected ?? "";
    expect(rowOf(shell, id).partOfPlan).toBe(false);
    expect(rowOf(shell, id).ownScale).toBe(true);
    expect(rowOf(shell, id).scale).toBe(75);
  });

  it("one General shows whole follows General", () => {
    const shell = opened(withCommands(roomDoc(), line()));
    shell.ui({ type: "addSheet", kind: "section" });
    const id = shell.view().sheetsView?.selected ?? "";
    expect(rowOf(shell, id).ownScale).toBe(false);
  });
});
