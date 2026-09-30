import { EPS, WALL_THICKNESS, add, incidentWalls, length, normalize, perpLeft, scale, sub, wallOutlines, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { screenToWorld, type Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import type { FontSpec, Host } from "../ports/host";
import { gridSpacingFor } from "../snapping/snap";
import type { EditorState } from "../state";
import { PREVIEW_OP, draggedJoints, type WallPreview } from "../tools/types";
import { COLORS } from "./colors";
import { HELPER_FONT } from "./fonts";
import { drawHelper } from "./helper";
import { labelBox } from "./labels";
import type { Layer, LayerName, Primitive, Scene } from "./scene-types";
import { idsKey, idsOf, memoLast } from "./memo";
import { tagsLayer, zoneFillsLayer } from "./zones-layer";

export const LAYER_ORDER: readonly LayerName[] = ["grid", "zoneFills", "walls", "tags", "annotations", "overlays", "presence"];
const MAX_GRID_LINES = 400;
const PREVIEW_WALL = `${PREVIEW_OP}/w0`; // the wall created by the wall tool's preview addWall
const WALL_EDGE_PX = 1; // width of the outline segments drawn over each wall fill

/** The layers built fresh on every event; walls, zoneFills and tags come from memoized builders (spec §5.9). */
type Layers = Record<Exclude<LayerName, "walls" | "zoneFills" | "tags">, Primitive[]>;
const NONE: readonly Primitive[] = [];

export function buildScene(state: EditorState, host: Host): Scene {
  const layers: Layers = { grid: [], annotations: [], overlays: [], presence: [] };
  drawGrid(state.camera, layers.grid);
  const doc = sceneDocument(state);
  let walls = NONE;
  let zoneFills = NONE;
  let tags = NONE;
  if (doc) {
    const labels = idsKey(state.selection.filter((r) => r.table === "zoneLabels").map((r) => r.id));
    const zoneTool = state.tool.name === "zone" ? state.tool.state : null;
    zoneFills = zoneFillsLayer(doc, labels, zoneTool !== null, zoneTool?.hoverFaceKey ?? null);
    tags = tagsLayer(doc, state.camera.zoom, host, labels);
    walls = wallsLayer(
      doc,
      idsKey(state.selection.filter((r) => r.table === "walls").map((r) => r.id)),
      state.hover?.table === "walls" ? state.hover.id : null,
      idsKey([...invalidWalls(state, doc)]),
    );
    drawSelection(state, doc, layers.overlays);
    drawHelper(state, doc, layers.annotations, host); // selected wall, Select tool only
    drawToolOverlay(state, layers, host);
  }
  drawSnap(state, layers.overlays);
  drawPresence(state, layers.presence);
  const all: Record<LayerName, readonly Primitive[]> = { ...layers, walls, zoneFills, tags };
  return { layers: LAYER_ORDER.map((name): Layer => ({ name, primitives: all[name] })) };
}

/** The document to draw: a gesture's preview while one is active, otherwise the visible document. */
export function sceneDocument(state: EditorState): Document | null {
  if (!state.document) return null;
  const tool = state.tool;
  if (tool.name === "select" && tool.state.kind === "moving") return tool.state.attempt.doc;
  if (tool.name === "wall" && tool.state.kind === "drawing") {
    const preview = tool.state.preview;
    if (preview?.ok) return preview.doc;
  }
  return visibleDoc(state.document);
}

/** A background box behind a label. */
export function textBox(text: string, at: Point, font: FontSpec, camera: Camera, host: Host): Primitive {
  const { min, max } = labelBox(text, at, font, camera, host);
  return {
    kind: "polygon",
    points: [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }],
    color: COLORS.background,
  };
}

function drawGrid(camera: Camera, out: Primitive[]): void {
  const s = gridSpacingFor(camera.zoom);
  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: camera.viewport.width, y: camera.viewport.height });
  const x0 = Math.ceil(topLeft.x / s);
  const x1 = Math.floor(bottomRight.x / s);
  const y0 = Math.ceil(bottomRight.y / s);
  const y1 = Math.floor(topLeft.y / s);
  if (x1 - x0 + (y1 - y0) > MAX_GRID_LINES) return;
  const line = (a: Point, b: Point, major: boolean): Primitive => ({
    kind: "segment", a, b, width: { px: 1 }, color: major ? COLORS.gridMajor : COLORS.grid, cap: "butt",
  });
  for (let i = x0; i <= x1; i++) out.push(line({ x: i * s, y: bottomRight.y }, { x: i * s, y: topLeft.y }, i % 5 === 0));
  for (let j = y0; j <= y1; j++) out.push(line({ x: topLeft.x, y: j * s }, { x: bottomRight.x, y: j * s }, j % 5 === 0));
}

/**
 * Each wall is its filled outline, then 1 px segments along the outline's edges in the same colour (spec §6.2):
 * under WebGL the segments give wall edges analytic antialiasing. All fills come before all edges, the order
 * the WebGL renderer draws a layer in (polygons, then segments).
 */
const wallsLayer = memoLast((doc: Document, selectedWalls: string, hovered: string | null, invalidWallIds: string): readonly Primitive[] => {
  const selected = idsOf(selectedWalls);
  const invalid = idsOf(invalidWallIds);
  const out: Primitive[] = [];
  const edges: Primitive[] = [];
  for (const [id, points] of wallOutlines(doc)) {
    const color = invalid.has(id)
      ? COLORS.invalid
      : id === PREVIEW_WALL
        ? COLORS.preview
        : selected.has(id)
          ? COLORS.wallSelected
          : id === hovered
            ? COLORS.wallHover
            : COLORS.wall;
    out.push({ kind: "polygon", points, color });
    points.forEach((a, i) => {
      edges.push({ kind: "segment", a, b: points[(i + 1) % points.length] ?? a, width: { px: WALL_EDGE_PX }, color, cap: "round" });
    });
  }
  out.push(...edges);
  return out;
});

/** While a drag is invalid, the walls around the dragged joints are drawn red (spec §5.7). */
function invalidWalls(state: EditorState, doc: Document): Set<string> {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "moving" || tool.state.attempt.ok) return new Set();
  return new Set(draggedJoints(doc, tool.state.target).flatMap((j) => incidentWalls(doc, j)));
}

function drawSelection(state: EditorState, doc: Document, out: Primitive[]): void {
  for (const ref of state.selection) {
    const joints =
      ref.table === "walls" ? draggedJoints(doc, { kind: "wall", wallId: ref.id }) : ref.table === "joints" ? [ref.id] : [];
    // A wall's joints come as [a, b]; endpoint a stays fixed when the helper resizes (spec §5.6).
    joints.forEach((id, i) => {
      const j = doc.joints[id];
      if (j) out.push(...handle({ x: j.x, y: j.y }, ref.table === "walls" && i === 0));
    });
  }
}

function handle(p: Point, fixed: boolean): Primitive[] {
  return [
    { kind: "disc", center: p, radius: { px: 5 }, color: COLORS.wallSelected },
    { kind: "disc", center: p, radius: { px: 3.5 }, color: fixed ? COLORS.handleFixed : COLORS.handle },
  ];
}

function drawToolOverlay(state: EditorState, layers: Layers, host: Host): void {
  const tool = state.tool;
  if (tool.name === "wall" && tool.state.kind === "drawing" && tool.state.preview) {
    const p = tool.state.preview;
    if (!p.ok) {
      layers.overlays.push({ kind: "segment", a: p.from, b: p.to, width: { m: WALL_THICKNESS }, color: COLORS.invalid, cap: "butt" });
    }
    drawLengthLabel(p, state.camera, host, layers.annotations);
  }
  if (tool.name === "select" && tool.state.kind === "moving" && !tool.state.attempt.ok) {
    layers.overlays.push({ kind: "disc", center: tool.state.attempt.cursor, radius: { px: 4 }, color: COLORS.invalid }); // ghost
  }
}

/** Live length and angle of the wall being drawn (F1). */
function drawLengthLabel(p: WallPreview, camera: Camera, host: Host, out: Primitive[]): void {
  const d = sub(p.to, p.from);
  const len = length(d);
  if (len < EPS) return;
  const degrees = Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI);
  const text = `${len.toFixed(2)} m  ${degrees}°`;
  const at = add(scale(add(p.from, p.to), 0.5), scale(perpLeft(scale(d, 1 / len)), 16 / camera.zoom));
  out.push(textBox(text, at, HELPER_FONT, camera, host));
  out.push({ kind: "text", text, at, size: HELPER_FONT.size, color: p.ok ? COLORS.text : COLORS.invalid, align: "center", rotation: 0 });
}

function drawSnap(state: EditorState, out: Primitive[]): void {
  const snap = state.snap;
  if (!snap || snap.kind === "none") return;
  const r = 5 / state.camera.zoom;
  const { x, y } = snap.point;
  const seg = (a: Point, b: Point): Primitive => ({ kind: "segment", a, b, width: { px: 1.5 }, color: COLORS.snap, cap: "round" });
  const ring = (pts: Point[]): Primitive[] => pts.map((a, i) => seg(a, pts[(i + 1) % pts.length] ?? a));
  switch (snap.kind) {
    case "endpoint":
      out.push(...ring([{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }]));
      return;
    case "midpoint":
      out.push(...ring([{ x, y: y + r }, { x: x - r, y: y - r }, { x: x + r, y: y - r }]));
      return;
    case "perpendicular": {
      // A right-angle mark in the corner between the wall and the line to the origin (guides[0]).
      const from = snap.guides?.[0];
      const u = (from && normalize(sub(from, snap.point))) ?? { x: 0, y: -1 };
      const w = perpLeft(u); // along the wall
      const corner = add(snap.point, add(scale(u, r), scale(w, r)));
      out.push(seg(add(snap.point, scale(u, r)), corner), seg(corner, add(snap.point, scale(w, r))));
      return;
    }
    case "onWall":
      out.push(seg({ x: x - r, y: y - r }, { x: x + r, y: y + r }), seg({ x: x - r, y: y + r }, { x: x + r, y: y - r }));
      return;
    case "angle": // a guide from the origin (and from the joint on a tie), like aligned
    case "aligned":
      for (const g of snap.guides ?? []) {
        out.push({ kind: "segment", a: g, b: snap.point, width: { px: 1 }, color: COLORS.snapGuide, cap: "butt" });
      }
      out.push({ kind: "disc", center: snap.point, radius: { px: 2.5 }, color: COLORS.snap });
      return;
    case "grid":
      out.push({ kind: "disc", center: snap.point, radius: { px: 2.5 }, color: COLORS.snap });
      return;
    default:
      assertNever(snap.kind);
  }
}

/** Remote cursors with their names, in each collaborator's colour (§7.6). Remote selections are not drawn. */
function drawPresence(state: EditorState, out: Primitive[]): void {
  const offset = 10 / state.camera.zoom;
  for (const p of Object.values(state.presence)) {
    if (!p.cursor) continue;
    out.push({ kind: "disc", center: p.cursor, radius: { px: 5 }, color: p.color });
    out.push({
      kind: "text", text: p.name, at: { x: p.cursor.x + offset, y: p.cursor.y - offset },
      size: 11, color: p.color, align: "left", rotation: 0,
    });
  }
}
