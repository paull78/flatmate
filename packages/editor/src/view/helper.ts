import { EPS, add, distance, scale, sub, wallChain, wallFace, wallFrame, type ChainPiece, type Document, type Opening, shown } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import { viewedLevelOn, type EditorState } from "../state";
import { COLORS } from "./colors";
import { CHROME_FONT, HELPER_FONT } from "./fonts";
import { labelBox } from "./labels";
import type { Primitive } from "./scene-types";
import { inBox } from "./tags";

// The editable helper dimension of a selected wall (spec: tools, F5). It sits on, and measures, the wall's room-side face
// (ux-polish.35: clear interior; a divider or a free wall takes the left of a → b). A wall that holds openings shows
// two rows there (ux-polish item 2): its chain nearer the wall, in the helper's usual place, and the total further out.
const HELPER_LINE_PX = 8; // dimension line, beyond the wall face
export const HELPER_OFFSET_PX = 18; // text centre, beyond the wall face
export const HELPER_TICK_PX = 4;
const ROW_GAP_PX = 4; // between the chain's plates and the total's
const ROW_TEXT = "00.00"; // sizes the chain row's plates, so the total row stays put while a value is typed

// normal: towards the room side; half: half the wall's thickness; faceStart/faceEnd: the face's ends, metres from a.
type Frame = { a: Point; dir: Point; normal: Point; half: number; faceStart: number; faceEnd: number };
type Plate = { text: string; at: Point; min: Point; max: Point };
/** One chain piece's text plate, a → b; `shown` is false when the text does not fit the piece on screen. */
type ChainBox = Plate & { index: number; piece: ChainPiece; shown: boolean };

function frame(doc: Document, wallId: string): Frame | null {
  const f = wallFrame(doc, wallId);
  const face = wallFace(doc, wallId);
  if (!f || !face) return null;
  const normal = scale(f.left, face.side === "left" ? 1 : -1);
  return { a: f.a, dir: f.dir, normal, half: f.half, faceStart: face.faceStart, faceEnd: face.faceEnd };
}

/** The point on the room-side face line `t` metres from joint a (along the wall). */
function onFace(f: Frame, t: number): Point {
  return add(add(f.a, scale(f.dir, t)), scale(f.normal, f.half));
}

/** Whether the wall shows a chain: it holds at least one opening. */
function hasChain(doc: Document, wallId: string): boolean {
  return Object.values(doc.openings).some((o) => o.wall === wallId);
}

/** Distance from the face to the total's text: the usual 18 px, or beyond the chain row's plates. */
function totalOffset(doc: Document, wallId: string, f: Frame, camera: Camera): number {
  const usual = HELPER_OFFSET_PX / camera.zoom;
  if (!hasChain(doc, wallId)) return usual;
  const { max } = labelBox(ROW_TEXT, { x: 0, y: 0 }, HELPER_FONT, camera);
  const across = Math.abs(f.normal.x) * max.x + Math.abs(f.normal.y) * max.y; // a plate's half extent away from the wall
  return usual + 2 * across + ROW_GAP_PX / camera.zoom;
}

/** Centre of the total's text: the face's middle, 18 px beyond the face (further out over a chain). The one placement function. */
export function helperLabelAt(doc: Document, wallId: string, camera: Camera): Point | null {
  const f = frame(doc, wallId);
  if (!f) return null;
  return add(onFace(f, (f.faceStart + f.faceEnd) / 2), scale(f.normal, totalOffset(doc, wallId, f, camera)));
}

/**
 * The wall whose helper is shown: in the Select tool, the one selected wall or the wall of the one selected opening
 * (or the one being edited), never during a drag.
 */
function helperWall(state: EditorState): string | null {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind === "moving" || tool.state.kind === "splitting") return null; // Split draws its own distances
  if (tool.state.kind === "editingHelper") return tool.state.wallId;
  const ref = state.selection[0];
  if (state.selection.length !== 1 || !ref || !state.document) return null;
  if (ref.table === "walls") return visibleDoc(state.document).walls[ref.id]?.column ? null : ref.id; // a column has no length
  return ref.table === "openings" ? (visibleDoc(state.document).openings[ref.id]?.wall ?? null) : null;
}

/** What a click on the helper edits: the wall's total, or one piece of its chain (an index in wallChain). */
type HelperTarget = { wallId: string; piece?: number };

/** The typed value while the plate of `piece` (undefined: the total) of the wall is the value field, else null. */
function editingValue(state: EditorState, wallId: string, piece: number | undefined): string | null {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "editingHelper") return null;
  return tool.state.wallId === wallId && tool.state.piece === piece ? tool.state.value : null;
}

/** The typed value while editing the total, otherwise the (clear) length with two decimals. */
function helperText(state: EditorState, wallId: string, length: number): string {
  const editing = editingValue(state, wallId, undefined);
  return editing ? editing : shown(length);
}

/** The total's text, its centre and its box; the box is both the drawn plate and the click target. */
export function helperBox(state: EditorState, doc: Document, wallId: string): Plate | null {
  const f = frame(doc, wallId);
  const at = helperLabelAt(doc, wallId, state.camera);
  if (!f || !at) return null;
  const text = helperText(state, wallId, f.faceEnd - f.faceStart);
  return { text, at, ...labelBox(text, at, HELPER_FONT, state.camera) }; // same box as the length label (phase 3)
}

/**
 * The chain's pieces with their plates, centred 18 px beyond the face at each piece's middle; `moving` is an opening
 * being positioned (hover or drag). The one placement function for the chain, shared by drawing and hit-testing. A
 * piece being typed into shows the typed value and is always shown.
 */
export function chainBoxes(state: EditorState, doc: Document, wallId: string, moving?: Opening): ChainBox[] {
  const f = frame(doc, wallId);
  const chain = f ? wallChain(doc, wallId, viewedLevelOn(state, doc), moving) : null; // the viewed level's openings (review.09)
  if (!f || !chain) return [];
  const out = scale(f.normal, HELPER_OFFSET_PX / state.camera.zoom);
  return chain.pieces.map((piece, index) => {
    const editing = editingValue(state, wallId, index);
    const text = editing ? editing : shown(piece.length);
    const at = add(scale(add(piece.from, piece.to), 0.5), out);
    const box = labelBox(text, at, HELPER_FONT, state.camera);
    const along = Math.abs(f.dir.x) * (box.max.x - box.min.x) + Math.abs(f.dir.y) * (box.max.y - box.min.y);
    return { text, at, ...box, index, piece, shown: editing !== null || piece.length >= along };
  });
}

/** The total or the chain piece of the shown helper whose text is under the point (a click there starts editing it). */
export function helperHit(state: EditorState, world: Point): HelperTarget | null {
  const wallId = helperWall(state);
  if (!wallId || !state.document) return null;
  const doc = visibleDoc(state.document);
  const box = helperBox(state, doc, wallId);
  if (box && inBox(world, box.min, box.max)) return { wallId };
  if (!hasChain(doc, wallId)) return null;
  const piece = chainBoxes(state, doc, wallId).find((b) => b.shown && inBox(world, b.min, b.max));
  return piece ? { wallId, piece: piece.index } : null;
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

/** The selected wall's helper (annotations layer): its chain and total when it holds openings, else the total alone. */
export function drawHelper(state: EditorState, doc: Document, out: Primitive[]): void {
  const wallId = helperWall(state);
  const f = wallId ? frame(doc, wallId) : null;
  const box = wallId ? helperBox(state, doc, wallId) : null;
  if (!wallId || !f || !box) return;
  if (hasChain(doc, wallId)) drawChain(state, doc, wallId, out);
  const line = totalOffset(doc, wallId, f, state.camera) - (HELPER_OFFSET_PX - HELPER_LINE_PX) / state.camera.zoom; // 10 px nearer the wall than the text
  const offset = scale(f.normal, line);
  const a = add(onFace(f, f.faceStart), offset);
  const b = add(onFace(f, f.faceEnd), offset);
  drawDimension(a, b, [a, b], f.normal, box, state.camera.zoom, out);
  drawPlate(box, editingValue(state, wallId, undefined), out);
}

/** A wall's chain (annotations layer), with `moving` placed in it while an opening is positioned. */
export function drawChain(state: EditorState, doc: Document, wallId: string, out: Primitive[], moving?: Opening): void {
  const f = frame(doc, wallId);
  if (!f) return;
  const offset = scale(f.normal, HELPER_LINE_PX / state.camera.zoom);
  for (const box of chainBoxes(state, doc, wallId, moving)) {
    const p = add(box.piece.from, offset);
    const q = add(box.piece.to, offset);
    drawDimension(p, q, box.index === 0 ? [p, q] : [q], f.normal, box.shown ? box : null, state.camera.zoom, out); // one tick per boundary
    if (box.shown) drawPlate(box, editingValue(state, wallId, box.index), out);
  }
}

/**
 * A dimension line p → q with ticks at `ticks`; the line stops at the plate, and the line and ticks stop at every box
 * in `avoid` (another label's plate, such as a resize's size label).
 */
export function drawDimension(
  p: Point, q: Point, ticks: readonly Point[], normal: Point, plate: Plate | null, zoom: number, out: Primitive[],
  avoid: readonly { min: Point; max: Point }[] = [],
): void {
  const tick = scale(normal, HELPER_TICK_PX / zoom);
  const seg = (a: Point, b: Point): Primitive => ({ kind: "segment", a, b, width: { px: 1 }, color: COLORS.helper, cap: "butt" });
  const clear = (pieces: [Point, Point][]): [Point, Point][] =>
    avoid.reduce((acc, box) => acc.flatMap(([a, b]) => outsideBox(a, b, box.min, box.max)), pieces);
  // The line stops at the plate: WebGL draws a layer's polygons before its segments, so a plate cannot hide it.
  const whole: [Point, Point][] = [[p, q]];
  for (const [a, b] of clear(plate ? outsideBox(p, q, plate.min, plate.max) : whole)) out.push(seg(a, b));
  for (const t of ticks) for (const [a, b] of clear([[sub(t, tick), add(t, tick)]])) out.push(seg(a, b));
}

/** The text on its plate; `editing` is the typed value while this plate is the value field, else null. */
export function drawPlate(plate: Plate, editing: string | null, out: Primitive[]): void {
  const corners = [plate.min, { x: plate.max.x, y: plate.min.y }, plate.max, { x: plate.min.x, y: plate.max.y }];
  // While editing, the plate looks like a text field: the current value stays "selected" until the first key (spec: tools).
  const fill = editing === null ? COLORS.background : editing === "" ? COLORS.fieldSelection : COLORS.field;
  out.push({ kind: "polygon", points: corners, holes: [], color: fill });
  if (editing !== null) {
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % corners.length] ?? p;
      out.push({ kind: "segment", a: p, b: q, width: { px: 1 }, color: COLORS.wallSelected, cap: "round" }); // round caps close the corners
    });
  }
  out.push({ kind: "text", text: plate.text, at: plate.at, size: HELPER_FONT.size, color: COLORS.helper, align: "center", rotation: 0, font: CHROME_FONT });
}
