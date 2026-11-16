import { cloneElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Field, UiAction, ViewModel } from "@fm/editor";
import { FakeShell, roomDoc, withCommands } from "@fm/editor/testing";
import { DraftInput, DraftTextArea } from "../src/panels/DraftInput";
import { Icon } from "../src/panels/icons";
import { PropertiesPanel } from "../src/panels/PropertiesPanel";
import { viewFixture } from "./fixtures";
import { call, findAll, findByTestId, mouseDown } from "./react-tree";

/** The tree with every hook-free child component called in place (DraftInput and DraftTextArea, which hold a draft, stay elements). */
function expand(node: unknown): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement<Record<string, unknown>>(node)) return typeof node === "string" || typeof node === "number" ? node : null;
  const type: unknown = node.type;
  if (typeof type === "function" && type !== DraftInput && type !== DraftTextArea) return expand(type(node.props));
  return "children" in node.props ? cloneElement(node, undefined, expand(node.props.children)) : node;
}

const render = (view: ViewModel, sent: UiAction[]) => expand(PropertiesPanel({ view, send: (a) => sent.push(a) }));
const byField = (tree: unknown, id: string) => findAll(tree, (p) => p["data-field-id"] === id);

const murphy: ViewModel["properties"] = {
  kind: "object",
  fields: [
    { id: "kind", label: "Kind", section: "Object", value: "Murphy bed", unit: null, readOnly: true },
    { id: "name", label: "Name", section: "Object", value: "Murphy bed", unit: null, readOnly: false },
    { id: "width", label: "Width", section: "Size", value: "1.60", unit: "m", readOnly: false, step: 0.01 },
    { id: "depth", label: "Depth", section: "Size", value: "0.40", unit: "m", readOnly: false, step: 0.01 },
    { id: "config", label: "Configuration", section: "Placement", value: "folded", unit: null, readOnly: false, options: [{ value: "folded", label: "Closed" }, { value: "down", label: "Open" }] },
    { id: "angle", label: "Angle", section: "Placement", value: "0", unit: "°", readOnly: false, step: 1 },
  ],
};

describe("PropertiesPanel sections and controls (ux-polish item 6)", () => {
  it("a murphy bed shows sections Object, Size and Placement; Kind is plain text; the configuration is a segmented control of Closed and Open whose click sends one setField (AC-10)", () => {
    const view = viewFixture({ properties: murphy });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    const titles = [...html.matchAll(/<summary[^>]*>.*?<\/svg>(.*?)<\/summary>/g)].map((m) => m[1]);
    expect(titles).toEqual(["Object", "Size", "Placement"]);
    // Each section collapses on its title: a <details>, open at first.
    expect(html.match(/<details[^>]*open=""/g)).toHaveLength(3);
    // Kind is read-only text, not a filled control; e2e reads read-only values with toHaveValue, so it stays a readonly input.
    expect(html).toMatch(/<input[^>]*readOnly=""[^>]*data-field-id="kind"[^>]*value="Murphy bed"|<input[^>]*data-field-id="kind"[^>]*readOnly=""/);
    expect(html).not.toMatch(/class="fm-control"><input[^>]*data-field-id="kind"/);
    expect(html).not.toContain("<select");
    const group = /<div[^>]*data-field-id="config"[^>]*>(.*?)<\/div>/.exec(html)?.[0] ?? "";
    expect(group).toContain('class="fm-seg fm-seg-full"');
    expect([...group.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1])).toEqual(["Closed", "Open"]);
    expect(group).toMatch(/<button[^>]*data-value="folded"[^>]*aria-pressed="true"|<button[^>]*aria-pressed="true"[^>]*data-value="folded"/);

    const sent: UiAction[] = [];
    const tree = render(view, sent);
    const down = findAll(byField(tree, "config")[0]?.["children"], (p) => p["data-value"] === "down")[0];
    call(down, "onClick");
    expect(sent).toEqual([{ type: "setField", fieldId: "config", value: "down" }]);
  });

  it("a field with select: true renders Select; a field with options only stays Segmented", () => {
    const fields = murphy.kind === "object" ? murphy.fields : [];
    const preset = {
      id: "preset", label: "Preset", section: "Size", value: "Double", unit: null, readOnly: false, select: true,
      options: [{ value: "Single", label: "Single 100 × 40 (open 210)" }, { value: "Double", label: "Double 160 × 40 (open 210)" }, { value: "custom", label: "Custom", disabled: true }],
    };
    const withPreset: ViewModel["properties"] = { kind: "object", fields: [...fields.slice(0, 2), preset, ...fields.slice(2)] };
    const view = viewFixture({ properties: withPreset });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    expect(html).toMatch(/<div class="fm-control"><select[^>]*data-field-id="preset"/);
    expect([...html.matchAll(/<summary[^>]*>.*?<\/svg>(.*?)<\/summary>/g)].map((m) => m[1])).toEqual(["Object", "Size", "Placement"]);
    const size = /<details[^>]*>(?:(?!<\/details>).)*?>Size<\/summary>(.*?)<\/details>/.exec(html)?.[1] ?? "";
    expect([...size.matchAll(/data-field-id="([^"]*)"/g)].map((m) => m[1])).toEqual(["preset", "width", "depth"]);
    expect(/<div[^>]*data-field-id="config"[^>]*>/.exec(html)?.[0]).toContain('class="fm-seg fm-seg-full"');
    expect(html).not.toMatch(/<select[^>]*data-field-id="config"/);

    const sent: UiAction[] = [];
    call(byField(render(view, sent), "preset")[0], "onChange", { currentTarget: { value: "Single", blur: () => {} } }); // a select blurs after a pick (snags.06)
    expect(sent).toEqual([{ type: "setField", fieldId: "preset", value: "Single" }]);
  });

  it("Stands on renders as a drop-down of Floor and the deck under the piece, and a choice sends one setField (decks.16)", () => {
    const fields = murphy.kind === "object" ? murphy.fields : [];
    const standsOn = {
      id: "standsOn", label: "Stands on", section: "Placement", value: "floor", unit: null, readOnly: false, select: true,
      options: [{ value: "floor", label: "Floor" }, { value: "l/k0", label: "Loft +2.15" }],
    };
    const view = viewFixture({ properties: { kind: "object", fields: [...fields, standsOn] } });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    const select = /<select[^>]*data-field-id="standsOn"[^>]*>(.*?)<\/select>/.exec(html);
    expect(select?.[0]).toContain('aria-label="Stands on"');
    expect([...(select?.[1] ?? "").matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]])).toEqual([["floor", "Floor"], ["l/k0", "Loft +2.15"]]);
    const sent: UiAction[] = [];
    call(byField(render(view, sent), "standsOn")[0], "onChange", { currentTarget: { value: "l/k0", blur: () => {} } }); // a select blurs after a pick (snags.06)
    expect(sent).toEqual([{ type: "setField", fieldId: "standsOn", value: "l/k0" }]);
  });

  it("an Opens into field renders as a segmented control of Table, Desk, Bed and a click sends one setField", () => {
    // A guard: a field with options is a Segmented control already (smart.21).
    const unit: ViewModel["properties"] = {
      kind: "object",
      fields: [
        { id: "kind", label: "Kind", section: "Object", value: "Built-in unit", unit: null, readOnly: true },
        {
          id: "opensInto", label: "Opens into", section: "Object", value: "builtInTable", unit: null, readOnly: false,
          options: [{ value: "builtInTable", label: "Table" }, { value: "builtInDesk", label: "Desk" }, { value: "murphyBed", label: "Bed" }],
        },
      ],
    };
    const view = viewFixture({ properties: unit });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    const group = /<div[^>]*data-field-id="opensInto"[^>]*>(.*?)<\/div>/.exec(html)?.[0] ?? "";
    expect(group).toContain('class="fm-seg fm-seg-full"');
    expect([...group.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1])).toEqual(["Table", "Desk", "Bed"]);
    const sent: UiAction[] = [];
    const tree = render(view, sent);
    call(findAll(byField(tree, "opensInto")[0]?.["children"], (p) => p["data-value"] === "builtInDesk")[0], "onClick");
    expect(sent).toEqual([{ type: "setField", fieldId: "opensInto", value: "builtInDesk" }]);
  });

  it("a stepper click on Width sends setField with the value plus 0.01 (AC-10)", () => {
    const sent: UiAction[] = [];
    const tree = render(viewFixture({ properties: murphy }), sent);
    call(findAll(tree, (p) => p["aria-label"] === "Increase Width")[0], "onClick");
    call(findAll(tree, (p) => p["aria-label"] === "Decrease Angle")[0], "onClick");
    expect(sent).toEqual([
      { type: "setField", fieldId: "width", value: "1.61" },
      { type: "setField", fieldId: "angle", value: "-1" },
    ]);
    // Typed values still commit through the draft input.
    call(byField(tree, "depth")[0], "onCommit", "0.45");
    expect(sent.at(-1)).toEqual({ type: "setField", fieldId: "depth", value: "0.45" });
  });

  it("a glazed door shows a switch that sends \"false\" when turned off", () => {
    const opening: ViewModel["properties"] = {
      kind: "opening",
      fields: [
        { id: "kind", label: "Kind", section: "Opening", value: "swing", unit: null, readOnly: false, options: [{ value: "swing", label: "Swing door" }, { value: "sliding", label: "Sliding door" }, { value: "window", label: "Fixed window" }] },
        { id: "glazed", label: "Glazed", section: "Swing", value: "true", unit: null, readOnly: false, toggle: true },
      ],
    };
    const view = viewFixture({ properties: opening });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    const tag = /<button[^>]*data-field-id="glazed"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain('role="switch"');
    expect(tag).toContain('aria-checked="true"');
    expect(html).not.toContain('type="checkbox"');
    const sent: UiAction[] = [];
    call(byField(render(view, sent), "glazed")[0], "onClick");
    expect(sent).toEqual([{ type: "setField", fieldId: "glazed", value: "false" }]);
  });

  it("disables every control when the drawing cannot be edited", () => {
    const view = viewFixture({ properties: murphy, project: { name: "x", status: "saved", dirty: false, canEdit: false } });
    const tree = render(view, []);
    const editable = findAll(tree, (p) => "onClick" in p || "onCommit" in p);
    expect(editable.length).toBeGreaterThan(0);
    // A text box keeps its focus through an edit's answer, so it's read-only, not disabled (sheetset.68).
    for (const p of editable) expect("onCommit" in p ? p["readOnly"] : p["disabled"]).toBe(true);
  });

  it("with nothing selected and the Wall tool active, shows Wall, its key W, the hint, and every tool's shortcut (AC-11)", () => {
    const shortcuts = [
      { label: "Select", key: "V" }, { label: "Wall", key: "W" }, { label: "Zone", key: "Z" }, { label: "Object", key: "O" },
      { label: "Opening", key: "D" }, { label: "Undo", key: "Mod+Z" }, { label: "Delete", key: "Delete" },
    ];
    const view = viewFixture({
      activeTool: "wall",
      toolHelp: { tool: "wall", label: "Wall", key: "W", hint: "First point" },
      shortcuts,
    });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} mac />);
    expect(html).toContain('data-testid="properties"');
    expect(html).toMatch(/data-testid="tool-help"[^>]*>.*?<svg.*?<\/svg>Wall<kbd[^>]*>W<\/kbd>/);
    expect(html).toContain(">First point<");
    const pairs = (markup: string) => [...markup.matchAll(/<dt>(.*?)<\/dt><dd><kbd[^>]*>(.*?)<\/kbd><\/dd>/g)].map((m) => [m[1], m[2]]);
    const shown = (undo: string, del: string) => shortcuts.map((s) => [s.label, s.label === "Undo" ? undo : s.label === "Delete" ? del : s.key]);
    expect(pairs(html)).toEqual(shown("⌘Z", "⌫"));
    // Elsewhere the same keys read Ctrl+Z and Del (cleanup.09, AC-14).
    expect(pairs(renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} mac={false} />))).toEqual(shown("Ctrl+Z", "Del"));
  });

  it("the empty state shows the Scale tool's icon, label and prompt, with no key (import.13)", () => {
    const view = viewFixture({ activeTool: "scale", toolHelp: { tool: "scale", label: "Scale", key: "", hint: "Click the first point on the picture" } });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    const help = /data-testid="tool-help"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(help).toBe(renderToStaticMarkup(<Icon name="scale" size={18} />) + "Scale");
    expect(help).not.toContain("<kbd");
    expect(html).toContain('<p class="prop-empty-hint">Click the first point on the picture</p>');
  });

  it("with nothing selected, lists the rooms with their second line (size and floor), area and free floor, and the total (export.10, finishes.11)", () => {
    const view = viewFixture({
      rooms: {
        rows: [
          { labelId: "L1", name: "Bedroom", detail: "2.80 × 3.80 m · Planks", area: "10.64 m²", free: "8.4 m²" },
          { labelId: "L2", name: "Hall", detail: null, area: "6.12 m²", free: null },
        ],
        total: "16.76 m²",
      },
    });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    expect(html).toContain('data-testid="rooms-table"');
    // Each row: the name with the size under it (narrow panel), then Area and Free.
    const rows = [...html.matchAll(/<tr[^>]*data-room[^>]*>(.*?)<\/tr>/g)].map((m) => {
      const row = m[1] ?? "";
      const name = /class="prop-room-name"[^>]*>(.*?)</.exec(row)?.[1];
      const size = /class="prop-room-size"[^>]*>(.*?)</.exec(row)?.[1] ?? "";
      const cells = [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1]);
      return [name, size, ...cells];
    });
    expect(rows).toEqual([["Bedroom", "2.80 × 3.80 m · Planks", "10.64 m²", "8.4 m²"], ["Hall", "", "6.12 m²", ""]]);
    expect(html).toMatch(/Total.*16\.76 m²/);
    expect(renderToStaticMarkup(<PropertiesPanel view={viewFixture({ rooms: null })} send={() => {}} />)).not.toContain("rooms-table");
  });

  it("a named area is a row under its room, marked as a part, with its area and no free floor (areas.12)", () => {
    const view = viewFixture({
      rooms: {
        rows: [
          { labelId: "L1", name: "Great room", detail: null, area: "22.04 m²", free: "18.0 m²" },
          { labelId: "k/a0", name: "Kitchen", detail: null, area: "4.00 m²", free: null, part: true },
        ],
        total: "22.04 m²",
      },
    });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={() => {}} />);
    const room = /<tr[^>]*data-room="Great room"[^>]*>/.exec(html)?.[0] ?? "";
    const part = /<tr[^>]*data-area="Kitchen"[^>]*>(.*?)<\/tr>/.exec(html);
    expect(room).not.toContain("prop-room-part");
    expect(part?.[0]).toContain('class="prop-room-part"');
    expect([...(part?.[1] ?? "").matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1])).toEqual(["4.00 m²", ""]);
    expect(html.indexOf('data-room="Great room"')).toBeLessThan(html.indexOf('data-area="Kitchen"'));
  });
});

describe("Project section (sheet.04, AC-06)", () => {
  const projectFields: ViewModel["projectFields"] = [
    { id: "project.client", label: "Client", section: "Project", value: "Rossi", unit: null, readOnly: false },
    { id: "project.notes", label: "Notes", section: "Project", value: "", unit: null, readOnly: false, multiline: true },
  ];
  const rooms: ViewModel["rooms"] = { rows: [{ labelId: "L1", name: "Studio", detail: "5.80 × 3.80 m", area: "22.04 m²", free: null }], total: "22.04 m²" };

  it("with nothing selected, shows the Project section above Rooms, the notes as a textarea", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ projectFields, rooms })} send={() => {}} />);
    const project = html.indexOf('data-testid="project-section"');
    expect(project).toBeGreaterThan(-1);
    expect(project).toBeLessThan(html.indexOf('data-testid="rooms-table"'));
    expect(html).toMatch(/<input[^>]*data-field-id="project.client"[^>]*value="Rossi"|<input[^>]*value="Rossi"[^>]*data-field-id="project.client"/);
    expect(html).toMatch(/<textarea[^>]*data-field-id="project.notes"/);
  });

  it("committing a field sends setField with its id", () => {
    const sent: UiAction[] = [];
    const tree = render(viewFixture({ projectFields }), sent);
    const input = byField(tree, "project.client")[0];
    call(input, "onCommit", "Bianchi");
    expect(sent).toEqual([{ type: "setField", fieldId: "project.client", value: "Bianchi" }]);
  });

  it("a report's row shows its first line and an Edit that opens that sheet (AC-14)", () => {
    const sent: UiAction[] = [];
    const report: Field = { id: "project.report", label: "Report", section: "Project", value: "Studio in a room", unit: null, readOnly: true, sheet: "r/t0" };
    const tree = render(viewFixture({ projectFields: [report] }), sent);
    expect(byField(tree, "project.report")[0]?.["value"]).toBe("Studio in a room");
    call(findByTestId(tree, "project-report-edit"), "onClick");
    expect(sent).toEqual([{ type: "openSheet", id: "r/t0" }]);
  });

  it("no Project section without fields (a selection, or no drawing)", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ projectFields: null })} send={() => {}} />);
    expect(html).not.toContain("project-section");
  });
});

describe("group selection (direct.08, AC-09)", () => {
  it("a group shows \"3 objects\" and no field rows", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ properties: { kind: "group", count: 3 } })} send={() => {}} />);
    expect(html).toContain("3 objects");
    expect(html).toContain('data-testid="properties-group"');
    expect(html).not.toContain("data-field-id");
    expect(html).not.toContain("<details");
  });
});

describe("a group with walls (straight.09, AC-23)", () => {
  it("shows its counts and a Duplicate that is off, with the reason as its title", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ properties: { kind: "group", count: 10, walls: 4, duplicate: "Walls can't be duplicated" } })} send={() => {}} />);
    expect(html).toContain(">4 walls, 6 pieces<");
    const button = /<button[^>]*data-testid="prop-duplicate"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain("disabled");
    expect(button).toMatch(/title="Walls can(&#x27;|')t be duplicated"/);
    expect(html).toContain('data-testid="group-delete"');
  });

  it("walls alone read \"2 walls\"", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ properties: { kind: "group", count: 2, walls: 2, duplicate: "Walls can't be duplicated" } })} send={() => {}} />);
    expect(html).toContain(">2 walls<");
  });
});

describe("group Delete (direct.08, AC-09)", () => {
  const group: ViewModel["properties"] = { kind: "group", count: 2 };

  it("the group section has a Delete button and no field rows", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ properties: group })} send={() => {}} />);
    expect(html).toContain('data-testid="properties-group"');
    expect(html).toContain(">2 objects<");
    expect(html).toContain('data-testid="group-delete"');
    expect(html).not.toContain("data-field-id");
    expect(html).not.toContain("<details");
  });

  it("Delete sends one deleteSelection", () => {
    const sent: UiAction[] = [];
    const tree = render(viewFixture({ properties: group }), sent);
    const button = findAll(tree, (p) => p["data-testid"] === "group-delete")[0];
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(sent).toEqual([{ type: "deleteSelection" }]);
  });

  it("Delete is disabled when the drawing cannot be edited", () => {
    const base = viewFixture().project;
    expect(base?.canEdit).toBe(true);
    const tree = render(viewFixture({ properties: group, project: base && { ...base, canEdit: false } }), []);
    expect(findAll(tree, (p) => p["data-testid"] === "group-delete")[0]?.["disabled"]).toBe(true);
  });
});

describe("Duplicate in Properties (ghost.03, AC-08)", () => {
  const base = viewFixture().project;
  const group: ViewModel["properties"] = { kind: "group", count: 3 };
  const wall: ViewModel["properties"] = {
    kind: "wall",
    fields: [{ id: "length", label: "Length", section: "Wall", value: "3.00", unit: "m", readOnly: false, step: 0.01 }],
  };

  it("an object's Properties offers Duplicate, which sends duplicate", () => {
    const sent: UiAction[] = [];
    const button = findByTestId(render(viewFixture({ properties: murphy }), sent), "prop-duplicate");
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(sent).toEqual([{ type: "duplicate" }]);
  });

  it("a set's Properties offers Break apart, which sends breakApart; another piece's doesn't", () => {
    const sent: UiAction[] = [];
    const button = findByTestId(render(viewFixture({ properties: { ...murphy, breakApart: true } }), sent), "prop-break-apart");
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(sent).toEqual([{ type: "breakApart" }]);
    expect(findByTestId(render(viewFixture({ properties: murphy }), []), "prop-break-apart")).toBeNull();
  });

  it("a group's Properties offers Duplicate next to Delete (AC-09)", () => {
    const sent: UiAction[] = [];
    const tree = render(viewFixture({ properties: group }), sent);
    const row = findAll(tree, (p) => p["className"] === "prop-group-actions")[0];
    expect(findAll(row?.["children"], (p) => typeof p["data-testid"] === "string").map((p) => p["data-testid"])).toEqual(["group-delete", "prop-duplicate"]);
    const button = findByTestId(tree, "prop-duplicate");
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(sent).toEqual([{ type: "duplicate" }]);
  });

  it("Duplicate is disabled when the drawing cannot be edited", () => {
    expect(base?.canEdit).toBe(true);
    const project = base && { ...base, canEdit: false };
    for (const properties of [murphy, group]) {
      expect(findByTestId(render(viewFixture({ properties, project }), []), "prop-duplicate")?.["disabled"]).toBe(true);
    }
  });

  it("no Duplicate for a wall", () => {
    expect(findByTestId(render(viewFixture({ properties: wall }), []), "prop-duplicate")).toBeNull();
  });

  it("Duplicate keeps keyboard focus off the button, so R and Esc reach the ghost", () => {
    for (const properties of [murphy, group]) {
      const preventDefault = vi.fn();
      call(findByTestId(render(viewFixture({ properties }), []), "prop-duplicate"), "onMouseDown", mouseDown(preventDefault));
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }
  });
});

describe("Underlay section (import.06)", () => {
  const HINT = "Use a straight scan or screenshot; for a paper plan, your phone's document scanner straightens it";
  const none: NonNullable<ViewModel["underlay"]> = { present: false, canEdit: true, fade: 0.5, visible: true };
  const shown: NonNullable<ViewModel["underlay"]> = { ...none, present: true };
  const readOnly: NonNullable<ViewModel["underlay"]> = { ...shown, canEdit: false };
  const projectFields: ViewModel["projectFields"] = [{ id: "project.client", label: "Client", section: "Project", value: "", unit: null, readOnly: false }];

  type Extra = { renderer?: "canvas2d" | "webgl" | "webgpu"; onChoosePicture?: () => void };
  const tree = (underlay: ViewModel["underlay"], sent: UiAction[] = [], extra: Extra = {}) =>
    expand(PropertiesPanel({ view: viewFixture({ underlay }), send: (a) => sent.push(a), ...extra }));
  const markup = (underlay: ViewModel["underlay"], extra: Extra = {}) =>
    renderToStaticMarkup(<PropertiesPanel view={viewFixture({ underlay, projectFields })} send={() => {}} {...extra} />);
  const part = (t: unknown, id: string) => findByTestId(t, id);

  it("with nothing selected the section sits between the tool help and the Project section", () => {
    const html = markup(none);
    const section = html.indexOf('data-testid="underlay-section"');
    expect(section).toBeGreaterThan(html.indexOf('data-testid="tool-help"'));
    expect(section).toBeLessThan(html.indexOf('data-testid="project-section"'));
    expect(html).toContain(`>${HINT.replace("'", "&#x27;")}<`); // the markup escapes the apostrophe
    expect(findAll(tree(none), (p) => p["children"] === HINT)).toHaveLength(1); // the exact text, in its own element
    expect(markup(null)).not.toContain("underlay-section");
  });

  it("Choose picture… calls onChoosePicture and is off without the prop or when read-only", () => {
    const sent: UiAction[] = [];
    const onChoosePicture = vi.fn();
    const button = part(tree(none, sent, { onChoosePicture }), "underlay-choose");
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(onChoosePicture).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    expect(part(tree(none), "underlay-choose")?.["disabled"]).toBe(true);
    expect(part(tree(readOnly, [], { onChoosePicture }), "underlay-choose")?.["disabled"]).toBe(true);
    const preventDefault = vi.fn();
    call(button, "onMouseDown", mouseDown(preventDefault));
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("Remove sends removeUnderlay and is off with no picture or when read-only", () => {
    const sent: UiAction[] = [];
    const button = part(tree(shown, sent), "underlay-remove");
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(sent).toEqual([{ type: "removeUnderlay" }]);
    expect(part(tree(none), "underlay-remove")?.["disabled"]).toBe(true);
    expect(part(tree(readOnly), "underlay-remove")?.["disabled"]).toBe(true);
    const preventDefault = vi.fn();
    call(button, "onMouseDown", mouseDown(preventDefault));
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("Scale in the Underlay section picks the tool, disabled with no picture or read-only (import.13)", () => {
    const sent: UiAction[] = [];
    const button = part(tree(shown, sent), "underlay-scale");
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(sent).toEqual([{ type: "pickTool", tool: "scale" }]);
    const preventDefault = vi.fn();
    call(button, "onMouseDown", mouseDown(preventDefault));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(part(tree(none), "underlay-scale")?.["disabled"]).toBe(true); // assert the prop: call ignores disabled
    expect(part(tree(readOnly), "underlay-scale")?.["disabled"]).toBe(true);
    const ids = ["underlay-choose", "underlay-scale", "underlay-remove"];
    const buttons = findAll(tree(shown), (p) => ids.includes(String(p["data-testid"])));
    expect(buttons.map((b) => b["children"])).toEqual(["Choose picture…", "Scale", "Remove"]);
  });

  it("the fade slider sends setUnderlayFade as a number and stays on when read-only", () => {
    const sent: UiAction[] = [];
    const input = part(tree(shown, sent), "underlay-fade");
    expect([input?.["type"], input?.["min"], input?.["max"], input?.["step"], input?.["value"]]).toEqual(["range", 0, 1, 0.05, 0.5]);
    expect(markup(shown)).toMatch(/<input[^>]*type="range"[^>]*data-testid="underlay-fade"|<input[^>]*data-testid="underlay-fade"[^>]*type="range"/);
    call(input, "onChange", { currentTarget: { value: "0.8" } });
    expect(sent).toEqual([{ type: "setUnderlayFade", fade: 0.8 }]);
    expect(input?.["disabled"]).toBe(false);
    expect(part(tree(readOnly), "underlay-fade")?.["disabled"]).toBe(false);
    expect(part(tree(none), "underlay-fade")?.["disabled"]).toBe(true);
    expect(input?.["onMouseDown"]).toBeUndefined(); // a preventDefault would stop the drag
  });

  it("show/hide reads Hide or Show and sends toggleUnderlay, also when read-only", () => {
    const sent: UiAction[] = [];
    const hide = part(tree(shown, sent), "underlay-toggle");
    expect(hide?.["children"]).toBe("Hide");
    call(hide, "onClick");
    expect(sent).toEqual([{ type: "toggleUnderlay" }]);
    expect(part(tree({ ...shown, visible: false }), "underlay-toggle")?.["children"]).toBe("Show");
    expect(part(tree(readOnly), "underlay-toggle")?.["disabled"]).toBe(false);
    expect(part(tree(none), "underlay-toggle")?.["disabled"]).toBe(true);
  });

  it("the line shows only under a GPU renderer, WebGL or WebGPU (webgpu gate M2)", () => {
    const line = "The underlay shows with Canvas2D";
    expect(markup(shown, { renderer: "webgl" })).toContain(line);
    expect(markup(shown, { renderer: "webgpu" })).toContain(line);
    expect(markup(shown, { renderer: "canvas2d" })).not.toContain(line);
    expect(markup(shown)).not.toContain(line);
  });
});

describe("Ceiling section (heights.11, AC-04)", () => {
  const ceiling: ViewModel["ceiling"] = [
    { id: "ceiling.height", label: "Height", section: "Ceiling", value: "2.50", unit: "m", readOnly: false, step: 0.05 },
    { id: "ceiling.shape", label: "Shape", section: "Ceiling", value: "flat", unit: null, readOnly: false, options: [{ value: "flat", label: "Flat" }, { value: "shed", label: "Shed", disabled: true }, { value: "gable", label: "Gable", disabled: true }] },
  ];
  const projectFields: ViewModel["projectFields"] = [{ id: "project.client", label: "Client", section: "Project", value: "", unit: null, readOnly: false }];

  it("with nothing selected, shows the ceiling above Project, Shed and Gable disabled", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ ceiling, projectFields })} send={() => {}} />);
    const section = html.indexOf('data-testid="ceiling-section"');
    expect(section).toBeGreaterThan(-1);
    expect(section).toBeLessThan(html.indexOf('data-testid="project-section"'));
    expect(html).toMatch(/data-field-id="ceiling.height"/);
    expect(html).toMatch(/<button[^>]*data-value="shed"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*data-value="gable"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*data-value="flat"[^>]*disabled=""/);
    expect(renderToStaticMarkup(<PropertiesPanel view={viewFixture({ ceiling: null })} send={() => {}} />)).not.toContain("ceiling-section");
  });
});

describe("the Stair section (stairs.15, AC-11, AC-04)", () => {
  /** The 6 × 4 room under 3.20 with a hollow loft (x 3.85–5.85, top 2.15) and a storage stair of run `run` on its edge reaching it, selected. */
  function stairShell(run = 1.99): FakeShell {
    const doc = withCommands(
      roomDoc(),
      { type: "setCeiling", height: 3.2 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.85, y: 2 }, w: 2, d: 3 },
      { type: "placeObject", opId: "st", state: "s0", object: { kind: "storageStair" }, at: { x: 3.85, y: 2 }, rotation: 270, deck: null, reaches: "l/k0" },
      { type: "setObjectSize", objectId: "st/o0", w: 0.6, d: { standard: run } },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 3.35, y: 2 });
    return shell;
  }
  /** The panel's tree for the shell's view; what it sends goes to the editor, as the web store does. */
  const stairPanel = (shell: FakeShell) => expand(PropertiesPanel({ view: shell.view(), send: (a) => shell.ui(a) }));
  const html = (shell: FakeShell) => renderToStaticMarkup(<PropertiesPanel view={shell.view()} send={() => {}} />);
  const readOnlyValue = (markup: string, id: string) => new RegExp(`<input readOnly=""[^>]*data-field-id="${id}"[^>]*value="([^"]*)"`).exec(markup)?.[1];
  const checks = (markup: string) => [...markup.matchAll(/<p class="prop-check" data-check="([^"]*)" data-field-id="[^"]*">(?:<svg.*?<\/svg>)<span>([^<]*)<\/span><\/p>/g)].map((m) => [m[1], m[2]]);

  it("a storage stair to the loft with run 1.50 shows 10 risers, going 0.167, slope 52.2° read-only and a going warning (AC-11)", () => {
    const markup = html(stairShell(1.5));
    expect([...markup.matchAll(/<summary[^>]*>.*?<\/svg>(.*?)<\/summary>/g)].map((m) => m[1])).toEqual(["Object", "Stair", "Placement", "Use zones"]);
    expect(["risers", "slope"].map((id) => readOnlyValue(markup, id))).toEqual(["10 × 0.215", "52.2"]);
    expect(checks(markup)).toContainEqual(["warning", "Going 0.167 m (0.221 wanted)"]);
    expect(checks(markup)).toContainEqual(["ok", "Riser 0.215 m (0.178–0.305 wanted)"]);
  });

  it("Fit run sends setObjectSize with depth 1.99: 9 × (0.508 − 4/3 × 0.215) = 1.992, the width unchanged", () => {
    const shell = stairShell(1.5);
    expect(html(shell)).toMatch(/<button type="button" data-field-id="fitRun"[^>]*aria-label="Fit run 1.99 m"[^>]*>Use 1.99 m<\/button>/);
    call(byField(stairPanel(shell), "fitRun")[0], "onClick");
    expect(shell.doc().objects["st/o0"]?.d.standard).toBeCloseTo(1.992, 6);
    expect(shell.doc().objects["st/o0"]?.w.standard).toBe(0.6);
  });

  it("a stair's Through row selects its hole, and lights it up while pointed at (riser.20)", () => {
    const doc = withCommands(
      roomDoc(), { type: "setCeiling", height: 5 },
      { type: "addDeck", opId: "up", preset: "loft", at: { x: 3, y: 2 }, w: 5.8, d: 3.8, top: 2.7 },
      { type: "addDeckHole", opId: "h", deck: "up/k0", at: { x: 3, y: 2 }, w: 3.8, d: 1 },
      { type: "placeObject", opId: "st", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 3.78 } }, at: { x: 4.9, y: 2 }, rotation: 270, deck: null, reaches: "up/k0" },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 3, y: 2 });
    const row = () => byField(stairPanel(shell), "hole.h/h0")[0];
    expect(html(shell)).toContain(">Hole 3.80 × 1.00</button>");
    call(row(), "onMouseEnter");
    expect(shell.state.hover).toEqual({ table: "deckHoles", id: "h/h0" });
    call(row(), "onMouseLeave");
    expect(shell.state.hover).toBeNull();
    call(row(), "onClick");
    expect(shell.state.selection).toEqual([{ table: "deckHoles", id: "h/h0" }]);
  });

  it("Fit run is off once the run fits (riser.18)", () => {
    const shell = stairShell(1.5);
    call(byField(stairPanel(shell), "fitRun")[0], "onClick");
    expect(html(shell)).toMatch(/<button type="button" data-field-id="fitRun"[^>]* disabled=""[^>]*>Use 1.99 m<\/button>/);
  });

  it("Reaches lists the decks and Nothing; picking Nothing sends setStairReaches null", () => {
    const shell = stairShell();
    const select = /<select[^>]*data-field-id="reaches"[^>]*>(.*?)<\/select>/.exec(html(shell));
    expect([...(select?.[1] ?? "").matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]])).toEqual([["l/k0", "Loft +2.15"], ["nothing", "Nothing"]]);
    call(byField(stairPanel(shell), "reaches")[0], "onChange", { currentTarget: { value: "nothing", blur: () => {} } }); // a select blurs after a pick (snags.06)
    expect(shell.doc().objects["st/o0"]?.reaches).toBeNull();
  });

  it("the rise field is read-only while the stair reaches a deck, editable when it reaches nothing (editing it sends setObjectSize with h)", () => {
    const shell = stairShell();
    expect(readOnlyValue(html(shell), "rise")).toBe("2.15");
    shell.ui({ type: "setField", fieldId: "reaches", value: "nothing" });
    expect(readOnlyValue(html(shell), "rise")).toBeUndefined();
    call(byField(stairPanel(shell), "rise")[0], "onCommit", "1.8");
    expect(readOnlyValue(html(shell), "risers")).toBe("8 × 0.225");
    expect(byField(stairPanel(shell), "rise")[0]?.["value"]).toBe("1.80");
  });

  it("the headroom warning shows its value: 3.20 − 9 × 0.215 = 1.265 over the flight, 1.88 wanted (AC-04)", () => {
    expect(checks(html(stairShell()))).toContainEqual(["warning", "Headroom 1.27 m over the flight (1.88 wanted)"]);
  });
});

describe("the logo in Project (sheetset.21; AC-13)", () => {
  const none: NonNullable<ViewModel["logo"]> = { present: false, canEdit: true };
  const shown: NonNullable<ViewModel["logo"]> = { present: true, canEdit: true };
  const fields: Field[] = [{ id: "project.client", label: "Client", section: "Project", value: "", unit: null, readOnly: false }];
  const part = (t: unknown, id: string) => findByTestId(t, id);
  const tree = (logo: ViewModel["logo"], sent: UiAction[] = [], onChooseLogo?: () => void) =>
    expand(PropertiesPanel({ view: viewFixture({ logo, projectFields: fields }), send: (a) => sent.push(a), ...(onChooseLogo ? { onChooseLogo } : {}) }));
  const markup = (logo: ViewModel["logo"]): string => renderToStaticMarkup(<PropertiesPanel view={viewFixture({ logo, projectFields: fields })} send={() => {}} />);

  it("sits at the end of the Project section, only while it's offered", () => {
    const html = markup(none);
    const project = html.indexOf('data-testid="project-section"');
    expect(project).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('data-testid="logo-row"')).toBeGreaterThan(html.indexOf('data-field-id="project.client"'));
    expect(markup(null)).not.toContain("logo-row");
  });

  it("Choose picture opens the shell's picker, and is off without one or while the drawing can't be edited", () => {
    const onChoose = vi.fn();
    const button = part(tree(none, [], onChoose), "logo-choose");
    expect(button?.["disabled"]).toBe(false);
    call(button, "onClick");
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(part(tree(none), "logo-choose")?.["disabled"]).toBe(true);
    const waiting = part(tree({ ...none, canEdit: false }, [], onChoose), "logo-choose"); // refuses without going disabled, which would drop Tab's focus (sheetset.68)
    expect(waiting?.["disabled"]).toBe(false);
    expect(waiting?.["aria-disabled"]).toBe(true);
  });

  it("Remove sends its action, and is off with no logo", () => {
    const sent: UiAction[] = [];
    const remove = part(tree(shown, sent), "logo-remove");
    expect(remove?.["disabled"]).toBe(false);
    call(remove, "onClick");
    expect(sent).toEqual([{ type: "removeLogo" }]);
    expect(part(tree(none), "logo-remove")?.["disabled"]).toBe(true);
    expect(part(tree({ ...shown, canEdit: false }), "logo-remove")?.["disabled"]).toBe(true);
  });

  it("says whether there is one", () => {
    expect(markup(none)).toContain(">None<");
    expect(markup(shown)).toContain(">Set<");
  });
});

describe("a section's Properties (spec Depth)", () => {
  const selectedSection = (): ViewModel => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "addSection", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: 1 }));
    shell.click({ x: 3, y: 2 });
    return shell.view();
  };

  it("a blank Depth shows what it means, with the hint under it", () => {
    const html = renderToStaticMarkup(<PropertiesPanel view={selectedSection()} send={() => {}} />);
    expect(html).toMatch(/<input[^>]*placeholder="Whole"[^>]*data-field-id="depth"|<input[^>]*data-field-id="depth"[^>]*placeholder="Whole"/);
    expect(html).toContain('<p class="prop-hint" data-field-id="depthHint">Blank sees the whole drawing; 0 only the cut</p>');
    expect(html).toContain('<span class="prop-label">Letter</span>');
    expect(html).not.toContain('<span class="prop-label"></span>'); // the hint has no label of its own
  });

  it("Flip is a button that sends one setField, and clearing Depth sends a blank", () => {
    const sent: UiAction[] = [];
    const tree = render(selectedSection(), sent);
    const [flip] = byField(tree, "flip");
    expect(flip?.["disabled"]).toBe(false);
    expect(flip?.children).toBe("Flip");
    call(flip, "onClick");
    call(byField(tree, "depth")[0], "onCommit", "");
    expect(sent).toEqual([{ type: "setField", fieldId: "flip", value: "" }, { type: "setField", fieldId: "depth", value: "" }]);
  });
});
