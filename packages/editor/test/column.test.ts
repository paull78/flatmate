import { describe, expect, it } from "vitest";
import { emptyDocument, motifDefaults, rectangleRoom, type Command, type Document } from "@fm/domain";
import { helveticaWidth } from "../src/export/helvetica";
import { MARGIN_MM, columnMm, drawingArea } from "../src/export/paper";
import { sheetFitScale, sheetPages, type SheetPage } from "../src/export/sheet";
import type { Primitive } from "../src/view/scene-types";
import { donutDoc, roomDoc, withCommands } from "./builders";
import { FakeHost } from "./fake-shell";

// The title block column (sheet.07, .08, sheetset.19; AC-05, AC-12, AC-01): on each page's right edge, inside the margin,
// with the fields, the rooms table, the scale bar, the disclaimer, the paper and date, and the sheet number.

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}

const field = (key: string, value: string): Command => ({ type: "setProjectField", key, value });
const labelled = (): Document => withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Studio", finish: null });
const twoLayouts = (doc: Document = labelled()): Document =>
  withCommands(doc, { type: "renameState", stateId: "s0", name: "Day" }, { type: "addState", opId: "n", name: "Night" });

function pages(doc: Document, paper: "A4" | "A3" = "A4"): SheetPage[] {
  const sheet = sheetPages(doc, { projectName: "Flat Rossi", paper, scale: "fit", host: host(), finishes: true });
  if (!sheet) throw new Error("no sheet");
  return sheet.pages;
}

type Text = Extract<Primitive, { kind: "text" }>;
const texts = (page: SheetPage): Text[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
const columnLeft = (page: SheetPage, paper: "A4" | "A3" = "A4") => page.widthMm - MARGIN_MM - columnMm(paper);
/** The column's texts, top to bottom (y down the page), then left to right on one line. */
const columnTexts = (page: SheetPage): Text[] =>
  texts(page)
    .filter((t) => t.at.x >= columnLeft(page) - 1e-9)
    .sort((a, b) => b.at.y - a.at.y || a.at.x - b.at.x);
/** The x range a text covers on paper, from its alignment and Helvetica width. */
function extent(t: Text): [number, number] {
  const w = helveticaWidth(t.text, t.size);
  return t.align === "left" ? [t.at.x, t.at.x + w] : t.align === "right" ? [t.at.x - w, t.at.x] : [t.at.x - w / 2, t.at.x + w / 2];
}

describe("the rooms table's Free column (sheetset.70)", () => {
  const texts = (page: { primitives: readonly Primitive[] } | undefined): string[] => (page?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));
  it("a furnished plan's page has it; a report's, which shows no layout, has its rooms and no empty column", () => {
    const bed: Command = { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 3, y: 2 }, rotation: 0 };
    const doc = withCommands(labelled(), bed, { type: "addSheet", opId: "a", after: null, kind: "plan", title: "Plan", drawings: [{ layout: "s0", deck: null }] }, { type: "addSheet", opId: "r", after: null, kind: "report", title: "Report", drawings: [], text: "Words." });
    const all = pages(doc);
    const plan = all.find((p) => texts(p).includes("Words.") === false && texts(p).includes("ROOM"));
    const report = all.find((p) => texts(p).includes("Words."));
    expect(texts(plan)).toContain("FREE");
    expect(texts(report)).toContain("ROOM");
    expect(texts(report)).toContain("Studio");
    expect(texts(report)).not.toContain("FREE");
  });
});

describe("paper with the column", () => {
  it("the column is 60 mm on A4 and Letter, 75 mm on A3", () => {
    expect([columnMm("A4"), columnMm("Letter"), columnMm("A3")]).toEqual([60, 60, 75]);
  });

  it("the drawing area is the page inside the margin, left of the column", () => {
    expect(drawingArea("A4", "landscape")).toEqual({ x: 10, y: 10, w: 217, h: 190 });
    expect(drawingArea("A4", "portrait")).toEqual({ x: 10, y: 10, w: 130, h: 277 });
    expect(drawingArea("A3", "landscape")).toEqual({ x: 10, y: 10, w: 325, h: 277 });
  });

  it("fit uses the area left of the column: an 11 × 4 m plan goes from 1:50 to 1:75 on A4, and stays 1:50 on A3", () => {
    // Drawn 11.2 × 4.2 m: 224 × 84 mm at 1:50, wider than A4 landscape's 217 mm (it fitted the old 277).
    const doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 11, 4, "wide"));
    expect(sheetFitScale(doc, "A4")).toBe(75);
    expect(sheetFitScale(doc, "A3")).toBe(50);
  });
});

describe("the column", () => {
  const full = (): Document =>
    twoLayouts(withCommands(labelled(), field("subtitle", "Studio refurbishment"), field("client", "Famiglia Rossi"), field("revision", "B"), field("notes", "Check the sofa bed.")));

  it("holds the title block in order, top to bottom", () => {
    const order = columnTexts(pages(full())[0] ?? { widthMm: 0, heightMm: 0, primitives: [] }).map((t) => t.text);
    const at = (s: string) => order.indexOf(s);
    const sequence = ["Flat Rossi", "Studio refurbishment", "CLIENT", "Famiglia Rossi", "REVISION", "B", "NOTES", "Check the sofa bed.", "ROOM", "Studio", "Total", "0", "2 m", "Dimensions are approximate; check on site.", "A4", "2026-10-13", "Sheet 01 / 02"];
    for (const s of sequence) expect(at(s), s).toBeGreaterThan(-1);
    const positions = sequence.map(at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("leaves empty fields off; clearing a field removes its lines (AC-01)", () => {
    const withClient = columnTexts(pages(withCommands(labelled(), field("client", "Rossi")))[0] ?? { widthMm: 0, heightMm: 0, primitives: [] }).map((t) => t.text);
    expect(withClient).toEqual(expect.arrayContaining(["CLIENT", "Rossi"]));
    expect(withClient).not.toContain("ADDRESS");
    const cleared = withCommands(labelled(), field("client", "Rossi"), field("client", ""));
    const after = columnTexts(pages(cleared)[0] ?? { widthMm: 0, heightMm: 0, primitives: [] }).map((t) => t.text);
    expect(after).not.toContain("CLIENT");
    expect(after).not.toContain("Rossi");
  });

  it("a long field wraps to two lines and every column text stays inside the column (AC-05)", () => {
    const address = "Via Giuseppe Garibaldi 128, scala B, interno 14, 20121 Milano, Italia, presso Ca".slice(0, 80);
    const page = pages(withCommands(labelled(), field("address", address)))[0];
    if (!page) throw new Error("no page");
    const left = columnLeft(page);
    const right = page.widthMm - MARGIN_MM;
    const lines = columnTexts(page).filter((t) => address.includes(t.text.replace(/…$/, "")) && t.text.length > 3);
    expect(lines).toHaveLength(2);
    for (const t of columnTexts(page)) {
      const [a, b] = extent(t);
      expect(a, t.text).toBeGreaterThanOrEqual(left);
      expect(b, t.text).toBeLessThanOrEqual(right);
    }
  });

  it("a long project name and long room names stay inside the column too (AC-05)", () => {
    const doc = withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "A living room with a very long name indeed, longer than the column", finish: null });
    const sheet = sheetPages(doc, { projectName: "A project with a name far too long for one line of the title block", paper: "A4", scale: "fit", host: host(), finishes: true });
    const page = sheet?.pages[0];
    if (!page) throw new Error("no page");
    for (const t of columnTexts(page)) {
      const [a, b] = extent(t);
      expect(a, t.text).toBeGreaterThanOrEqual(columnLeft(page));
      expect(b, t.text).toBeLessThanOrEqual(page.widthMm - MARGIN_MM);
    }
  });

  it("notes wrap to at most 8 lines, the last ending with an ellipsis", () => {
    const notes = "Long notes about the flat and its furniture. ".repeat(11).slice(0, 500);
    const page = pages(withCommands(labelled(), field("notes", notes)))[0];
    if (!page) throw new Error("no page");
    const lines = columnTexts(page).filter((t) => notes.includes(t.text.replace(/…$/, "").trim()) && t.text.length > 5);
    expect(lines).toHaveLength(8);
    expect(lines.at(-1)?.text.endsWith("…")).toBe(true);
  });

  it("a room's grey second line is drawn when its detail isn't null, and its row grows by that line (finishes.11)", () => {
    // donutDoc: Living has a hole (no size), Stairs is the 2.80 × 2.80 core.
    const doc = withCommands(
      donutDoc(),
      { type: "labelZone", id: "L1", at: { x: 1.5, y: 4 }, name: "Living", finish: null },
      { type: "labelZone", id: "L2", at: { x: 5, y: 4 }, name: "Stairs", finish: null },
    );
    const finished = withCommands(doc, { type: "setFinish", id: "L1", finish: motifDefaults("planks") });
    const column = (d: Document): Text[] => columnTexts(pages(d)[0] ?? { widthMm: 0, heightMm: 0, primitives: [] });
    const y = (ts: Text[], s: string): number => ts.find((t) => t.text === s)?.at.y ?? NaN;
    const plain = column(doc);
    const after = column(finished);
    expect(plain.map((t) => t.text)).not.toContain("Planks");
    const detail = after.find((t) => t.text === "Planks");
    expect(detail).toMatchObject({ size: 2, color: "#7a7a7a", align: "left" });
    expect(detail?.at.y).toBeLessThan(y(after, "Living"));
    expect(detail?.at.y).toBeGreaterThan(y(after, "Stairs"));
    expect(after.map((t) => t.text)).toContain("2.80 × 2.80 m"); // Stairs' size, unfinished
    const step = (ts: Text[]) => y(ts, "Living") - y(ts, "Stairs");
    expect(step(after) - step(plain)).toBeCloseTo(2 * 1.3, 6); // one 2 mm line
  });

  it("numbers the sheets across the PDF", () => {
    const [day, night] = pages(twoLayouts());
    if (!day || !night) throw new Error("no pages");
    expect(columnTexts(day).map((t) => t.text)).toContain("Sheet 01 / 02");
    expect(columnTexts(night).map((t) => t.text)).toContain("Sheet 02 / 02");
  });

  it("a one-page PDF has no sheet number (sheet.29)", () => {
    const page = pages(labelled())[0];
    if (!page) throw new Error("no page");
    const names = columnTexts(page).map((t) => t.text);
    expect(names.filter((n) => n.startsWith("Sheet "))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(["2026-10-13", "Dimensions are approximate; check on site."]));
  });

  it("the plan sits in the drawing area, left of the column", () => {
    const page = pages(twoLayouts())[0];
    if (!page) throw new Error("no page");
    const area = drawingArea("A4", page.widthMm > page.heightMm ? "landscape" : "portrait");
    // The walls' fills: near-black polygons.
    const planPoints = page.primitives.flatMap((p) => (p.kind === "polygon" && p.color === "#1a1a1a" ? p.points : []));
    expect(planPoints.length).toBeGreaterThan(0);
    for (const q of planPoints) {
      expect(q.x).toBeGreaterThanOrEqual(area.x - 1e-9);
      expect(q.x).toBeLessThanOrEqual(area.x + area.w + 1e-9);
    }
  });
});

describe("named areas in the PDF's rooms table (areas.12, AC-10)", () => {
  it("a named area's row sits under its room, indented, with its m² in the Area column and no free figure", () => {
    const doc = withCommands(labelled(), { type: "addArea", opId: "k", at: { x: 1.5, y: 2 }, w: 2, d: 2, name: "Kitchen" });
    const page = pages(doc)[0];
    if (!page) throw new Error("no page");
    const col = columnTexts(page);
    const room = col.find((t) => t.text === "Studio");
    const area = col.find((t) => t.text === "Kitchen");
    const m2 = col.find((t) => t.text === "4.00 m²");
    const roomM2 = col.find((t) => t.text === "22.04 m²" && t.align === "right");
    if (!room || !area || !m2 || !roomM2) throw new Error(`missing: ${col.map((t) => t.text).join(" | ")}`);
    expect(area.at.y).toBeLessThan(room.at.y); // under it, the page's y running up
    expect(area.at.x).toBeGreaterThan(room.at.x); // indented
    expect(m2.at.x).toBeCloseTo(roomM2.at.x, 9); // the Area column
    expect(Math.abs(m2.at.y - area.at.y)).toBeLessThan(1e-9);
  });
});
