import { IS_MAC, keyLabel } from "../src/keys";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SheetsView as SheetsViewModel, UiAction } from "@fm/editor";
import { ImagesMenu, SheetsBar } from "../src/panels/SheetsView";
import { FloatingBar } from "../src/panels/FloatingBar";
import { viewFixture } from "./fixtures";
import { call, findAll, findByTestId } from "./react-tree";

// The sheets view's top bar and the floating bar's Export button (export.04, sheetset.13; AC-05, AC-12).

const SHEETS: SheetsViewModel = {
  projectName: "Studio",
  paper: "A4",
  papers: [{ value: "A4", label: "A4" }, { value: "A3", label: "A3" }],
  scale: "",
  scales: [{ value: "", label: "Fit (1:50)" }, { value: "20", label: "1:20" }, { value: "50", label: "1:50" }],
  page: { widthMm: 297, heightMm: 210 },
  status: "Whole plans on every sheet",
  note: null,
  warning: null,
  canSave: true,
  saveReason: null,
  finishes: "with",
  readOnly: false,
  sheets: [],
  selected: null,
  missing: [],
  missingSections: [],
  north: null,
  accent: "#b3261e",
  accents: [],
  canCompare: false,
  sections: [],
  layouts: [],
  levels: [],
};
function bar(sheets: Partial<SheetsViewModel> = {}, zoom = 1, fitted = false) {
  const sent: UiAction[] = [];
  const zooms: (number | null)[] = [];
  const tree = SheetsBar({ sheets: { ...SHEETS, ...sheets }, canUndo: true, canRedo: false, send: (a) => sent.push(a), zoom, fitted, onZoom: (z) => zooms.push(z) });
  return { tree, sent, zooms, html: renderToStaticMarkup(tree) };
}
const tag = (html: string, testId: string): string => new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? "";

describe("the sheets view's top bar (AC-12)", () => {
  it("Fit goes back to the desk's width after a zoom step, and has nothing to do while fitted", () => {
    const { tree, zooms, sent } = bar({}, 1.25, false);
    call(findByTestId(tree, "sheets-zoom-fit"), "onClick");
    expect(zooms).toEqual([null]);
    expect(sent).toEqual([]); // the zoom is this viewer's, never a command
    expect(tag(bar({}, 0.93, true).html, "sheets-zoom-fit")).toContain("disabled");
    expect(tag(bar({}, 1.25, false).html, "sheets-zoom-fit")).not.toContain("disabled");
  });

  it("with nothing to say, the status chip goes, and Save PDF's reason stays", () => {
    const { html } = bar({ status: "", saveReason: "Tick a sheet to save a PDF", canSave: false });
    expect(html).not.toContain('data-testid="sheets-status"');
    expect(html).toContain("Tick a sheet to save a PDF");
    expect(html).not.toContain("Whole plans");
  });

  it("shows paper, general scale, status, undo and redo, zoom, images and Save PDF", () => {
    const { html } = bar();
    expect(html).toContain("Studio · Sheets");
    expect(html).toContain("Fit (1:50)");
    expect(html).toContain("Whole plans on every sheet");
    expect(html).toContain("screen only");
    expect(/<button[^>]*data-action="sheets-undo"[^>]*>/.exec(html)?.[0]).not.toContain("disabled");
    expect(/<button[^>]*data-action="sheets-redo"[^>]*>/.exec(html)?.[0]).toContain("disabled");
    expect(tag(html, "sheets-save-pdf")).not.toContain("disabled");
  });

  it("sends what each control means", () => {
    const { tree, sent } = bar();
    call(findByTestId(tree, "sheets-close"), "onClick");
    call(findAll(tree, (p) => p["data-action"] === "sheets-undo")[0], "onClick");
    call(findAll(tree, (p) => p["data-action"] === "sheets-redo")[0], "onClick");
    call(findByTestId(tree, "sheets-paper"), "onChange", { target: { value: "A3" } });
    call(findByTestId(tree, "sheets-scale"), "onChange", { target: { value: "20" } });
    call(findByTestId(tree, "sheets-save-pdf"), "onClick");
    expect(sent).toEqual([
      { type: "closeExport" },
      { type: "undo" },
      { type: "redo" },
      { type: "setSheetSetting", key: "paper", value: "A3" },
      { type: "setSheetSetting", key: "generalScale", value: "20" },
      { type: "download", format: "pdf" },
    ]);
  });

  it("with no sheet ticked, Save PDF is disabled and the bar says why", () => {
    const { html } = bar({ canSave: false, saveReason: "Tick a sheet to save a PDF" });
    expect(tag(html, "sheets-save-pdf")).toContain("disabled");
    expect(tag(html, "sheets-save-pdf")).toContain('title="Tick a sheet to save a PDF"');
    expect(html).toContain('data-testid="sheets-save-reason"');
  });

  it("shows the title block's note and the characters warning when there are any", () => {
    const { html } = bar({ note: "Title block too full for A4; try A3", warning: "Some names use characters the PDF can't show" });
    expect(html).toContain("Title block too full for A4; try A3");
    expect(html).toContain("Some names use characters the PDF can&#x27;t show");
    expect(bar().html).not.toContain("sheets-note");
    expect(bar().html).not.toContain("sheets-warning");
  });

  it("read-only, paper and scale can't change", () => {
    const { html } = bar({ readOnly: true });
    expect(tag(html, "sheets-paper")).toContain("disabled");
    expect(tag(html, "sheets-scale")).toContain("disabled");
  });

  it("zooms by steps and stops at the ends, never as a command", () => {
    const { tree, sent, zooms } = bar();
    call(findByTestId(tree, "sheets-zoom-in"), "onClick");
    call(findByTestId(tree, "sheets-zoom-out"), "onClick");
    expect(zooms).toEqual([1.25, 0.75]);
    expect(sent).toEqual([]);
    expect(tag(bar({}, 2).html, "sheets-zoom-in")).toContain("disabled");
    expect(tag(bar({}, 0.5).html, "sheets-zoom-out")).toContain("disabled");
  });
});

describe("PNG and SVG of the plan, a small menu", () => {
  const menu = (sheets: Partial<SheetsViewModel> = {}) => {
    const sent: UiAction[] = [];
    const tree = ImagesMenu({ sheets: { ...SHEETS, ...sheets }, send: (a) => sent.push(a) });
    return { html: renderToStaticMarkup(tree), tree, sent };
  };

  it("names both, with the finishes switch", () => {
    const { html } = menu();
    expect(html).toContain("PNG of the plan");
    expect(html).toContain("SVG of the plan");
    expect(/<input[^>]*data-testid="images-finishes"[^>]*>/.exec(html)?.[0]).toContain("checked");
    expect(/<input[^>]*data-testid="images-finishes"[^>]*>/.exec(menu({ finishes: "without" }).html)?.[0]).not.toContain("checked");
  });

  it("sends the format, and the other finishes", () => {
    const { tree, sent } = menu();
    const noMenu = { currentTarget: { closest: () => null } };
    call(findAll(tree, (p) => p["data-format"] === "svg")[0], "onClick", noMenu);
    call(findAll(tree, (p) => p["data-format"] === "png")[0], "onClick", noMenu);
    call(findByTestId(tree, "images-finishes"), "onChange");
    expect(sent).toEqual([{ type: "download", format: "svg" }, { type: "download", format: "png" }, { type: "setExport", field: "finishes", value: "without" }]);
  });
});

describe("the floating bar's shortcut titles (cleanup step 16)", () => {
  it("Undo and Redo name the platform's keys", () => {
    const html = renderToStaticMarkup(FloatingBar({ view: viewFixture({}), send: () => {} }));
    expect(html).toContain(`title="Undo (${keyLabel("Mod+Z", IS_MAC)})"`);
    expect(html).toContain(`title="Redo (${keyLabel("Shift+Mod+Z", IS_MAC)})"`);
  });
});

describe("Export in the floating bar (AC-05)", () => {
  it("is a button that opens the sheets view", () => {
    const sent: UiAction[] = [];
    const bar = FloatingBar({ view: viewFixture({ export: { available: true, reason: null } }), send: (a) => sent.push(a) });
    const button = findByTestId(bar, "export-button");
    expect(button?.disabled).toBe(false);
    expect(button?.title).toBe("Export");
    call(button, "onClick");
    expect(sent).toEqual([{ type: "openExport" }]);
  });

  it("is disabled with the reason as its tooltip", () => {
    const html = renderToStaticMarkup(<FloatingBar view={viewFixture({ export: { available: false, reason: "Draw some walls first" } })} send={() => {}} />);
    const tag = /<button[^>]*data-testid="export-button"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain("disabled");
    expect(tag).toContain('title="Draw some walls first"');
  });

  it("is absent with no drawing open", () => {
    expect(findByTestId(FloatingBar({ view: viewFixture({ export: null }), send: () => {} }), "export-button")).toBeNull();
  });
});
