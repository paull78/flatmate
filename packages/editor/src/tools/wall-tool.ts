import { EPS, FLOOR_BASE, add, distance, highestCeilingAlong, execute, flushEnd, normalize, scale, sub, surfaceTop, type Command, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import { hasEntry, isPendingEntry } from "../history/history";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { otherParts, snapPoint, snapStep } from "../snapping/snap";
import { switchTool, viewedLevelOn, type EditorState, type Step } from "../state";
import { showToast } from "../toast";
import { reasonOf } from "../toast-text";
import type { SnapResult } from "../types";
import { baseAt } from "./column-refs";
import { DRAG_THRESHOLD_PX } from "./hit-test";
import { PREVIEW_OP, type WallPreview, type WallToolState } from "./types";
import { cantRead, editedValue, readValue, valueChar } from "../typed-value";

type Drawing = Extract<WallToolState, { kind: "drawing" }>;

/** spec: wall-editing. A click is a pointerDown at the snapped point; a drag from the first point draws one wall. */
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
      const preview = e.type === "pointerMove" ? previewWall(doc, tool.origin, snap.point, state.wallThickness, wallBase(state, doc, tool.origin)) : tool.preview;
      return { state: withWall(state, { ...tool, preview }, snap), effects: [] };
    }
    case "paused":
      // Shared documents (phase 7): the cursor is tracked, there is no preview, clicks are ignored and never queued.
      return { state: withWall(state, tool, null), effects: [] };
    default:
      return assertNever(tool);
  }
}

/** The value field of the wall tool (spec: tools precedence 1). Returns null when the key is not captured. */
export function wallKey(state: EditorState, tool: WallToolState, key: string, host: Host): Step | null {
  switch (tool.kind) {
    case "idle":
      return null;
    case "paused":
      return isValueKey(key) ? { state, effects: [] } : null; // ignored, never queued
    case "drawing": {
      const value = editedValue(tool.value, key);
      if (value !== null) return { state: withWall(state, { ...tool, value }, state.snap), effects: [] };
      if (key === "Enter") return tool.value === "" ? { state: withWall(state, { kind: "idle" }, state.snap), effects: [] } : placeTyped(state, tool, host);
      return null;
    }
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

/** Preview of the wall from `from` to `to` on `base`, on the visible document; null while the cursor is on the origin. */
export function previewWall(doc: Document, from: Point, to: Point, thickness: number, base: string): WallPreview | null {
  if (onOrigin(from, to)) return null;
  const r = execute(doc, previewCommand(from, to, thickness, base));
  return r.ok
    ? { from, to, ok: true, doc: r.value.doc }
    : { from, to, ok: false };
}

/** The preview's command, its one refusal check. */
function previewCommand(from: Point, to: Point, thickness: number, base: string): Command {
  return { type: "addWall", opId: PREVIEW_OP, from: { at: from }, to: { at: to }, thickness, base };
}

/** Why a red preview is refused (clarity.03). A preview keeps no error: worked out only when the rest fires. */
export function wallReason(state: EditorState, preview: WallPreview): string | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  return doc && reasonOf(doc, previewCommand(preview.from, preview.to, state.wallThickness, wallBase(state, doc, preview.from)));
}

/**
 * Enters drawing at `origin` with a preview to the current cursor, exactly as on a pointer move.
 * Phase 7's resume rule (spec: wall-editing) calls this after checking the anchor joint.
 */
export function drawingAt(state: EditorState, origin: Point, chainStart: Point): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc || !state.pointer) return withWall(state, { kind: "drawing", origin, chainStart, value: "", preview: null, dragFrom: null }, null);
  const snap = snapCursor(state, doc, origin);
  const preview = previewWall(doc, origin, snap.point, state.wallThickness, wallBase(state, doc, origin));
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
  const out = runCommand(idle, addWall(state, tool.origin, q, host), host);
  return { state: out.state, effects: out.effects };
}

function placePoint(state: EditorState, tool: Drawing, q: Point, isClick: boolean, host: Host): Step {
  const closes = isClick && distance(q, tool.chainStart) < EPS;
  const to = closes ? tool.chainStart : q;
  const out = runCommand(state, addWall(state, tool.origin, to, host), host);
  // Refused by execute (nothing committed), or rejected by the document in the same step: tool unchanged, toast shown.
  if (out.committed === null || !hasEntry(out.state.undo, out.committed)) return { state: out.state, effects: out.effects };
  if (closes) return { state: withWall(out.state, { kind: "idle" }, out.state.snap), effects: out.effects };
  const next = isPendingEntry(out.state.undo, out.committed)
    ? withWall(out.state, { kind: "paused", origin: to, chainStart: tool.chainStart, segment: out.committed }, null)
    : drawingAt(out.state, to, tool.chainStart);
  return { state: next, effects: out.effects };
}

/** Enter with a value: q = origin + v · direction, where direction comes from the snapped cursor. */
function placeTyped(state: EditorState, tool: Drawing, host: Host): Step {
  const length = readValue(tool.value, "metres");
  if (length === null) return showToast(state, cantRead(tool.value), host);
  if (length <= 0) return showToast(state, "Type a length in metres", host);
  const doc = state.document ? visibleDoc(state.document) : null;
  const cursor = doc ? snapCursor(state, doc, tool.origin).point : tool.origin; // no pointer yet: snapCursor gives the origin
  const dir = onOrigin(tool.origin, cursor) ? null : normalize(sub(cursor, tool.origin)); // as previewWall
  if (!dir || !doc) return showToast(state, "Move the cursor to set a direction", host);
  const q = add(tool.origin, scale(dir, length));
  return placePoint(state, tool, flushed(doc, q, tool.origin, wallBase(state, doc, tool.origin)), false, host);
}

/** The wall from `from` to `to`, on the base `from` stands on at the viewed level. */
function addWall(state: EditorState, from: Point, to: Point, host: Host): Command {
  const doc = state.document ? visibleDoc(state.document) : null;
  const base = doc ? wallBase(state, doc, from) : FLOOR_BASE;
  return { type: "addWall", opId: host.newId(), from: { at: from }, to: { at: to }, thickness: state.wallThickness, base };
}

/** What a wall drawn from `at` stands on: the floor, or at a deck's level the deck there (pillars.09). */
function wallBase(state: EditorState, doc: Document, at: Point): string {
  return baseAt(doc, viewedLevelOn(state, doc), at);
}

/**
 * Where an end at `end` of a wall from `from` on `base` lands: on a deck, inside a wall of another base, flush on its
 * face, as addWall puts it (AC-09); otherwise `end`. The ghost, the click and the chain's next origin then agree.
 */
function flushed(doc: Document, end: Point, from: Point, base: string): Point {
  if (base === FLOOR_BASE) return end;
  return flushEnd(doc, end, from, base, { bottom: surfaceTop(doc, base), top: highestCeilingAlong(doc, from, end) }) ?? end; // a full wall's top, under a slope too (roofs.17)
}

function snapCursor(state: EditorState, doc: Document, origin: Point | null): SnapResult {
  const p = state.pointer;
  if (!p) return { point: origin ?? { x: 0, y: 0 }, kind: "none" };
  const { tolerancePx } = state.snapSettings;
  const gridSpacing = snapStep(state);
  const base = wallBase(state, doc, origin ?? p.world);
  const others = otherParts(doc, base);
  const snap = snapPoint({ doc, cursor: p.world, camera: state.camera, mods: p.mods, origin, tolerancePx, gridSpacing, angles: true, excludeJoints: others.joints, excludeWalls: others.walls, ...(origin ? { squareFrom: [origin] } : {}) });
  const end = origin ? flushed(doc, snap.point, origin, base) : snap.point;
  return end === snap.point ? snap : { point: end, kind: "onWall" }; // on the face of a wall of another base
}

/** The cursor is on the origin: no preview, no direction, and a click there is ignored. */
function onOrigin(origin: Point, p: Point): boolean {
  return distance(p, origin) < EPS;
}

function withWall(state: EditorState, tool: WallToolState, snap: SnapResult | null): EditorState {
  return { ...state, tool: { name: "wall", state: tool }, snap };
}

function isValueKey(key: string): boolean {
  return valueChar("", key) !== null || key === "Backspace" || key === "Enter";
}
