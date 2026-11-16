import { describe, expect, it } from "vitest";
import { PROJECT_FIELDS, emptyDocument, orderedStates, rectangleRoom, sheetsOf, type Command, type Document, type PaperName } from "@fm/domain";
import { helveticaWidth } from "../src/export/helvetica";
import { COVER_TINT } from "../src/export/cover-column";
import { DISCLAIMER, pagesOf, sheetSet, type SheetPage, type SheetSet } from "../src/export/sheet";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { clearRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// The cover (sheetset.06; AC-08), as on the mockup the user iterated:
//
//   |+------------------+  +-----------------+
//   ||                  |  | DRAWINGS        |
//   ||      plan        |  | Project title   |
//   ||    to scale      |  | | date          |
//   ||                  |  | SHEET INDEX     |
//   ||                  |  | 01 ..    03 ..  |
//   ||                  |  | 02 ..    04 ..  |
//   ||                  |  |-----------------|
//   || TITLE            |  | studio   N  1:50|
//   || scale 1:50       |  +-----------------+
//   ^ the accent band

const COVER = "c/t0";
const addCover = (fields: Partial<Extract<Command, { type: "addSheet" }>> = {}): Command => ({ type: "addSheet", opId: "c", after: null, kind: "cover", title: "Ground floor", drawings: [{ layout: "s0", deck: null }], ...fields });
const addPlan = (id: string, title: string, fields: Partial<Extract<Command, { type: "addSheet" }>> = {}): Command => ({ type: "addSheet", opId: id, after: null, kind: "plan", title, drawings: [{ layout: "s0", deck: null }], ...fields });
const field = (key: string, value: string): Command => ({ type: "setProjectField", key, value });
const STUDIO: Command[] = [field("studioName", "Atelier Bruni"), field("studioAddress", "Via Roma 1, Milano"), field("studioContact", "ciao@bruni.example")];
const LONG_STUDIO: Command[] = [
  field("studioName", "Atelier Bruni & Associati, architettura e interni per la casa piccola, Milano"),
  field("studioAddress", "Via Alessandro Manzoni 142, scala B, quarto piano, 20121 Milano, Italia, sede"),
  field("studioContact", "studio@atelier-bruni.example · +39 02 5555 0142 · www.atelier-bruni.example"),
];

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2 November 2026";
  return h;
}
const options = (paper: PaperName, scale: number, projectName: string) => ({ projectName, paper, scale, host: host(), finishes: true });
type Opts = { paper?: PaperName; scale?: number; projectName?: string };
const setOf = (doc: Document, { paper = "A3", scale = 50, projectName = "Studio" }: Opts = {}): SheetSet => sheetSet(doc, options(paper, scale, projectName));
function coverOf(doc: Document, opts: Opts = {}): SheetPage {
  const sheet = sheetsOf(doc).find((s) => s.id === COVER);
  if (!sheet) throw new Error("no cover");
  const [page] = pagesOf(doc, sheet, setOf(doc, opts));
  if (!page) throw new Error("no page");
  return page;
}
/** `doc` with a cover as its only sheet. */
function coverOn(doc: Document, fields: Partial<Extract<Command, { type: "addSheet" }>> = {}): Document {
  const layout = orderedStates(doc)[0]?.id ?? "s0";
  const automatic = sheetsOf(doc).map((s): Command => ({ type: "deleteSheet", sheetId: s.id }));
  return withCommands(doc, addCover({ drawings: [{ layout, deck: null }], ...fields }), ...automatic);
}
const covered = (...cmds: Command[]): Document => withCommands(coverOn(roomDoc()), ...cmds);
/** A plan taller than wide on A4, so the set stands up, with its cover first. */
const tall = (...cmds: Command[]): Document => withCommands(coverOn(clearRoomDoc(4, 14, "r")), ...cmds);
/** A cover and every project field at length over 30 labelled rooms: a title block on A4 can't hold it. */
function crowded(): Document {
  const rooms = 30;
  let doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, rooms, 1, "row"));
  for (let i = 1; i < rooms; i++) doc = withCommands(doc, { type: "addWall", opId: `d${i}`, from: { at: { x: i, y: 0 } }, to: { at: { x: i, y: 1 } } });
  for (let i = 0; i < rooms; i++) doc = withCommands(doc, { type: "labelZone", id: `L${i}`, at: { x: i + 0.5, y: 0.5 }, name: `R${i}`, finish: null });
  return coverOn(withCommands(doc, ...PROJECT_FIELDS.map((f) => field(f.key, "Field value long enough to wrap ".repeat(3).slice(0, f.maxLength)))));
}
const manySheets = (n: number): Command[] => Array.from({ length: n }, (_, i) => addPlan(`p${i}`, `Sheet number ${i + 1}`));

type Text = Extract<Primitive, { kind: "text" }>;
type Polygon = Extract<Primitive, { kind: "polygon" }>;
const texts = (page: SheetPage): Text[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
const words = (page: SheetPage): string[] => texts(page).map((t) => t.text);
function textOf(page: SheetPage, text: string): Text {
  const found = texts(page).find((t) => t.text === text);
  if (!found) throw new Error(`no "${text}" in ${words(page).join(" | ")}`);
  return found;
}
const polygons = (page: SheetPage): Polygon[] => page.primitives.flatMap((p) => (p.kind === "polygon" ? [p] : []));
const xs = (p: Polygon): number[] => p.points.map((q) => q.x);
const ys = (p: Polygon): number[] => p.points.map((q) => q.y);
const box = (p: Polygon) => ({ x0: Math.min(...xs(p)), x1: Math.max(...xs(p)), y0: Math.min(...ys(p)), y1: Math.max(...ys(p)) });
function tintOf(page: SheetPage) {
  const found = polygons(page).find((p) => p.color === COVER_TINT);
  if (!found) throw new Error("no tint");
  return box(found);
}
function clipOf(page: SheetPage) {
  const [clip, ...rest] = page.clips ?? [];
  if (!clip || rest.length > 0) throw new Error("one clip expected");
  return clip;
}
/** The walls' fills, the plan's only near-black polygons. */
const wallPoints = (page: SheetPage) => {
  const { from, to } = clipOf(page);
  return page.primitives.slice(from, to).flatMap((p) => (p.kind === "polygon" && p.color === PRESENTATION_STYLE.wall ? p.points : []));
};
const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
/** Left and right edges of a text, measured as it prints. */
function reach(t: Text): { x0: number; x1: number } {
  const w = helveticaWidth(t.text, t.size);
  const x0 = t.align === "left" ? t.at.x : t.align === "right" ? t.at.x - w : t.at.x - w / 2;
  return { x0, x1: x0 + w };
}
const inTint = (page: SheetPage): Text[] => texts(page).filter((t) => t.at.x >= tintOf(page).x0);
function expectAllInTint(page: SheetPage, atLeast: number): void {
  const tint = tintOf(page);
  const all = inTint(page);
  expect(all.length).toBeGreaterThanOrEqual(atLeast); // never a vacuous pass (sheetset.39)
  for (const t of all) {
    const { x0, x1 } = reach(t);
    expect(x0, t.text).toBeGreaterThanOrEqual(tint.x0);
    expect(x1, t.text).toBeLessThanOrEqual(tint.x1);
    expect(t.at.y - t.size / 2, t.text).toBeGreaterThanOrEqual(tint.y0);
    expect(t.at.y + t.size / 2, t.text).toBeLessThanOrEqual(tint.y1);
  }
}
const opened = (doc: Document): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
};
function rowOf(shell: FakeShell) {
  const row = shell.view().sheetsView?.sheets.find((s) => s.id === COVER);
  if (!row) throw new Error("no row");
  return row;
}

describe("the cover's drawing (AC-08)", () => {
  it("the plan is true to its scale", () => {
    expect(span(wallPoints(coverOf(covered(), { scale: 50 })).map((p) => p.x))).toBeCloseTo(6.2 * 20, 6);
    expect(span(wallPoints(coverOf(covered(), { scale: 100 })).map((p) => p.x))).toBeCloseTo(6.2 * 10, 6);
    const own = coverOn(roomDoc(), { scale: 20 });
    expect(span(wallPoints(coverOf(own, { paper: "A1", scale: 100 })).map((p) => p.y))).toBeCloseTo(4.2 * 50, 6); // its own scale, not the set's
  });

  it("clipped to its area: left of the column, off the band, with no border", () => {
    const page = coverOf(coverOn(roomDoc(), { scale: 20 }), { paper: "A4" }); // too large for its area on purpose
    const { rect, from, to } = clipOf(page);
    expect(to - from).toBeGreaterThan(0);
    expect(rect.x + rect.w).toBeLessThan(tintOf(page).x0);
    expect(rect.x).toBeGreaterThan(2.5);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.h).toBeLessThan(page.heightMm);
    expect(page.primitives.slice(to).filter((p) => p.kind === "segment" && p.cap === "round")).toEqual([]); // a plan page's frame draws so
  });

  it("its title and scale print at its bottom left, and its title in capitals", () => {
    const page = coverOf(covered());
    const { rect } = clipOf(page);
    const title = textOf(page, "GROUND FLOOR");
    const scale = textOf(page, "scale 1:50");
    expect(title.at.x).toBeGreaterThanOrEqual(rect.x);
    expect(title.at.x).toBeLessThan(rect.x + 5);
    expect(scale.at.x).toBe(title.at.x);
    expect(scale.at.y).toBeGreaterThanOrEqual(rect.y);
    expect(title.at.y).toBeGreaterThan(scale.at.y);
    expect(title.at.y).toBeLessThan(rect.y + 12);
  });

  it("a long sheet title is cut before it reaches the column, and is never drawn inside the clip", () => {
    const page = coverOf(coverOn(roomDoc(), { title: "Una pianta del piano terra con un titolo molto lungo davvero" }), { paper: "A4" });
    const { rect, to } = clipOf(page);
    const tag = texts(page).find((t) => t.text.startsWith("UNA PIANTA"));
    if (!tag) throw new Error("no tag");
    expect(reach(tag).x1).toBeLessThanOrEqual(rect.x + rect.w);
    expect(page.primitives.indexOf(tag)).toBeGreaterThanOrEqual(to);
  });

  it("the fit test measures against its own, narrower frame: dots, note, chip and shortcuts follow", () => {
    // 7.2 m at 1:50 is 144 mm: inside a plan sheet's 217 mm on A4 landscape, not inside a cover's 5 mm inset of 149 mm.
    const shell = opened(coverOn(clearRoomDoc(7, 2.5, "r")));
    shell.ui({ type: "setSheetSetting", key: "paper", value: "A4" });
    shell.ui({ type: "setSheetSetting", key: "generalScale", value: "50" });
    const row = rowOf(shell);
    expect(row.partOfPlan).toBe(true);
    expect(row.scales.find((s) => s.scale === 50)?.nofit).toBe(true);
    expect(row.scales.find((s) => s.scale === 75)?.nofit).toBe(false);
    expect(row.shortcuts).toMatchObject({ centre: false, fit: 75 });
  });

  it("a framing drag moves the plan in its clip, and undoes as one step", () => {
    const shell = opened(covered());
    const before = span(wallPoints(coverOf(shell.doc())).map((p) => p.x));
    const left = Math.min(...wallPoints(coverOf(shell.doc())).map((p) => p.x));
    shell.ui({ type: "frameSheet", id: COVER, dxMm: 10, dyMm: 0 });
    const moved = wallPoints(coverOf(shell.doc())).map((p) => p.x);
    expect(span(moved)).toBeCloseTo(before, 6);
    expect(Math.min(...moved) - left).toBeCloseTo(10, 6);
    expect(rowOf(shell).centred).toBe(false);
  });

  it("a cover whose layout goes draws the first layout left, and still prints", () => {
    const night: Command = { type: "addState", opId: "n", name: "Night" };
    const doc = withCommands(coverOn(withCommands(roomDoc(), night), { drawings: [{ layout: "n/s0", deck: null }] }), { type: "deleteState", stateId: "n/s0" });
    const page = coverOf(doc);
    expect(wallPoints(page).length).toBeGreaterThan(0);
    expect(words(page)).toContain("Studio");
  });

  it("a taller drawing turns the set portrait, and everything stays in the column", () => {
    const page = coverOf(tall(...STUDIO), { paper: "A4", scale: 100 });
    expect(page.heightMm).toBeGreaterThan(page.widthMm);
    expectAllInTint(page, 5);
  });
});

describe("the cover's column (AC-08)", () => {
  it("the column holds the title, date, index, studio details, north and scale, in that order down the page", () => {
    // A4 portrait is the narrowest column, so the foot stacks there: studio details, then north beside the scale.
    const page = coverOf(tall(addPlan("p", "Day"), ...STUDIO, field("north", "0")), { paper: "A4", scale: 50 });
    expect(page.heightMm).toBeGreaterThan(page.widthMm);
    const at = (text: string): number => textOf(page, text).at.y;
    const order = [at("DRAWINGS"), at("Studio"), at("2 November 2026"), at("SHEET INDEX"), at("01"), at("Atelier Bruni"), at("Via Roma 1, Milano"), at("ciao@bruni.example"), at("SCALE"), at("1:50")];
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(at("ciao@bruni.example")).toBeGreaterThan(at("N"));
    expect(textOf(page, "N").at.x).toBeLessThan(textOf(page, "SCALE").at.x);
  });

  it("with room, the foot lies across as on the mockup: studio details, north, scale", () => {
    const page = coverOf(covered(...STUDIO, addPlan("p", "Day"), field("north", "0")), { paper: "A3" });
    expect(page.widthMm).toBeGreaterThan(page.heightMm);
    const studio = textOf(page, "Atelier Bruni");
    const north = textOf(page, "N");
    const scale = textOf(page, "SCALE");
    expect(studio.at.x).toBeLessThan(north.at.x);
    expect(north.at.x).toBeLessThan(scale.at.x);
    expect(Math.abs(studio.at.y - scale.at.y)).toBeLessThan(15);
    expect(textOf(page, "1:50").at.y).toBeLessThan(textOf(page, "SHEET INDEX").at.y);
  });

  it("prints no title block column: no disclaimer, paper or page number", () => {
    const page = coverOf(covered(addPlan("p", "Day")));
    expect(words(page)).not.toContain(DISCLAIMER);
    expect(words(page)).not.toContain("A3");
    expect(words(page).filter((w) => w.startsWith("Sheet "))).toEqual([]);
  });

  it("no studio details and no north: neither is drawn, and the scale takes the room", () => {
    const page = coverOf(covered());
    expect(words(page)).not.toContain("N");
    expect(textOf(page, "SCALE").at.x).toBeCloseTo(textOf(page, "DRAWINGS").at.x, 6);
  });

  it("the bar's length is true to the scale, and it stays in the column at every scale", () => {
    for (const scale of [20, 25, 50, 100, 200]) {
      for (const paper of ["A4", "A3", "Letter"] as const) {
        const doc = withCommands(coverOn(roomDoc(), { scale }), ...STUDIO, field("north", "45"));
        const page = coverOf(doc, { paper });
        const label = texts(page).find((t) => /^0 — [\d.]+ m$/.test(t.text));
        if (!label) throw new Error("no bar label");
        const metres = Number(label.text.slice(4, -2));
        const cells = polygons(page).filter((p) => (p.color === "#000000" || p.color === "#ffffff") && Math.abs(span(ys(p)) - 1.5) < 1e-9).map(box);
        expect(cells).toHaveLength(4);
        const left = Math.min(...cells.map((c) => c.x0));
        const right = Math.max(...cells.map((c) => c.x1));
        expect(right - left).toBeCloseTo((metres * 1000) / scale, 6);
        expect(left).toBeGreaterThanOrEqual(tintOf(page).x0);
        expect(right).toBeLessThanOrEqual(tintOf(page).x1);
      }
    }
  });

  it("a 60-character project name wraps at a smaller size, whole and inside the column, on A4 and A3 either way", () => {
    const name = "Ristrutturazione dell'appartamento di via Alessandro Manzoni";
    expect(name).toHaveLength(60);
    for (const paper of ["A4", "A3"] as const) {
      for (const doc of [covered(addPlan("p", "Day")), tall(addPlan("p", "Day"))]) {
        const page = coverOf(doc, { paper, scale: 100, projectName: name });
        const big = inTint(page).filter((t) => t.size > 4);
        expect(big.length).toBeGreaterThan(1);
        expect(big.length).toBeLessThanOrEqual(6); // the scale's value too
        expect(big.filter((t) => t.text !== "1:100").map((t) => t.text).join(" ")).toBe(name);
        expectAllInTint(page, 8);
      }
    }
  });

  it("a short project name prints large, as on the mockup", () => {
    expect(textOf(coverOf(covered()), "Studio").size).toBe(13);
  });

  it("a long word never breaks while a smaller size could hold it", () => {
    const page = coverOf(covered(addPlan("p", "Day")), { paper: "A4", projectName: "Precipitevolissimevolmente" });
    expect(words(page)).toContain("Precipitevolissimevolmente");
  });

  it("a blank project name prints as Untitled, as the title block does", () => {
    expect(words(coverOf(covered(), { projectName: "  " }))).toContain("Untitled");
  });

  it("long studio details, a long date and north stay in the column, cut as a title block cuts them", () => {
    for (const paper of ["A4", "A3", "Letter"] as const) {
      const page = coverOf(covered(...LONG_STUDIO, field("north", "45"), field("issueDate", "il quattordicesimo giorno di settembre dell'anno duemilaventisei, revisione B"), addPlan("p", "Day")), { paper });
      expectAllInTint(page, 10);
      if (paper === "A4") expect(words(page).some((w) => w.endsWith("…"))).toBe(true);
    }
  });

  it("the date prints as typed, and blank prints today's", () => {
    expect(words(coverOf(covered()))).toContain("2 November 2026");
    expect(words(coverOf(covered(field("issueDate", "settembre 2026"))))).toContain("settembre 2026");
  });

  it("the north arrow draws at the set's angle; unset, nothing", () => {
    const page = coverOf(covered(field("north", "90")));
    const ring = page.primitives.filter((p) => p.kind === "arc" && p.from === 0 && p.to === 2 * Math.PI && p.radius === 3.94);
    expect(ring).toHaveLength(1);
    const n = textOf(page, "N");
    const centre = ring[0]?.kind === "arc" ? ring[0].center : { x: 0, y: 0 };
    expect(n.at.x).toBeGreaterThan(centre.x);
    expect(n.at.y).toBeCloseTo(centre.y, 6);
    expect(coverOf(covered()).primitives.filter((p) => p.kind === "arc" && p.radius === 3.94)).toEqual([]);
  });

  it("its column's tint is drawn under its text, on the page's right", () => {
    const page = coverOf(covered());
    const { x0, x1 } = tintOf(page);
    expect(x1).toBeLessThan(page.widthMm);
    expect(x0).toBeCloseTo(page.widthMm * 0.59, 6);
    const tint = page.primitives.findIndex((p) => p.color === COVER_TINT);
    expect(page.primitives.indexOf(textOf(page, "Studio"))).toBeGreaterThan(tint);
  });

  it("the band takes the accent, along the page's left edge", () => {
    const page = coverOf(covered(field("accent", "#0a7d55")));
    const [band, ...rest] = polygons(page).filter((p) => p.color === "#0a7d55" && span(ys(p)) === page.heightMm);
    if (!band) throw new Error("no band");
    expect(rest).toEqual([]);
    expect(box(band)).toEqual({ x0: 0, x1: 2.5, y0: 0, y1: page.heightMm });
    expect(polygons(coverOf(covered())).some((p) => p.color === PRESENTATION_STYLE.accent && span(ys(p)) === page.heightMm)).toBe(true);
  });

  it("the date's tick and the studio's name take the accent too", () => {
    const page = coverOf(covered(field("accent", "#0a7d55"), ...STUDIO));
    expect(textOf(page, "Atelier Bruni").color).toBe("#0a7d55");
    expect(polygons(page).filter((p) => p.color === "#0a7d55")).toHaveLength(2);
  });
});

describe("the sheet index (AC-08)", () => {
  /** A row: its number's text, with the title beside it. */
  const row = (page: SheetPage, number: string): { number: Text; title: Text } => {
    const n = texts(page).find((t) => t.text === number);
    if (!n) throw new Error(`no ${number} in ${words(page).join(" | ")}`);
    const title = inTint(page).find((t) => t !== n && t.at.y === n.at.y && t.at.x > n.at.x);
    if (!title) throw new Error(`no title for ${number}`);
    return { number: n, title };
  };

  it("the index lists the sheets In PDF with their numbers, in two columns", () => {
    const doc = covered(addPlan("a", "Day"), addPlan("b", "Night"), addPlan("e", "Detail"), addPlan("d", "Compare"));
    const titles = sheetsOf(doc).map((s) => s.title);
    const page = coverOf(doc);
    const rows = ["01", "02", "03", "04", "05"].map((n) => row(page, n));
    expect(rows.map((r) => r.title.text)).toEqual(titles);
    const [a, b, c, d, e] = rows.map((r) => r.number.at);
    if (!a || !b || !c || !d || !e) throw new Error("five rows");
    expect([b.x, c.x]).toEqual([a.x, a.x]); // the fuller first column, as on the mockup
    expect(d.x).toBeGreaterThan(a.x);
    expect(e.x).toBe(d.x);
    expect(b.y).toBeLessThan(a.y);
    expect(d.y).toBe(a.y);
  });

  it("a sheet left out isn't listed, and the numbers close up", () => {
    const doc = covered(addPlan("a", "Day"), addPlan("b", "Night", { inPdf: false }), addPlan("e", "Detail"));
    const page = coverOf(doc);
    expect(words(page)).not.toContain("Night");
    const listed = sheetsOf(doc).filter((s) => s.inPdf).map((s) => s.title);
    expect(["01", "02", "03"].map((n) => row(page, n).title.text)).toEqual(listed);
    expect(words(page)).not.toContain("04");
  });

  it("an unticked cover isn't listed by itself, so its preview lists what will print", () => {
    const doc = withCommands(coverOn(roomDoc(), { inPdf: false }), addPlan("a", "Day"), addPlan("b", "Night"));
    const page = coverOf(doc);
    expect(words(page).filter((w) => w === "Ground floor")).toEqual([]);
    expect(row(page, "01").title.text).not.toBe("Ground floor");
    expect(words(page)).toContain("02");
  });

  it("a multi-page report is listed once, with its first number", () => {
    const text = Array.from({ length: 80 }, (_, i) => `${i} A paragraph long enough to fill some lines of a column on this paper, and then some more of them.`).join("\n\n");
    const doc = withCommands(roomDoc(), addCover(), { type: "addSheet", opId: "r", after: COVER, kind: "report", title: "Long report", drawings: [], text }, addPlan("p", "After"));
    const sheets = sheetsOf(doc);
    const onCover = texts(coverOf(doc, { paper: "A4" }));
    const set = setOf(doc, { paper: "A4" });
    const report = sheets.find((s) => s.id === "r/t0");
    if (!report) throw new Error("no report");
    const pages = pagesOf(doc, report, set).length;
    expect(pages).toBeGreaterThan(1);
    expect(onCover.filter((t) => t.text === "Long report")).toHaveLength(1);
    const first = set.numbers.get(report.id) ?? 0;
    const numberBeside = (title: string): string | undefined => {
      const row = onCover.find((t) => t.text === title);
      const left = onCover.filter((t) => t.at.y === row?.at.y && /^\d+$/.test(t.text) && t.at.x < (row?.at.x ?? 0));
      return left[left.length - 1]?.text; // the nearest: rows lie in columns, left to right
    };
    expect(numberBeside("Long report")).toBe(String(first).padStart(2, "0"));
    expect(set.numbers.get("p/t0")).toBeDefined();
    // The next sheet's number skips the report's pages, whichever side of it it fell.
    expect(new Set(set.numbers.values()).size).toBe(sheets.length);
    expect(set.total).toBe(sheets.length - 1 + pages);
  });

  it("the title, the tag's title and the scale print bold, and a bold title still stays on the tint", () => {
    const page = coverOf(withCommands(roomDoc(), addCover()));
    const printed = texts(page);
    expect(printed.find((t) => t.text === "GROUND FLOOR")?.style).toBe("bold");
    expect(printed.find((t) => t.text === "1:50")?.style).toBe("bold");
    // Words of each length, on the letter bold widens most: some one of them fits regular widths and not bold's.
    const names = [...Array.from({ length: 28 }, (_, i) => "A".repeat(4 + 2 * i)), ...[3, 4, 5, 6, 7, 8, 9].flatMap((long) => [2, 3, 4, 5, 6, 8, 10].map((count) => Array.from({ length: count }, () => "A".repeat(long)).join(" ")))];
    for (const projectName of names) {
      const cover = coverOf(withCommands(roomDoc(), addCover()), { paper: "A4", projectName });
      const tint = cover.primitives.find((p) => p.kind === "polygon" && p.color === COVER_TINT);
      if (tint?.kind !== "polygon") throw new Error("no tint");
      const [left, right] = [Math.min(...tint.points.map((q) => q.x)), Math.max(...tint.points.map((q) => q.x))];
      const titled = texts(cover).filter((t) => t.text.startsWith("AA"));
      expect(titled.length).toBeGreaterThan(0);
      for (const t of titled) {
        expect(t.style).toBe("bold");
        expect(t.at.x + helveticaWidth(t.text, t.size, "bold")).toBeLessThanOrEqual(right - (t.at.x - left) + 1e-6); // the same margin as on its left
      }
    }
    expect(printed.find((t) => t.text === "SCALE")?.style).toBeUndefined();
  });

  it("the tag's plate covers its bold title", () => {
    const page = coverOf(withCommands(roomDoc(), addCover({ title: "Aaaaaaaaaaaa Bbbbbbbbbbbb" })));
    const title = texts(page).find((t) => t.text === "AAAAAAAAAAAA BBBBBBBBBBBB");
    if (!title) throw new Error("no title");
    const plate = page.primitives.find((p) => p.kind === "polygon" && p.color === "#ffffff" && p.points.some((q) => Math.abs(q.x - title.at.x) < 1));
    if (plate?.kind !== "polygon") throw new Error("no plate");
    expect(Math.max(...plate.points.map((q) => q.x))).toBeGreaterThanOrEqual(title.at.x + helveticaWidth(title.text, title.size, "bold"));
  });

  it("a long index stays inside the column, dropping none: 30 sheets on A4, either way up", () => {
    for (const [name, doc] of [
      ["landscape", covered(...LONG_STUDIO, field("north", "45"), ...manySheets(29))],
      ["portrait", tall(...LONG_STUDIO, field("north", "45"), ...Array.from({ length: 29 }, (_, i) => addPlan(`p${i}`, `Sheet number ${i + 1}`)))],
    ] as const) {
      const page = coverOf(doc, { paper: "A4", scale: 100 });
      expect(page.heightMm > page.widthMm, name).toBe(name === "portrait");
      expectAllInTint(page, 60);
      const rows = Array.from({ length: 30 }, (_, i) => row(page, String(i + 1).padStart(2, "0")));
      const foot = Math.max(textOf(page, "SCALE").at.y, ...texts(page).filter((t) => t.text.startsWith("Atelier")).map((t) => t.at.y));
      for (const r of rows) expect(r.number.at.y, r.title.text).toBeGreaterThan(foot);
      expect(new Set(rows.map((r) => r.title.text)).size).toBe(30); // cut or not, each its own
    }
  });

  it("measured: a few sheets keep the largest type, more than the column holds a smaller one or a third column", () => {
    const opts = { paper: "A4", scale: 100 } as const;
    expect(row(coverOf(covered(...manySheets(4)), opts), "01").number.size).toBe(4);
    const page = coverOf(covered(...LONG_STUDIO, field("north", "45"), ...manySheets(39)), opts);
    const across = new Set(Array.from({ length: 40 }, (_, i) => row(page, String(i + 1).padStart(2, "0")).number.at.x)).size;
    expect(row(page, "01").number.size < 4 || across > 2).toBe(true);
  });

  it("two rows of an index never share a line, whatever the count", () => {
    for (const n of [2, 5, 13, 40, 90]) {
      const page = coverOf(covered(...manySheets(n)), { paper: "A4", scale: 100 });
      const at = Array.from({ length: n }, (_, i) => row(page, String(i + 1).padStart(2, "0")).number.at).map((p) => `${p.x} ${p.y}`);
      expect(new Set(at).size, String(n)).toBe(n);
      expectAllInTint(page, n * 2);
    }
  });

  it("a long title is cut with an ellipsis, and doesn't reach the next column", () => {
    const page = coverOf(covered(addPlan("a", "Una pianta del piano terra con un titolo molto lungo davvero"), addPlan("b", "Day")), { paper: "A4" });
    const [first, second] = [row(page, "02").title, row(page, "03").number];
    expect(first.text.endsWith("…")).toBe(true);
    expect(reach(first).x1).toBeLessThan(second.at.x);
  });
});

describe("a cover's number (AC-08)", () => {
  it("a cover's number counts: it's Sheet 01 when first", () => {
    const doc = covered(addPlan("a", "Day"), addPlan("b", "Night"));
    const set = setOf(doc);
    expect(set.numbers.get(COVER)).toBe(1);
    expect(texts(coverOf(doc)).find((t) => t.text === "01")).toBeDefined();
    const plan = sheetsOf(doc)[1];
    if (!plan) throw new Error("no plan");
    const [next] = pagesOf(doc, plan, set);
    expect(words(next ?? { widthMm: 0, heightMm: 0, primitives: [] })).toContain("Sheet 02 / 03");
  });

  it("a set whose only sheet is a cover has no number and no index", () => {
    const page = coverOf(covered());
    expect(words(page)).not.toContain("01");
    expect(words(page)).not.toContain("SHEET INDEX");
    expect(words(page)).toContain("GROUND FLOOR");
  });

  it("a cover's rooms never crowd out a plan's table: it has no title block", () => {
    expect(setOf(crowded(), { paper: "A4" }).columnFull).toBe(false);
    expect(setOf(withCommands(crowded(), addPlan("p", "Day")), { paper: "A4" }).columnFull).toBe(true); // the cover isn't why
  });
});
