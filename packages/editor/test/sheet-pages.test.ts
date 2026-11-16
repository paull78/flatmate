import { describe, expect, it } from "vitest";
import { motifDefaults, sheetsOf, type Command, type Document, type PaperName } from "@fm/domain";
import { helveticaWidth } from "../src/export/helvetica";
import { MARGIN_MM, columnMm, drawingArea, type Orientation } from "../src/export/paper";
import { pagesOf, sheetPages, sheetSet, showsPart, type SheetPage } from "../src/export/sheet";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { clearRoomDoc, roomDoc, wallDoc, withCommands } from "./builders";
import { FakeHost } from "./fake-shell";

// Pages from sheetsOf (sheetset.08, .17, .19, .20; AC-01, AC-04, AC-05, AC-11): one plan page per sheet In PDF, each at
// its own scale and framing, in one solid frame, with its title at the bottom left and the number at the column's foot.

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}

type Options = { paper?: PaperName; scale?: number | "fit" };
const options = ({ paper = "A4", scale = 50 }: Options = {}) => ({ projectName: "Flat", paper, scale, host: host(), finishes: true });
const pages = (doc: Document, o?: Options): SheetPage[] => sheetPages(doc, options(o)).pages;
function onlyPage(doc: Document, o?: Options): SheetPage {
  const [page, ...rest] = pages(doc, o);
  if (!page || rest.length > 0) throw new Error("not one page");
  return page;
}

type Text = Extract<Primitive, { kind: "text" }>;
type Segment = Extract<Primitive, { kind: "segment" }>;
const texts = (page: SheetPage): Text[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
const segments = (page: SheetPage): Segment[] => page.primitives.flatMap((p) => (p.kind === "segment" ? [p] : []));
const columnX = (page: SheetPage, paper: PaperName = "A4"): number => page.widthMm - MARGIN_MM - columnMm(paper);
/** The drawing's title and scale, as the mockup prints them on one line. */
const tag = (page: SheetPage): Text | undefined => texts(page).find((t) => t.text.includes("scale 1:"));
const tags = (ps: readonly SheetPage[]): (string | undefined)[] => ps.map((p) => tag(p)?.text);
/** The walls' fills on the page, the plan's only near-black polygons. */
const wallPoints = (page: SheetPage) => page.primitives.flatMap((p) => (p.kind === "polygon" && p.color === PRESENTATION_STYLE.wall ? p.points : []));
const xSpan = (page: SheetPage): number => {
  const xs = wallPoints(page).map((q) => q.x);
  return Math.max(...xs) - Math.min(...xs);
};
const left = (page: SheetPage): number => Math.min(...wallPoints(page).map((q) => q.x));
const bottom = (page: SheetPage): number => Math.min(...wallPoints(page).map((q) => q.y));

const named = (doc: Document): Document => withCommands(doc, { type: "renameState", stateId: "s0", name: "Day" }, { type: "addState", opId: "n", name: "Night" });
const NIGHT = "n/s0";
const LOFT = "loft/k0";
/** roomDoc under a tall ceiling, with a loft and a Living tag. Day and Night; a bed stands on the loft only with `bed`. */
const studio = (bed: boolean): Document =>
  withCommands(
    named(roomDoc()),
    { type: "setCeiling", height: 3.5 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2 }, w: 2.4, d: 2.4 },
    { type: "labelZone", id: "L1", at: { x: 4.8, y: 2 }, name: "Living", finish: null },
    ...(bed ? [{ type: "placeObject", linked: false, deck: LOFT, opId: "bed", state: NIGHT, object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 2.5, y: 2 } } satisfies Command] : []),
  );

const plan = (opId: string, fields: Partial<Omit<Extract<Command, { type: "addSheet" }>, "type" | "opId" | "kind">> = {}, layout = "s0"): Command => ({
  type: "addSheet",
  opId,
  after: null,
  kind: "plan",
  drawings: [{ layout, deck: null }],
  ...fields,
});
/** The doc with only the sheets added, in that order. */
const withSheets = (doc: Document, ...added: Command[]): Document =>
  withCommands(doc, ...added, ...sheetsOf(doc).map((s): Command => ({ type: "deleteSheet", sheetId: s.id })));

describe("the list of pages (AC-01)", () => {
  it("no rows: as many pages as layouts, in order, at the floor", () => {
    const [day, night, ...rest] = pages(studio(false));
    expect(rest).toEqual([]);
    if (!day || !night) throw new Error("no pages");
    expect(tags([day, night])).toEqual(["DAY  ·  scale 1:50", "NIGHT  ·  scale 1:50"]);
    // At the floor: an upper level has no room tags, and "Living" is also in the column's table.
    const inPlan = (page: SheetPage) => texts(page).filter((t) => t.text === "Living" && t.at.x < columnX(page));
    expect(inPlan(day)).toHaveLength(1);
    expect(inPlan(night)).toHaveLength(1);
  });

  it("no rows: a loft with its own pieces adds pages, drawn at that level", () => {
    const ps = pages(studio(true));
    expect(tags(ps)).toEqual(["DAY  ·  scale 1:50", "NIGHT  ·  scale 1:50", "NIGHT · LOFT  ·  scale 1:50"]);
    const loft = ps[2];
    if (!loft) throw new Error("no page");
    expect(texts(loft).filter((t) => t.text === "Living" && t.at.x < columnX(loft))).toEqual([]);
  });

  it("one page per sheet In PDF, in order", () => {
    const doc = withSheets(named(roomDoc()), plan("b", { title: "Second" }, NIGHT), plan("a", { title: "First" }));
    expect(tags(pages(doc))).toEqual(["SECOND  ·  scale 1:50", "FIRST  ·  scale 1:50"]);
    const moved = withCommands(doc, { type: "moveSheet", sheetId: "a/t0", index: 0 });
    expect(tags(pages(moved))).toEqual(["FIRST  ·  scale 1:50", "SECOND  ·  scale 1:50"]);
  });

  it("an unticked sheet makes none, and doesn't count in the numbers", () => {
    const doc = withSheets(roomDoc(), plan("a", { title: "A" }), plan("b", { title: "B", inPdf: false }), plan("c", { title: "C" }));
    const ps = pages(doc);
    expect(tags(ps)).toEqual(["A  ·  scale 1:50", "C  ·  scale 1:50"]);
    expect(texts(ps[1] ?? { widthMm: 0, heightMm: 0, primitives: [] }).map((t) => t.text)).toContain("Sheet 02 / 02");
  });

  it("a sheet that isn't a plan makes a blank framed page in its place", () => {
    const doc = withSheets(roomDoc(), plan("a"), { type: "addSheet", opId: "r", after: null, kind: "report", drawings: [], title: "Report" });
    const [drawn, blank, ...rest] = pages(doc);
    expect(rest).toEqual([]);
    if (!drawn || !blank) throw new Error("no pages");
    expect(wallPoints(blank)).toEqual([]);
    expect(tag(blank)).toBeUndefined();
    expect(segments(blank).filter((s) => s.a.x === columnX(blank) && s.b.x === columnX(blank))).toHaveLength(1);
    expect(texts(blank).map((t) => t.text)).toEqual(expect.arrayContaining(["Flat", "Sheet 02 / 02"]));
    expect(texts(blank).map((t) => t.text)).not.toContain("0"); // nothing drawn to measure: no scale bar
  });
});

describe("scale (AC-04)", () => {
  it("two sheets of one plan at 1:20 and 1:100 draw at each scale", () => {
    const doc = withSheets(wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 }), plan("big", { scale: 20 }), plan("small", { scale: 100 }));
    const [big, small] = pages(doc);
    if (!big || !small) throw new Error("no pages");
    expect(xSpan(big)).toBeCloseTo(200, 6); // 4 m at 50 mm per metre
    expect(xSpan(small)).toBeCloseTo(40, 6);
    expect(tags([big, small])).toEqual(["scale 1:20", "scale 1:100"]); // no title: the scale alone
  });

  it("a sheet with no scale of its own follows the general scale", () => {
    const doc = withSheets(wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 }), plan("own", { scale: 100 }), plan("general"));
    const [own, general] = pages(doc, { scale: 25 });
    if (!own || !general) throw new Error("no pages");
    expect(xSpan(own)).toBeCloseTo(40, 6);
    expect(xSpan(general)).toBeCloseTo(160, 6);
  });

  it("the scale bar's length is true at 1:75", () => {
    const page = onlyPage(withSheets(roomDoc(), plan("a", { scale: 75 })));
    const at = (s: string) => texts(page).find((t) => t.text === s)?.at.x ?? Number.NaN;
    const k = 1000 / 75;
    expect(at("2 m") - at("0")).toBeCloseTo(2 * k, 6);
    // The bar's four cells, black and white, under its labels.
    const cells = page.primitives.flatMap((p) => (p.kind === "polygon" && p.points.every((q) => q.x >= columnX(page)) ? [p] : []));
    expect(cells).toHaveLength(4);
    const xs = cells.flatMap((c) => c.points.map((q) => q.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * k, 6);
  });

  it("orientation is one for the set, from each plan sheet's drawn size at its own scale", () => {
    // The floor's dimension line makes it tall, which alone is portrait, but at 1:200 it's far smaller than the loft's wide plan at 1:50.
    const tall = withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2 }, w: 2.4, d: 2.4 }, { type: "addDimension", opId: "m", a: { x: 6.1, y: -0.1 }, b: { x: -0.1, y: -0.1 }, offset: 8 });
    const floor = plan("floor", { scale: 200 });
    const loft: Command = { type: "addSheet", opId: "up", after: null, kind: "plan", drawings: [{ layout: "s0", deck: LOFT }], scale: 50 };
    expect(sheetPages(withSheets(tall, floor), options()).orientation).toBe("portrait");
    const both = sheetPages(withSheets(tall, floor, loft), options());
    expect(both.orientation).toBe("landscape");
    expect(both.pages.map((p) => [p.widthMm, p.heightMm])).toEqual([[297, 210], [297, 210]]);
  });

  it("a sheet's own floor finishes switch: off leaves the floors out, and the set's With can't turn it on", () => {
    const planks = motifDefaults("planks");
    const floored = withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Living", finish: planks });
    const colour = (page: SheetPage) => page.primitives.filter((p) => p.color === planks.colour);
    const [withFloor, without] = pages(withSheets(floored, plan("a"), plan("b", { finishes: false })));
    if (!withFloor || !without) throw new Error("no pages");
    expect(colour(withFloor).length).toBeGreaterThan(0);
    expect(colour(without)).toEqual([]);
  });

  it("paper A1 and A2 give their sizes", () => {
    const size = (paper: PaperName): [number, number] => {
      const page = onlyPage(roomDoc(), { paper, scale: 20 });
      return [page.widthMm, page.heightMm];
    };
    expect(size("A1")).toEqual([841, 594]); // landscape: the room is wide
    expect(size("A2")).toEqual([594, 420]);
  });
});

describe("framing (AC-05)", () => {
  const room = (fields: Parameters<typeof plan>[1]): SheetPage => onlyPage(withSheets(roomDoc(), plan("a", fields)));

  it("framing moves the plan, not the frame", () => {
    const centred = room({ scale: 50 });
    const framed = room({ scale: 50, cx: 1, cy: -0.5 });
    expect(left(framed) - left(centred)).toBeCloseTo(-20, 6); // the frame's centre looks 1 m further right
    expect(bottom(framed) - bottom(centred)).toBeCloseTo(10, 6);
    const outsidePlan = (page: SheetPage) => page.primitives.slice(page.clips?.[0]?.to);
    expect(outsidePlan(framed)).toEqual(outsidePlan(centred));
    expect(framed.clips?.[0]?.rect).toEqual(centred.clips?.[0]?.rect);
  });

  it("showing part of the plan adds nothing to the page: past the frame, it prints what any framing prints (AC-06)", () => {
    const doc = withSheets(roomDoc(), plan("a", { scale: 50, cx: 20 }));
    const [sheet] = sheetsOf(doc);
    if (!sheet) throw new Error("no sheet");
    expect(showsPart(doc, sheet, sheetSet(doc, options()))).toBe(true);
    const outsidePlan = (page: SheetPage) => page.primitives.slice(page.clips?.[0]?.to);
    const past = onlyPage(doc);
    expect(outsidePlan(past)).toEqual(outsidePlan(room({ scale: 50 })));
    expect(texts(past).filter((t) => /part/i.test(t.text))).toEqual([]);
  });

  it("framing survives a scale change: it's stored in metres", () => {
    for (const scale of [20, 100]) {
      const k = 1000 / scale;
      expect(left(room({ scale, cx: 1 })) - left(room({ scale }))).toBeCloseTo(-k, 6);
    }
  });

  it("centres on the floor's bounds, so a loft sheet stays aligned with the floor's", () => {
    // The dimension widens the floor's bounds to the right; the loft draws no dimension and lands in the same place.
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2 }, w: 2.4, d: 2.4 }, { type: "addDimension", opId: "m", a: { x: 6.1, y: 0 }, b: { x: 6.1, y: 3 }, offset: 2 });
    const [floor, up] = pages(withSheets(doc, plan("f"), { type: "addSheet", opId: "u", after: null, kind: "plan", drawings: [{ layout: "s0", deck: LOFT }] }));
    if (!floor || !up) throw new Error("no pages");
    expect(left(up)).toBeCloseTo(left(floor), 6);
  });

  it("the plan is in the clip, the frame and column aren't", () => {
    const page = room({ scale: 20, cx: 3 }); // pushed past the frame's left edge
    const [clip, ...more] = page.clips ?? [];
    expect(more).toEqual([]);
    if (!clip) throw new Error("no clip");
    const area = drawingArea("A4", "landscape");
    expect(clip.rect).toEqual({ x: area.x, y: area.y, w: area.w, h: area.h });
    expect(clip.from).toBe(0);
    const inside = page.primitives.slice(clip.from, clip.to);
    const after = page.primitives.slice(clip.to);
    expect(inside.filter((p) => p.kind === "polygon" && p.color === PRESENTATION_STYLE.wall).length).toBeGreaterThan(0);
    expect(after.filter((p) => p.kind === "polygon" && p.color === PRESENTATION_STYLE.wall)).toEqual([]);
    expect(inside.filter((p) => p.kind === "text" && p.at.x >= columnX(page))).toEqual([]);
    expect(after.flatMap((p) => (p.kind === "text" ? [p.text] : []))).toEqual(expect.arrayContaining(["Flat", "2026-10-13"]));
    expect(after.filter((p) => p.kind === "segment" && p.a.x === columnX(page)).length).toBe(1);
    expect(left(page)).toBeLessThan(area.x); // the fixture changes the answer: only the clip keeps it off the frame
  });
});

describe("the frame (AC-11)", () => {
  it.each<[PaperName, Orientation]>([["A4", "landscape"], ["A3", "landscape"], ["Letter", "landscape"]])("one solid frame with one shared edge on %s", (paper, orientation) => {
    const page = onlyPage(roomDoc(), { paper, scale: 100 });
    expect(page.widthMm > page.heightMm).toBe(orientation === "landscape");
    const segs = segments(page);
    expect(segs.filter((s) => s.dash !== undefined)).toEqual([]);
    const m = MARGIN_MM;
    const [l, r, b, t] = [m, page.widthMm - m, m, page.heightMm - m];
    const near = (a: number, c: number): boolean => Math.abs(a - c) < 1e-9;
    const edge = (x0: number, y0: number, x1: number, y1: number) =>
      segs.filter((s) => (near(s.a.x, x0) && near(s.a.y, y0) && near(s.b.x, x1) && near(s.b.y, y1)) || (near(s.a.x, x1) && near(s.a.y, y1) && near(s.b.x, x0) && near(s.b.y, y0)));
    for (const side of [edge(l, b, r, b), edge(r, b, r, t), edge(r, t, l, t), edge(l, t, l, b)]) expect(side).toHaveLength(1);
    // The column's left edge is the frame's right edge: one segment, top to bottom, and nothing else on that line.
    const x = columnX(page, paper);
    const shared = segs.filter((s) => near(s.a.x, x) && near(s.b.x, x));
    expect(shared).toHaveLength(1);
    expect(shared[0]?.a.y).toBeCloseTo(b, 9);
    expect(shared[0]?.b.y).toBeCloseTo(t, 9);
    const rect = page.clips?.[0]?.rect;
    expect((rect?.x ?? 0) + (rect?.w ?? 0)).toBeCloseTo(x, 9);
  });
});

describe("what a page prints (sheetset.19, .20)", () => {
  it("the title and scale print once: at the drawing's bottom left, and not in the column", () => {
    const page = onlyPage(named(withSheets(roomDoc(), plan("a", { title: "Bedroom detail", scale: 25 }))));
    expect(texts(page).filter((t) => t.text.includes("1:25")).map((t) => t.text)).toEqual(["BEDROOM DETAIL  ·  scale 1:25"]);
    expect(texts(page).filter((t) => /bedroom detail/i.test(t.text))).toHaveLength(1);
    const printed = tag(page);
    if (!printed) throw new Error("no title");
    const area = drawingArea("A4", "landscape");
    expect(printed.align).toBe("left");
    expect(printed.at.x).toBeLessThan(area.x + 5);
    expect(printed.at.y).toBeLessThan(area.y + 10);
    expect(printed.at.x).toBeGreaterThan(area.x);
    expect(printed.at.y).toBeGreaterThan(area.y);
  });

  it("the foot keeps the bar, paper, date and disclaimer", () => {
    const page = onlyPage(roomDoc());
    const inColumn = texts(page).filter((t) => t.at.x >= columnX(page)).map((t) => t.text);
    expect(inColumn).toEqual(expect.arrayContaining(["0", "2 m", "A4", "2026-10-13", "Dimensions are approximate; check on site."]));
  });

  it("a long title ends in … and leaves the scale and the frame alone", () => {
    // A tall room prints in portrait, where A4's area is 130 mm wide: 80 wide capitals don't fit.
    const page = onlyPage(withSheets(clearRoomDoc(3, 8, "r"), plan("a", { title: "W".repeat(80) })), { scale: 100 });
    const printed = tag(page);
    expect(printed?.text.endsWith("W…  ·  scale 1:100")).toBe(true);
    if (!printed) throw new Error("no title");
    const right = printed.at.x + helveticaWidth(printed.text, printed.size);
    expect(right).toBeLessThanOrEqual(columnX(page));
  });

  it('sheet number: "Sheet 02 / 03"; none for a set of one', () => {
    const three = pages(withSheets(roomDoc(), plan("a"), plan("b"), plan("c")));
    expect(three.map((p) => texts(p).filter((t) => t.text.startsWith("Sheet ")).map((t) => t.text))).toEqual([["Sheet 01 / 03"], ["Sheet 02 / 03"], ["Sheet 03 / 03"]]);
    expect(texts(three[1] ?? onlyPage(roomDoc())).find((t) => t.text === "Sheet 02 / 03")?.at.x).toBeGreaterThanOrEqual(columnX(three[1] ?? onlyPage(roomDoc())));
    expect(texts(onlyPage(roomDoc())).filter((t) => t.text.startsWith("Sheet "))).toEqual([]);
  });

  it("the layout key is gone: no extra plan pictures per page", () => {
    const page = pages(named(roomDoc()))[0];
    if (!page) throw new Error("no page");
    expect(texts(page).map((t) => t.text)).not.toContain("LAYOUTS");
    expect(wallPoints(page).filter((q) => q.x >= columnX(page))).toEqual([]);
    const one = onlyPage(roomDoc());
    expect(wallPoints(page)).toHaveLength(wallPoints(one).length); // two layouts draw one plan a page, as one layout does
  });
});

describe("pagesOf", () => {
  it("pages are built per sheet: a sheet's pages, the ones sheetPages lists", () => {
    const doc = withSheets(roomDoc(), plan("a", { scale: 20 }), plan("b", { scale: 100 }), plan("c", { inPdf: false }));
    const set = sheetSet(doc, options());
    const [a, b, c] = sheetsOf(doc);
    if (!a || !b || !c) throw new Error("no sheets");
    expect(pagesOf(doc, a, set)).toHaveLength(1);
    expect([...pagesOf(doc, a, set), ...pagesOf(doc, b, set)]).toEqual(sheetPages(doc, options()).pages);
    // An unticked sheet still has a page, for the view to show, with no number.
    const [off] = pagesOf(doc, c, set);
    expect(off && texts(off).filter((t) => t.text.startsWith("Sheet "))).toEqual([]);
  });

  it("kept per document, so the view rebuilds nothing on an event", () => {
    const doc = withSheets(roomDoc(), plan("a"), plan("b"));
    const [a, b] = sheetsOf(doc);
    if (!a || !b) throw new Error("no sheets");
    const set = sheetSet(doc, options());
    const first = pagesOf(doc, a, set);
    expect(pagesOf(doc, b, set)).not.toBe(first);
    expect(pagesOf(doc, a, sheetSet(doc, options()))).toBe(first);
    expect(pagesOf(doc, a, sheetSet(doc, options({ scale: 100 })))).not.toBe(first);
    const edited = withCommands(doc, { type: "setSheet", sheetId: "a/t0", cx: 1 });
    const [movedA] = sheetsOf(edited);
    if (!movedA) throw new Error("no sheet");
    expect(pagesOf(edited, movedA, sheetSet(edited, options()))).not.toEqual(first);
  });
});
