import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialState, type Field, type Host, type UiAction } from "@fm/editor";
import { App } from "../src/app";
import { CommandBar } from "../src/panels/CommandBar";
import { Select } from "../src/panels/controls";
import { PresenceHead } from "../src/panels/PresenceHead";
import { ProjectHead } from "../src/panels/ProjectHead";
import { PropertiesPanel } from "../src/panels/PropertiesPanel";
import { SurroundingsMenu } from "../src/panels/SurroundingsMenu";
import { Toast } from "../src/panels/Toast";
import { View3dPanel } from "../src/panels/View3dPanel";
import { createRendererSwitch, type RendererKind } from "../src/renderer-switch";
import { createEditorStore } from "../src/store";
import { viewFixture } from "./fixtures";
import { call, findAll, findByTestId } from "./react-tree";

const send = (): void => {};

function inputTag(html: string, fieldId: string): string {
  const match = new RegExp(`<input[^>]*data-field-id="${fieldId}"[^>]*>`).exec(html);
  if (match === null) throw new Error(`no input for ${fieldId} in ${html}`);
  return match[0];
}

const host: Host = {
  now: () => 0,
  today: () => "2026-10-13",
  newId: () => "id",
};

/** The whole page, server-rendered: effects (the canvases) do not run. */
function page(renderer: RendererKind = "canvas2d", onChoosePicture?: () => void): string {
  const initial = initialState({ mode: "local", me: { clientId: "c1", name: "Alice" }, viewport: { width: 800, height: 600 }, dpr: 1 }, host);
  const store = createEditorStore({ initial, host });
  return renderToStaticMarkup(<App store={store} renderer={createRendererSwitch(renderer)} mountCanvas={() => () => {}} onChoosePicture={onChoosePicture} />);
}

describe("the value input (tidy C6, AC-11, AC-12)", () => {
  it("is mounted only while a value field is open, marked to send its keys to the editor; the visible value stays a span", () => {
    const typing = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "Next point or length", value: "6", unit: "m", chips: [] }, typing: true })} send={send} />);
    expect(typing).toMatch(/<input[^>]*data-editor-keys/);
    expect(typing).toContain('data-testid="command-value">6<');
    const idle = renderToStaticMarkup(<CommandBar view={viewFixture({ typing: false })} send={send} />);
    expect(idle).not.toContain("<input");
  });
});

describe("the shell (ux-polish item 7)", () => {
  it("the hint line shows the prompt and the typed value; the page renders no top toolbar and no status bar; the project head shows the name and save status (AC-13)", () => {
    const hint = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "Next point or length", value: "6", unit: "m", chips: [] } })} send={send} />);
    expect(hint).toMatch(/data-testid="command-bar"[^>]*>.*Next point or length/);
    expect(hint).toContain('data-testid="command-value">6<');

    const html = page();
    expect(html).not.toContain("toolbar");
    expect(html).not.toContain("status-bar");
    expect(html).not.toContain("<footer");
    expect(html).toContain('data-testid="floating-bar"');
    // The bar, the hint and the corner chip float inside the canvas area; the project head tops the palette column.
    const stage = html.slice(html.indexOf('class="canvas-host'), html.indexOf('data-testid="properties-column"'));
    for (const id of ["floating-bar", "command-bar", "canvas-corner"]) expect(stage, id).toContain(`data-testid="${id}"`);
    const left = html.slice(html.indexOf('data-testid="palette-column"'), html.indexOf('class="canvas-host'));
    expect(left).toMatch(/data-testid="project-head".*data-testid="palette"/);

    const head = renderToStaticMarkup(<ProjectHead view={viewFixture({ project: { name: "Apartment", status: "saved", dirty: false, canEdit: true } })} />);
    expect(head).toContain('data-testid="project-name">Apartment<');
    expect(head).toContain('data-testid="project-status" data-status="saved">saved<');
    const none = renderToStaticMarkup(<ProjectHead view={viewFixture({ project: null })} />);
    expect(none).toContain("No drawing open");
    expect(none).not.toContain("project-status");
  });

  it("the Properties head lists the collaborators by name", () => {
    const html = renderToStaticMarkup(<PresenceHead view={viewFixture({ presence: [{ clientId: "b", name: "Bob", color: "#e67e22", at: null }] })} />);
    expect(html).toMatch(/data-testid="collaborators"[^>]*>.*Bob/);
    expect(html).toContain("background:#e67e22");
    expect(renderToStaticMarkup(<PresenceHead view={viewFixture()} />)).toContain('data-testid="collaborators"');
  });
});

describe("the Underlay section in the shell (import.17)", () => {
  it("the App passes the renderer kind to Properties", () => {
    const line = "The underlay shows with Canvas2D";
    expect(page("canvas2d")).toContain('data-testid="underlay-section"');
    expect(page("webgl")).toContain(line);
    expect(page("canvas2d")).not.toContain(line);
  });

  it("the App passes onChoosePicture to Properties: Choose picture… is on only with it", () => {
    const choose = (html: string): string => {
      const match = /<button[^>]*data-testid="underlay-choose"[^>]*>/.exec(html);
      if (match === null) throw new Error(`no Choose picture… button in ${html}`);
      return match[0];
    };
    expect(choose(page("canvas2d", () => {}))).not.toContain("disabled");
    expect(choose(page("canvas2d"))).toContain("disabled");
  });
});

describe("CommandBar", () => {
  it("shows the prompt, the typed value and its unit", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "Next point or length", value: "3.2", unit: "m", chips: [] } })} send={send} />);
    expect(html).toContain("Next point or length");
    expect(html).toContain('data-testid="command-value">3.2<');
    expect(html).toContain(">m<");
  });

  it("hides the unit while nothing is typed", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar: { prompt: "First point", value: "", unit: "m", chips: [] } })} send={send} />);
    expect(html).not.toContain(">m<");
  });

  it("shows the size picker and sends pickPreset", () => {
    const picker = { kind: "bed", current: "Single 100 × 210", options: [{ label: "Single 100 × 210", w: 1, d: 2.1 }, { label: "King 170 × 210", w: 1.7, d: 2.1 }] };
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ sizePicker: picker })} send={send} />);
    expect(html).toContain('data-testid="size-picker"');
    expect(html).toContain("Size:");
    expect(html).toMatch(/<option[^>]*value="Single 100 × 210"[^>]*selected=""/);
    expect(html).not.toMatch(/<option[^>]*value="King 170 × 210"[^>]*selected=""/);
    expect(renderToStaticMarkup(<CommandBar view={viewFixture()} send={send} />)).not.toContain("size-picker");

    // The select gives key focus back after a pick: the window key listener drops keys aimed at a SELECT.
    const sent: UiAction[] = [];
    let blurs = 0;
    const select = findByTestId(CommandBar({ view: viewFixture({ sizePicker: picker }), send: (a) => sent.push(a) }), "size-picker-select");
    call(select, "onChange", { currentTarget: { value: "King 170 × 210", blur: () => { blurs += 1; } } });
    expect(sent).toEqual([{ type: "pickPreset", kind: "bed", preset: "King 170 × 210" }]);
    expect(blurs).toBe(1);
  });

  it("shows Width and Depth for the armed size and sends setArmedSize on commit, one field at a time (sizing step 03)", () => {
    const fields = { kind: "wardrobe", width: "1.20", depth: "0.60", height: "2.05", bad: [] };
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ sizeFields: fields })} send={send} />);
    expect(html).toMatch(/data-testid="size-width"[^>]*value="1.20"|value="1.20"[^>]*data-testid="size-width"/);
    expect(html).toMatch(/data-testid="size-depth"[^>]*value="0.60"|value="0.60"[^>]*data-testid="size-depth"/);
    expect(html).not.toContain("aria-invalid");
    expect(renderToStaticMarkup(<CommandBar view={viewFixture()} send={send} />)).not.toContain("size-width");

    const sent: UiAction[] = [];
    const tree = CommandBar({ view: viewFixture({ sizeFields: fields }), send: (a) => sent.push(a) });
    call(findByTestId(tree, "size-width"), "onCommit", "0.83");
    call(findByTestId(tree, "size-depth"), "onCommit", "0.55");
    expect(sent).toEqual([{ type: "setArmedSize", kind: "wardrobe", width: "0.83" }, { type: "setArmedSize", kind: "wardrobe", depth: "0.55" }]);
  });

  it("shows Height for a kind that may be lowered and sends it; none where height is null (sizing step 06)", () => {
    const fields = { kind: "wardrobe", width: "1.20", depth: "0.60", height: "2.05", bad: [] };
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ sizeFields: fields })} send={send} />);
    expect(html).toMatch(/data-testid="size-height"[^>]*value="2.05"|value="2.05"[^>]*data-testid="size-height"/);
    const murphy = renderToStaticMarkup(<CommandBar view={viewFixture({ sizeFields: { ...fields, kind: "murphyBed", height: null } })} send={send} />);
    expect(murphy).toContain("size-depth");
    expect(murphy).not.toContain("size-height");
    const sent: UiAction[] = [];
    call(findByTestId(CommandBar({ view: viewFixture({ sizeFields: fields }), send: (a) => sent.push(a) }), "size-height"), "onCommit", "1.40");
    expect(sent).toEqual([{ type: "setArmedSize", kind: "wardrobe", height: "1.40" }]);
  });

  it("marks a field that didn't read as invalid and shows its text (AC-11)", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ sizeFields: { kind: "wardrobe", width: "12", depth: "0.60", height: "2.05", bad: ["width"] } })} send={send} />);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"[^>]*value="12"|<input[^>]*value="12"[^>]*aria-invalid="true"/);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
  });

  it("lists Custom, selected and disabled, while the size is typed", () => {
    const picker = { kind: "wardrobe", current: "Custom", options: [{ label: "100 × 60", w: 1, d: 0.6 }] };
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ sizePicker: picker })} send={send} />);
    expect(html).toMatch(/<option[^>]*value="Custom"[^>]*disabled=""[^>]*selected=""|<option[^>]*disabled=""[^>]*value="Custom"[^>]*selected=""/);
    const normal = renderToStaticMarkup(<CommandBar view={viewFixture({ sizePicker: { ...picker, current: "100 × 60" } })} send={send} />);
    expect(normal).not.toContain('value="Custom"');
  });

  it("a kind with no presets shows the fields and no list (AC-03); neither for a set (AC-16)", () => {
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ sizeFields: { kind: "chair", width: "0.45", depth: "0.45", height: "0.90", bad: [] } })} send={send} />);
    expect(html).toContain("size-width");
    expect(html).not.toContain("size-picker-select");
    const set = renderToStaticMarkup(<CommandBar view={viewFixture({ sizeFields: null, sizePicker: null })} send={send} />);
    expect(set).not.toContain("size-width");
    expect(set).not.toContain("size-picker-select");
  });

  it("renders chips after the prompt and sends chipClick with the id; hovering sends chipHover (stairdraw.13)", () => {
    const chips = [
      { id: "l", label: "Make it an L" },
      { id: "storage", label: "Storage stair", detail: "1.9 m" },
    ];
    const commandBar = { prompt: "Doesn't fit", value: "", unit: null, chips };
    const html = renderToStaticMarkup(<CommandBar view={viewFixture({ commandBar })} send={send} />);
    expect(html).toMatch(/command-prompt">Doesn&#x27;t fit<.*<button[^>]*data-chip-id="l"[^>]*>Make it an L<.*<button[^>]*data-chip-id="storage"[^>]*>Storage stair · 1.9 m</);
    expect(renderToStaticMarkup(<CommandBar view={viewFixture()} send={send} />)).not.toContain("<button");

    const sent: UiAction[] = [];
    const tree = CommandBar({ view: viewFixture({ commandBar }), send: (a) => sent.push(a) });
    const storage = findAll(tree, (p) => p["data-chip-id"] === "storage")[0];
    call(storage, "onMouseEnter");
    call(storage, "onClick");
    call(storage, "onMouseLeave");
    expect(sent).toEqual([
      { type: "chipHover", id: "storage" },
      { type: "chipClick", id: "storage" },
      { type: "chipHover", id: null },
    ]);
  });
});

describe("the 3D panel's surroundings menu (surroundings.15, AC-06)", () => {
  const options = [
    { value: "", label: "None" }, { value: "interior", label: "Interior" }, { value: "outside", label: "Outside" }, { value: "wheels", label: "On wheels" }, { value: "grid", label: "Grid" },
  ];

  it("the menu's markup shows the current option, is disabled when it can't edit, sends and blurs once", () => {
    const html = renderToStaticMarkup(<SurroundingsMenu menu={{ value: "wheels", options, canEdit: true }} send={send} />);
    expect(html).toMatch(/^<select[^>]*aria-label="Surroundings"/);
    expect(html).not.toMatch(/<select[^>]*disabled/);
    expect([...html.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["None", "Interior", "Outside", "On wheels", "Grid"]);
    expect([...html.matchAll(/<option[^>]*selected=""[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["On wheels"]);
    expect(renderToStaticMarkup(<SurroundingsMenu menu={{ value: "", options, canEdit: true }} send={send} />)).toMatch(/<option value="" selected="">None</);
    expect(renderToStaticMarkup(<SurroundingsMenu menu={{ value: "wheels", options, canEdit: false }} send={send} />)).toMatch(/<select[^>]*disabled=""/);

    // A pick sends the drawing's setting, then gives key focus back: the window key listener drops keys aimed at a SELECT.
    const sent: UiAction[] = [];
    let blurs = 0;
    const select = findByTestId(SurroundingsMenu({ menu: { value: "", options, canEdit: true }, send: (a) => sent.push(a) }), "surroundings-menu");
    expect(select?.["onMouseDown"]).toBeUndefined(); // no keepFocus: preventing the mouse down stops a native select opening
    call(select, "onChange", { currentTarget: { value: "outside", blur: () => { blurs += 1; } } });
    expect(sent).toEqual([{ type: "setSheetSetting", key: "surroundings", value: "outside" }]);
    expect(blurs).toBe(1);
    // None is sent as "", which clears the row; "none" would be refused (AC-04).
    call(select, "onChange", { currentTarget: { value: "", blur: () => { blurs += 1; } } });
    expect(sent.at(-1)).toEqual({ type: "setSheetSetting", key: "surroundings", value: "" });
  });

  it("the 3D panel's header shows the Roof switch, pressed when on (roofs.13), named Outside under a flat ceiling (inherit step 07)", () => {
    const base = { open: true, size: "corner" as const, yaw: 225, tilt: 35, layout: "Layout", surroundings: { value: "", options, canEdit: true } };
    const panel = (roof: boolean | null, outside = false) => renderToStaticMarkup(<View3dPanel view3d={{ ...base, roof, outside }} frames={viewFixture().frames} send={send} hostRef={null} onSwap={send} />);
    expect(panel(null)).not.toContain('data-action="roof3d"');
    expect(panel(false)).toMatch(/data-action="roof3d"[^>]*aria-pressed="false"/);
    expect(panel(true)).toMatch(/data-action="roof3d"[^>]*aria-pressed="true"/);
    expect(panel(false)).toContain("Show the roof");
    expect(panel(false, true)).toContain("Show the outside walls");
    expect(panel(true, true)).toContain("Hide the outside walls");
  });

  it("the 3D panel's header passes the view model's canEdit through to the menu", () => {
    const view3d = { open: true, size: "corner" as const, yaw: 225, tilt: 35, roof: null, outside: false, layout: "Layout", surroundings: { value: "outside", options, canEdit: false } };
    const panel = (canEdit: boolean) =>
      renderToStaticMarkup(<View3dPanel view3d={{ ...view3d, surroundings: { ...view3d.surroundings, canEdit } }} frames={viewFixture().frames} send={send} hostRef={null} onSwap={send} />);
    const selectTag = (html: string) => /<select[^>]*data-testid="surroundings-menu"[^>]*>/.exec(html)?.[0] ?? "no menu";
    expect(selectTag(panel(false))).toContain('disabled=""');
    expect(selectTag(panel(true))).not.toContain("disabled");
    expect(panel(true)).toMatch(/<option value="outside" selected="">Outside</);
  });

  /** A key pressed on the menu, with its list closed, open, or in a browser with no `:open`; what the menu did with it. */
  const keyOn = (select: ReturnType<typeof findByTestId>, key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}, list: "closed" | "open" | "unknown" = "closed") => {
    const seen = { prevented: 0, blurs: 0 };
    const matches = (selector: string): boolean => {
      if (selector !== ":open" || list === "unknown") throw new SyntaxError(`'${selector}' is not a valid selector`);
      return list === "open";
    };
    call(select, "onKeyDown", { key, metaKey: false, ctrlKey: false, altKey: false, ...mods, preventDefault: () => { seen.prevented += 1; }, currentTarget: { matches, blur: () => { seen.blurs += 1; } } });
    return seen;
  };

  // A close with no change leaves the focus on the select, and the window key listener drops its keys, so the browser's
  // type-ahead would turn the next letter (O for Object), or an arrow meant to nudge, into a shared, undoable edit.
  it("a typed letter or a moving key on the focused, closed menu picks nothing and gives key focus back; the keys that open it stay", () => {
    const sent: UiAction[] = [];
    const select = findByTestId(SurroundingsMenu({ menu: { value: "", options, canEdit: true }, send: (a) => sent.push(a) }), "surroundings-menu");
    const press = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => keyOn(select, key, mods);
    for (const key of ["o", "O", "i", "n", "g", "3"]) expect(press(key), key).toEqual({ prevented: 1, blurs: 1 });
    // On Windows and Linux the arrows, Home, End and the Page keys pick straight away on a closed select, with no popup.
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) expect(press(key), key).toEqual({ prevented: 1, blurs: 1 });
    for (const key of [" ", "Enter", "Tab", "Escape", "Shift", "F4"]) expect(press(key), key).toEqual({ prevented: 0, blurs: 0 });
    expect(press("ArrowDown", { altKey: true }), "Alt+ArrowDown opens the menu").toEqual({ prevented: 0, blurs: 0 });
    expect(press("z", { metaKey: true })).toEqual({ prevented: 0, blurs: 0 });
    expect(press("z", { ctrlKey: true })).toEqual({ prevented: 0, blurs: 0 });
    expect(sent).toEqual([]);
  });

  // With the list open, Chromium's internal popup (headless, and headed Windows and Linux) still sends the keys to the
  // select: they move in the list and pick by type-ahead, as the person meant. Where the browser can't say (no `:open`),
  // an open list would be unusable from the keyboard under a closing guard, so the keys are left alone there too.
  it("keys in the open list, or where the browser can't say it's open, are left to the list", () => {
    const sent: UiAction[] = [];
    const select = findByTestId(SurroundingsMenu({ menu: { value: "", options, canEdit: true }, send: (a) => sent.push(a) }), "surroundings-menu");
    for (const list of ["open", "unknown"] as const) {
      for (const key of ["ArrowDown", "ArrowUp", "End", "PageDown", "o", "i"]) expect(keyOn(select, key, {}, list), `${key} with the list ${list}`).toEqual({ prevented: 0, blurs: 0 });
    }
    expect(sent).toEqual([]);
  });

  // The same guard on every native dropdown (snags.06, AC-01): the size picker keeps the focus after a cancelled open, and
  // Properties' dropdowns kept it even after a pick, so a typed O could change a piece's preset, a shared edit.
  it("the size picker and Properties' dropdowns drop the same keys, and only on a closed list", () => {
    const sent: UiAction[] = [];
    const picker = { kind: "bed", current: "Single 100 × 210", options: [{ label: "Single 100 × 210", w: 1, d: 2.1 }, { label: "King 170 × 210", w: 1.7, d: 2.1 }] };
    const preset: Field = { id: "preset", label: "Size", section: "Size", value: "Single", unit: null, readOnly: false, select: true, options: [{ value: "Single", label: "Single" }, { value: "Double", label: "Double" }] };
    const selects = {
      "size picker": findByTestId(CommandBar({ view: viewFixture({ sizePicker: picker }), send: (a) => sent.push(a) }), "size-picker-select"),
      "Properties": findAll(Select({ field: preset, disabled: false, onSet: () => sent.push({ type: "undo" }) }), (p) => p["data-field-id"] === "preset")[0] ?? null,
    };
    for (const [name, select] of Object.entries(selects)) {
      for (const key of ["o", "O", "3", "ArrowDown", "ArrowLeft", "End", "PageUp"]) expect(keyOn(select, key), `${name}: ${key}`).toEqual({ prevented: 1, blurs: 1 });
      for (const key of [" ", "Enter", "Tab", "Escape"]) expect(keyOn(select, key), `${name}: ${JSON.stringify(key)}`).toEqual({ prevented: 0, blurs: 0 });
      expect(keyOn(select, "z", { metaKey: true }), `${name}: Cmd+Z`).toEqual({ prevented: 0, blurs: 0 });
      expect(keyOn(select, "ArrowDown", { altKey: true }), `${name}: Alt+ArrowDown`).toEqual({ prevented: 0, blurs: 0 });
      for (const key of ["o", "ArrowDown"]) expect(keyOn(select, key, {}, "open"), `${name}: ${key}, list open`).toEqual({ prevented: 0, blurs: 0 });
    }
    expect(sent).toEqual([]);
  });
});

describe("PropertiesPanel", () => {
  it("shows the active tool's help when nothing is selected (ux-polish item 6)", () => {
    expect(renderToStaticMarkup(<PropertiesPanel view={viewFixture()} send={send} />)).toMatch(/data-testid="tool-help"[^>]*>.*?Select<kbd/);
  });

  it("leaves out a hint that only repeats the tool's name", () => {
    const same = viewFixture({ toolHelp: { tool: "select", label: "Select", key: "V", hint: "Select" } });
    expect(renderToStaticMarkup(<PropertiesPanel view={same} send={send} />)).not.toContain("prop-empty-hint");
    const other = viewFixture({ toolHelp: { tool: "wall", label: "Wall", key: "W", hint: "First point" } });
    expect(renderToStaticMarkup(<PropertiesPanel view={other} send={send} />)).toContain("First point");
  });

  it("renders read-only wall fields with their field IDs", () => {
    const view = viewFixture({
      properties: {
        kind: "wall",
        fields: [
          { id: "length", label: "Length", section: "Wall", value: "6.00", unit: "m", readOnly: true },
          { id: "thickness", label: "Thickness", section: "Wall", value: "0.20", unit: "m", readOnly: true },
        ],
      },
    });
    const html = renderToStaticMarkup(<PropertiesPanel view={view} send={send} />);
    expect(html).toContain(">Wall<");
    const length = inputTag(html, "length");
    expect(length).toContain('value="6.00"');
    expect(length).toMatch(/readonly=""/i); // React 19.3 prints `readOnly`; HTML attribute names ignore case
    expect(inputTag(html, "thickness")).toContain('value="0.20"');
  });

  it("renders an editable zone name, read-only when editing is blocked", () => {
    const fields = [
      { id: "name", label: "Name", section: "Room", value: "Kitchen", unit: null, readOnly: false },
      { id: "area", label: "Area", section: "Room", value: "10.64 m²", unit: null, readOnly: true },
    ];
    const editable = renderToStaticMarkup(<PropertiesPanel view={viewFixture({ properties: { kind: "zone", fields } })} send={send} />);
    const name = inputTag(editable, "name");
    expect(name).toContain('value="Kitchen"');
    expect(name).not.toMatch(/readonly/i);
    expect(name).not.toContain("disabled");

    const blocked = renderToStaticMarkup(
      <PropertiesPanel
        view={viewFixture({
          properties: { kind: "zone", fields },
          project: { name: "Apartment", status: "waiting for server", dirty: false, canEdit: false },
        })}
        send={send}
      />,
    );
    expect(inputTag(blocked, "name")).toMatch(/readonly/i);
  });
});

describe("Toast", () => {
  it("renders nothing without a toast", () => {
    expect(renderToStaticMarkup(<Toast view={viewFixture()} />)).toBe("");
  });

  it("renders the toast text as a status message", () => {
    expect(renderToStaticMarkup(<Toast view={viewFixture({ toast: "Wall too short" })} />)).toBe(
      '<div class="toast fm-toast" role="status">Wall too short</div>',
    );
  });
});
