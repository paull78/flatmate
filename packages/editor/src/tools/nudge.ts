import { wallGroup } from "./wall-group";
import { columnOf, deckView, execute, holeView, placementCentre, roundMm, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { blockedMessage, runCommand } from "../commit";
import { canCommit, visibleDoc } from "../document/open-document";
import type { Event } from "../ports/events";
import type { Host } from "../ports/host";
import { selectedPlacements, type EditorState, type Step } from "../state";
import { showToast } from "../toast";
import type { Mods } from "../types";
import { blockedPlacements, tryCommand, zeroMoveDependencies } from "./drag-commit";
import type { DragTarget, DragTry, MoveAttempt, SelectToolState } from "./types";

// A nudge run (direct.09, direct.10, direct.19): arrow keys move the selected furniture, column, deck or hole 1 cm, Shift+arrow 10 cm,
// along the world axes. Each press previews at once on the document the run started from; the run commits as one
// command 400 ms after the last press. It reuses the drag targets (arch-review R-07).
//
//   ArrowRight ──► nudging(+1) ──► ArrowRight ──► nudging(+2) ──400 ms──► movePlacement(s) at +2 cm, one undo step
//                                     │
//         Esc, Cmd/Ctrl+Z, Undo/Redo ─┴─► idle, nothing committed     a click, a tool, a command ──► commit, then it

export const NUDGE_TIMER = "nudge";
const NUDGE_MS = 400;

type Nudging = Extract<SelectToolState, { kind: "nudging" }>;

const ZERO: Point = { x: 0, y: 0 };
const NOTHING: DragTry = { kind: "none" };
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

const none = (state: EditorState): Step => ({ state, effects: [] });

/** An arrow key in the Select tool: starts a run on the selected furniture, or steps the running one. */
export function nudgeKey(state: EditorState, key: string, shift: boolean, host: Host): Step {
  const dir = arrowDirection(key);
  const d = state.document;
  const tool = state.tool;
  if (!dir || !d || tool.name !== "select") return none(state);
  if (tool.state.kind === "idle" && wallGroup(visibleDoc(d), state.selection)) return showToast(state, "Arrow keys move furniture only", host); // straight.24
  const run = tool.state.kind === "nudging" ? tool.state : tool.state.kind === "idle" ? newRun(state) : null;
  if (!run) return none(state);
  // As a drag, no run starts while an edit is in flight (direct.19); unlike a drag's press, a key press says why.
  if (tool.state.kind === "idle" && !canCommit(d)) return showToast(state, blockedMessage(d), host);
  const size = shift ? 10 : 1;
  const next = tryOffset(run, { x: run.offset.x + dir.x * size, y: run.offset.y + dir.y * size });
  return { state: withRun(state, { ...next, until: host.now() + NUDGE_MS }), effects: [{ type: "startTimer", timerId: NUDGE_TIMER, ms: NUDGE_MS }] };
}

/** The deadline pattern (toast.ts): an early fire re-arms, a fire during an edit in flight waits for it (direct.19). */
export function onNudgeTimer(state: EditorState, host: Host): Step {
  const run = nudging(state);
  if (!run || !state.document) return none(state); // the run already ended
  const left = run.until - host.now();
  if (left > 0) return { state, effects: [{ type: "startTimer", timerId: NUDGE_TIMER, ms: left }] };
  if (!canCommit(state.document)) return { state, effects: [{ type: "startTimer", timerId: NUDGE_TIMER, ms: NUDGE_MS }] };
  return flushNudge(state, host);
}

/** Ends the run and commits its last valid offset, a red press included: unlike a drag, a refusal is not a toast. */
function flushNudge(state: EditorState, host: Host): Step {
  const run = nudging(state);
  if (!run) return none(state);
  const idle = cancelNudge(state);
  const moved = run.offset.x !== 0 || run.offset.y !== 0;
  const command = moved ? tryCommand(run.target, nudgeTry(run.baseDoc, run.target, run.offset)) : null;
  if (!command) return none(idle);
  const out = runCommand(idle, command, host);
  return { state: out.state, effects: out.effects };
}

/** Ends the run without committing; the selection stays. */
function cancelNudge(state: EditorState): EditorState {
  return nudging(state) ? { ...state, tool: { name: "select", state: { kind: "idle" } } } : state;
}

/**
 * A remote change that does not touch the run (spec: tools): rerun its last valid offset on the new visible document. When
 * that no longer fits, the run falls back to no move, with the refused place drawn red.
 */
export function rerunNudge(state: EditorState, run: Nudging): EditorState {
  if (!state.document) return state;
  const baseDoc = visibleDoc(state.document);
  const rerun = tryOffset({ ...run, baseDoc, attempt: { ...run.attempt, doc: baseDoc } }, run.offset);
  if (rerun.attempt.ok) return withRun(state, rerun);
  return withRun(state, { ...rerun, offset: ZERO, attempt: { ...rerun.attempt, dependencies: zeroMoveDependencies(baseDoc, run.target) } });
}

/**
 * The one gate in front of every event while a run is open (update.ts): it keeps the run, commits it before the
 * event is handled (`consumed` false), or cancels it and swallows the event (Cmd/Ctrl+Z, Undo, Redo).
 */
export function beforeEvent(state: EditorState, event: Event, host: Host): Step & { consumed: boolean } {
  if (!nudging(state)) return { state, effects: [], consumed: false };
  const action = gateAction(event);
  switch (action) {
    case "keep":
      return { state, effects: [], consumed: false };
    case "flush":
      return { ...flushNudge(state, host), consumed: false };
    case "cancel":
      return { state: cancelNudge(state), effects: [], consumed: true };
    default:
      return assertNever(action);
  }
}

function gateAction(event: Event): "keep" | "flush" | "cancel" {
  switch (event.type) {
    case "pointerMove":
    case "pointerUp":
    case "pointerLeave":
    case "pointAt":
    case "wheel":
    case "frame":
    case "viewportResized":
    case "saveResult":
    case "rasterised":
    case "timerFired":
    case "serverEvent": // remote notices reach the run through selectRemote and cancelGestures (gestures.ts)
    case "workspaceEvent":
      return "keep";
    case "pointerDown":
      return event.button === 1 ? "keep" : "flush"; // a middle-button press pans (pointer.ts); the hit test reads the committed run
    case "key":
      return keyAction(event.key, event.mods);
    case "ui":
      return event.action.type === "undo" || event.action.type === "redo" ? "cancel" : "flush";
    case "command":
      return "flush";
    default:
      return assertNever(event);
  }
}

/** The next press, Esc (selectEscape cancels) and a bare modifier (the shell sends the first Shift) keep the run. */
function keyAction(key: string, mods: Mods): "keep" | "flush" | "cancel" {
  const command = mods.meta || mods.ctrl;
  if (command && key.toLowerCase() === "z") return "cancel";
  if (key.startsWith("Arrow") && !command && !mods.alt) return "keep";
  return key === "Escape" || MODIFIER_KEYS.has(key) ? "keep" : "flush";
}

/**
 * A run on the selection when it is all furniture of the active layout (direct.09), one column (pillars.13), one hole
 * (stairwell.35) or one deck (stairwell.37); null otherwise.
 */
function newRun(state: EditorState): Nudging | null {
  if (!state.document) return null;
  const baseDoc = visibleDoc(state.document);
  const target = nudgeTarget(state, baseDoc);
  if (!target) return null;
  const [firstId] = selectedPlacements(state);
  const first = firstId === undefined ? undefined : baseDoc.placements[firstId];
  const centre = target.kind === "column" ? (columnOf(baseDoc, target.wallId)?.centre ?? null)
    : target.kind === "hole" ? (holeView(baseDoc, target.holeId)?.hole.at ?? null)
    : target.kind === "deck" ? (deckView(baseDoc, target.deckId)?.at ?? null)
    : first ? placementCentre(baseDoc, first) : null;
  if (!centre) return null;
  const attempt: MoveAttempt = { ok: true, doc: baseDoc, cursor: centre, tried: NOTHING, blocked: [], dependencies: zeroMoveDependencies(baseDoc, target), guides: [] };
  return { kind: "nudging", target, baseDoc, offset: ZERO, attempt, until: 0 };
}

/** What a run moves: the selected furniture, or the one selected column, hole or deck. */
function nudgeTarget(state: EditorState, doc: Document): DragTarget | null {
  const [only, ...more] = state.selection;
  if (only?.table === "walls" && more.length === 0) return doc.walls[only.id]?.column ? { kind: "column", wallId: only.id } : null;
  if (only?.table === "deckHoles" && more.length === 0) return { kind: "hole", holeId: only.id };
  if (only?.table === "decks" && more.length === 0) return { kind: "deck", deckId: only.id };
  const ids = selectedPlacements(state);
  const [first] = ids;
  if (!first || ids.length !== state.selection.length) return null;
  return ids.length > 1 ? { kind: "placements", placementIds: ids } : { kind: "placement", placementId: first };
}

/** Tries `offset` on the run's base: a valid one becomes the run's offset; a refused one keeps the last valid preview. */
function tryOffset(run: Nudging, offset: Point): Nudging {
  const tried = nudgeTry(run.baseDoc, run.target, offset);
  const command = tryCommand(run.target, tried);
  const r = command ? execute(run.baseDoc, command) : null;
  if (r?.ok) return { ...run, offset, attempt: { ...run.attempt, ok: true, doc: r.value.doc, tried, blocked: [], dependencies: r.value.patch.dependencies } };
  return { ...run, attempt: { ...run.attempt, ok: false, tried, blocked: r ? blockedPlacements(r.error, run.target) : [] } };
}

/** Every anchor moves by the offset, kept in whole cm until here so presses do not drift; nothing turns. */
function nudgeTry(doc: Document, target: DragTarget, offset: Point): DragTry {
  const moved = (at: Point): Point => ({ x: roundMm(at.x + offset.x / 100), y: roundMm(at.y + offset.y / 100) });
  switch (target.kind) {
    case "placement": {
      const p = doc.placements[target.placementId];
      return p ? { kind: "place", at: moved(p.at), rotation: p.rotation, deck: p.deck } : NOTHING; // a nudge keeps the surface (decks.11)
    }
    case "placements": {
      const places = target.placementIds.flatMap((id) => {
        const p = doc.placements[id];
        return p ? [{ placementId: id, at: moved(p.at), rotation: p.rotation }] : [];
      });
      return places.length === target.placementIds.length ? { kind: "places", places } : NOTHING;
    }
    case "column": {
      const column = columnOf(doc, target.wallId);
      return column ? { kind: "columnMove", at: moved(column.centre) } : NOTHING;
    }
    case "hole": {
      const hole = holeView(doc, target.holeId)?.hole;
      return hole ? { kind: "holeMove", at: moved(hole.at) } : NOTHING;
    }
    case "deck": {
      const deck = deckView(doc, target.deckId);
      return deck ? { kind: "deckMove", at: moved(deck.at) } : NOTHING; // carries its pieces and holes (decks.13, stairwell.34)
    }
    case "joint":
    case "walls":
    case "opening":
    case "resize":
    case "rotate":
    case "armGrip":
    case "dimension":
    case "zoneDepth":
    case "zoneEnd":
    case "deckSide":
    case "holeSide":
    case "area": // arrows leave named areas alone (areas.07)
    case "areaSide":
    case "sectionEnd":
    case "sectionFar":
      return NOTHING; // furniture, columns, holes and decks only (direct.09, pillars.13, stairwell.35, .37)
    default:
      return assertNever(target);
  }
}

/** World axes, y up: ArrowUp is +y. */
function arrowDirection(key: string): Point | null {
  switch (key) {
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: 1 };
    case "ArrowDown":
      return { x: 0, y: -1 };
    default:
      return null;
  }
}

function nudging(state: EditorState): Nudging | null {
  const tool = state.tool;
  return tool.name === "select" && tool.state.kind === "nudging" ? tool.state : null;
}

function withRun(state: EditorState, run: Nudging): EditorState {
  return { ...state, tool: { name: "select", state: run } };
}
