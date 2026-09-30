import { add, distance, execute, incidentWalls, sub, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { canCommit, visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { roundTo } from "../snapping/policies";
import { gridSpacingFor, orthogonalAxis, projectOnAxis, snapPoint } from "../snapping/snap";
import type { EditorState, Step } from "../state";
import { NO_MODS, type Mods, type SnapResult } from "../types";
import { helperHit } from "../view/helper";
import { helperKey } from "./helper-edit";
import { DRAG_THRESHOLD_PX, hitTest } from "./hit-test";
import { draggedJoints, type DragTarget, type MoveAttempt, type Moves, type SelectToolState } from "./types";

type Moving = Extract<SelectToolState, { kind: "moving" }>;

/** Spec §5.6 and §5.7: press selects, a drag previews on baseDoc, release commits once. */
export function selectPointer(state: EditorState, tool: SelectToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  switch (e.type) {
    case "pointerDown":
      return { state: press(state, pointer.world, host), effects: [] };
    case "pointerMove":
      return { state: move(state, tool, pointer.world, host), effects: [] };
    case "pointerUp":
      return release(state, tool, host);
    default:
      return assertNever(e.type);
  }
}

/** The helper-dimension value field while editing (spec §5.4 precedence 1). */
export function selectKey(state: EditorState, tool: SelectToolState, key: string, host: Host): Step | null {
  return tool.kind === "editingHelper" ? helperKey(state, tool, key, host) : null;
}

/** Esc: cancel a press, drag or helper edit; when idle, clear the selection. */
export function selectEscape(state: EditorState, tool: SelectToolState): EditorState {
  switch (tool.kind) {
    case "idle":
      return { ...state, selection: [] };
    case "pressing":
    case "moving":
    case "editingHelper":
      return withSelect({ ...state, snap: null }, { kind: "idle" });
    default:
      return assertNever(tool);
  }
}

function press(state: EditorState, world: Point, host: Host): EditorState {
  // The helper text first: on a vertical wall its box overlaps the wall's hit zone.
  const helper = helperHit(state, world, host);
  if (helper) return withSelect({ ...state, snap: null }, { kind: "editingHelper", wallId: helper, value: "" });
  const hit = hitTest(state, world, host);
  if (!hit) return withSelect({ ...state, selection: [] }, { kind: "idle" });
  const selection = hit.handle ? state.selection : [hit.ref]; // a handle keeps its wall selected
  return withSelect({ ...state, selection }, { kind: "pressing", pressWorld: world, target: dragTarget(hit.ref) });
}

function move(state: EditorState, tool: SelectToolState, world: Point, host: Host): EditorState {
  switch (tool.kind) {
    case "idle":
    case "editingHelper":
      return { ...state, hover: hitTest(state, world, host)?.ref ?? null };
    case "pressing": {
      if (!tool.target || !state.document || !canCommit(state.document)) return state; // no drag while edits are blocked
      // In world units at the current zoom: the cursor follows the camera (spec §5.4), so a scroll
      // under a still press starts the drag and a zoom at the cursor does not.
      if (distance(world, tool.pressWorld) * state.camera.zoom <= DRAG_THRESHOLD_PX) return state;
      const baseDoc = visibleDoc(state.document);
      const start: Moving = {
        kind: "moving",
        target: tool.target,
        pressWorld: tool.pressWorld,
        baseDoc,
        attempt: { ok: false, doc: baseDoc, cursor: world, moves: [] }, // replaced by the first attempt below, or the press ends
      };
      return attemptMove(state, start, world);
    }
    case "moving":
      return attemptMove(state, tool, world);
    default:
      return assertNever(tool);
  }
}

/** Commits the last attempt's moves, as previewed; the release point and mods play no part. */
function release(state: EditorState, tool: SelectToolState, host: Host): Step {
  switch (tool.kind) {
    case "idle":
    case "editingHelper":
      return { state, effects: [] };
    case "pressing":
      return { state: withSelect(state, { kind: "idle" }), effects: [] };
    case "moving": {
      const idle = withSelect({ ...state, snap: null }, { kind: "idle" });
      const { moves } = tool.attempt;
      if (moves.length === 0) return { state: idle, effects: [] }; // unreachable (see attemptMove); moveJoints would toast
      // A fresh execute on the visible document: an invalid (red) attempt is a toast and no commit.
      const out = runCommand(idle, { type: "moveJoints", moves }, host);
      return { state: out.state, effects: out.effects };
    }
    default:
      return assertNever(tool);
  }
}

/** Each pointer move re-runs the command on baseDoc (spec §5.7). */
function attemptMove(state: EditorState, tool: Moving, world: Point): EditorState {
  const { moves, snap } = dragMoves(state, tool, world);
  // The target is not in baseDoc: it vanished during the press (phase 7: a remote delete). Nothing to drag.
  if (moves.length === 0) return withSelect({ ...state, snap: null }, { kind: "idle" });
  const r = execute(tool.baseDoc, { type: "moveJoints", moves });
  const attempt: MoveAttempt = { ok: r.ok, doc: r.ok ? r.value.doc : tool.attempt.doc, cursor: world, moves };
  return withSelect({ ...state, snap }, { ...tool, attempt });
}

/** A joint snaps to the cursor, ignoring itself and its walls; a wall moves by a grid-rounded delta. */
function dragMoves(state: EditorState, tool: Moving, world: Point): { moves: Moves; snap: SnapResult | null } {
  const doc = tool.baseDoc;
  const mods = state.pointer?.mods ?? NO_MODS;
  switch (tool.target.kind) {
    case "joint": {
      const id = tool.target.jointId;
      const j = doc.joints[id];
      if (!j) return { moves: [], snap: null };
      const snap = snapPoint({
        doc,
        cursor: world,
        camera: state.camera,
        mods,
        origin: { x: j.x, y: j.y },
        tolerancePx: state.snapSettings.tolerancePx,
        excludeJoints: new Set([id]),
        excludeWalls: new Set(incidentWalls(doc, id)),
      });
      return { moves: [{ jointId: id, to: snap.point }], snap };
    }
    case "wall": {
      const delta = gridDelta(sub(world, tool.pressWorld), gridSpacingFor(state.camera.zoom), mods);
      const moves: Moves = [];
      for (const id of draggedJoints(doc, tool.target)) {
        const j = doc.joints[id];
        if (j) moves.push({ jointId: id, to: add(j, delta) });
      }
      return { moves, snap: null };
    }
    default:
      return assertNever(tool.target);
  }
}

function gridDelta(d: Point, spacing: number, mods: Mods): Point {
  const constrained = mods.shift ? projectOnAxis(orthogonalAxis({ x: 0, y: 0 }, d), d) : d; // the larger axis
  return mods.ctrl ? constrained : { x: roundTo(constrained.x, spacing), y: roundTo(constrained.y, spacing) };
}

function dragTarget(ref: EntityRef): DragTarget | null {
  switch (ref.table) {
    case "joints":
      return { kind: "joint", jointId: ref.id };
    case "walls":
      return { kind: "wall", wallId: ref.id };
    case "zoneLabels":
      return null; // zone selection does not move walls (spec §5.6)
    default:
      return assertNever(ref.table);
  }
}

/**
 * A remote change that does not touch the drag (§5.7): rerun it on the new visible document from the
 * same cursor. `attempt.doc` restarts at the new base, so an invalid rerun shows the current drawing.
 */
export function rerunMove(state: EditorState, tool: Moving): EditorState {
  if (!state.document) return state;
  const baseDoc = visibleDoc(state.document);
  return attemptMove(state, { ...tool, baseDoc, attempt: { ...tool.attempt, doc: baseDoc } }, tool.attempt.cursor);
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}
