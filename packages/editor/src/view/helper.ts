import { EPS, WALL_THICKNESS, add, distance, normalize, perpLeft, scale, sub, wallHelperDimension, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import { COLORS } from "./colors";
import { HELPER_FONT } from "./fonts";
import { labelBox } from "./labels";
import type { Primitive } from "./scene-types";
import { inBox } from "./tags";

// The editable helper dimension of a selected wall (spec §5.6, F5). It sits on the left of a → b.
export const HELPER_LINE_PX = 8; // dimension line, beyond the wall face
export const HELPER_OFFSET_PX = 18; // text centre, beyond the wall face
export const HELPER_TICK_PX = 4;

type Frame = { a: Point; b: Point; length: number; normal: Point };

function frame(doc: Document, wallId: string): Frame | null {
  const h = wallHelperDimension(doc, wallId);
  const dir = h ? normalize(sub(h.b, h.a)) : null;
  return h && dir ? { ...h, normal: perpLeft(dir) } : null;
}

/** Centre of the helper text: the wall's midpoint, 18 px beyond its face. The one placement function. */
export function helperLabelAt(doc: Document, wallId: string, camera: Camera): Point | null {
  const f = frame(doc, wallId);
  if (!f) return null;
  return add(scale(add(f.a, f.b), 0.5), scale(f.normal, WALL_THICKNESS / 2 + HELPER_OFFSET_PX / camera.zoom));
}

/** The wall whose helper is shown: in the Select tool, the one selected wall (or the one being edited), never during a drag. */
export function helperWall(state: EditorState): string | null {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind === "moving") return null;
  if (tool.state.kind === "editingHelper") return tool.state.wallId;
  const ref = state.selection[0];
  return state.selection.length === 1 && ref?.table === "walls" ? ref.id : null;
}

/** The typed value while editing, otherwise the length with two decimals. */
export function helperText(state: EditorState, length: number): string {
  const tool = state.tool;
  const editing = tool.name === "select" && tool.state.kind === "editingHelper" ? tool.state.value : "";
  return editing !== "" ? editing : length.toFixed(2);
}

/** The text, its centre and its box; the box is both the drawn plate and the click target. */
export function helperBox(
  state: EditorState,
  doc: Document,
  wallId: string,
  host: Host,
): { text: string; at: Point; min: Point; max: Point } | null {
  const f = frame(doc, wallId);
  const at = helperLabelAt(doc, wallId, state.camera);
  if (!f || !at) return null;
  const text = helperText(state, f.length);
  return { text, at, ...labelBox(text, at, HELPER_FONT, state.camera, host) }; // same box as the length label (phase 3)
}

/** The selected wall, when the point is on its helper text (a click there starts editing). */
export function helperHit(state: EditorState, world: Point, host: Host): string | null {
  const wallId = helperWall(state);
  if (!wallId || !state.document) return null;
  const box = helperBox(state, visibleDoc(state.document), wallId, host);
  return box && inBox(world, box.min, box.max) ? wallId : null;
}

/**
 * The parts of segment a → b outside the axis-aligned box: 0, 1 or 2 pieces (Liang–Barsky gives the inside
 * interval t0..t1; the pieces are 0..t0 and t1..1). Pieces shorter than EPS are dropped.
 */
export function outsideBox(a: Point, b: Point, min: Point, max: Point): [Point, Point][] {
  const d = sub(b, a);
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-d.x, a.x - min.x],
    [d.x, max.x - a.x],
    [-d.y, a.y - min.y],
    [d.y, max.y - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return [[a, b]]; // parallel to this edge and outside it (or on it)
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (t0 >= t1) return [[a, b]];
  const pieces: [Point, Point][] = [
    [a, add(a, scale(d, t0))],
    [add(a, scale(d, t1)), b],
  ];
  return pieces.filter(([p, q]) => distance(p, q) >= EPS);
}

/** Dimension line with end ticks, and the length on a plate (annotations layer). */
export function drawHelper(state: EditorState, doc: Document, out: Primitive[], host: Host): void {
  const wallId = helperWall(state);
  const f = wallId ? frame(doc, wallId) : null;
  const box = wallId ? helperBox(state, doc, wallId, host) : null;
  if (!f || !box) return;
  const zoom = state.camera.zoom;
  const offset = scale(f.normal, WALL_THICKNESS / 2 + HELPER_LINE_PX / zoom);
  const tick = scale(f.normal, HELPER_TICK_PX / zoom);
  const a = add(f.a, offset);
  const b = add(f.b, offset);
  const seg = (p: Point, q: Point): Primitive => ({ kind: "segment", a: p, b: q, width: { px: 1 }, color: COLORS.helper, cap: "butt" });
  // The line stops at the plate: WebGL draws a layer's polygons before its segments, so a plate cannot hide it.
  for (const [p, q] of outsideBox(a, b, box.min, box.max)) out.push(seg(p, q));
  out.push(seg(sub(a, tick), add(a, tick)), seg(sub(b, tick), add(b, tick)));
  out.push({
    kind: "polygon",
    points: [box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y }],
    color: COLORS.background,
  });
  out.push({ kind: "text", text: box.text, at: box.at, size: HELPER_FONT.size, color: COLORS.helper, align: "center", rotation: 0 });
}
