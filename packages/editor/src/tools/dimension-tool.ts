import { MIN_DIMENSION, distance, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import { hasEntry } from "../history/history";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { DIMENSION_POLICIES } from "../snapping/dimension-policies";
import { roundTo } from "../snapping/policies";
import { snapPoint, snapStep } from "../snapping/snap";
import { switchTool, type EditorState, type Step } from "../state";
import type { SnapResult } from "../types";
import { acrossLine } from "../view/dimension-layout";
import type { DimensionDraft } from "../view/dimensions-layer";
import type { DimensionToolState } from "./types";

/**
 * Spec §Placing (dims.04): a press sets A, then B, then the offset, which commits one `addDimension`; the tool then
 * waits for the next A. Releases are ignored. A second press under 1 cm from A is ignored, before the domain refuses it.
 */
export function dimensionPointer(state: EditorState, tool: DimensionToolState, e: PointerInput, host: Host): Step {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc) return { state, effects: [] };
  const press = e.type === "pointerDown";
  switch (tool.kind) {
    case "idle": {
      const snap = snapCursor(state, doc, null);
      return { state: withDimension(state, press ? { kind: "second", a: snap.point } : tool, snap), effects: [] };
    }
    case "second": {
      const snap = snapCursor(state, doc, tool.a);
      if (!press || distance(snap.point, tool.a) < MIN_DIMENSION) return { state: withDimension(state, tool, snap), effects: [] };
      const b = snap.point;
      return { state: withDimension(state, { kind: "offset", a: tool.a, b, offset: offsetAt(state, tool.a, b) }, null), effects: [] };
    }
    case "offset": {
      const { a, b } = tool;
      const offset = offsetAt(state, a, b);
      const next = withDimension(state, { kind: "offset", a, b, offset }, null);
      if (!press) return { state: next, effects: [] };
      const out = runCommand(next, { type: "addDimension", opId: host.newId(), a, b, offset }, host);
      // Refused, or rejected by the document in the same step: A and B stay placed and the toast says why.
      if (out.committed === null || !hasEntry(out.state.undo, out.committed)) return { state: out.state, effects: out.effects };
      const after = out.state.document ? visibleDoc(out.state.document) : doc;
      return { state: withDimension(out.state, { kind: "idle" }, snapCursor(out.state, after, null)), effects: out.effects };
    }
    default:
      return assertNever(tool);
  }
}

/**
 * Esc goes back one stage: B, then A; with nothing placed it picks the Select tool. The snap is redone at the pointer,
 * so the stage it returns to draws without waiting for a move.
 */
export function dimensionEscape(state: EditorState, tool: DimensionToolState): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  const snap = (origin: Point | null) => (doc && state.pointer ? snapCursor(state, doc, origin) : null);
  switch (tool.kind) {
    case "idle":
      return switchTool(state, "select");
    case "second":
      return withDimension(state, { kind: "idle" }, snap(null));
    case "offset":
      return withDimension(state, { kind: "second", a: tool.a }, snap(tool.a));
    default:
      return assertNever(tool);
  }
}

/**
 * The tool's preview for the dimensions layer: the rubber band (offset 0) to the snapped cursor, then the dimension at
 * its offset. Nothing while the pointer is off the canvas.
 */
export function dimensionDraft(state: EditorState): DimensionDraft | null {
  const tool = state.tool;
  if (tool.name !== "dimension" || !state.pointer) return null;
  const t = tool.state;
  switch (t.kind) {
    case "idle":
      return null;
    case "second":
      return state.snap ? { a: t.a, b: state.snap.point, offset: 0 } : null;
    case "offset":
      return { a: t.a, b: t.b, offset: t.offset };
    default:
      return assertNever(t);
  }
}

/**
 * The raw pointer's signed distance from the line A→B (positive to its left), rounded to the snap step. Ctrl does not
 * skip the rounding.
 */
function offsetAt(state: EditorState, a: Point, b: Point): number {
  const p = state.pointer;
  return p ? roundTo(acrossLine(a, b, p.world), snapStep(state)) : 0;
}

/**
 * Its own list (dims.18): face corners, joint centres, face points and the grid; angle and perpendicular snaps from A on
 * the second click, as the Wall tool's; Shift's axis runs from A.
 */
export function snapCursor(state: EditorState, doc: Document, origin: Point | null): SnapResult {
  const p = state.pointer;
  if (!p) return { point: origin ?? { x: 0, y: 0 }, kind: "none" };
  const { tolerancePx } = state.snapSettings;
  const gridSpacing = snapStep(state);
  return snapPoint({ doc, cursor: p.world, camera: state.camera, mods: p.mods, origin, tolerancePx, gridSpacing, angles: true, policies: DIMENSION_POLICIES });
}

function withDimension(state: EditorState, tool: DimensionToolState, snap: SnapResult | null): EditorState {
  return { ...state, tool: { name: "dimension", state: tool }, snap };
}
