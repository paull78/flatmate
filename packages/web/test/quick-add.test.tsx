import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_MODS, searchPalette, type PaletteCard, type PaletteResult } from "@fm/editor";
import { EMPTY_QUICK_ADD, isQuickAddShortcut, pickActions, quickAddKey, quickAddText, withFallback } from "../src/panels/quick-add";
import { QuickAddView, type QuickAddProps } from "../src/panels/QuickAdd";
import { call, findAll, findByTestId } from "./react-tree";

// Quick add's field (quick-add.06, .07, .09): keys as data, the combobox and its rows, the shortcut predicate.

const row = (kind: string, over: Partial<PaletteResult> = {}): PaletteResult => ({ kind, label: kind, group: "G", tier: 2, matched: [], detail: null, preset: null, ...over });
const props = (text: string, rows: readonly PaletteResult[], over: Partial<QuickAddProps> = {}): QuickAddProps => ({
  state: { text, highlight: 0 },
  rows,
  tiles: new Map<string, PaletteCard>(),
  onText: () => {},
  onKeyDown: () => {},
  onPick: () => {},
  onHover: () => {},
  ...over,
});

describe("quickAddKey", () => {
  it("ArrowDown and ArrowUp move the highlight and wrap at the ends", () => {
    const s = { text: "bed", highlight: 0 };
    expect(quickAddKey(s, "ArrowDown", 3).state.highlight).toBe(1);
    expect(quickAddKey({ ...s, highlight: 2 }, "ArrowDown", 3).state.highlight).toBe(0);
    expect(quickAddKey(s, "ArrowUp", 3).state.highlight).toBe(2);
  });

  it("Enter picks the highlighted row, clears the field and gives up the focus", () => {
    expect(quickAddKey({ text: "bed", highlight: 2 }, "Enter", 5)).toEqual({ state: EMPTY_QUICK_ADD, pick: 2, blur: true, handled: true });
    expect(quickAddKey({ text: "xyzq", highlight: 0 }, "Enter", 0).pick).toBeNull();
  });

  it("Escape with text clears it; Escape in an empty field gives up the focus", () => {
    expect(quickAddKey({ text: "bed", highlight: 1 }, "Escape", 5)).toMatchObject({ state: EMPTY_QUICK_ADD, blur: false });
    expect(quickAddKey(EMPTY_QUICK_ADD, "Escape", 0)).toMatchObject({ blur: true });
  });

  it("letters are the input's own, and new text puts the highlight back on the first row", () => {
    expect(quickAddKey({ text: "be", highlight: 1 }, "d", 5).handled).toBe(false);
    expect(quickAddText("bed")).toEqual({ text: "bed", highlight: 0 });
  });
});

describe("pickActions", () => {
  it("arms the kind, and its preset when the row shows one", () => {
    expect(pickActions(row("sofa"))).toEqual([{ type: "pickKind", kind: "sofa" }]);
    expect(pickActions(row("bed", { preset: "US Queen", detail: "US Queen 162 × 213" }))).toEqual([
      { type: "pickKind", kind: "bed" },
      { type: "pickPreset", kind: "bed", preset: "US Queen" },
    ]);
  });
});

describe("QuickAddView", () => {
  it("is a combobox whose active descendant is the highlighted option, with a polite count", () => {
    const tree = QuickAddView({ ...props("bed", searchPalette("bed")), state: { text: "bed", highlight: 1 } });
    const input = findByTestId(tree, "quick-add-input");
    expect(input).toMatchObject({ role: "combobox", "aria-expanded": true, "aria-controls": "quick-add-list", "aria-label": "Find furniture" });
    const html = renderToStaticMarkup(tree);
    const selected = [...html.matchAll(/<li id="([^"]+)" role="option" aria-selected="true"/g)].map((m) => m[1]);
    expect(selected).toEqual([input?.["aria-activedescendant"]]);
    expect(html).toContain(">8 results<");
  });

  it("shows at most eight rows, then \"+N more · keep typing\"", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`k${i}`));
    const html = renderToStaticMarkup(QuickAddView(props("k", rows)));
    expect([...html.matchAll(/role="option"/g)]).toHaveLength(8);
    expect(html).toContain("+3 more · keep typing");
  });

  it("puts the matched part of the label in bold and the alias or preset after it", () => {
    const html = renderToStaticMarkup(QuickAddView(props("bed", [row("murphyBed", { label: "Murphy bed", matched: [{ start: 7, end: 10 }] }), row("sofa", { label: "Sofa", detail: "(couch)" })])));
    expect(html).toContain("Murphy <b>bed</b>");
    expect(html).toContain("Sofa<span class=\"quick-add-detail\"> (couch)</span>");
  });

  it("with an empty field shows no list and says nothing", () => {
    const tree = QuickAddView(props("", []));
    expect(findByTestId(tree, "quick-add-list")).toBeNull();
    expect(findByTestId(tree, "quick-add-input")).toMatchObject({ "aria-expanded": false, "aria-activedescendant": undefined });
  });

  it("a click on a row picks it, hovering highlights it", () => {
    const picked: number[] = [];
    const hovered: number[] = [];
    const tree = QuickAddView(props("bed", searchPalette("bed"), { onPick: (i) => picked.push(i), onHover: (i) => hovered.push(i) }));
    const options = findAll(tree, (p) => p.role === "option");
    call(options[2], "onMouseEnter");
    call(options[2], "onClick");
    expect([hovered, picked]).toEqual([[2], [2]]);
  });
});

describe("isQuickAddShortcut", () => {
  it('"/" and Ctrl or ⌘ + K, outside fields and typed values only', () => {
    expect(isQuickAddShortcut("/", NO_MODS, false, false)).toBe(true);
    expect(isQuickAddShortcut("/", { ...NO_MODS, shift: true }, false, false)).toBe(true); // Shift+7 on an Italian keyboard
    expect(isQuickAddShortcut("k", { ...NO_MODS, ctrl: true }, false, false)).toBe(true);
    expect(isQuickAddShortcut("K", { ...NO_MODS, meta: true }, false, false)).toBe(true);
    expect(isQuickAddShortcut("k", NO_MODS, false, false)).toBe(false);
    expect(isQuickAddShortcut("/", NO_MODS, true, false)).toBe(false);
    expect(isQuickAddShortcut("/", NO_MODS, false, true)).toBe(false);
  });
});

describe("no match (quick-add.08)", () => {
  it("no rows for some text gives the Custom box row, flagged as a fallback", () => {
    const out = withFallback([], "xyzq", "Custom box");
    expect(out).toEqual({ rows: [expect.objectContaining({ kind: "block", label: "Custom box", group: "Basic" })], noMatch: true });
    expect(withFallback([row("sofa")], "couch", "Custom box")).toEqual({ rows: [row("sofa")], noMatch: false });
    expect(withFallback([], "", "Custom box")).toEqual({ rows: [], noMatch: false });
  });

  it("the view says nothing matches, offers the highlighted Custom box and reads No results", () => {
    const { rows } = withFallback([], "xyzq", "Custom box");
    const html = renderToStaticMarkup(QuickAddView({ ...props("xyzq", rows), noMatch: true }));
    expect(html).toContain("No furniture matches “xyzq”");
    expect(html).toMatch(/role="option" aria-selected="true"[^>]*data-kind="block"/);
    expect(html).toContain(">No results<");
  });
});
