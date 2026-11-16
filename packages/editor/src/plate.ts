import { zoneReason } from "./tools/area-draft";
import { distance, execute } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import type { Effect } from "./ports/effects";
import type { Event } from "./ports/events";
import { viewedLevel, type EditorState, type Step } from "./state";
import { noFloorAt, reasonOf, refusalText } from "./toast-text";
import { visibleDoc } from "./document/open-document";
import { splitCommand } from "./tools/split-gesture";
import { PREVIEW_OP } from "./tools/types";
import { columnReason } from "./tools/column-tool";
import { deckReason } from "./tools/deck-tool";
import { holeReason } from "./tools/hole-tool";
import { ADVICE, ghostAdvice } from "./tools/ghost-advice";
import { reasonOfGhost } from "./tools/object-tool";
import { openingReason } from "./tools/opening-tool";
import type { SelectToolState } from "./tools/types";
import { wallReason } from "./tools/wall-tool";

const PLATE_CLEAR_PX = 24;
export const REST_MS = 150;
export const REST_TIMER = "rest";
const START_REST: Effect = { type: "startTimer", timerId: REST_TIMER, ms: REST_MS };

type Plate = NonNullable<EditorState["plate"]>;
type Reason = () => string | null;

/**
 * Whether this event ends the plate (clarity.02, .13). A release doesn't: it follows a refusing press at once. A zoom
 * doesn't either: its replayed moves stay inside the route (pointer.ts), so they never come here as `pointerMove`.
 * A real move ends a rest's plate at once, and a sticky one past 24 px.
 */
function endsPlate(plate: Plate, event: Event): boolean {
  if (event.type === "pointerMove") return !plate.sticky || distance(event.screen, plate.anchor) > PLATE_CLEAR_PX;
  return event.type === "pointerDown" || event.type === "pointerLeave" || event.type === "key" || event.type === "ui";
}

/** A refused press or release raises the sticky plate, except in a stair gesture, which keeps its hint line (clarity.03, .15). */
function raisePlate(state: EditorState, event: Event): EditorState {
  const text = state.refused;
  if (text === null) return state;
  const stair = state.tool.name === "object" && state.tool.state.stair !== null;
  const atPointer = (event.type === "pointerDown" || event.type === "pointerUp") && !stair;
  return { ...state, refused: null, plate: atPointer ? { text, anchor: event.screen, sticky: true } : state.plate };
}

/**
 * Runs one event's chain with the plate around it: only a refused press or release raises one, so a refusal from a key,
 * Properties or a command keeps to the bottom message (clarity.08). Tools just call `refuse`. A real move on a red spot
 * restarts the rest; a rest's plate goes once nothing is red, a pan under a still pointer included.
 */
export function withPlate(state: EditorState, event: Event, run: (state: EditorState) => Step): Step {
  const r = run(state.plate && endsPlate(state.plate, event) ? { ...state, plate: null } : state);
  const raised = raisePlate(r.state, event);
  const red = liveReason(raised) !== null;
  return {
    state: raised.plate?.sticky === false && !red ? { ...raised, plate: null } : raised,
    // A typed distance that turns a walls drag red rests like a move (straight.20): its key ended the plate above.
    effects: (event.type === "pointerMove" || (event.type === "key" && typedMove(raised))) && red ? [...r.effects, START_REST] : r.effects,
  };
}

/**
 * The one place that knows which gestures can be red. Its words are a thunk, so a move only asks whether: they take an
 * `execute` for a ghost, and are worked out only when the rest fires (clarity.07). Null with nothing red, or no pointer to sit by.
 */
export function liveReason(state: EditorState): Reason | null {
  if (state.pointer === null || state.panDrag !== null) return null; // a pan's moves don't reach the tool (pointer.ts)
  const tool = state.tool;
  switch (tool.name) {
    case "select": {
      const t = tool.state;
      if (t.kind === "splitting") return splitReason(state, t); // the tick inside a door: red after a rest
      return t.kind === "moving" || t.kind === "copying" ? dragReason(state, t) : null;
    }
    case "object": { // a caught stair edge keeps its hint line (clarity.03)
      const t = tool.state;
      return t.stair === null && t.ghost?.fits === false ? () => reasonOfGhost(state, t) : null;
    }
    case "wall": {
      const preview = tool.state.kind === "drawing" ? tool.state.preview : null;
      return preview?.ok === false ? () => wallReason(state, preview) : null;
    }
    case "opening": {
      const preview = tool.state.preview;
      return preview?.ok === false ? () => openingReason(state, preview) : null;
    }
    case "column": {
      const ghost = tool.state.ghost;
      return ghost?.ok === false ? () => columnReason(state, ghost) : null;
    }
    case "deck": {
      const t = tool.state;
      if (t.kind !== "pressing" || t.current === null || t.ok) return null;
      const { start, current } = t;
      return () => deckReason(state, start, current);
    }
    case "hole": {
      const t = tool.state;
      if (t.kind !== "pressing" || t.current === null || t.ok) return null;
      const { start, current } = t;
      return () => holeReason(state, start, current);
    }
    case "zone": { // a click is never red; an area being drawn is, where addArea refuses it (areas.06)
      const t = tool.state;
      if (t.kind !== "pressing" || t.current === null || t.ok) return null;
      const { start, current } = t;
      return () => zoneReason(state, start, current);
    }
    case "dimension":
    case "section": // refused on the press, with a plate of its own
    case "scale":
      return null;
    default:
      return assertNever(tool);
  }
}

/**
 * A red drag's or duplicate ghost's words, from the command its release or click would run, on the document it ran on
 * (the same opening subject). With nothing to try, a ghost's attempt still holds its last refusal: not this one's.
 */
function dragReason(state: EditorState, tool: Extract<SelectToolState, { kind: "moving" | "copying" }>): Reason | null {
  const { ok, tried, refused } = tool.attempt;
  if (ok || tried.kind === "none") return null;
  const level = viewedLevel(state);
  if (tried.kind === "noFloor") return level && (() => noFloorAt(level));
  return refused ? () => refusalText(refused.error, tool.baseDoc, refused.cmd) : null;
}

/**
 * The rest's timer: a late one finds nothing red, and a refused click's plate stays as it is (clarity.07). A red click
 * ghost's plate gains its advice, worked out only here, when the rest fires (sizing.09).
 */
export function onRestTimer(state: EditorState): Step {
  const text = state.plate?.sticky ? null : (liveReason(state)?.() ?? null);
  if (text === null || state.pointer === null) return { state, effects: [] };
  const advice = ghostAdvice(state);
  return { state: { ...state, plate: { text, anchor: state.pointer.screen, sticky: false, ...(advice === null ? {} : { advice: ADVICE[advice] }) } }, effects: [] };
}

/** What a split at the tick would be refused for, as a thunk; null with no tick or a split that would run. */
function splitReason(state: EditorState, t: Extract<SelectToolState, { kind: "splitting" }>): Reason | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  const tick = t.tick;
  if (!doc || !tick) return null;
  const cmd = splitCommand(PREVIEW_OP, t.wallId, tick.offset);
  return execute(doc, cmd).ok ? null : () => reasonOf(doc, cmd) ?? "";
}

/** Whether a walls drag has a typed distance. */
function typedMove(state: EditorState): boolean {
  const t = state.tool.name === "select" ? state.tool.state : null;
  return t?.kind === "moving" && Boolean(t.value);
}
