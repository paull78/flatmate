import { SIZE_LIMITS, execute, inSizeRange, sizeRange, wallBodies, type Command, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { roundTo } from "../snapping/policies";
import { snapStep } from "../snapping/snap";
import { switchTool, viewedLevelOn, type EditorState, type Step } from "../state";
import { showToast } from "../toast";
import { reasonOf } from "../toast-text";
import type { ColumnSize } from "../types";
import { columnRefs } from "./column-refs";
import { PREVIEW_OP, type ColumnGhost, type ColumnToolState } from "./types";
import { cantRead, readValue } from "../typed-value";

/**
 * The Column tool (spec "The Column tool", pillars.12, .19): a ghost of the column centred on the pointer, on the snap
 * step (Ctrl: the centimetre), follows it; a click (the release) runs `placeColumn` there with the tool's size and
 * selects the new column; the tool stays. Only a release after a press in the tool places (a stray release, found
 * hands-on at the M1 gate, placed a column mid-move). The ghost is the same command run on the visible document, red where it
 * refuses; a refused click toasts the domain's reason. Its base and top come from the viewed level and the decks over
 * the point (columnRefs); over a wall with that base the domain puts it in the wall's line.
 */
export function columnPointer(state: EditorState, tool: ColumnToolState, e: PointerInput, host: Host): Step {
  const world = state.pointer?.world ?? null;
  if (world === null || !state.document) return { state, effects: [] };
  const at = columnCentre(state, world, e.mods.ctrl);
  switch (e.type) {
    case "pointerDown":
      return { state: withGhost(state, { kind: "pressed", ghost: ghostOf(state, visibleDoc(state.document), at) }), effects: [] };
    case "pointerMove":
      return { state: withGhost(state, { ...tool, ghost: ghostOf(state, visibleDoc(state.document), at) }), effects: [] };
    case "pointerUp": {
      if (tool.kind !== "pressed") return { state: withGhost(state, { ...tool, ghost: ghostOf(state, visibleDoc(state.document), at) }), effects: [] };
      const opId = host.newId();
      const out = runCommand(state, placeCommand(state, visibleDoc(state.document), at, opId), host);
      const after = out.state.document ? visibleDoc(out.state.document) : null;
      const row: EntityRef = { table: "walls", id: `${opId}/w0` };
      const next = after?.walls[row.id]?.column === true ? { ...out.state, selection: [row] } : out.state;
      return { state: withGhost(next, { kind: "idle", ghost: after ? ghostOf(next, after, at) : null }), effects: out.effects };
    }
    default:
      return assertNever(e.type);
  }
}

/** Esc picks the Select tool. */
export function columnEscape(state: EditorState): EditorState {
  return switchTool(state, "select");
}

/** The tool without its ghost: the pointer left the canvas, or the view moved to another level. */
export function dropColumnGhost(state: EditorState, tool: ColumnToolState): EditorState {
  return tool.ghost === null ? state : withGhost(state, { ...tool, ghost: null });
}

/**
 * The floating bar's size (a preset sends both sides, a typed field one): a value that is not a number, or outside
 * the column limits, keeps the size and toasts.
 */
export function setColumnSize(state: EditorState, width: string | undefined, depth: string | undefined, host: Host): Step {
  const nextWidth = width === undefined ? state.columnSize.width : readValue(width, "metres");
  const nextDepth = depth === undefined ? state.columnSize.depth : readValue(depth, "metres");
  if (nextWidth === null || nextDepth === null) return showToast(state, cantRead((nextWidth === null ? width : depth) ?? ""), host);
  const next: ColumnSize = { width: nextWidth, depth: nextDepth };
  const fits = inSizeRange(next.width, SIZE_LIMITS.column.width) && inSizeRange(next.depth, SIZE_LIMITS.column.depth);
  if (!fits) return showToast(state, `Column width and depth are ${sizeRange(SIZE_LIMITS.column.width)} m`, host);
  return { state: { ...state, columnSize: next }, effects: [] };
}

/** The ghost at `at`: the body `placeColumn` builds on `doc`, or the free rectangle, red, where it refuses. */
function ghostOf(state: EditorState, doc: Document, at: Point): ColumnGhost {
  const r = execute(doc, placeCommand(state, doc, at, PREVIEW_OP));
  const body = r.ok ? wallBodies(r.value.doc).get(`${PREVIEW_OP}/w0`) : undefined;
  if (body) return { at, ring: body, ok: true };
  const { width, depth } = state.columnSize;
  const [x0, x1, y0, y1] = [at.x - width / 2, at.x + width / 2, at.y - depth / 2, at.y + depth / 2];
  return { at, ring: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], ok: false };
}

/** Why a red ghost is refused (clarity.03). A ghost keeps no error: worked out only when the rest fires. */
export function columnReason(state: EditorState, ghost: ColumnGhost): string | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  return doc && reasonOf(doc, placeCommand(state, doc, ghost.at, PREVIEW_OP));
}

/** `placeColumn` at `at` on `doc`, with the base and top the viewed level gives there (columnRefs). */
function placeCommand(state: EditorState, doc: Document, at: Point, opId: string): Command {
  const refs = columnRefs(doc, viewedLevelOn(state, doc), at);
  return { type: "placeColumn", opId, at, width: state.columnSize.width, depth: state.columnSize.depth, ...refs };
}

/** The pointer on the snap step, or to the centimetre with Ctrl. */
function columnCentre(state: EditorState, world: Point, ctrl: boolean): Point {
  const step = ctrl ? 0.01 : snapStep(state);
  return { x: roundTo(world.x, step), y: roundTo(world.y, step) };
}

function withGhost(state: EditorState, tool: ColumnToolState): EditorState {
  return { ...state, tool: { name: "column", state: tool } };
}
