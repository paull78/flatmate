import { describe, expect, it } from "vitest";
import { sheetsOf, type Command, type Document, type PaperName, type SheetSize } from "@fm/domain";
import { helveticaWidth } from "../src/export/helvetica";
import { drawingArea, type Rect } from "../src/export/paper";
import { columnCount, flowReport } from "../src/export/report-flow";
import { pagesOf, sheetPages, sheetSet, type SheetPage } from "../src/export/sheet";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { PERF } from "./perf-switch";

// A report's flow (sheetset.08, AC-09), as on the mockup the user corrected: each column fills to the bottom before the
// next begins, and the rejected balanced columns would fail the second test here.
//
//   +----------------------------+----+
//   | Title across the columns   |    |
//   | HEADING       text         |    |
//   | text text     text         |    |
//   | text text     text         | c  |
//   | text text                  | o  |
//   | text text                  | l  |
//   +----------------------------+----+

type Text = Extract<Primitive, { kind: "text" }>;
const textsOf = (primitives: readonly Primitive[]): Text[] => primitives.filter((p): p is Text => p.kind === "text");
const A4: Rect = drawingArea("A4", "portrait");
const A3: Rect = drawingArea("A3", "landscape");
const LOREM = "The plan fits a whole home into seven by two and a half metres, with a partition at the west end closing off the bathroom.";
const paragraphs = (count: number): string => Array.from({ length: count }, (_, i) => `${i} ${LOREM}`).join("\n\n");
const BOTTOM = (area: Rect): number => area.y + 8;
const NORMAL_LH = 3.3 * 1.45;

/** The x of each column in use, left to right; each line starts at one. */
const columnsIn = (texts: readonly Text[]): number[] => [...new Set(texts.filter((t) => t.size === 3.3).map((t) => t.at.x))].sort((a, b) => a - b);

function pageOfDoc(doc: Document, paper: PaperName = "A3") {
  const h = new FakeHost();
  return sheetPages(doc, { projectName: "Studio", paper, scale: 50, host: h, finishes: true });
}
const report = (id: string, text: string, fields: Partial<Extract<Command, { type: "addSheet" }>> = {}): Command => ({ type: "addSheet", opId: id, after: null, kind: "report", title: "Report", drawings: [], text, ...fields });
const numberOf = (page: SheetPage): string | undefined => textsOf(page.primitives).find((t) => t.text.startsWith("Sheet "))?.text;

describe("how many columns", () => {
  it("2 columns on A4, 3 on A3, 4 on A2 and A1", () => {
    // Landscape, the set's way up with no plan to read, and the mockup's.
    expect((["A4", "A3", "A2", "A1"] as const).map((p) => columnCount(drawingArea(p, "landscape")))).toEqual([2, 3, 4, 4]);
  });

  it("a column per 90 mm of the frame's inner width, so upright pages have fewer: 2, 2, 3 and 4", () => {
    expect((["A4", "A3", "A2", "A1"] as const).map((p) => columnCount(drawingArea(p, "portrait")))).toEqual([2, 2, 3, 4]);
    expect(columnCount(drawingArea("Letter", "landscape"))).toBe(2);
    const wide = (w: number): number => columnCount({ x: 0, y: 0, w, h: 100 });
    expect([wide(285.9), wide(286)]).toEqual([2, 3]); // 16 mm of it is the inset
    expect([wide(100), wide(2000)]).toEqual([2, 4]);
  });

  it("draws that many, side by side", () => {
    const { pages } = flowReport(paragraphs(120), "normal", A3);
    const [first] = pages;
    expect(columnsIn(textsOf(first ?? []))).toHaveLength(3);
  });
});

describe("the flow", () => {
  it("fills a column to the bottom before the next", () => {
    const { pages } = flowReport(paragraphs(60), "normal", A4);
    const [first] = pages;
    const texts = textsOf(first ?? []);
    const [left, right] = columnsIn(texts);
    expect(right).toBeDefined();
    const lefts = texts.filter((t) => t.at.x === left);
    const lowest = Math.min(...lefts.map((t) => t.at.y));
    expect(lefts.length).toBeGreaterThan(20);
    expect(lowest - BOTTOM(A4)).toBeLessThan(NORMAL_LH + 2 + NORMAL_LH / 2); // no room for a line and its gap under it
    expect(lowest).toBeGreaterThan(BOTTOM(A4));
  });

  it("a short text stays in the first column", () => {
    const { pages } = flowReport("# T\n\n## H\n\nA short paragraph, of two lines at most on this page, then the rest is white.", "normal", A4);
    expect(pages).toHaveLength(1);
    expect(columnsIn(textsOf(pages[0] ?? []))).toHaveLength(1);
  });

  it("keeps every word, in order, whatever the page", () => {
    const source = paragraphs(40);
    const printed = flowReport(source, "normal", A3)
      .pages.flatMap((p) => textsOf(p).map((t) => t.text))
      .join(" ");
    expect(printed.split(/\s+/)).toEqual(source.split(/\s+/));
  });

  it("flows onto a second page, numbered", () => {
    const doc = withCommands(roomDoc(), report("r", paragraphs(80)));
    const { pages, total, numbers } = pageOfDoc(doc, "A4");
    const planSheets = sheetsOf(doc).filter((s) => s.kind !== "report").length;
    expect(pages.length).toBeGreaterThan(planSheets + 1);
    expect(total).toBe(pages.length);
    expect(numbers.size).toBe(sheetsOf(doc).length);
    const two = (n: number): string => String(n).padStart(2, "0");
    expect(pages.map(numberOf)).toEqual(pages.map((_, i) => `Sheet ${two(i + 1)} / ${two(pages.length)}`));
  });

  it("a sheet after a long report numbers from where it ended", () => {
    const doc = withCommands(roomDoc(), report("r", paragraphs(80)), { type: "addSheet", opId: "p", after: "r/t0", kind: "plan", title: "After", drawings: [{ layout: "s0", deck: null }] });
    const set = sheetSet(doc, { projectName: "Studio", paper: "A4", scale: 50, host: new FakeHost(), finishes: true });
    const sheets = sheetsOf(doc);
    const reportAt = sheets.findIndex((s) => s.id === "r/t0");
    const r = sheets[reportAt];
    const after = sheets[reportAt + 1];
    if (!r || !after) throw new Error("no sheets");
    const first = set.numbers.get(r.id) ?? 0;
    expect(set.numbers.get(after.id)).toBe(first + pagesOf(doc, r, set).length);
    expect(set.total).toBe(pagesOf(doc, r, set).length + sheets.length - 1);
  });

  it("a report not In PDF takes no numbers, yet still knows its pages", () => {
    const doc = withCommands(roomDoc(), report("r", paragraphs(80), { inPdf: false }));
    const set = sheetSet(doc, { projectName: "Studio", paper: "A4", scale: 50, host: new FakeHost(), finishes: true });
    expect(set.numbers.has("r/t0")).toBe(false);
    expect(set.total).toBe(sheetsOf(doc).length - 1);
  });

  it("a lone report of several pages numbers them; of one page, it has no number", () => {
    const only = (text: string): Document => withCommands(roomDoc(), report("r", text), { type: "setSheetsInPdf", on: false }, { type: "setSheet", sheetId: "r/t0", inPdf: true });
    const long = pageOfDoc(only(paragraphs(80)), "A4").pages;
    expect(long.length).toBeGreaterThan(1);
    expect(numberOf(long[1] ?? { widthMm: 0, heightMm: 0, primitives: [] })).toBe(`Sheet 02 / ${String(long.length).padStart(2, "0")}`);
    const [short] = pageOfDoc(only("Short."), "A4").pages;
    expect(numberOf(short ?? { widthMm: 0, heightMm: 0, primitives: [] })).toBeUndefined();
  });

  it("a heading isn't left alone at a column's foot", () => {
    // Walk a heading down the column one short paragraph at a time, so one of these lands it at the foot.
    let moved = 0;
    for (let filler = 0; filler < 60; filler++) {
      const text = [...Array.from({ length: filler }, (_, i) => `${i}`), "## The heading", `${LOREM} ${LOREM}`].join("\n\n");
      const { pages } = flowReport(text, "normal", A4);
      const lines = pages.flatMap((p) => textsOf(p));
      const at = lines.findIndex((t) => t.text === "THE HEADING");
      const heading = lines[at];
      const next = lines[at + 1];
      if (!heading || !next) throw new Error("no heading");
      expect(next.at.x).toBe(heading.at.x);
      expect(next.at.y).toBeLessThan(heading.at.y);
      if (filler > 0 && heading.at.x !== lines[0]?.at.x) moved++;
    }
    expect(moved).toBeGreaterThan(0); // or nothing was at a foot, and this proves nothing
  });

  it("a run of headings stays with what follows it", () => {
    let moved = 0;
    for (let filler = 0; filler < 60; filler++) {
      const text = [...Array.from({ length: filler }, (_, i) => `${i}`), "## One", "## Two", LOREM].join("\n\n");
      const lines = flowReport(text, "normal", A4).pages.flatMap((p) => textsOf(p));
      const at = lines.findIndex((t) => t.text === "ONE");
      const [one, two, after] = [lines[at], lines[at + 1], lines[at + 2]];
      if (!one || !two || !after) throw new Error("no heading");
      expect(new Set([one.at.x, two.at.x, after.at.x]).size).toBe(1);
      if (filler > 0 && one.at.x !== lines[0]?.at.x) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("a heading at the very end of a text stays where it falls", () => {
    const { pages } = flowReport("One\n\n## Last", "normal", A4);
    expect(pages).toHaveLength(1);
    expect(textsOf(pages[0] ?? []).map((t) => t.text)).toEqual(["One", "LAST"]);
  });

  it("the first page has its title across the columns; following pages don't repeat it", () => {
    const title = "Wider than one column";
    const { pages } = flowReport(`# ${title}\n\n${paragraphs(80)}`, "normal", A4);
    expect(pages.length).toBeGreaterThan(1);
    const titled = pages.map((p) => textsOf(p).filter((t) => t.text === title));
    expect(titled.map((t) => t.length)).toEqual(pages.map((_, i) => (i === 0 ? 1 : 0)));
    const [shown] = titled[0] ?? [];
    expect(shown?.style).toBe("bold");
    const inner = A4.w - 16;
    expect(helveticaWidth(title, shown?.size ?? 0, "bold")).toBeGreaterThan((inner - 9) / 2); // it does cross
    // Under it on the first page, at the top on the next.
    const top = A4.y + A4.h - 8;
    const firstBody = Math.max(...textsOf(pages[0] ?? []).filter((t) => t.text !== title).map((t) => t.at.y));
    const nextBody = Math.max(...textsOf(pages[1] ?? []).map((t) => t.at.y));
    expect(firstBody).toBeLessThan((shown?.at.y ?? 0) - 8);
    expect(nextBody).toBeCloseTo(top - NORMAL_LH / 2, 6);
  });

  it("a report without a # starts at the top", () => {
    const [first] = flowReport("Just a line.", "normal", A4).pages;
    const [line] = textsOf(first ?? []);
    expect(line?.at.y).toBeCloseTo(A4.y + A4.h - 8 - NORMAL_LH / 2, 6);
  });

  it("a very long title ends in … within three lines, so the columns keep their page", () => {
    const { pages } = flowReport(`# ${"Long title ".repeat(300)}\n\nBody.`, "normal", A4);
    const texts = textsOf(pages[0] ?? []);
    const titled = texts.filter((t) => t.size === 8);
    expect(titled).toHaveLength(3);
    expect(titled[2]?.text.endsWith("…")).toBe(true);
    expect(texts.some((t) => t.text === "Body.")).toBe(true);
    expect(pages).toHaveLength(1);
  });

  it("an empty report is one page with no text", () => {
    for (const text of ["", "\n\n  \n"]) {
      const { pages } = flowReport(text, "normal", A4);
      expect(pages).toHaveLength(1);
      expect(pages[0]).toEqual([]);
    }
    const doc = withCommands(roomDoc(), report("r", ""));
    const sheet = sheetsOf(doc).find((s) => s.id === "r/t0");
    if (!sheet) throw new Error("no report");
    const set = sheetSet(doc, { projectName: "Studio", paper: "A4", scale: 50, host: new FakeHost(), finishes: true });
    expect(pagesOf(doc, sheet, set)).toHaveLength(1);
  });
});

describe("what's on a line", () => {
  it("bold is wider than regular, measured", () => {
    expect(helveticaWidth("Hamburg", 10, "bold")).toBeGreaterThan(helveticaWidth("Hamburg", 10));
    expect(helveticaWidth("H", 1000, "bold")).toBe(722);
    expect(helveticaWidth("a", 1000, "bold")).toBe(556);
    expect(helveticaWidth("n", 1000, "bold")).toBe(611); // regular's is 556
    expect(helveticaWidth("Ÿÿ", 1000, "bold")).toBe(667 + 556);
  });

  it("oblique measures as regular, as the AFMs say", () => {
    expect(helveticaWidth("Hamburg", 10, "oblique")).toBe(helveticaWidth("Hamburg", 10));
  });

  it("styled runs follow each other by their own widths", () => {
    const [page] = flowReport("plain **bold** *slant* plain", "normal", A4).pages;
    const texts = textsOf(page ?? []);
    expect(texts.map((t) => [t.text, t.style])).toEqual([["plain ", undefined], ["bold ", "bold"], ["slant ", "oblique"], ["plain", undefined]]);
    let x = texts[0]?.at.x ?? 0;
    for (const t of texts) {
      expect(t.at.x).toBeCloseTo(x, 6);
      x += helveticaWidth(t.text, t.size, t.style);
    }
    expect(new Set(texts.map((t) => t.at.y)).size).toBe(1);
  });

  it("a word marked across a line break keeps its style on both lines", () => {
    const long = "word ".repeat(40).trim();
    const texts = textsOf(flowReport(`**${long}**`, "normal", A4).pages[0] ?? []);
    expect(texts.length).toBeGreaterThan(3);
    expect(texts.every((t) => t.style === "bold")).toBe(true);
  });

  it("no line leaves its column, in any style", () => {
    const source = Array.from({ length: 30 }, (_, i) => `${i} A **bold stretch of words** and *a slanted one* in ${LOREM}\n\n**${LOREM}**`).join("\n\n");
    for (const size of ["small", "normal", "large"] as const) {
      for (const paper of ["A4", "A3", "A1", "Letter"] as const) {
        for (const orientation of ["portrait", "landscape"] as const) {
          const area = drawingArea(paper, orientation);
          const n = columnCount(area);
          const width = (area.w - 16 - (n - 1) * 9) / n;
          const texts = flowReport(source, size, area).pages.flatMap((p) => textsOf(p));
          expect(texts.length).toBeGreaterThan(50);
          for (const t of texts) {
            const column = Math.floor((t.at.x - (area.x + 8) + 1e-6) / (width + 9));
            const right = area.x + 8 + column * (width + 9) + width;
            expect(t.at.x + helveticaWidth(t.text.trimEnd(), t.size, t.style)).toBeLessThanOrEqual(right + 1e-6);
            expect(t.at.y).toBeGreaterThan(area.y + 8);
            expect(t.at.y).toBeLessThan(area.y + area.h - 8);
          }
        }
      }
    }
  });

  it("a word longer than a column breaks", () => {
    const word = "W".repeat(500);
    const { pages } = flowReport(word, "normal", A4);
    const texts = pages.flatMap((p) => textsOf(p));
    const width = (A4.w - 16 - 9) / 2;
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) expect(helveticaWidth(t.text, t.size)).toBeLessThanOrEqual(width + 1e-6);
    expect(texts.map((t) => t.text).join("")).toBe(word);
  });

  it("a break inside a word leaves a character outside Windows-1252 whole", () => {
    const word = "a😀".repeat(100);
    const texts = flowReport(word, "normal", A4).pages.flatMap((p) => textsOf(p));
    expect(texts.length).toBeGreaterThan(1);
    for (const t of texts) expect(Array.from(t.text).every((c) => c === "a" || c === "😀")).toBe(true);
    expect(texts.map((t) => t.text).join("")).toBe(word);
  });

  it("small, normal and large change the size", () => {
    const sized = (size: SheetSize): number[] => [...new Set(textsOf(flowReport("A line.", size, A4).pages[0] ?? []).map((t) => t.size))];
    expect(sized("small")).toEqual([2.8]);
    expect(sized("normal")).toEqual([3.3]);
    expect(sized("large")).toEqual([3.9]);
    const pagesAt = (size: SheetSize): number => flowReport(paragraphs(80), size, A4).pages.length;
    expect(pagesAt("large")).toBeGreaterThan(pagesAt("small"));
  });
});

/** The shapes that cost a flow the most. */
const WORST = ["W".repeat(20000), "word ".repeat(4000), "a\n\n".repeat(6666), "## a\n\n".repeat(3333), "*a* ".repeat(5000), "*".repeat(20000)];

describe("at the 20,000 characters a report may hold", () => {
  it("the worst shapes flow into pages: no spaces, one paragraph, one letter a paragraph", () => {
    for (const text of WORST) {
      const { pages } = flowReport(text, "large", A4);
      expect(pages.length).toBeGreaterThan(0);
      expect(pages.flat().length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!PERF)("at the 20,000 characters a report may hold: speed, with FM_PERF=1", () => {
  const long = paragraphs(200).slice(0, 20000);

  it("20,000 characters builds in under 200 ms", () => {
    const ms = (text: string): number => {
      const t0 = Date.now();
      flowReport(text, "normal", A4);
      return Date.now() - t0;
    };
    // Soft: the best of three, as a machine under load shouldn't fail it.
    expect(Math.min(ms(long), ms(long), ms(long))).toBeLessThan(200);
  });

  it("so do the worst shapes: no spaces, one paragraph, one letter a paragraph", () => {
    for (const text of WORST) {
      const t0 = Date.now();
      const { pages } = flowReport(text, "large", A4);
      expect(Date.now() - t0).toBeLessThan(200);
      expect(pages.length).toBeGreaterThan(0);
      expect(pages.flat().length).toBeGreaterThan(0);
    }
  });

  it("a run of headings too tall for a column flows on, rather than one to a column", () => {
    const { pages } = flowReport("## a\n\n".repeat(3333), "normal", A4);
    const perColumn = (A4.h - 16) / (3.3 * 1.45 + 1.5);
    expect(pages.length).toBeLessThanOrEqual(Math.ceil(3333 / (2 * Math.floor(perColumn))) + 1);
  });
});

describe("the sheet list knows a report's length", () => {
  const opened = (doc: Document): FakeShell => {
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "openExport" });
    return shell;
  };

  it("a row's page count matches its pages, without building them", () => {
    const shell = opened(withCommands(roomDoc(), report("r", paragraphs(80))));
    const row = shell.view().sheetsView?.sheets.find((s) => s.id === "r/t0");
    expect(row?.pageCount).toBeGreaterThan(1);
    expect(row?.pages()).toHaveLength(row?.pageCount ?? 0);
    const plan = shell.view().sheetsView?.sheets.find((s) => s.kind === "plan");
    expect(plan?.pageCount).toBe(1);
  });

  it("a report's text counts for the characters the PDF can't show; its line breaks and marks don't", () => {
    const warning = (text: string): string | null | undefined => opened(withCommands(roomDoc(), report("r", text))).view().sheetsView?.warning;
    expect(warning("# Title\n\n## Heading\n\n**Bold** and *oblique*,\r\nè and € print.")).toBeNull();
    expect(warning("Una stanza di 7 m\n\n日本")).toBe("The report uses characters the PDF can't show");
  });

  it("a report not In PDF doesn't warn, as it won't print", () => {
    const shell = opened(withCommands(roomDoc(), report("r", "日本", { inPdf: false })));
    expect(shell.view().sheetsView?.warning).toBeNull();
  });
});
