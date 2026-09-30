import { EPS, add, distance, execute, normalize, scale, sub, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import { hasEntry, isPendingEntry } from "../history/history";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { snapPoint } from "../snapping/snap";
import { switchTool, type EditorState, type Step } from "../state";
import { showToast } from "../toast";
import type { SnapResult } from "../types";
import { DRAG_THRESHOLD_PX } from "./hit-test";
import { PREVIEW_OP, type WallPreview, type WallToolState } from "./types";

type Drawing = Extract<WallToolState, { kind: "drawing" }>;

/** Spec §5.5. A click is a pointerDown at the snapped point; a drag from the first point draws one wall. */
export function wallPointer(state: EditorState, tool: WallToolState, e: PointerInput, host: Host): Step {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc) return { state, effects: [] };
  switch (tool.kind) {
    case "idle": {
      const snap = snapCursor(state, doc, null);
      const dragFrom = state.pointer?.world ?? snap.point;
      const next: WallToolState =
        e.type === "pointerDown" ? { kind: "drawing", origin: snap.point, chainStart: snap.point, value: "", preview: null, dragFrom } : tool;
      return { state: withWall(state, next, snap), effects: [] };
    }
    case "drawing": {
      const snap = snapCursor(state, doc, tool.origin);
      if (e.type === "pointerDown") {
        // A click on the origin (e.g. a double click) is ignored: no wall, no toast, value and preview kept.
        if (onOrigin(tool.origin, snap.point)) return { state: withWall(state, tool, snap), effects: [] };
        return placePoint(withWall(state, tool, snap), tool, snap.point, true, host);
      }
      if (e.type === "pointerUp" && tool.dragFrom) return releaseFirst(withWall(state, tool, snap), tool, tool.dragFrom, snap.point, host);
      const preview = e.type === "pointerMove" ? previewWall(doc, tool.origin, snap.point) : tool.preview;
      return { state: withWall(state, { ...tool, preview }, snap), effects: [] };
    }
    case "paused":
      // Shared documents (phase 7): the cursor is tracked, there is no preview, clicks are ignored and never queued.
      return { state: withWall(state, tool, null), effects: [] };
    default:
      return assertNever(tool);
  }
}

/** The value field of the wall tool (spec §5.4 precedence 1). Returns null when the key is not captured. */
export function wallKey(state: EditorState, tool: WallToolState, key: string, host: Host): Step | null {
  switch (tool.kind) {
    case "idle":
      return null;
    case "paused":
      return isValueKey(key) ? { state, effects: [] } : null; // ignored, never queued
    case "drawing":
      if (/^[0-9]$/.test(key) || key === ".") return { state: withWall(state, { ...tool, value: tool.value + key }, state.snap), effects: [] };
      if (key === "Backspace") return { state: withWall(state, { ...tool, value: tool.value.slice(0, -1) }, state.snap), effects: [] };
      if (key === "Enter" || key === " ") {
        return tool.value === "" ? { state: withWall(state, { kind: "idle" }, state.snap), effects: [] } : placeTyped(state, tool, host);
      }
      return null;
    default:
      return assertNever(tool);
  }
}

/** Esc: drawing or paused → idle (walls already added stay; a submitted wall still settles); idle → Select. */
export function wallEscape(state: EditorState, tool: WallToolState): EditorState {
  switch (tool.kind) {
    case "idle":
      return switchTool(state, "select");
    case "drawing":
    case "paused":
      return withWall(state, { kind: "idle" }, null);
    default:
      return assertNever(tool);
  }
}

/** Preview of the wall from `from` to `to` on the visible document; null while the cursor is on the origin. */
export function previewWall(doc: Document, from: Point, to: Point): WallPreview | null {
  if (onOrigin(from, to)) return null;
  const r = execute(doc, { type: "addWall", opId: PREVIEW_OP, from: { at: from }, to: { at: to } });
  return r.ok
    ? { from, to, ok: true, doc: r.value.doc }
    : { from, to, ok: false };
}

/**
 * Enters drawing at `origin` with a preview to the current cursor, exactly as on a pointer move.
 * Phase 7's resume rule (spec §5.5) calls this after checking the anchor joint.
 */
export function drawingAt(state: EditorState, origin: Point, chainStart: Point): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc || !state.pointer) return withWall(state, { kind: "drawing", origin, chainStart, value: "", preview: null, dragFrom: null }, null);
  const snap = snapCursor(state, doc, origin);
  const preview = previewWall(doc, origin, snap.point);
  return withWall(state, { kind: "drawing", origin, chainStart, value: "", preview, dragFrom: null }, snap);
}

/**
 * The release of the press that started the chain. Past the drag threshold (world distance at the current zoom,
 * as the select tool) it draws one wall to the snapped release point and the chain ends, even on a shared
 * document (no pause) or when the wall is refused (toast). Otherwise it was a click and the chain goes on; so is a
 * release that snaps back onto the first point (hand jitter on a trackpad tap), as a click there is ignored.
 */
function releaseFirst(state: EditorState, tool: Drawing, dragFrom: Point, q: Point, host: Host): Step {
  const world = state.pointer?.world ?? dragFrom;
  if (distance(world, dragFrom) * state.camera.zoom <= DRAG_THRESHOLD_PX || onOrigin(tool.origin, q)) {
    return { state: withWall(state, { ...tool, dragFrom: null }, state.snap), effects: [] };
  }
  const idle = withWall(state, { kind: "idle" }, null);
  const out = runCommand(idle, { type: "addWall", opId: host.newId(), from: { at: tool.origin }, to: { at: q } }, host);
  return { state: out.state, effects: out.effects };
}

function placePoint(state: EditorState, tool: Drawing, q: Point, isClick: boolean, host: Host): Step {
  const closes = isClick && distance(q, tool.chainStart) < EPS;
  const to = closes ? tool.chainStart : q;
  const out = runCommand(state, { type: "addWall", opId: host.newId(), from: { at: tool.origin }, to: { at: to } }, host);
  // Refused by execute (nothing committed), or rejected by the document in the same step: tool unchanged, toast shown.
  if (out.committed === null || !hasEntry(out.state.undo, out.committed)) return { state: out.state, effects: out.effects };
  if (closes) return { state: withWall(out.state, { kind: "idle" }, out.state.snap), effects: out.effects };
  const next = isPendingEntry(out.state.undo, out.committed)
    ? withWall(out.state, { kind: "paused", origin: to, chainStart: tool.chainStart, segment: out.committed }, null)
    : drawingAt(out.state, to, tool.chainStart);
  return { state: next, effects: out.effects };
}

/** Enter/Space with a value: q = origin + v · direction, where direction comes from the snapped cursor. */
function placeTyped(state: EditorState, tool: Drawing, host: Host): Step {
  const length = Number(tool.value);
  if (!Number.isFinite(length) || length <= 0) return showToast(state, "Type a length in metres", host);
  const doc = state.document ? visibleDoc(state.document) : null;
  const cursor = doc ? snapCursor(state, doc, tool.origin).point : tool.origin; // no pointer yet: snapCursor gives the origin
  const dir = onOrigin(tool.origin, cursor) ? null : normalize(sub(cursor, tool.origin)); // as previewWall
  if (!dir) return showToast(state, "Move the cursor to set a direction", host);
  return placePoint(state, tool, add(tool.origin, scale(dir, length)), false, host);
}

function snapCursor(state: EditorState, doc: Document, origin: Point | null): SnapResult {
  const p = state.pointer;
  if (!p) return { point: origin ?? { x: 0, y: 0 }, kind: "none" };
  const tolerancePx = state.snapSettings.tolerancePx;
  return snapPoint({ doc, cursor: p.world, camera: state.camera, mods: p.mods, origin, tolerancePx, angles: true });
}

/** The cursor is on the origin: no preview, no direction, and a click there is ignored. */
function onOrigin(origin: Point, p: Point): boolean {
  return distance(p, origin) < EPS;
}

function withWall(state: EditorState, tool: WallToolState, snap: SnapResult | null): EditorState {
  return { ...state, tool: { name: "wall", state: tool }, snap };
}

function isValueKey(key: string): boolean {
  return /^[0-9]$/.test(key) || key === "." || key === "Backspace" || key === "Enter" || key === " ";
}
