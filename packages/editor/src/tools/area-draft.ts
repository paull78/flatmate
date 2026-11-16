import { MIN_AREA_SIZE, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import { reasonOf } from "../toast-text";
import { PREVIEW_OP } from "./types";

// Drawing a named area with the Zone tool (areas.06, .15): the rectangle between two corners, along the world axes, a
// corner also caught by another area's side, and the size under which the press is a click.

/** Corners closer than this to the minimum still draw: they are kept to the cm, the minimum to the mm. */
const SIZE_SLACK = 1e-9;

/** Whether the rectangle between `a` and `b` is an area, at least MIN_AREA_SIZE both ways; under it the press is a click. */
export function drawsArea(a: Point, b: Point): boolean {
  return Math.abs(b.x - a.x) >= MIN_AREA_SIZE - SIZE_SLACK && Math.abs(b.y - a.y) >= MIN_AREA_SIZE - SIZE_SLACK;
}

/** The addArea a drag from `a` to `b` sends; the domain keeps it to the millimetre and names it. */
export function drawnArea(a: Point, b: Point, opId: string): Command {
  return { type: "addArea", opId, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, w: Math.abs(b.x - a.x), d: Math.abs(b.y - a.y) };
}

/**
 * A corner pulled onto another area's side when within `tolerance` metres of its line and along its span: x onto a
 * vertical side, y onto a horizontal one, each independently, so a corner can take both (a corner of the other area).
 * None with Ctrl, which snaps to the cm only.
 */
export function areaCorner(doc: Document, p: Point, tolerance: number, ctrl: boolean): Point {
  if (ctrl) return p;
  let best = { x: p.x, dx: tolerance, y: p.y, dy: tolerance };
  for (const a of Object.values(doc.areas)) {
    const [x0, x1, y0, y1] = [a.at.x - a.w / 2, a.at.x + a.w / 2, a.at.y - a.d / 2, a.at.y + a.d / 2];
    const alongY = p.y >= y0 - tolerance && p.y <= y1 + tolerance;
    const alongX = p.x >= x0 - tolerance && p.x <= x1 + tolerance;
    for (const x of [x0, x1]) if (alongY && Math.abs(p.x - x) < best.dx) best = { ...best, x, dx: Math.abs(p.x - x) };
    for (const y of [y0, y1]) if (alongX && Math.abs(p.y - y) < best.dy) best = { ...best, y, dy: Math.abs(p.y - y) };
  }
  return { x: best.x, y: best.y };
}

/** The area a release named `opId` added. */
export function addedArea(doc: Document, opId: string): EntityRef[] {
  const id = `${opId}/a0`;
  return Object.hasOwn(doc.areas, id) ? [{ table: "areas", id }] : [];
}

/** The area being drawn, for the overlay: its ring and whether addArea would take it; null unless a drag is drawing one. */
export function zoneDraft(state: EditorState): { ring: Point[]; ok: boolean } | null {
  const tool = state.tool;
  if (tool.name !== "zone" || tool.state.kind !== "pressing" || tool.state.current === null) return null;
  const { start, current, ok } = tool.state;
  return { ring: [start, { x: current.x, y: start.y }, current, { x: start.x, y: current.y }], ok };
}

/** Why the area a drag draws is refused, in the toast's words; null when it isn't. */
export function zoneReason(state: EditorState, start: Point, current: Point): string | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  return doc ? reasonOf(doc, drawnArea(start, current, PREVIEW_OP)) : null;
}
