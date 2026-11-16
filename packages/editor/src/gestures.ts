import { splitDependencies } from "./tools/split-gesture";
import { EPS, UNDERLAY_ID, distance, incidentWalls, isValidId, type Document } from "@fm/domain";
import { assertNever, keyOf, uniqueKeys, type EntityKey, type Point, type TableName } from "@fm/protocol";
import { visibleDoc } from "./document/open-document";
import { rerunCopy } from "./duplicate";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";
import { showToast } from "./toast";
import { dropColumnGhost } from "./tools/column-tool";
import { gapDependencies } from "./tools/gap-edit";
import { rerunNudge } from "./tools/nudge";
import { rerunMove } from "./tools/select-tool";
import { idleTool, zoneIdle, type SelectToolState, type WallToolState } from "./tools/types";
import { drawingAt } from "./tools/wall-tool";

// How tools react to document notices: pause and resume (spec: wall-editing), remote changes (spec: tools), snapshots and disconnects.

export const CHAIN_ENDED = "Drawing changed remotely — wall chain ended";
export const GESTURE_CANCELLED = "Drawing changed remotely";
export const CONNECTION_LOST = "Connection lost: editing resumes when it returns";

type Drawing = Extract<WallToolState, { kind: "drawing" }>;
type Touches = (deps: EntityKey[]) => boolean;

const none = (state: EditorState): Step => ({ state, effects: [] });
const key = (table: TableName, id: string): EntityKey => ({ table, id });

/** `accepted` for the paused segment: the resume rule (spec: wall-editing). */
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
 * Any own rejection drops a half-done scale: rolling back a pending import or undo can bring back another picture,
 * and rejections send no remoteChange, so the row-write check in onRemoteChange never sees it. The toast says why.
 */
export function endScaleOnRejection(state: EditorState): EditorState {
  const tool = state.tool;
  return tool.name === "scale" && tool.state.kind !== "idle" ? idle(state) : state;
}

/**
 * Any own rejection drops a chain piece being typed: the rollback can bring back an opening and renumber the pieces
 * (tidy C5), and rejections send no remoteChange. The rejection toast says why.
 */
export function endPieceEditOnRejection(state: EditorState): EditorState {
  const tool = state.tool;
  return tool.name === "select" && tool.state.kind === "editingHelper" && tool.state.piece !== undefined ? idle(state) : state;
}

/**
 * A remote change (spec: tools): a topology change cancels every active geometry gesture; any other change cancels
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
      return selectRemote(state, tool.state, doc, touches, openingDeleted(doc, writes), host);
    case "zone":
    case "object":
    case "opening": // its preview is redrawn on the next pointer move
    case "dimension": // A and B are points until the commit anchors them (spec §Placing)
    case "section": // A and B are points, and the letter is taken at the commit
    case "deck": // its preview is redone on the next pointer move, its corners snapped then
    case "hole":
    case "column": // its ghost is redone on the next pointer move
      return none(state);
    case "scale": {
      // A and B lie in the picture's current frame, and expectations taken at commit time would already include the
      // remote edit, so the server can't catch a stale frame: a write to the row cancels. Topology alone does not.
      const reframed = writes.some((k) => k.table === "underlays" && k.id === UNDERLAY_ID);
      return tool.state.kind !== "idle" && reframed ? showToast(idle(state), GESTURE_CANCELLED, host) : none(state);
    }
    default:
      return assertNever(tool);
  }
}

/** A snapshot or a lost connection cancels every active gesture, helper edits included (spec: tools, P8). */
export function cancelGestures(state: EditorState, cause: "snapshot" | "offline", host: Host): Step {
  const tool = state.tool;
  const chain = tool.name === "wall" && tool.state.kind !== "idle";
  // A box still within the drag threshold is a click, like "pressing": it survives and its release still selects.
  const box = tool.name === "select" && tool.state.kind === "box" && tool.state.corner !== null;
  const kind = tool.name === "select" ? tool.state.kind : null;
  const dimension = tool.name === "dimension" && tool.state.kind !== "idle"; // a half-placed dimension
  const scale = tool.name === "scale" && tool.state.kind !== "idle"; // a half-done scale, as a half-placed dimension
  const section = tool.name === "section" && tool.state.kind !== "idle"; // a half-made section, the same
  const gesture = box || dimension || scale || section || kind === "moving" || kind === "nudging" || kind === "copying" || kind === "editingHelper" || kind === "editingGap" || kind === "splitting";
  if (!chain && !gesture) return none(state);
  const text = cause === "offline" ? CONNECTION_LOST : chain ? CHAIN_ENDED : GESTURE_CANCELLED;
  return showToast(idle(state), text, host);
}

/**
 * The viewed level's height changed (levels.40, levels.ts): the gesture in progress is dropped, since it was started
 * at the other level; the tool, its settings and the selection stay (the caller prunes). No toast: the view moved.
 */
export function dropGesture(state: EditorState): EditorState {
  const tool = state.tool;
  switch (tool.name) {
    case "object": // the ghost and the press were landed at the other level; the next move rebuilds the ghost
      if (tool.state.ghost === null && tool.state.pressing === null && tool.state.stair === null && tool.state.offer === null) return state;
      return { ...state, tool: { name: "object", state: { ...tool.state, ghost: null, pressing: null, stair: null, preview: null, offer: null } }, snap: null };
    case "select":
    case "wall":
    case "dimension":
    case "deck":
    case "hole":
    case "section":
    case "scale":
      return tool.state.kind === "idle" ? state : idle(state);
    case "column": // the ghost was placed at the other level
      return dropColumnGhost(state, tool.state);
    case "zone": // a press drawing an area drops; otherwise a hovered face only
      return tool.state.kind === "idle" ? state : { ...state, tool: zoneIdle(tool.state.motif) };
    case "opening":
      return tool.state.preview === null ? state : idle(state);
    default:
      return assertNever(tool);
  }
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

function selectRemote(state: EditorState, t: SelectToolState, doc: Document, touches: Touches, deleted: boolean, host: Host): Step {
  switch (t.kind) {
    case "idle":
    case "pressing": // a press whose target vanished ends on the next move (select-tool)
    case "box": // it reads the document only at release
      return none(state);
    case "moving":
      return touches(t.attempt.dependencies) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(rerunMove(state, t));
    case "nudging": // as a drag; a vanished piece is a write to its own key
      return touches(t.attempt.dependencies) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(rerunNudge(state, t));
    case "copying": // as a drag: a change to an original cancels, any other reruns the ghost
      return touches(t.attempt.dependencies) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(rerunCopy(state, t));
    case "editingHelper": {
      // A deleted opening renumbers the pieces of its wall, and it is gone from doc, so its key can't be a dependency:
      // any opening delete cancels a piece edit, on whichever wall (tidy C5).
      const cancel = touches(helperDependencies(doc, t.wallId, t.piece)) || (t.piece !== undefined && deleted);
      return cancel ? showToast(idle(state), GESTURE_CANCELLED, host) : none(state);
    }
    case "editingGap": // a change to its hole or deck cancels it
      return touches(gapDependencies(state, t.holeId)) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(state);
    case "splitting": // a change to the wall, its joints, neighbours or openings, or any opening deleted, cancels it
      return touches(splitDependencies(doc, t.wallId)) || deleted ? showToast(idle(state), GESTURE_CANCELLED, host) : none(state);
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

/** The change deleted an opening: a written opening key that the document no longer holds. */
function openingDeleted(doc: Document, writes: EntityKey[]): boolean {
  return writes.some((k) => k.table === "openings" && !(isValidId(k.id) && doc.openings[k.id]));
}

/**
 * A resize keeps endpoint a: the wall, both endpoints and the walls at the moving end (spec: collaboration, tools). A chain piece is
 * an index into the wall's chain, so it also depends on the openings now on the wall (ux-polish item 4): one added or
 * moved there renumbers the pieces. A deleted one is caught by `openingDeleted` instead (tidy C5).
 */
function helperDependencies(doc: Document, wallId: string, piece: number | undefined): EntityKey[] {
  const w = isValidId(wallId) ? doc.walls[wallId] : undefined;
  if (!w) return [key("walls", wallId)];
  const moving = incidentWalls(doc, w.b).map((id) => key("walls", id));
  const openings = piece === undefined ? [] : Object.values(doc.openings).filter((o) => o.wall === wallId).map((o) => key("openings", o.id));
  return uniqueKeys([key("walls", wallId), key("joints", w.a), key("joints", w.b), ...moving, ...openings]);
}
