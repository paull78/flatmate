import { isFurnitureSet } from "../src/furniture-sets";
import { describe, expect, it } from "vitest";
import { MESSAGES, OBJECT_KINDS, OPENING_GROUP_LABELS, OPENING_KINDS, OPENING_KIND_IDS, PROJECT_FIELDS, STUDIO_FIELDS, execute, unwrap, type Command, type Document } from "@fm/domain";
import type { UndoEntry } from "../src/history/history";
import type { EditorState } from "../src/state";
import { PREVIEW_OP, type ToolState } from "../src/tools/types";
import { gridSpacingFor } from "../src/snapping/snap";
import { COLORS } from "../src/view/colors";
import { HELPER_FONT } from "../src/view/fonts";
import { labelBox, textBox } from "../src/view/labels";
import { FLOOR_TILES } from "../src/view/palette";
import { LAYER_ORDER, buildScene } from "../src/view/scene";
import type { Primitive, Scene } from "../src/view/scene-types";
import { buildViewModel, steppedValue } from "../src/view/view-model";
import { commandCode } from "../src/keys";
import { NO_MODS } from "../src/types";
import { bed160x200, dividedRoomDoc, jointAt, localState, roomDoc, serverState, wallBetween, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { INTER_ASCENT, INTER_DESCENT } from "../src/view/inter-widths";

const host = new FakeHost();
const PALETTE = buildViewModel(localState(host), host).palette;
const SHORTCUTS = [
  { label: "Select", key: "V" }, { label: "Wall", key: "W" }, { label: "Zone", key: "Z" }, { label: "Object", key: "O" },
  { label: "Opening", key: "D" }, { label: "Dimension", key: "M" }, { label: "Section", key: "S" }, { label: "Column", key: "C" }, { label: "Deck", key: "K" }, { label: "Hole", key: "H" }, { label: "Undo", key: "Mod+Z" }, { label: "Delete", key: "Delete" },
];
const TOOLS = [
  { tool: "select", label: "Select", key: "V" }, { tool: "wall", label: "Wall", key: "W" }, { tool: "zone", label: "Zone", key: "Z" },
  { tool: "object", label: "Object", key: "O" }, { tool: "opening", label: "Opening", key: "D" },
  { tool: "dimension", label: "Dimension", key: "M" }, { tool: "section", label: "Section", key: "S" }, { tool: "column", label: "Column", key: "C" }, { tool: "deck", label: "Deck", key: "K" }, { tool: "hole", label: "Hole", key: "H", disabled: true },
];
/** The 3D panel's surroundings menu (surroundings.15): None first, sent as "", then the four stored styles. */
const SURROUNDINGS_MENU = [
  { value: "", label: "None" }, { value: "interior", label: "Interior" }, { value: "outside", label: "Outside" }, { value: "wheels", label: "On wheels" }, { value: "grid", label: "Grid" },
];

function layer(scene: Scene, name: (typeof LAYER_ORDER)[number]): readonly Primitive[] {
  return scene.layers.find((l) => l.name === name)?.primitives ?? [];
}

/** Wall fills only: since S1 the walls layer also holds 1 px edge segments over each fill. */
function fills(primitives: readonly Primitive[]): Primitive[] {
  return primitives.filter((p) => p.kind === "polygon");
}

/** A zoom where doors and windows draw simple (openingsDetailed). */
const SIMPLE: Partial<EditorState> = { camera: { ...localState(host).camera, zoom: 60 } };

function stateWith(doc: Document, patch: Partial<EditorState> = {}): EditorState {
  return { ...localState(host, doc), ...patch };
}

describe("buildScene", () => {
  it("always has the six layers in order", () => {
    expect(buildScene(stateWith(roomDoc())).layers.map((l) => l.name)).toEqual([...LAYER_ORDER]);
  });

  it("draws grid lines as screen-constant hairlines, with major lines", () => {
    const grid = layer(buildScene(stateWith(roomDoc())), "grid");
    expect(grid.length).toBeGreaterThan(100);
    expect(grid.every((p) => p.kind === "segment" && "px" in p.width && p.width.px === 1)).toBe(true);
    expect(grid.some((p) => p.kind === "segment" && p.color === COLORS.gridMajor)).toBe(true);
    const s = gridSpacingFor(stateWith(roomDoc()).camera.zoom);
    const vertical = (x: number) => grid.find((p) => p.kind === "segment" && p.a.x === x && p.b.x === x);
    expect(vertical(0)).toMatchObject({ color: COLORS.gridMajor });
    expect(vertical(s)).toMatchObject({ color: COLORS.grid });
  });

  it("draws one wall outline per wall, then a 1 px edge segment along every outline edge (spec: rendering)", () => {
    const walls = layer(buildScene(stateWith(roomDoc())), "walls");
    const outlines = walls.flatMap((p) => (p.kind === "polygon" ? [p] : []));
    const edges = walls.flatMap((p) => (p.kind === "segment" ? [p] : []));
    expect(outlines).toHaveLength(4);
    expect(outlines.every((p) => p.color === COLORS.wall)).toBe(true);
    expect(walls.slice(0, 4)).toEqual(outlines); // all fills first, then all edges
    expect(edges).toHaveLength(outlines.reduce((n, p) => n + p.points.length, 0));
    expect(edges.every((e) => "px" in e.width && e.width.px === 1 && e.cap === "round" && e.color === COLORS.wall && e.dash === undefined)).toBe(true);
    const first = outlines[0];
    if (!first) throw new Error("no outline");
    expect(edges.slice(0, first.points.length).map((e) => [e.a, e.b])).toEqual(
      first.points.map((a, i) => [a, first.points[(i + 1) % first.points.length]]),
    );
  });

  it("draws a wall's edges in its fill colour", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const walls = layer(buildScene(stateWith(doc, { selection: [{ table: "walls", id: right }] })), "walls");
    const selectedFill = walls.find((p) => p.kind === "polygon" && p.color === COLORS.wallSelected);
    const selectedEdges = walls.filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected);
    expect(selectedFill?.kind === "polygon" && selectedEdges.length === selectedFill.points.length).toBe(true);
  });

  it("highlights a selected wall and shows its two joint handles", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const scene = buildScene(stateWith(doc, { selection: [{ table: "walls", id: right }] }));
    expect(layer(scene, "walls").filter((p) => p.kind === "polygon" && p.color === COLORS.wallSelected)).toHaveLength(1);
    expect(layer(scene, "overlays").filter((p) => p.kind === "disc")).toHaveLength(4); // two discs per handle
  });

  it("draws the snap glyph", () => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 6, y: 4 }, kind: "endpoint" } }));
    expect(layer(scene, "overlays").filter((p) => p.kind === "segment" && p.color === COLORS.snap)).toHaveLength(4);
  });

  it("sizes snap glyphs in screen pixels: their world extent scales with 1 / zoom", () => {
    const extent = (zoom: number): number => {
      const base = stateWith(roomDoc(), { snap: { point: { x: 6, y: 4 }, kind: "endpoint" } });
      const glyph = layer(buildScene({ ...base, camera: { ...base.camera, zoom } }), "overlays");
      const xs = glyph.flatMap((p) => (p.kind === "segment" ? [p.a.x, p.b.x] : []));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(extent(50)).toBeGreaterThan(0);
    expect(extent(100)).toBeCloseTo(extent(50) / 2, 9);
  });

  it("colours a hovered wall, and lets the selection colour win over hover", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const hover = { table: "walls" as const, id: right };
    const walls = (patch: Partial<EditorState>) => layer(buildScene(stateWith(doc, patch)), "walls");
    const hovered = walls({ hover });
    expect(hovered.filter((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toHaveLength(1);
    expect(hovered.filter((p) => p.kind === "polygon" && p.color === COLORS.wall)).toHaveLength(3);
    const both = walls({ hover, selection: [hover] });
    expect(both.filter((p) => p.kind === "polygon" && p.color === COLORS.wallSelected)).toHaveLength(1);
    expect(both.filter((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toHaveLength(0);
  });

  it("sizes a label box from its font's table plus 4 px padding, and textBox draws that box", () => {
    const camera = stateWith(roomDoc()).camera;
    const at = { x: 1, y: 2 };
    expect(HELPER_FONT).toEqual({ font: "inter", size: 11 });
    const box = labelBox("abc", at, HELPER_FONT, camera);
    const hw = (((1150 + 1254 + 1170) / 2048) * 11) / 2 + 4; // Inter's a, b and c advances, in font units
    const hh = (((INTER_ASCENT + INTER_DESCENT) / 2048) * 11) / 2 + 2; // Inter's ascent + descent, half the padding
    expect(box.min.x).toBeCloseTo(at.x - hw / camera.zoom, 9);
    expect(box.max.x).toBeCloseTo(at.x + hw / camera.zoom, 9);
    expect(box.min.y).toBeCloseTo(at.y - hh / camera.zoom, 9);
    expect(box.max.y).toBeCloseTo(at.y + hh / camera.zoom, 9);
    expect(textBox("abc", at, HELPER_FONT, camera)).toEqual({
      kind: "polygon",
      points: [box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y }],
      holes: [],
      color: COLORS.background,
    });
  });
});

describe("buildViewModel", () => {
  it("describes an idle local drawing", () => {
    expect(buildViewModel(stateWith(roomDoc()), host)).toEqual({
      activeTool: "select",
      commandBar: { prompt: "Select", value: "", unit: null, chips: [] },
      typing: false,
      properties: { kind: "none" },
      cursor: "default",
      snap: null,
      presence: [],
      project: { name: "Untitled", status: "not saved", dirty: false, canEdit: true },
      projectList: null,
      underPointer: null,
      toast: null,
      canUndo: false,
      canRedo: false,
      wallThickness: "0.20",
      states: [{ id: "s0", name: "Layout", active: true }],
      warnings: { rows: [], blink: 0 },
      objectKind: "bed",
      sizePicker: null,
      sizeFields: null,
      openingKind: "swing",
      openingKinds: OPENING_KIND_IDS.map((kind) => ({ kind, label: OPENING_KINDS[kind].label, group: OPENING_GROUP_LABELS[OPENING_KINDS[kind].group] })),
      deckPreset: "platform",
      deckPresets: [{ preset: "platform", label: "Platform" }, { preset: "loft", label: "Loft" }],
      columnSize: { width: "0.30", depth: "0.30" },
      columnSizes: [{ width: "0.20", depth: "0.20", label: "20" }, { width: "0.30", depth: "0.30", label: "30" }, { width: "0.40", depth: "0.40", label: "40" }],
      palette: PALETTE,
      toolHelp: { tool: "select", label: "Select", key: "V", hint: "Select" },
      shortcuts: SHORTCUTS,
      tools: TOOLS,
      gridStep: 0.2,
      cut: "Cut +1.20",
      levels: null,
      snapStep: "auto",
      snapSteps: [
        { step: "auto", label: "Auto" }, { step: 0.01, label: "1" }, { step: 0.05, label: "5" },
        { step: 0.1, label: "10" }, { step: 0.25, label: "25" }, { step: 0.5, label: "50" },
      ],
      export: { available: true, reason: null },
      sheetsView: null,
      // Nothing selected: the Project section's nine empty fields (sheet.04; the list is pinned in the domain's tests).
      projectFields: [...PROJECT_FIELDS, ...STUDIO_FIELDS].map((f) => ({
        id: `project.${f.key}`, label: f.label, section: "Project", value: "", unit: null, readOnly: false, ...(f.multiline ? { multiline: true } : {}), ...(f.blank !== undefined ? { placeholder: f.blank } : {}),
      })),
      underlay: { present: false, canEdit: true, fade: 0.5, visible: true }, // the Underlay section, with no picture
      logo: { present: false, canEdit: true },
      ceiling: [
        {
          id: "ceiling.preset", label: "Preset", section: "Ceiling", value: "custom", unit: null, readOnly: false, select: true,
          options: [
            { value: "tinyShed", label: "Tiny house shed" }, { value: "tinyGable", label: "Tiny house gable" }, { value: "smallShed", label: "Small home shed" },
            { value: "smallGable", label: "Small home gable" }, { value: "custom", label: "Custom", disabled: true },
          ],
        },
        { id: "ceiling.shape", label: "Shape", section: "Ceiling", value: "flat", unit: null, readOnly: false, options: [{ value: "flat", label: "Flat" }, { value: "shed", label: "Shed" }, { value: "gable", label: "Gable" }] },
        { id: "ceiling.height", label: "Height", section: "Ceiling", value: "2.50", unit: "m", readOnly: false, step: 0.05 },
      ],
      outside: expect.arrayContaining([expect.objectContaining({ id: "row:outside.finish", section: "Outside walls", value: "None" })]), // inherit step 06
      trailer: null,
      sectionMarks: null,
      frames: { height: 0.46, larger: false, sectionShare: 0.56, sectionFirst: true, docked: false, side: false },
      view3d: { open: false, size: "corner", yaw: 225, tilt: 35, roof: false, outside: true, layout: "Layout", surroundings: { value: "", options: SURROUNDINGS_MENU, canEdit: true } },
      sectionStrip: null,
      rooms: null,
      floors: { on: true, tiles: FLOOR_TILES, armed: null }, // the Floors group: the switch on, a tile per motif
    });
  });

  it("shows wall properties", () => {
    const doc = roomDoc();
    const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const props = buildViewModel(stateWith(doc, { selection: [{ table: "walls", id: bottom }] }), host).properties;
    if (props.kind !== "wall") throw new Error("not a wall");
    expect(props.fields.filter((f) => f.section === "Wall")).toEqual([
      { id: "length", label: "Length", section: "Wall", value: "6.00", unit: "m", readOnly: true },
      { id: "thickness", label: "Thickness", section: "Wall", value: "0.20", unit: "m", readOnly: false, step: 0.05 },
      { id: "base", label: "Base", section: "Wall", value: "Floor", unit: null, readOnly: true },
      { id: "toCeiling", label: "To ceiling", section: "Wall", value: "true", unit: null, readOnly: false, toggle: true },
      { id: "top", label: "Top", section: "Wall", value: "2.50", unit: "m", readOnly: true },
    ]);
    // Then a section per side, named by what it faces: what it shows and Customize (surfaces step 04, inherit step 05).
    const sides = props.fields.filter((f) => f.section !== "Wall");
    expect(sides.map((f) => f.id).sort()).toEqual(["left.customize", "left.shows", "right.customize", "right.shows"]);
    expect([...new Set(sides.map((f) => f.section))].sort()).toEqual(["Outside", "Room side"]);
  });

  it("shows joint properties", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const props = buildViewModel(stateWith(doc, { selection: [{ table: "joints", id: corner }] }), host).properties;
    expect(props).toEqual({
      kind: "joint",
      fields: [
        { id: "x", label: "X", section: "Joint", value: "6.00", unit: "m", readOnly: true },
        { id: "y", label: "Y", section: "Joint", value: "4.00", unit: "m", readOnly: true },
      ],
    });
  });

  it("maps remote presence to cursors", () => {
    const presence = { c2: { clientId: "c2", name: "Bob", color: "#e0457b", cursor: { x: 1, y: 2 }, selection: [], state: null, level: null } };
    expect(buildViewModel(stateWith(roomDoc(), { presence }), host).presence).toEqual([
      { clientId: "c2", name: "Bob", color: "#e0457b", at: { x: 1, y: 2 } },
    ]);
  });

  it("shows the project list when no document is open", () => {
    const vm = buildViewModel(serverState(host), host);
    expect(vm.project).toBeNull();
    expect(vm.projectList).toMatchObject({ items: [], loading: true, error: null });
  });

  it("the ViewModel's palette has the spec's groups without the retired blocks, each card with its configuration and size (AC-16, ux-polish.32, library.05)", () => {
    const { palette } = buildViewModel(stateWith(roomDoc()), host);
    const kindsOf = (cards: readonly { kind: string }[]) => cards.map((c) => c.kind).filter((k, i, all) => all.indexOf(k) === i);
    expect(palette.map((g) => [g.group, kindsOf(g.cards)])).toEqual([
      ["Sleep", ["bed", "mattress", "liftBed", "loftBed", "murphyBed", "builtInTable", "sofaBed", "nightstand", "cot"]],
      ["Sit and eat", ["foldingTable", "extendingTable", "roundTable", "seatedDining", "seatedRound", "sofa", "armchair", "chair", "stool", "barTable", "bench", "coffeeTable", "cornerSofa"]],
      ["Work", ["desk", "deskSet", "cornerDesk"]],
      ["Kitchen", ["hobUnit", "range", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "tallPantry", "wallCabinet", "cookerHood", "cornerCounter"]],
      ["Bathroom", ["toilet", "bidet", "washbasin", "vanityUnit", "cornerBasin", "showerTray", "cornerShower", "bathtub", "washingMachine", "towelRail"]],
      ["Storage", ["wardrobe", "drawers", "storageChest", "shelf", "glassCabinet", "halfGlassCabinet", "tvUnit", "cornerWardrobe", "wallTv", "pegboard", "coatHooks", "coatStand"]],
      ["Sets", ["bedAndNightstands", "sofaAndRug"]],
      ["Basic", ["block", "roundBlock", "cornerBlock", "plant", "palm", "fern", "rosette", "radiator", "wheelWell", "beam", "woodStove", "electricFireplace", "wallUnit", "rug", "roundRug", "picture", "mirror", "clock"]],
      ["Stairs", ["stair", "openStair", "storageStair", "storageSteps", "winderStair", "shipsLadder", "alternatingTread", "rungLadder", "spiralStair"]],
    ]);
    const cards = palette.flatMap((g) => g.cards);
    const kinds = kindsOf(cards);
    expect(kinds.filter((id) => !isFurnitureSet(id))).toHaveLength(OBJECT_KINDS.filter((k) => !k.retired).length - 1); // the built-in desk has no card: Opens into reaches it
    expect(kinds.some((id) => OBJECT_KINDS.find((o) => o.id === id)?.retired)).toBe(false);
    // Kind cards show the murphy bed, the built-in unit and the folding table open (ux-polish.32); every other kind its first configuration.
    const shown: Record<string, string> = { murphyBed: "down", builtInTable: "down", foldingTable: "open" };
    const labels: Record<string, string> = { builtInTable: "Built-in unit" };
    for (const c of cards.filter((c) => c.preset === null && !isFurnitureSet(c.kind))) {
      const kind = OBJECT_KINDS.find((o) => o.id === c.kind);
      const config = kind?.configs.find((k) => k.id === (shown[c.kind] ?? kind.configs[0]?.id));
      expect(c, c.kind).toMatchObject({ name: labels[c.kind] ?? kind?.label, config: config?.id, w: config?.w, d: config?.d });
    }
    expect(cards.find((c) => c.kind === "builtInTable")).toEqual({ kind: "builtInTable", preset: null, name: "Built-in unit", size: "1.20 × 1.15 m", config: "down", w: 1.2, d: 1.15 });
    expect(cards.find((c) => c.kind === "murphyBed")).toEqual({ kind: "murphyBed", preset: null, name: "Murphy bed", size: "1.60 × 2.10 m", config: "down", w: 1.6, d: 2.1 });
    expect(cards.find((c) => c.kind === "foldingTable")).toEqual({ kind: "foldingTable", preset: null, name: "Folding table", size: "1.20 × 0.80 m", config: "open", w: 1.2, d: 0.8 });
    expect(cards.find((c) => c.kind === "sofa")).toEqual({ kind: "sofa", preset: "2 seats", name: "Sofa · 2 seats", size: "1.50 × 0.90 m", config: "standard", w: 1.5, d: 0.9 });
  });

  it("with nothing selected and the Wall tool active, toolHelp is Wall, W and the Wall tool's hint, and shortcuts list every tool plus Undo and Delete (AC-11)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("w");
    const vm = shell.view();
    expect(vm.properties.kind).toBe("none");
    expect(vm.toolHelp).toEqual({ tool: "wall", label: "Wall", key: "W", hint: vm.commandBar.prompt });
    expect(vm.toolHelp.hint).toBe("First point");
    expect(vm.shortcuts.map((s) => s.label)).toEqual(["Select", "Wall", "Zone", "Object", "Opening", "Dimension", "Section", "Column", "Deck", "Hole", "Undo", "Delete"]);
    // The portable core names keys neutrally; the shell draws ⌘ or Ctrl (cleanup.09, AC-14).
    expect(vm.shortcuts.map((s) => s.key).join(" ")).not.toMatch(/[⌘⌫⇧⌥]/);
    // Each tool's key is the command code that picks it.
    const tools = ["select", "wall", "zone", "object", "opening", "dimension"] as const;
    tools.forEach((tool, i) => expect(commandCode(vm.shortcuts[i]?.key ?? "", NO_MODS), tool).toBe(tool));
  });

  it("steppedValue adds or removes one step and formats to the step's precision", () => {
    const f = (value: string, step: number) => ({ id: "w", label: "W", section: "Size", value, unit: "m", readOnly: false, step });
    expect(steppedValue(f("0.80", 0.01), 1)).toBe("0.81");
    expect(steppedValue(f("0.20", 0.05), -1)).toBe("0.15");
    expect(steppedValue(f("359", 1), 1)).toBe("360");
    expect(steppedValue({ ...f("1.00", 0.01), step: undefined }, 1)).toBe("1.00");
  });

  it("hides a toast whose time is up even before its timer fires", () => {
    const h = new FakeHost();
    const s = { ...localState(h), toast: { text: "Wall too short", until: 3000 } };
    expect(buildViewModel(s, h).toast).toBe("Wall too short");
    h.advance(3000);
    expect(buildViewModel(s, h).toast).toBeNull();
  });
});

// Added in review: spec rules and README constants the plan's tests above leave unpinned.
describe("buildScene: spec rules", () => {
  const texts = (scene: Scene): Primitive[] => layer(scene, "annotations").filter((p) => p.kind === "text");
  const colored = (ps: readonly Primitive[], color: string): Primitive[] => ps.filter((p) => "color" in p && p.color === color);

  it("orders the layers as spec: editor lists them", () => {
    expect([...LAYER_ORDER]).toEqual(["grid", "ghosts", "finishes", "zoneFills", "deckFloors", "decks", "objects", "overheads", "warnings", "walls", "openings", "deckLabels", "tags", "dimensions", "marks", "annotations", "overlays", "presence"]);
  });

  it("draws an ok drag attempt's document normally", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", turn: 0, target: { kind: "joint", jointId: corner }, pressWorld: { x: 6, y: 4 }, baseDoc: doc,
        attempt: { ok: true, doc: dividedRoomDoc(), cursor: { x: 6, y: 4 }, tried: { kind: "none" }, blocked: [], dependencies: [], guides: [] } },
    };
    const walls = layer(buildScene(stateWith(doc, { tool })), "walls");
    expect(fills(walls)).toHaveLength(7); // the attempt's document, not the visible one
    expect(colored(walls, COLORS.invalid)).toHaveLength(0);
  });

  it("draws the walls at an invalid drag's joints red, over the selection colour, with a ghost at the cursor (spec: tools)", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", turn: 0, target: { kind: "walls", wallIds: [right], placementIds: [], across: { x: 1, y: 0 } }, pressWorld: { x: 6, y: 2 }, baseDoc: doc,
        attempt: { ok: false, doc, cursor: { x: 9, y: 2 }, tried: { kind: "none" }, blocked: [], dependencies: [], guides: [] } },
    };
    const scene = buildScene(stateWith(doc, { tool, selection: [{ table: "walls", id: right }] }));
    expect(colored(fills(layer(scene, "walls")), COLORS.invalid)).toHaveLength(3); // the wall and its two neighbours
    expect(colored(layer(scene, "walls"), COLORS.wallSelected)).toHaveLength(0);
    expect(layer(scene, "overlays")).toContainEqual({ kind: "disc", center: { x: 9, y: 2 }, radius: { px: 4 }, color: COLORS.invalid });
  });

  it("draws the wall tool's valid preview from its document, with live length and angle (spec: wall-editing)", () => {
    const from = { x: 1, y: 1 };
    const to = { x: 1, y: 3 };
    const previewDoc = unwrap(execute(roomDoc(), { type: "addWall", opId: PREVIEW_OP, from: { at: from }, to: { at: to } })).doc;
    const tool: ToolState = {
      name: "wall",
      state: { kind: "drawing", origin: from, chainStart: from, value: "", preview: { ok: true, from, to, doc: previewDoc }, dragFrom: null },
    };
    const scene = buildScene(stateWith(roomDoc(), { tool }));
    expect(fills(layer(scene, "walls"))).toHaveLength(5);
    expect(colored(fills(layer(scene, "walls")), COLORS.preview)).toHaveLength(1);
    expect(texts(scene)).toEqual([expect.objectContaining({ text: "2.00 m  90°", color: COLORS.text })]);
    expect(colored(layer(scene, "overlays"), COLORS.invalid)).toHaveLength(0);
  });

  it("draws an invalid wall preview red, with a negative angle downwards (spec: wall-editing)", () => {
    const from = { x: 1, y: 3 };
    const to = { x: 1, y: 1 };
    const tool: ToolState = {
      name: "wall",
      state: { kind: "drawing", origin: from, chainStart: from, value: "", preview: { ok: false, from, to }, dragFrom: null },
    };
    const scene = buildScene(stateWith(roomDoc(), { tool }));
    expect(fills(layer(scene, "walls"))).toHaveLength(4);
    expect(colored(layer(scene, "overlays"), COLORS.invalid)).toEqual([expect.objectContaining({ kind: "segment", a: from, b: to })]);
    expect(texts(scene)).toEqual([expect.objectContaining({ text: "2.00 m  -90°", color: COLORS.invalid })]);
  });

  it("draws a dragged joint's handle at the drag preview, not the visible position (spec: tools)", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const moved = unwrap(execute(doc, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 7, y: 5 } }] })).doc;
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", turn: 0, target: { kind: "joint", jointId: corner }, pressWorld: { x: 6, y: 4 }, baseDoc: doc,
        attempt: { ok: true, doc: moved, cursor: { x: 7, y: 5 }, tried: { kind: "none" }, blocked: [], dependencies: [], guides: [] } },
    };
    const scene = buildScene(stateWith(doc, { tool, selection: [{ table: "joints", id: corner }] }));
    const discs = layer(scene, "overlays").filter((p) => p.kind === "disc");
    expect(discs.map((p) => p.kind === "disc" && p.center)).toEqual([{ x: 7, y: 5 }, { x: 7, y: 5 }]);
  });

  it("shows one handle for a selected joint", () => {
    const doc = roomDoc();
    const scene = buildScene(stateWith(doc, { selection: [{ table: "joints", id: jointAt(doc, { x: 6, y: 4 }) }] }));
    expect(layer(scene, "overlays").filter((p) => p.kind === "disc")).toHaveLength(2);
  });

  it.each(["midpoint", "onWall", "grid"] as const)("draws a %s snap glyph", (kind) => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 0 }, kind } }));
    expect(colored(layer(scene, "overlays"), COLORS.snap).length).toBeGreaterThan(0);
  });

  it("draws an aligned snap with a guide line from each joint it lines up with", () => {
    const guides = [{ x: 3, y: 4 }, { x: 0, y: 2 }];
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 2 }, kind: "aligned", guides } }));
    const lines = colored(layer(scene, "overlays"), COLORS.snapGuide);
    expect(lines.map((p) => p.kind === "segment" && [p.a, p.b])).toEqual([[guides[0], { x: 3, y: 2 }], [guides[1], { x: 3, y: 2 }]]);
    expect(colored(layer(scene, "overlays"), COLORS.snap).length).toBeGreaterThan(0);
  });

  it("draws an angle snap with a guide line from the origin (and from a joint on a tie) plus the dot", () => {
    const guides = [{ x: 0, y: 0 }, { x: 3, y: 5 }];
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 3 }, kind: "angle", guides } }));
    const lines = colored(layer(scene, "overlays"), COLORS.snapGuide);
    expect(lines.map((p) => p.kind === "segment" && [p.a, p.b])).toEqual([[guides[0], { x: 3, y: 3 }], [guides[1], { x: 3, y: 3 }]]);
    expect(colored(layer(scene, "overlays"), COLORS.snap).filter((p) => p.kind !== "text").map((p) => p.kind === "disc" && p.center)).toEqual([{ x: 3, y: 3 }]); // the word beside it is text (straight step 22)
  });

  it("draws a perpendicular snap as a right-angle mark at the foot, turned to the wall", () => {
    // Origin (2, 0) below the foot (2, 4): one leg towards the origin, one along the wall.
    const state = stateWith(roomDoc(), { snap: { point: { x: 2, y: 4 }, kind: "perpendicular", guides: [{ x: 2, y: 0 }] } });
    const r = 5 / state.camera.zoom;
    const marks = colored(layer(buildScene(state), "overlays"), COLORS.snap).filter((p) => p.kind !== "text"); // the word beside it is text (straight step 22)
    expect(marks.map((p) => p.kind === "segment" && [p.a, p.b])).toEqual([
      [{ x: 2, y: 4 - r }, { x: 2 + r, y: 4 - r }],
      [{ x: 2 + r, y: 4 - r }, { x: 2 + r, y: 4 }],
    ]);
  });

  it("draws no glyph when snapping is bypassed", () => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 0 }, kind: "none" } }));
    expect(colored(layer(scene, "overlays"), COLORS.snap)).toHaveLength(0);
  });
});

describe("buildViewModel: README constants", () => {
  const from = { x: 0, y: 0 };
  it.each<[string, ToolState, EditorState["hover"], object]>([
    ["wall idle", { name: "wall", state: { kind: "idle" } }, null,
      { commandBar: { prompt: "First point", value: "", unit: "m", chips: [] }, cursor: "crosshair" }],
    ["wall drawing", { name: "wall", state: { kind: "drawing", origin: from, chainStart: from, value: "3.2", preview: null, dragFrom: null } }, null,
      { commandBar: { prompt: "Next point or length", value: "3.2", unit: "m", chips: [] }, cursor: "crosshair" }],
    ["wall paused", { name: "wall", state: { kind: "paused", origin: from, chainStart: from, segment: "c1" } }, null,
      { commandBar: { prompt: "Waiting for server", value: "", unit: null, chips: [] }, cursor: "crosshair" }],
    ["helper editing", { name: "select", state: { kind: "editingHelper", wallId: "w", value: "2" } }, null,
      { commandBar: { prompt: "Wall length", value: "2", unit: "m", chips: [] } }],
    ["zone", { name: "zone", state: { kind: "idle", hoverFaceKey: null, hoverDeck: null, motif: null } }, null,
      { commandBar: { prompt: "Click a room to name it · drag to name part of it", value: "", unit: null, chips: [] }, cursor: "crosshair" }], // it draws named areas (areas.41)
    ["select hovering", { name: "select", state: { kind: "idle" } }, { table: "joints", id: "j" },
      { commandBar: { prompt: "Select", value: "", unit: null, chips: [] }, cursor: "move" }], // a joint drags (furnish.10)
  ])("%s: command bar and cursor", (_name, tool, hover, expected) => {
    expect(buildViewModel(stateWith(roomDoc(), { tool, hover }), host)).toMatchObject(expected);
  });

  it("the Floor mode: the hint reads \"Click a floor to lay Planks\"; the armed Floors tile is planks (finishes.19)", () => {
    const tool: ToolState = { name: "zone", state: { kind: "idle", hoverFaceKey: null, hoverDeck: null, motif: "planks" } };
    const vm = buildViewModel(stateWith(roomDoc(), { tool }), host);
    expect(vm.commandBar.prompt).toBe("Click a floor to lay Planks");
    expect(vm.toolHelp.hint).toBe("Click a floor to lay Planks");
    expect(vm.floors.armed).toBe("planks");
    expect(vm.activeTool).toBe("zone"); // the floating bar shows the Zone tool
    const wide: ToolState = { name: "zone", state: { kind: "idle", hoverFaceKey: null, hoverDeck: null, motif: "widePlanks" } };
    expect(buildViewModel(stateWith(roomDoc(), { tool: wide }), host).commandBar.prompt).toBe("Click a floor to lay Wide planks");
  });

  it("uses the move cursor while dragging", () => {
    const doc = roomDoc();
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", turn: 0, target: { kind: "joint", jointId: jointAt(doc, { x: 0, y: 0 }) }, pressWorld: from, baseDoc: doc,
        attempt: { ok: true, doc, cursor: from, tried: { kind: "none" }, blocked: [], dependencies: [], guides: [] } },
    };
    expect(buildViewModel(stateWith(doc, { tool }), host).cursor).toBe("move");
  });

  it("enables undo and redo from usable history entries", () => {
    const entry: UndoEntry = { id: "c1", patch: { puts: [], deletes: [], before: [], dependencies: [] }, dependencies: [], status: "usable" };
    const vm = buildViewModel(stateWith(roomDoc(), { undo: { past: [entry], future: [entry], pending: null } }), host);
    expect([vm.canUndo, vm.canRedo]).toEqual([true, true]);
  });
});

describe("the Wall tool's thickness setting (layout-states.27, AC-24)", () => {
  it("the ViewModel carries wallThickness \"0.20\" initially and \"0.10\" after the action", () => {
    const shell = FakeShell.local();
    expect(shell.view().wallThickness).toBe("0.20");
    shell.ui({ type: "setWallThickness", value: "0.10" });
    expect(shell.view().wallThickness).toBe("0.10");
    expect(shell.view().toast).toBeNull();
    shell.ui({ type: "setWallThickness", value: "0.5" });
    expect(shell.view().wallThickness).toBe("0.50");
  });

  it.each([
    ["abc", "Can't read abc"],
    ["0.7", MESSAGES.thickness],
    ["0.04", MESSAGES.thickness],
    ["", "Enter a number"],
    ["Infinity", "Can't read Infinity"],
  ])("a bad value (%j) leaves it \"0.20\" and toasts %j", (value, toast) => {
    const shell = FakeShell.local();
    shell.ui({ type: "setWallThickness", value });
    expect(shell.view().wallThickness).toBe("0.20");
    expect(shell.view().toast).toBe(toast);
  });
});

describe("the openings layer (spec: openings)", () => {
  // Doors on the bottom wall (0, 0)–(6, 0), opening into the room; a window on the top wall.
  const doc = (): Document => {
    const d = roomDoc();
    const bottom = wallBetween(d, { x: 0, y: 0 }, { x: 6, y: 0 });
    const top = wallBetween(d, { x: 6, y: 4 }, { x: 0, y: 4 });
    const cmds: Command[] = [
      { type: "addOpening", opId: "s", wall: bottom, kind: "swing", offset: 0.5, side: "left" },
      { type: "addOpening", opId: "g", wall: bottom, kind: "swing", offset: 2.5, side: "left", glazed: true },
      { type: "addOpening", opId: "w", wall: top, kind: "window", offset: 2.5 },
    ];
    return cmds.reduce((acc, cmd) => unwrap(execute(acc, cmd)).doc, d);
  };
  const kinds = (ps: readonly Primitive[]): Record<string, number> =>
    ps.reduce((acc: Record<string, number>, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + 1 }), {});
  const only = (d: Document, id: string): Document => ({ ...d, openings: Object.fromEntries(Object.entries(d.openings).filter(([k]) => k === id)) });

  it("the openings layer holds, for a swing door, its span, the threshold line, the leaf and the arc; for a glazed door two leaf segments; for a window its cleared stretch and three lines; and one segment (thresholds.01)", () => {
    const d = doc();
    expect(kinds(layer(buildScene(stateWith(only(d, "s/d0"), SIMPLE)), "openings"))).toEqual({ polygon: 1, segment: 2, arc: 1 });
    expect(kinds(layer(buildScene(stateWith(only(d, "g/d0"), SIMPLE)), "openings"))).toEqual({ polygon: 1, segment: 3, arc: 1 });
    expect(kinds(layer(buildScene(stateWith(only(d, "w/d0"), SIMPLE)), "openings"))).toEqual({ polygon: 1, segment: 3 });
  });

  it("draws the swing door's leaf from the hinge into the room and a quarter arc from the leaf to the wall line", () => {
    const ps = layer(buildScene(stateWith(only(doc(), "s/d0"), SIMPLE)), "openings");
    const leaf = ps.find((p) => p.kind === "segment" && Math.abs(p.a.x - p.b.x) < 1e-9); // across the wall, not the threshold along it
    const arc = ps.find((p) => p.kind === "arc");
    expect(leaf?.kind === "segment" ? [leaf.a, leaf.b] : null).toEqual([{ x: 0.54, y: 0.1 }, { x: 0.54, y: expect.closeTo(0.82, 9) }]); // at its frames' 4 cm rebates
    expect(arc?.kind === "arc" ? [arc.center, arc.radius, arc.from, arc.to] : null).toEqual([{ x: 0.54, y: 0.1 }, expect.closeTo(0.72, 9), 0, expect.closeTo(Math.PI / 2, 9)]);
  });

  it("a bed inside a door's swing square produces one warnings polygon and the room's free floor is unchanged (AC-18)", () => {
    // The bed turned 180° about (3, 0.7): x 2.2–3.8, y 0.7–2.7, its use zone above it and clear.
    const bed = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 0.7 }, rotation: 180 }, bed160x200("bed/o0"));
    const tags = (s: Scene): string[] => layer(s, "tags").flatMap((p) => (p.kind === "text" ? [p.text] : []));
    const before = buildScene(stateWith(bed));
    expect(layer(before, "warnings")).toEqual([]);
    const bottom = wallBetween(bed, { x: 0, y: 0 }, { x: 6, y: 0 });
    const door = unwrap(execute(bed, { type: "addOpening", opId: "d", wall: bottom, kind: "swing", offset: 2.6, side: "left" })).doc;
    const after = buildScene(stateWith(door));
    expect(fills(layer(after, "warnings"))).toHaveLength(1);
    expect(tags(after).length).toBeGreaterThan(0);
    expect(tags(after)).toEqual(tags(before));
  });

  it("is reused by identity while the document is unchanged", () => {
    const state = stateWith(doc());
    const a = layer(buildScene(state), "openings");
    const b = layer(buildScene({ ...state, camera: { ...state.camera, center: { x: 1, y: 1 } } }), "openings");
    expect(b).toBe(a);
  });
});

describe("object names (ux-polish.06, AC-08)", () => {
  it("an unselected object draws no name text; selecting it draws its name at the footprint's centre; renaming updates it", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3 } }, bed160x200("bed/o0")));
    const names = () => layer(shell.scene(), "objects").flatMap((p) => (p.kind === "text" ? [[p.text, p.at]] : []));
    expect(names()).toEqual([]);
    shell.click({ x: 3, y: 2 });
    expect(names()).toEqual([["Bed", { x: 3, y: 2 }]]);
    shell.ui({ type: "setField", fieldId: "name", value: "Guest bed" });
    expect(names()).toEqual([["Guest bed", { x: 3, y: 2 }]]);
    shell.key("Escape");
    expect(names()).toEqual([]);
  });
});
