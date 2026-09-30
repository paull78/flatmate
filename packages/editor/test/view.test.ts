import { describe, expect, it } from "vitest";
import { execute, unwrap, type Document } from "@fm/domain";
import type { UndoEntry } from "../src/history/history";
import type { EditorState } from "../src/state";
import { PREVIEW_OP, type ToolState } from "../src/tools/types";
import { gridSpacingFor } from "../src/snapping/snap";
import { COLORS } from "../src/view/colors";
import { HELPER_FONT } from "../src/view/fonts";
import { labelBox } from "../src/view/labels";
import { LAYER_ORDER, buildScene, textBox } from "../src/view/scene";
import type { Primitive, Scene } from "../src/view/scene-types";
import { buildViewModel } from "../src/view/view-model";
import { dividedRoomDoc, jointAt, localState, roomDoc, serverState, wallBetween } from "./builders";
import { FakeHost } from "./fake-shell";

const host = new FakeHost();

function layer(scene: Scene, name: (typeof LAYER_ORDER)[number]): Primitive[] {
  return scene.layers.find((l) => l.name === name)?.primitives ?? [];
}

/** Wall fills only: since S1 the walls layer also holds 1 px edge segments over each fill. */
function fills(primitives: Primitive[]): Primitive[] {
  return primitives.filter((p) => p.kind === "polygon");
}

function stateWith(doc: Document, patch: Partial<EditorState> = {}): EditorState {
  return { ...localState(host, doc), ...patch };
}

describe("buildScene", () => {
  it("always has the six layers in order", () => {
    expect(buildScene(stateWith(roomDoc()), host).layers.map((l) => l.name)).toEqual([...LAYER_ORDER]);
  });

  it("draws grid lines as screen-constant hairlines, with major lines", () => {
    const grid = layer(buildScene(stateWith(roomDoc()), host), "grid");
    expect(grid.length).toBeGreaterThan(100);
    expect(grid.every((p) => p.kind === "segment" && "px" in p.width && p.width.px === 1)).toBe(true);
    expect(grid.some((p) => p.kind === "segment" && p.color === COLORS.gridMajor)).toBe(true);
    const s = gridSpacingFor(stateWith(roomDoc()).camera.zoom);
    const vertical = (x: number) => grid.find((p) => p.kind === "segment" && p.a.x === x && p.b.x === x);
    expect(vertical(0)).toMatchObject({ color: COLORS.gridMajor });
    expect(vertical(s)).toMatchObject({ color: COLORS.grid });
  });

  it("draws one wall outline per wall, then a 1 px edge segment along every outline edge (§6.2)", () => {
    const walls = layer(buildScene(stateWith(roomDoc()), host), "walls");
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
    const walls = layer(buildScene(stateWith(doc, { selection: [{ table: "walls", id: right }] }), host), "walls");
    const selectedFill = walls.find((p) => p.kind === "polygon" && p.color === COLORS.wallSelected);
    const selectedEdges = walls.filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected);
    expect(selectedFill?.kind === "polygon" && selectedEdges.length === selectedFill.points.length).toBe(true);
  });

  it("highlights a selected wall and shows its two joint handles", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const scene = buildScene(stateWith(doc, { selection: [{ table: "walls", id: right }] }), host);
    expect(layer(scene, "walls").filter((p) => p.kind === "polygon" && p.color === COLORS.wallSelected)).toHaveLength(1);
    expect(layer(scene, "overlays").filter((p) => p.kind === "disc")).toHaveLength(4); // two discs per handle
  });

  it("draws the snap glyph", () => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 6, y: 4 }, kind: "endpoint" } }), host);
    expect(layer(scene, "overlays").filter((p) => p.kind === "segment" && p.color === COLORS.snap)).toHaveLength(4);
  });

  it("sizes snap glyphs in screen pixels: their world extent scales with 1 / zoom", () => {
    const extent = (zoom: number): number => {
      const base = stateWith(roomDoc(), { snap: { point: { x: 6, y: 4 }, kind: "endpoint" } });
      const glyph = layer(buildScene({ ...base, camera: { ...base.camera, zoom } }, host), "overlays");
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
    const walls = (patch: Partial<EditorState>) => layer(buildScene(stateWith(doc, patch), host), "walls");
    const hovered = walls({ hover });
    expect(hovered.filter((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toHaveLength(1);
    expect(hovered.filter((p) => p.kind === "polygon" && p.color === COLORS.wall)).toHaveLength(3);
    const both = walls({ hover, selection: [hover] });
    expect(both.filter((p) => p.kind === "polygon" && p.color === COLORS.wallSelected)).toHaveLength(1);
    expect(both.filter((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toHaveLength(0);
  });

  it("sizes a label box from the host's text metrics plus 4 px padding, and textBox draws that box", () => {
    const camera = stateWith(roomDoc()).camera;
    const at = { x: 1, y: 2 };
    const box = labelBox("abc", at, HELPER_FONT, camera, host);
    const hw = (0.6 * HELPER_FONT.size * 3) / 2 + 4; // FakeHost: 0.6 × size per character
    const hh = (0.8 * HELPER_FONT.size + 0.2 * HELPER_FONT.size) / 2 + 2; // ascent + descent, half the padding
    expect(box.min.x).toBeCloseTo(at.x - hw / camera.zoom, 9);
    expect(box.max.x).toBeCloseTo(at.x + hw / camera.zoom, 9);
    expect(box.min.y).toBeCloseTo(at.y - hh / camera.zoom, 9);
    expect(box.max.y).toBeCloseTo(at.y + hh / camera.zoom, 9);
    expect(textBox("abc", at, HELPER_FONT, camera, host)).toEqual({
      kind: "polygon",
      points: [box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y }],
      color: COLORS.background,
    });
  });
});

describe("buildViewModel", () => {
  it("describes an idle local drawing", () => {
    expect(buildViewModel(stateWith(roomDoc()), host)).toEqual({
      activeTool: "select",
      commandBar: { prompt: "Select", value: "", unit: null },
      properties: { kind: "none" },
      cursor: "default",
      snap: null,
      presence: [],
      project: { name: "Untitled", status: "not saved", dirty: false, canEdit: true },
      projectList: null,
      toast: null,
      canUndo: false,
      canRedo: false,
    });
  });

  it("shows wall properties", () => {
    const doc = roomDoc();
    const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(buildViewModel(stateWith(doc, { selection: [{ table: "walls", id: bottom }] }), host).properties).toEqual({
      kind: "wall",
      fields: [
        { id: "length", label: "Length", value: "6.00", unit: "m", readOnly: true },
        { id: "thickness", label: "Thickness", value: "0.20", unit: "m", readOnly: true },
      ],
    });
  });

  it("shows joint properties", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const props = buildViewModel(stateWith(doc, { selection: [{ table: "joints", id: corner }] }), host).properties;
    expect(props).toEqual({
      kind: "joint",
      fields: [
        { id: "x", label: "X", value: "6.00", unit: "m", readOnly: true },
        { id: "y", label: "Y", value: "4.00", unit: "m", readOnly: true },
      ],
    });
  });

  it("maps remote presence to cursors", () => {
    const presence = { c2: { clientId: "c2", name: "Bob", color: "#e0457b", cursor: { x: 1, y: 2 }, selection: [] } };
    expect(buildViewModel(stateWith(roomDoc(), { presence }), host).presence).toEqual([
      { clientId: "c2", name: "Bob", color: "#e0457b", at: { x: 1, y: 2 } },
    ]);
  });

  it("shows the project list when no document is open", () => {
    const vm = buildViewModel(serverState(host), host);
    expect(vm.project).toBeNull();
    expect(vm.projectList).toEqual({ items: [], loading: true, error: null });
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
  const colored = (ps: Primitive[], color: string): Primitive[] => ps.filter((p) => "color" in p && p.color === color);

  it("orders the layers as §5.9 lists them", () => {
    expect([...LAYER_ORDER]).toEqual(["grid", "zoneFills", "walls", "annotations", "overlays", "presence"]);
  });

  it("draws an ok drag attempt's document normally", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "joint", jointId: corner }, pressWorld: { x: 6, y: 4 }, baseDoc: doc,
        attempt: { ok: true, doc: dividedRoomDoc(), cursor: { x: 6, y: 4 }, moves: [] } },
    };
    const walls = layer(buildScene(stateWith(doc, { tool }), host), "walls");
    expect(fills(walls)).toHaveLength(7); // the attempt's document, not the visible one
    expect(colored(walls, COLORS.invalid)).toHaveLength(0);
  });

  it("draws the walls at an invalid drag's joints red, over the selection colour, with a ghost at the cursor (§5.7)", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "wall", wallId: right }, pressWorld: { x: 6, y: 2 }, baseDoc: doc,
        attempt: { ok: false, doc, cursor: { x: 9, y: 2 }, moves: [] } },
    };
    const scene = buildScene(stateWith(doc, { tool, selection: [{ table: "walls", id: right }] }), host);
    expect(colored(fills(layer(scene, "walls")), COLORS.invalid)).toHaveLength(3); // the wall and its two neighbours
    expect(colored(layer(scene, "walls"), COLORS.wallSelected)).toHaveLength(0);
    expect(layer(scene, "overlays")).toContainEqual({ kind: "disc", center: { x: 9, y: 2 }, radius: { px: 4 }, color: COLORS.invalid });
  });

  it("draws the wall tool's valid preview from its document, with live length and angle (§5.5)", () => {
    const from = { x: 1, y: 1 };
    const to = { x: 1, y: 3 };
    const previewDoc = unwrap(execute(roomDoc(), { type: "addWall", opId: PREVIEW_OP, from: { at: from }, to: { at: to } })).doc;
    const tool: ToolState = {
      name: "wall",
      state: { kind: "drawing", origin: from, chainStart: from, value: "", preview: { ok: true, from, to, doc: previewDoc }, dragFrom: null },
    };
    const scene = buildScene(stateWith(roomDoc(), { tool }), host);
    expect(fills(layer(scene, "walls"))).toHaveLength(5);
    expect(colored(fills(layer(scene, "walls")), COLORS.preview)).toHaveLength(1);
    expect(texts(scene)).toEqual([expect.objectContaining({ text: "2.00 m  90°", color: COLORS.text })]);
    expect(colored(layer(scene, "overlays"), COLORS.invalid)).toHaveLength(0);
  });

  it("draws an invalid wall preview red, with a negative angle downwards (§5.5)", () => {
    const from = { x: 1, y: 3 };
    const to = { x: 1, y: 1 };
    const tool: ToolState = {
      name: "wall",
      state: { kind: "drawing", origin: from, chainStart: from, value: "", preview: { ok: false, from, to }, dragFrom: null },
    };
    const scene = buildScene(stateWith(roomDoc(), { tool }), host);
    expect(fills(layer(scene, "walls"))).toHaveLength(4);
    expect(colored(layer(scene, "overlays"), COLORS.invalid)).toEqual([expect.objectContaining({ kind: "segment", a: from, b: to })]);
    expect(texts(scene)).toEqual([expect.objectContaining({ text: "2.00 m  -90°", color: COLORS.invalid })]);
  });

  it("draws a dragged joint's handle at the drag preview, not the visible position (§5.7)", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const moved = unwrap(execute(doc, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 7, y: 5 } }] })).doc;
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "joint", jointId: corner }, pressWorld: { x: 6, y: 4 }, baseDoc: doc,
        attempt: { ok: true, doc: moved, cursor: { x: 7, y: 5 }, moves: [] } },
    };
    const scene = buildScene(stateWith(doc, { tool, selection: [{ table: "joints", id: corner }] }), host);
    const discs = layer(scene, "overlays").filter((p) => p.kind === "disc");
    expect(discs.map((p) => p.kind === "disc" && p.center)).toEqual([{ x: 7, y: 5 }, { x: 7, y: 5 }]);
  });

  it("shows one handle for a selected joint", () => {
    const doc = roomDoc();
    const scene = buildScene(stateWith(doc, { selection: [{ table: "joints", id: jointAt(doc, { x: 6, y: 4 }) }] }), host);
    expect(layer(scene, "overlays").filter((p) => p.kind === "disc")).toHaveLength(2);
  });

  it.each(["midpoint", "onWall", "grid"] as const)("draws a %s snap glyph", (kind) => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 0 }, kind } }), host);
    expect(colored(layer(scene, "overlays"), COLORS.snap).length).toBeGreaterThan(0);
  });

  it("draws an aligned snap with a guide line from each joint it lines up with", () => {
    const guides = [{ x: 3, y: 4 }, { x: 0, y: 2 }];
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 2 }, kind: "aligned", guides } }), host);
    const lines = colored(layer(scene, "overlays"), COLORS.snapGuide);
    expect(lines.map((p) => p.kind === "segment" && [p.a, p.b])).toEqual([[guides[0], { x: 3, y: 2 }], [guides[1], { x: 3, y: 2 }]]);
    expect(colored(layer(scene, "overlays"), COLORS.snap).length).toBeGreaterThan(0);
  });

  it("draws an angle snap with a guide line from the origin (and from a joint on a tie) plus the dot", () => {
    const guides = [{ x: 0, y: 0 }, { x: 3, y: 5 }];
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 3 }, kind: "angle", guides } }), host);
    const lines = colored(layer(scene, "overlays"), COLORS.snapGuide);
    expect(lines.map((p) => p.kind === "segment" && [p.a, p.b])).toEqual([[guides[0], { x: 3, y: 3 }], [guides[1], { x: 3, y: 3 }]]);
    expect(colored(layer(scene, "overlays"), COLORS.snap).map((p) => p.kind === "disc" && p.center)).toEqual([{ x: 3, y: 3 }]);
  });

  it("draws a perpendicular snap as a right-angle mark at the foot, turned to the wall", () => {
    // Origin (2, 0) below the foot (2, 4): one leg towards the origin, one along the wall.
    const state = stateWith(roomDoc(), { snap: { point: { x: 2, y: 4 }, kind: "perpendicular", guides: [{ x: 2, y: 0 }] } });
    const r = 5 / state.camera.zoom;
    const marks = colored(layer(buildScene(state, host), "overlays"), COLORS.snap);
    expect(marks.map((p) => p.kind === "segment" && [p.a, p.b])).toEqual([
      [{ x: 2, y: 4 - r }, { x: 2 + r, y: 4 - r }],
      [{ x: 2 + r, y: 4 - r }, { x: 2 + r, y: 4 }],
    ]);
  });

  it("draws no glyph when snapping is bypassed", () => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 0 }, kind: "none" } }), host);
    expect(colored(layer(scene, "overlays"), COLORS.snap)).toHaveLength(0);
  });
});

describe("buildViewModel: README constants", () => {
  const from = { x: 0, y: 0 };
  it.each<[string, ToolState, EditorState["hover"], object]>([
    ["wall idle", { name: "wall", state: { kind: "idle" } }, null,
      { commandBar: { prompt: "First point", value: "", unit: "m" }, cursor: "crosshair" }],
    ["wall drawing", { name: "wall", state: { kind: "drawing", origin: from, chainStart: from, value: "3.2", preview: null, dragFrom: null } }, null,
      { commandBar: { prompt: "Next point or length", value: "3.2", unit: "m" }, cursor: "crosshair" }],
    ["wall paused", { name: "wall", state: { kind: "paused", origin: from, chainStart: from, segment: "c1" } }, null,
      { commandBar: { prompt: "Waiting for server", value: "", unit: null }, cursor: "crosshair" }],
    ["helper editing", { name: "select", state: { kind: "editingHelper", wallId: "w", value: "2" } }, null,
      { commandBar: { prompt: "Wall length", value: "2", unit: "m" } }],
    ["zone", { name: "zone", state: { kind: "idle", hoverFaceKey: null } }, null,
      { commandBar: { prompt: "Click inside a room", value: "", unit: null }, cursor: "pointer" }],
    ["select hovering", { name: "select", state: { kind: "idle" } }, { table: "joints", id: "j" },
      { commandBar: { prompt: "Select", value: "", unit: null }, cursor: "pointer" }],
  ])("%s: command bar and cursor", (_name, tool, hover, expected) => {
    expect(buildViewModel(stateWith(roomDoc(), { tool, hover }), host)).toMatchObject(expected);
  });

  it("uses the move cursor while dragging", () => {
    const doc = roomDoc();
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "joint", jointId: jointAt(doc, { x: 0, y: 0 }) }, pressWorld: from, baseDoc: doc,
        attempt: { ok: true, doc, cursor: from, moves: [] } },
    };
    expect(buildViewModel(stateWith(doc, { tool }), host).cursor).toBe("move");
  });

  it("enables undo and redo from usable history entries", () => {
    const entry: UndoEntry = { id: "c1", patch: { puts: [], deletes: [], before: [], dependencies: [] }, dependencies: [], status: "usable" };
    const vm = buildViewModel(stateWith(roomDoc(), { undo: { past: [entry], future: [entry], pending: null } }), host);
    expect([vm.canUndo, vm.canRedo]).toEqual([true, true]);
  });
});
