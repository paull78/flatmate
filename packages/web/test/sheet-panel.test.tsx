import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SheetRow, SheetsView, UiAction } from "@fm/editor";
import { DeskSheet } from "../src/panels/SheetPage";
import { SheetPanel } from "../src/panels/SheetPanel";
import { call, expanded, findAll, findByTestId } from "./react-tree";

// The right panel and a sheet on the desk (sheetset.15, .17; AC-05, AC-06, AC-12), as hook-free views: no DOM in web tests (layout-states.38).

const SCALES: SheetRow["scales"] = [
  { scale: null, label: "General", nofit: false },
  { scale: 20, label: "1:20", nofit: true },
  { scale: 50, label: "1:50", nofit: false },
];
const row = (over: Partial<SheetRow> = {}): SheetRow => ({
  id: "a",
  number: 1,
  kind: "plan",
  section: null,
  title: "Day",
  scale: 50,
  ownScale: false,
  partOfPlan: false,
  inPdf: true,
  drawing: { layout: "day", deck: null },
  panes: [],
  split: "auto",
  finishes: true, marks: true,
  text: "",
  textNote: null,
  textHeld: false,
  size: "normal",
  centred: true,
  scales: SCALES,
  shortcuts: null,
  pageCount: 1,
  pages: () => [],
  ...over,
});
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
  accents: [{ value: "#b3261e", label: "Brick red" }, { value: "#1d4ed8", label: "Blue" }],
  canCompare: true,
  sections: [],
  sheets: [row()],
  layouts: [{ id: "day", name: "Day" }, { id: "night", name: "Night" }],
  levels: [{ deck: null, label: "Floor" }, { deck: "loft", label: "Loft +2.15" }],
};
const HAS_HOOKS = ["DraftInput", "SheetPages", "NorthDial", "CustomColour"];
function panel(over: Partial<SheetsView> = {}, sheet?: Partial<SheetRow>) {
  const sent: UiAction[] = [];
  const sheets = { ...SHEETS, ...(sheet ? { sheets: [row(sheet)] } : {}), ...over };
  const view = SheetPanel({ sheets, send: (a) => sent.push(a) });
  return { tree: expanded(view, HAS_HOOKS), sent, html: renderToStaticMarkup(view) };
}
const group = (tree: unknown, label: string) => findAll(tree, (p) => p["role"] === "group" && p["aria-label"] === label)[0];
/** A group's buttons, by label, as [label, pressed, class]. */
const choices = (tree: unknown, label: string): [string, unknown, unknown][] => findAll(group(tree, label)?.["children"], (p) => "aria-pressed" in p).map((p) => [String(p["children"]), p["aria-pressed"], p["className"]]);
const choice = (tree: unknown, label: string, name: string) => findAll(group(tree, label)?.["children"], (p) => p["children"] === name)[0];

describe("the panel leads with the selected sheet (AC-12)", () => {
  it("names the kind, with its title in a box", () => {
    const { html, tree } = panel();
    expect(html).toContain("Plan sheet");
    expect(findByTestId(tree, "sheet-title")?.["value"]).toBe("Day");
  });

  it("a title is a rename of the selected sheet", () => {
    const { tree, sent } = panel();
    call(findByTestId(tree, "sheet-title"), "onCommit", "Bedroom detail");
    expect(sent).toEqual([{ type: "renameSheet", id: "a", title: "Bedroom detail" }]);
  });

  it("it follows the selection", () => {
    const { tree } = panel({ selected: "b", sheets: [row(), row({ id: "b", title: "Night" })] });
    expect(findByTestId(tree, "sheet-title")?.["value"]).toBe("Night");
  });

  it("no sheet, nothing to set", () => {
    expect(panel({ selected: null, sheets: [] }).html).toContain("No sheet selected");
  });

  it("a report has its title, its text under a style bar and its body size, and none of a drawing's settings", () => {
    const { tree, html } = panel({}, { kind: "report", text: "# Hello" });
    expect(findByTestId(tree, "sheet-title")).not.toBeNull();
    expect(group(tree, "Layout")).toBeUndefined();
    expect(html).not.toContain("Floor finishes");
    expect(findByTestId(tree, "report-text")?.["value"]).toBe("# Hello");
    expect(findAll(tree, (p) => "data-style" in p).map((p) => p["data-style"])).toEqual(["title", "heading", "bold", "italic"]);
    expect(group(tree, "Body size")).toBeDefined();
  });

  it("the report's box drafts on each change and commits on leaving, never read-only, so no key is lost to an ack", () => {
    const { tree, sent } = panel({ readOnly: true }, { kind: "report", text: "One" });
    const box = findByTestId(tree, "report-text");
    expect(box?.["readOnly"]).toBeUndefined();
    expect(box?.["disabled"]).toBeUndefined();
    call(box, "onChange", { target: { value: "One two" } });
    call(box, "onBlur");
    expect(sent).toEqual([{ type: "typeReport", id: "a", text: "One two" }, { type: "leaveReport", id: "a" }]);
  });

  it("Body size sends a command, and goes off while an edit waits", () => {
    const { tree, sent } = panel({}, { kind: "report" });
    expect(choices(tree, "Body size").map(([label, on]) => [label, on])).toEqual([["Small", false], ["Normal", true], ["Large", false]]);
    call(choice(tree, "Body size", "Large"), "onClick");
    expect(sent).toEqual([{ type: "setSheet", id: "a", fields: { size: "large" } }]);
    expect(choice(panel({ readOnly: true }, { kind: "report" }).tree, "Body size", "Large")?.["disabled"]).toBe(true);
  });

  it("the note and Try again show at the box, only when there's something to say", () => {
    const quiet = panel({}, { kind: "report" }).tree;
    expect(findByTestId(quiet, "report-note")).toBeNull();
    expect(findByTestId(quiet, "report-retry")).toBeNull();
    const over = panel({}, { kind: "report", textNote: "200 characters over" }).tree;
    expect(findByTestId(over, "report-note")?.["children"]).toBe("200 characters over");
    const held = panel({}, { kind: "report", textHeld: true });
    expect(held.html).toContain("Not saved yet");
    call(findByTestId(held.tree, "report-retry"), "onClick");
    expect(held.sent).toEqual([{ type: "leaveReport", id: "a" }]);
  });

  it("a cover has a plan's settings: Layout, Level, Scale and Centre, and picks them as a plan does", () => {
    const { tree, html, sent } = panel({}, { kind: "cover", centred: false });
    expect(html).toContain("Cover sheet");
    for (const label of ["Layout", "Level", "Scale"]) expect(group(tree, label), label).toBeDefined();
    expect(html).toContain("Floor finishes");
    call(findByTestId(tree, "sheet-centre"), "onClick");
    expect(sent).toEqual([{ type: "setSheet", id: "a", fields: { cx: 0, cy: 0 } }]);
  });

  it("read-only, nothing can be changed", () => {
    const { tree } = panel({ readOnly: true });
    expect(findByTestId(tree, "sheet-title")?.["readOnly"]).toBe(true); // not disabled: it keeps its focus and draft
    expect(choice(tree, "Scale", "1:20")?.["disabled"]).toBe(true);
    expect(findByTestId(tree, "sheet-finishes")?.["disabled"]).toBe(true);
  });
});

describe("Layout and Level are visible choices", () => {
  it("shows every layout, with this sheet's pressed", () => {
    expect(choices(panel().tree, "Layout").map(([n, on]) => [n, on])).toEqual([["Day", true], ["Night", false]]);
  });

  it("picks a layout at the same level", () => {
    const { tree, sent } = panel({}, { drawing: { layout: "day", deck: "loft" } });
    call(choice(tree, "Layout", "Night"), "onClick");
    expect(sent).toEqual([{ type: "setSheetDrawing", id: "a", layout: "night", deck: "loft" }]);
  });

  it("shows every level, and picks one in the same layout", () => {
    const { tree, sent } = panel();
    expect(choices(tree, "Level").map(([n, on]) => [n, on])).toEqual([["Floor", true], ["Loft +2.15", false]]);
    call(choice(tree, "Level", "Loft +2.15"), "onClick");
    expect(sent).toEqual([{ type: "setSheetDrawing", id: "a", layout: "day", deck: "loft" }]);
  });

  it("many layouts wrap to a grid instead of squeezing", () => {
    const { tree } = panel({ layouts: ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id })) });
    expect(group(tree, "Layout")?.["className"]).toContain("grid");
    expect(group(panel().tree, "Layout")?.["className"]).not.toContain("grid");
  });
});

describe("a compare sheet's panes and Split (AC-07)", () => {
  const pane = (layout: string, on: boolean, locked = false, deck: string | null = null): SheetRow["panes"][number] => ({ layout, deck, title: deck ? `${layout} · Loft` : layout, on, locked });
  const compare = (over: Partial<SheetRow> = {}): Partial<SheetRow> => ({ kind: "compare", panes: [pane("Day", true, true), pane("Night", true, true), pane("Guests", false), pane("Day", false, false, "loft")], ...over });
  const checks = (tree: unknown) => findAll(tree, (p) => p["type"] === "checkbox" && p["data-testid"] === "sheet-pane");

  it("lists each choice as a check, ticked by what it shows", () => {
    const { html, tree } = panel({}, compare());
    expect(html).toContain("Compare sheet");
    expect(checks(tree).map((c) => c["checked"])).toEqual([true, true, false, false]);
    for (const name of ["Day", "Night", "Guests", "Day · Loft"]) expect(html).toContain(`${name}</span>`);
  });

  it("says layouts and levels only when there's a level to pick", () => {
    expect(panel({}, compare()).html).toContain("Layouts and levels, 2 to 4");
    expect(panel({ levels: [{ deck: null, label: "Floor" }] }, compare()).html).toContain("Layouts, 2 to 4");
  });

  it("a check toggles its pane", () => {
    const { tree, sent } = panel({}, compare());
    call(checks(tree)[3], "onChange");
    expect(sent).toEqual([{ type: "toggleSheetPane", id: "a", layout: "Day", deck: "loft" }]);
  });

  it("a locked check can't be changed", () => {
    expect(checks(panel({}, compare()).tree).map((c) => c["disabled"])).toEqual([true, true, false, false]);
    expect(checks(panel({ readOnly: true }, compare()).tree).map((c) => c["disabled"])).toEqual([true, true, true, true]);
  });

  it("Split is three visible choices, Automatic by default", () => {
    const { tree, sent } = panel({}, compare());
    expect(choices(tree, "Split").map(([n, on]) => [n, on])).toEqual([["Automatic", true], ["Stacked", false], ["Side by side", false]]);
    call(choice(tree, "Split", "Side by side"), "onClick");
    expect(sent).toEqual([{ type: "setSheet", id: "a", fields: { split: "sideBySide" } }]);
  });

  it("keeps Scale, Floor finishes and Centre, with no Layout or Level of its own", () => {
    const { tree, html } = panel({}, compare());
    expect(group(tree, "Scale")).toBeDefined();
    expect(html).toContain("Floor finishes");
    expect(findByTestId(tree, "sheet-centre")).not.toBeNull();
    expect(group(tree, "Layout")).toBeUndefined();
    expect(group(tree, "Level")).toBeUndefined();
  });

  it("a plan sheet has no checks or Split", () => {
    const { tree } = panel();
    expect(checks(tree)).toEqual([]);
    expect(group(tree, "Split")).toBeUndefined();
  });
});

describe("Scale is a grid, with a neutral dot where the whole plan won't fit (AC-06)", () => {
  it("marks those, and only those, and says why", () => {
    const { tree } = panel();
    expect(choices(tree, "Scale").map(([n, , c]) => [n, c])).toEqual([["General", undefined], ["1:20", "nofit"], ["1:50", undefined]]);
    expect(choice(tree, "Scale", "1:20")?.["title"]).toBe("The whole plan won't fit on A4: for a detail");
    expect(choice(panel({}, { kind: "section", section: "A" }).tree, "Scale", "1:20")?.["title"]).toBe("The whole section won't fit on A4: for a detail");
    expect(choice(tree, "Scale", "1:50")?.["title"]).toBeUndefined();
  });

  it("General is pressed on a following sheet, the own scale otherwise", () => {
    expect(choices(panel().tree, "Scale").filter(([, on]) => on).map(([n]) => n)).toEqual(["General"]);
    expect(choices(panel({}, { scale: 20, ownScale: true }).tree, "Scale").filter(([, on]) => on).map(([n]) => n)).toEqual(["1:20"]);
  });

  it("picking one with a dot is allowed, and General clears the sheet's own", () => {
    const { tree, sent } = panel();
    call(choice(tree, "Scale", "1:20"), "onClick");
    call(choice(tree, "Scale", "General"), "onClick");
    expect(sent).toEqual([
      { type: "setSheet", id: "a", fields: { scale: 20 } },
      { type: "setSheet", id: "a", fields: { scale: null } },
    ]);
  });
});

describe("Floor finishes and Centre", () => {
  it("a switch sets the sheet's finishes", () => {
    const { tree, sent } = panel();
    const on = findByTestId(tree, "sheet-finishes");
    expect(on?.["checked"]).toBe(true);
    expect(on?.["role"]).toBe("switch");
    call(on, "onChange", { target: { checked: false } });
    expect(sent).toEqual([{ type: "setSheet", id: "a", fields: { finishes: false } }]);
  });

  it("Centre resets the framing, and has nothing to do on a centred sheet", () => {
    expect(findByTestId(panel().tree, "sheet-centre")?.["disabled"]).toBe(true);
    const { tree, sent } = panel({}, { centred: false });
    call(findByTestId(tree, "sheet-centre"), "onClick");
    expect(sent).toEqual([{ type: "setSheet", id: "a", fields: { cx: 0, cy: 0 } }]);
  });
});

describe("a sheet on the desk (AC-06, AC-12)", () => {
  function desk(over: { selected?: boolean; sheet?: Partial<SheetRow>; paper?: string; readOnly?: boolean } = {}) {
    const sent: UiAction[] = [];
    const picks: string[] = [];
    const view = DeskSheet({
      sheet: row(over.sheet),
      selected: over.selected ?? false,
      size: { widthMm: 297, heightMm: 210 },
      zoom: 1,
      drawPage: () => {},
      readOnly: over.readOnly ?? false,
      send: (a) => sent.push(a),
      onPick: () => picks.push("picked"),
    });
    return { tree: expanded(view, HAS_HOOKS), sent, picks, html: renderToStaticMarkup(view) };
  }
  const classOf = (html: string): string => /data-sheet-id="a"/.test(html) ? (/class="([^"]*)"/.exec(html)?.[1] ?? "") : "";

  it("a long report holds a place for each page, with none built until it's seen", () => {
    let built = 0;
    const { html } = desk({
      sheet: {
        pageCount: 3,
        pages: () => {
          built++;
          return [];
        },
      },
    });
    expect(html.match(/data-testid="sheet-canvas"/g)).toHaveLength(3);
    expect(built).toBe(0);
  });

  it("a page shows the ring only when selected", () => {
    expect(classOf(desk({ selected: true }).html)).toBe("sheets-sheet picked");
    expect(classOf(desk({ selected: false }).html)).toBe("sheets-sheet");
  });

  it("a click anywhere on it picks it", () => {
    const { tree, picks } = desk();
    call(findAll(tree, (p) => p["data-sheet-id"] === "a")[0], "onClick");
    expect(picks).toEqual(["picked"]);
  });

  it("the header shows only its title and scale", () => {
    const { html } = desk({ sheet: { title: "Bedroom detail", scale: 20 } });
    expect(html).toContain('<span class="sheets-title">Bedroom detail</span>');
    expect(html).toContain('<span class="sheets-scale">1:20</span>');
    expect(html).not.toContain("<select");
  });

  it("no note while the whole plan shows", () => {
    expect(desk().html).not.toContain("Shows part of the plan");
  });

  it('"Centre it" when that fixes it, and nothing else', () => {
    const { tree, sent, html } = desk({ sheet: { partOfPlan: true, shortcuts: { centre: true, fit: null, paper: null } } });
    expect(html).toContain("Shows part of the plan");
    expect(findAll(tree, (p) => p["data-shortcut"] !== undefined).map((p) => p["children"])).toEqual(["Centre it"]);
    call(findAll(tree, (p) => p["data-shortcut"] === "centre")[0], "onClick");
    expect(sent).toEqual([{ type: "setSheet", id: "a", fields: { cx: 0, cy: 0 } }]);
  });

  it("a section sheet's note says section", () => {
    const { html } = desk({ sheet: { kind: "section", section: "A", partOfPlan: true, shortcuts: { centre: false, fit: 50, paper: null } } });
    expect(html).toContain("Shows part of the section.");
    expect(html).toContain("Fit the whole section (1:50)");
    expect(html).not.toContain("plan");
  });

  it('else "Fit the whole plan (1:N)" and "Use A2"', () => {
    const { tree, sent } = desk({ sheet: { partOfPlan: true, shortcuts: { centre: false, fit: 50, paper: "A2" } } });
    const names = findAll(tree, (p) => p["data-shortcut"] !== undefined).map((p) => [p["children"]].flat().join(""));
    expect(names).toEqual(["Fit the whole plan (1:50)", "Use A2"]);
    call(findAll(tree, (p) => p["data-shortcut"] === "fit")[0], "onClick");
    call(findAll(tree, (p) => p["data-shortcut"] === "paper")[0], "onClick");
    expect(sent).toEqual([
      { type: "setSheet", id: "a", fields: { scale: 50, cx: 0, cy: 0 } },
      { type: "setSheetSetting", key: "paper", value: "A2" },
    ]);
  });

  it("read-only, the note shows and its shortcuts don't work", () => {
    const { tree } = desk({ readOnly: true, sheet: { partOfPlan: true, shortcuts: { centre: true, fit: null, paper: null } } });
    expect(findAll(tree, (p) => p["data-shortcut"] === "centre")[0]?.["disabled"]).toBe(true);
  });
});

describe("the whole set's settings go below the sheet's (sheetset.15)", () => {
  it("heads them, with the set's north handed to its dial", () => {
    const { tree, html } = panel({ north: 45 });
    expect(html.indexOf("Plan sheet")).toBeLessThan(html.indexOf("Whole set"));
    const dial = findAll(tree, (p) => p["north"] === 45);
    expect(dial).toHaveLength(1);
    expect(dial[0]?.["readOnly"]).toBe(false);
  });

  it("the dial's readOnly follows the view's, never disabling it", () => {
    const { tree } = panel({ north: null, readOnly: true });
    expect(findAll(tree, (p) => p["north"] === null && p["readOnly"] === true)).toHaveLength(1);
  });

  const swatches = (tree: unknown) => findAll(group(tree, "Accent")?.["children"], (p) => "aria-pressed" in p);
  const custom = (tree: unknown) => findAll(tree, (p) => "accent" in p && "send" in p && !("accents" in p));

  it("the accent comes after north, its swatch pressed", () => {
    const { tree, html } = panel({ accent: "#1d4ed8" });
    expect(html.indexOf("North")).toBeLessThan(html.indexOf("Accent"));
    expect(swatches(tree).map((s) => [s["aria-label"], s["aria-pressed"]])).toEqual([["Brick red", false], ["Blue", true]]);
    expect(custom(tree)[0]?.["on"]).toBe(false);
  });

  it("picking a swatch sends one setting; the one already on sends nothing, so no step that changes nothing", () => {
    const { tree, sent } = panel({ accent: "#1d4ed8" });
    const [brick, blue] = swatches(tree);
    (blue?.["onClick"] as () => void)();
    expect(sent).toEqual([]);
    (brick?.["onClick"] as () => void)();
    expect(sent).toEqual([{ type: "setSheetSetting", key: "accent", value: "#b3261e" }]);
  });

  it("a stored colour no swatch holds is the custom one's", () => {
    const { tree } = panel({ accent: "#0a7d55" });
    expect(swatches(tree).map((s) => s["aria-pressed"])).toEqual([false, false]);
    expect(custom(tree)[0]?.["on"]).toBe(true);
    expect(custom(tree)[0]?.["accent"]).toBe("#0a7d55");
  });

  it("read-only, a swatch refuses and stays enabled, so its focus survives an ack", () => {
    const { tree, sent } = panel({ accent: "#1d4ed8", readOnly: true });
    const [brick] = swatches(tree);
    expect(brick?.["disabled"]).toBeUndefined();
    (brick?.["onClick"] as () => void)();
    expect(sent).toEqual([]);
    expect(custom(tree)[0]?.["readOnly"]).toBe(true);
  });
});

describe("a section sheet's settings", () => {
  const pane = (title: string, on: boolean, locked = false) => ({ layout: title.toLowerCase(), deck: null, title, on, locked });
  const section = (over: Partial<SheetRow> = {}): Partial<SheetRow> => ({ kind: "section", section: "A", panes: [pane("Day", true, true), pane("Night", false)], ...over });
  const LETTERS = { sections: [{ id: "A", label: "A–A" }, { id: "B", label: "B–B" }] };
  const checks = (tree: unknown) => findAll(tree, (p) => p["data-testid"] === "sheet-pane");

  it("names the kind", () => {
    expect(panel(LETTERS, section()).html).toContain("Section sheet");
  });

  it("picks its section, the current one pressed, through the action a title follows", () => {
    const { tree, sent } = panel(LETTERS, section());
    expect(choices(tree, "Section").map(([label, pressed]) => [label, pressed])).toEqual([["A–A", true], ["B–B", false]]);
    call(choice(tree, "Section", "B–B"), "onClick");
    expect(sent).toEqual([{ type: "setSheetSection", id: "a", section: "B" }]);
  });

  it("has a check per layout, 1 to 4, sent as a compare's are; one it can't lose is off", () => {
    const { tree, sent, html } = panel(LETTERS, section());
    expect(html).toContain("Layouts, 1 to 4");
    expect(checks(tree).map((c) => [c["checked"], c["disabled"]])).toEqual([[true, true], [false, false]]);
    call(checks(tree)[1], "onChange");
    expect(sent).toEqual([{ type: "toggleSheetPane", id: "a", layout: "night", deck: null }]);
  });

  it("has a split, a scale and a framing, and neither a Layout, a Level nor floor finishes", () => {
    const { tree, html } = panel(LETTERS, section());
    expect(group(tree, "Split")).toBeDefined();
    expect(group(tree, "Scale")).toBeDefined();
    expect(findByTestId(tree, "sheet-centre")).not.toBeNull();
    expect(group(tree, "Layout")).toBeUndefined();
    expect(group(tree, "Level")).toBeUndefined();
    expect(html).not.toContain("Floor finishes");
  });

  it("the other drawn kinds keep their floor finishes", () => {
    expect(panel(LETTERS).html).toContain("Floor finishes");
    expect(panel(LETTERS, { kind: "compare", panes: [] }).html).toContain("Floor finishes");
    expect(panel(LETTERS, { kind: "cover" }).html).toContain("Floor finishes");
  });

  it("read-only, nothing can be changed", () => {
    const { tree } = panel({ ...LETTERS, readOnly: true }, section());
    expect(findAll(group(tree, "Section")?.["children"], (p) => "aria-pressed" in p).map((b) => b["disabled"])).toEqual([true, true]);
    expect(checks(tree).map((c) => c["disabled"])).toEqual([true, true]);
  });
});

describe("the Section marks tick (section.60)", () => {
  const LETTERS = { sections: [{ id: "A", label: "A–A" }] };
  const tick = (tree: unknown) => findAll(tree, (p) => p["data-testid"] === "sheet-marks")[0];

  it("shows only with a section to mark", () => {
    expect(tick(panel().tree)).toBeUndefined();
    expect(tick(panel(LETTERS).tree)?.["checked"]).toBe(true);
    expect(tick(panel(LETTERS, { marks: false }).tree)?.["checked"]).toBe(false);
  });

  it("a section sheet has none", () => {
    expect(tick(panel(LETTERS, { kind: "section", section: "A" }).tree)).toBeUndefined();
  });

  it("sends the sheet's edit", () => {
    const { tree, sent } = panel(LETTERS);
    call(tick(tree), "onChange", { target: { checked: false } });
    expect(sent).toEqual([{ type: "setSheet", id: "a", fields: { marks: false } }]);
  });
});
