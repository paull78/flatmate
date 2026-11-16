import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SheetRow, SheetsView, UiAction } from "@fm/editor";
import { AddSheetMenu } from "../src/panels/AddSheetMenu";
import { SheetListView, type DropAt } from "../src/panels/SheetList";
import { call, findAll } from "./react-tree";

// The list's rows and the Add sheet menu (sheetset.13, .14; AC-03, AC-12), as hook-free views: no DOM in web tests (layout-states.38).

const row = (over: Partial<SheetRow>): SheetRow => ({ id: "a", number: 1, kind: "plan", section: null, title: "Day", scale: 50, ownScale: false, partOfPlan: false, inPdf: true, drawing: null, panes: [], split: "auto", finishes: true, marks: true, text: "", textNote: null, textHeld: false, size: "normal", centred: true, scales: [], shortcuts: null, pageCount: 1, pages: () => [], ...over });
const SHEETS: SheetsView = {
  projectName: "Studio",
  paper: "A4",
  papers: [],
  scale: "",
  scales: [],
  page: { widthMm: 297, heightMm: 210 },
  status: "",
  note: null,
  warning: null,
  canSave: true,
  saveReason: null,
  finishes: "with",
  readOnly: false,
  selected: "a",
  missing: [],
  missingSections: [],
  north: null,
  accent: "#b3261e",
  accents: [],
  canCompare: true,
  sections: [],
  layouts: [],
  levels: [],
  sheets: [row({}), row({ id: "b", number: 2, title: "Night" })],
};
function list(sheets: Partial<SheetsView> = {}, over: { dragging?: string | null; drop?: DropAt | null } = {}) {
  const sent: UiAction[] = [];
  const keys: string[] = [];
  const tree = SheetListView({
    sheets: { ...SHEETS, ...sheets },
    send: (a) => sent.push(a),
    drawPage: () => {},
    dragging: over.dragging ?? null,
    drop: over.drop ?? null,
    onRowKey: (_e, id) => keys.push(id),
    onDelete: (id) => sent.push({ type: "deleteSheet", id }),
    onDragStart: () => {},
    onDragEnd: () => {},
    onDragOverRow: () => {},
    onDragOverList: () => {},
    onDragLeaveList: () => {},
    onDrop: () => {},
  });
  return { tree, sent, keys, html: renderToStaticMarkup(tree) };
}
const rowProps = (tree: unknown, id: string) => findAll(tree, (p) => p["data-sheet-row"] === id)[0];
const subOf = (html: string): string => /class="sheets-row-sub">(.*?)<\/div>/.exec(html)?.[1] ?? "";

describe("a row (AC-12)", () => {
  it("shows its title, number, kind and scale", () => {
    const { html } = list({ sheets: [row({ number: 3, title: "Bedroom detail" })] });
    expect(html).toContain("Bedroom detail");
    expect(subOf(html)).toBe("03 · Plan · 1:50");
  });

  it("marks an own scale, and only an own scale", () => {
    expect(subOf(list({ sheets: [row({ scale: 20, ownScale: true })] }).html)).toBe("01 · Plan · <b>1:20</b>");
    expect(subOf(list().html)).not.toContain("<b>");
  });

  it('says "cropped" when a sheet shows part of its drawing, which fits the row, and says so in full on hover', () => {
    const words = (html: string): string => subOf(html).replace(/<[^>]+>/g, "");
    expect(words(list({ sheets: [row({ partOfPlan: true })] }).html)).toBe("01 · Plan · 1:50 · cropped");
    expect(list({ sheets: [row({ partOfPlan: true })] }).html).toContain('title="Shows part of the plan"');
    expect(list({ sheets: [row({ kind: "section", section: "A", partOfPlan: true })] }).html).toContain('title="Shows part of the section"');
    expect(words(list({ sheets: [row({ kind: "section", section: "A", partOfPlan: true })] }).html)).toBe("01 · Section · 1:50 · cropped");
    expect(subOf(list().html)).not.toContain("cropped");
  });

  it("a report has no scale, and a sheet left out says so", () => {
    expect(subOf(list({ sheets: [row({ kind: "report", scale: null })] }).html)).toBe("01 · Report");
    expect(subOf(list({ sheets: [row({ inPdf: false, number: null, kind: "compare" })] }).html)).toBe("Not in PDF · Compare · 1:50");
    expect(list({ selected: null, sheets: [row({ inPdf: false, number: null })] }).html).toContain("sheets-row off");
  });

  it("the selected row is highlighted, and only it", () => {
    const { tree } = list({ selected: "b" });
    expect(rowProps(tree, "a")?.["aria-selected"]).toBe(false);
    expect(rowProps(tree, "b")?.["aria-selected"]).toBe(true);
    expect(rowProps(tree, "b")?.["className"]).toContain(" on");
    expect(rowProps(tree, "a")?.["className"]).not.toContain(" on");
  });

  it("a click selects it", () => {
    const { tree, sent } = list();
    call(rowProps(tree, "b"), "onClick");
    expect(sent).toEqual([{ type: "selectSheet", id: "b" }]);
  });

  it("its keys go to the list, by row", () => {
    const { tree, keys } = list();
    call(rowProps(tree, "b"), "onKeyDown", {});
    expect(keys).toEqual(["b"]);
  });

  it("the checkbox doesn't select the row", () => {
    const { tree, sent } = list();
    const check = findAll(tree, (p) => p["aria-label"] === "In PDF: Night")[0];
    const stopPropagation = vi.fn();
    call(check, "onClick", { stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce(); // or the click reaches the row
    expect(check?.["checked"]).toBe(true);
    call(check, "onChange", { target: { checked: false } });
    expect(sent).toEqual([{ type: "tickSheet", id: "b", on: false }]);
  });

  it("duplicate and delete don't select either", () => {
    const { tree, sent } = list();
    const stopPropagation = vi.fn();
    call(findAll(tree, (p) => p["aria-label"] === "Duplicate Night")[0], "onClick", { stopPropagation });
    call(findAll(tree, (p) => p["aria-label"] === "Delete Night")[0], "onClick", { stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([{ type: "duplicateSheet", id: "b" }, { type: "deleteSheet", id: "b" }]);
  });

  it("read-only, nothing can change, and rows can't be dragged", () => {
    const { tree } = list({ readOnly: true });
    expect(findAll(tree, (p) => p["aria-label"] === "In PDF: Night")[0]?.["disabled"]).toBe(true);
    expect(findAll(tree, (p) => p["aria-label"] === "Delete Night")[0]?.["disabled"]).toBe(true);
    expect(rowProps(tree, "a")?.["draggable"]).toBe(false);
    expect(rowProps(list().tree, "a")?.["draggable"]).toBe(true);
  });

  it("shows the drag and the insertion line", () => {
    const { tree } = list({}, { dragging: "a", drop: { id: "b", after: true } });
    expect(rowProps(tree, "a")?.["className"]).toContain("dragging");
    expect(rowProps(tree, "b")?.["className"]).toContain("drop-after");
    expect(rowProps(list({}, { dragging: "a", drop: { id: "b", after: false } }).tree, "b")?.["className"]).toContain("drop-before");
  });
});

describe("the list's head and foot", () => {
  it('counts what\'s in the PDF, with "None" when all are', () => {
    const { html, tree, sent } = list();
    expect(html).toContain("2 of 2 in PDF");
    const link = findAll(tree, (p) => p["data-testid"] === "sheets-all-none")[0];
    expect(link?.["children"]).toBe("None");
    call(link, "onClick");
    expect(sent).toEqual([{ type: "tickAllSheets", on: false }]);
  });

  it('and "All" otherwise', () => {
    const { html, tree, sent } = list({ sheets: [row({}), row({ id: "b", inPdf: false, number: null })] });
    expect(html).toContain("1 of 2 in PDF");
    call(findAll(tree, (p) => p["data-testid"] === "sheets-all-none")[0], "onClick");
    expect(sent).toEqual([{ type: "tickAllSheets", on: true }]);
  });

  it('offers "Night has no sheet · Add" and sends what it names', () => {
    const { html, tree, sent } = list({ missing: [{ layout: "n", deck: null, title: "Night" }] });
    expect(html).toContain("Night has no sheet");
    call(findAll(tree, (p) => p["data-testid"] === "sheets-missing-add")[0], "onClick");
    expect(sent).toEqual([{ type: "addMissingSheet", layout: "n", deck: null }]);
    expect(list().html).not.toContain("has no sheet");
  });

  it('offers "A–A has no sheet · Add" and sends the section it names', () => {
    const { html, tree, sent } = list({ missingSections: [{ section: "A", label: "A–A" }] });
    expect(html).toContain("A–A has no sheet");
    const adds = findAll(tree, (p) => p["data-testid"] === "sheets-missing-section-add");
    expect(adds).toHaveLength(1);
    call(adds[0], "onClick");
    expect(sent).toEqual([{ type: "addMissingSection", section: "A" }]);
    expect(renderToStaticMarkup(list({ missingSections: [{ section: "A", label: "A–A" }], readOnly: true }).tree)).toMatch(/data-testid="sheets-missing-section-add"[^>]*disabled/);
  });
});

describe("the Add sheet menu", () => {
  const menu = (canCompare = true, canSection = true) => {
    const picked: string[] = [];
    const tree = AddSheetMenu({ page: { widthMm: 297, heightMm: 210 }, canCompare, canSection, onPick: (k) => picked.push(k), onKeyDown: () => {} });
    return { tree, picked, html: renderToStaticMarkup(tree) };
  };

  it("offers the five kinds, each with its picture and one line", () => {
    const { html } = menu();
    for (const text of ["Plan", "One layout, one level", "Compare", "2 to 4 layouts at one scale", "Section", "A section for 1 to 4 layouts", "Cover", "Drawing, title and sheet index", "Report", "Text in columns"]) expect(html).toContain(text);
    expect(html.match(/sheets-thumb/g)).toHaveLength(5);
  });

  it("sends the kind", () => {
    const { tree, picked } = menu();
    for (const kind of ["plan", "compare", "section", "cover", "report"]) call(findAll(tree, (p) => p["data-kind"] === kind)[0], "onClick");
    expect(picked).toEqual(["plan", "compare", "section", "cover", "report"]);
  });

  it("with one layout, Compare is off and says why", () => {
    const off = findAll(menu(false).tree, (p) => p["data-kind"] === "compare")[0];
    expect(off?.["disabled"]).toBe(true);
    expect(off?.["title"]).toBe("Needs two layouts");
    expect(findAll(menu().tree, (p) => p["data-kind"] === "compare")[0]?.["disabled"]).toBe(false);
  });

  it("with no section, Section is off and says why; Compare doesn't care", () => {
    const off = findAll(menu(true, false).tree, (p) => p["data-kind"] === "section")[0];
    expect(off?.["disabled"]).toBe(true);
    expect(off?.["title"]).toBe("Draw a section first");
    expect(findAll(menu(true, false).tree, (p) => p["data-kind"] === "compare")[0]?.["disabled"]).toBe(false);
    const on = findAll(menu(false, true).tree, (p) => p["data-kind"] === "section")[0];
    expect(on?.["disabled"]).toBe(false);
    expect(on?.["title"]).toBeUndefined();
  });
});
