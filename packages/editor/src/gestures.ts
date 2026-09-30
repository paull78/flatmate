import { EPS, distance, incidentWalls, isValidId, type Document } from "@fm/domain";
import { assertNever, keyOf, uniqueKeys, type EntityKey, type Point, type TableName } from "@fm/protocol";
import { visibleDoc } from "./document/open-document";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";
import { showToast } from "./toast";
import { rerunMove } from "./tools/select-tool";
import { draggedJoints, idleTool, type SelectToolState, type WallToolState } from "./tools/types";
import { drawingAt } from "./tools/wall-tool";

// How tools react to document notices: pause and resume (§5.5), remote changes (§5.7), snapshots and disconnects.

export const CHAIN_ENDED = "Drawing changed remotely — wall chain ended";
export const GESTURE_CANCELLED = "Drawing changed remotely";
export const CONNECTION_LOST = "Connection lost: editing resumes when it returns";

type Drawing = Extract<WallToolState, { kind: "drawing" }>;
type Moving = Extract<SelectToolState, { kind: "moving" }>;
type Touches = (deps: EntityKey[]) => boolean;

const none = (state: EditorState): Step => ({ state, effects: [] });
const key = (table: TableName, id: string): EntityKey => ({ table, id });

/** `accepted` for the paused segment: the resume rule (§5.5). */
export function resumeChain(state: EditorState, id: string, host: Host): Step {
  const tool = state.tool;
  if (tool.name !== "wall" || tool.state.kind !== "paused" || tool.state.segment !== id || !state.document) return none(state);
  const { origin, chainStart } = tool.state;
  // 1. Check the anchor: the joint the segment created or reused must still be at the origin.
  if (!jointNear(visibleDoc(state.document), origin)) return endChain(state, host);
  // 2. Recompute the preview from the visible document at the current cursor; an invalid one is drawn red.
  return none(drawingAt(state, origin, chainStart));
}

/** `rejected` for the paused segment ends the chain; the rejection toast explains why. */
export function endChainOnRejection(state: EditorState, id: string): EditorState {
  const tool = state.tool;
  return tool.name === "wall" && tool.state.kind === "paused" && tool.state.segment === id ? idle(state) : state;
}

/**
 * A remote change (§5.7): a topology change cancels every active geometry gesture; any other change cancels
 * only a gesture whose dependencies it writes. A gesture it does not touch reruns on the new document.
 */
export function onRemoteChange(state: EditorState, writes: EntityKey[], topology: boolean, host: Host): Step {
  if (!state.document) return none(state);
  const doc = visibleDoc(state.document);
  const written = new Set(writes.map(keyOf));
  const touches: Touches = (deps) => topology || deps.some((k) => written.has(keyOf(k)));
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallRemote(state, tool.state, doc, topology, touches, host);
    case "select":
      return selectRemote(state, tool.state, doc, touches, host);
    case "zone":
      return none(state);
    default:
      return assertNever(tool);
  }
}

/** A snapshot or a lost connection cancels every active gesture, helper edits included (§5.7, P8). */
export function cancelGestures(state: EditorState, cause: "snapshot" | "offline", host: Host): Step {
  const tool = state.tool;
  const chain = tool.name === "wall" && tool.state.kind !== "idle";
  const gesture = tool.name === "select" && (tool.state.kind === "moving" || tool.state.kind === "editingHelper");
  if (!chain && !gesture) return none(state);
  const text = cause === "offline" ? CONNECTION_LOST : chain ? CHAIN_ENDED : GESTURE_CANCELLED;
  return showToast(idle(state), text, host);
}

function wallRemote(state: EditorState, t: WallToolState, doc: Document, topology: boolean, touches: Touches, host: Host): Step {
  switch (t.kind) {
    case "idle":
      return none(state);
    case "drawing":
      // The chain depends on its origin joint; once a wall was placed, a joint must still be at the origin.
      return topology || anchorLost(doc, t) ? endChain(state, host) : none(refreshDrawing(state, t));
    case "paused":
      // It depends on what its pending segment writes and reads: that segment's history entry.
      return touches(segmentDependencies(state, t.segment)) ? endChain(state, host) : none(state);
    default:
      return assertNever(t);
  }
}

function selectRemote(state: EditorState, t: SelectToolState, doc: Document, touches: Touches, host: Host): Step {
  switch (t.kind) {
    case "idle":
    case "pressing": // a press whose target vanished ends on the next move (select-tool)
      return none(state);
    case "moving":
      return touches(moveDependencies(t)) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(rerunMove(state, t));
    case "editingHelper":
      return touches(helperDependencies(doc, t.wallId)) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(state);
    default:
      return assertNever(t);
  }
}

function endChain(state: EditorState, host: Host): Step {
  return showToast(idle(state), CHAIN_ENDED, host);
}

function idle(state: EditorState): EditorState {
  return { ...state, tool: idleTool(state.tool.name), snap: null };
}

/** Recompute the preview as on a pointer move, keeping a half-typed length and a drag in progress. */
function refreshDrawing(state: EditorState, t: Drawing): EditorState {
  const next = drawingAt(state, t.origin, t.chainStart);
  const tool = next.tool;
  if (tool.name !== "wall" || tool.state.kind !== "drawing") return next;
  return { ...next, tool: { name: "wall", state: { ...tool.state, value: t.value, dragFrom: t.dragFrom } } };
}

function anchorLost(doc: Document, t: Drawing): boolean {
  return distance(t.origin, t.chainStart) >= EPS && !jointNear(doc, t.origin);
}

function jointNear(doc: Document, p: Point): boolean {
  return Object.values(doc.joints).some((j) => distance(j, p) < EPS);
}

function segmentDependencies(state: EditorState, id: string): EntityKey[] {
  return state.undo.past.find((e) => e.id === id)?.dependencies ?? [];
}

/** The moved joints and their incident walls, as in the command's dependencies (§4.1). */
function moveDependencies(t: Moving): EntityKey[] {
  const joints = draggedJoints(t.baseDoc, t.target);
  const walls = joints.flatMap((id) => incidentWalls(t.baseDoc, id));
  return uniqueKeys([...joints.map((id) => key("joints", id)), ...walls.map((id) => key("walls", id))]);
}

/** A resize keeps endpoint a: the wall, both endpoints and the walls at the moving end (§4.1, §5.6). */
function helperDependencies(doc: Document, wallId: string): EntityKey[] {
  const w = isValidId(wallId) ? doc.walls[wallId] : undefined;
  if (!w) return [key("walls", wallId)];
  const moving = incidentWalls(doc, w.b).map((id) => key("walls", id));
  return uniqueKeys([key("walls", wallId), key("joints", w.a), key("joints", w.b), ...moving]);
}
