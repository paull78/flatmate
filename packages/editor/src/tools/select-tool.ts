import { dragTarget } from "./drag-target";
import { distance, execute, sub, withSide, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { canCommit, visibleDoc } from "../document/open-document";
import { moveGhost, placeCopy } from "../duplicate";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { alignmentGuides } from "../snapping/guides";
import { activeStateId, pruneSelection, selectedPlacements, viewedLevel, viewedLevelOn, type EditorState, type Step } from "../state";
import { refuse, showToast } from "../toast";
import { noFloorAt } from "../toast-text";
import { helperHit } from "../view/helper";
import { holeGapHit } from "../view/hole-gaps";
import { boxSelection, placementsInBox } from "./box-select";
import { dragTry, splitTick } from "./drag";
import { blockedPlacements, stopsAtLimit, tryCommand, zeroMoveDependencies } from "./drag-commit";
import { guideTargets } from "../view/refused-overlay";
import { gapKey } from "./gap-edit";
import { helperKey } from "./helper-edit";
import { CANVAS_STYLE } from "../view/plan-style";
import { distanceToArrows } from "../view/section-marks-layer";
import { DRAG_THRESHOLD_PX, HIT_TOLERANCE_PX, hitTest, type Hit } from "./hit-test";
import { pressSelection } from "./press-selection";
import { splitCommand } from "./split-gesture";
import { typedDelta } from "./run-drag";
import { groupMembers, groupTarget, groupable, selectedWalls, wallGroup, wallsInBox } from "./wall-group";
import { cantRead, editedValue, readValue } from "../typed-value";
import type { DragTarget, MoveAttempt, SelectToolState } from "./types";

type Moving = Extract<SelectToolState, { kind: "moving" }>;

/** spec: tools: press selects, a drag previews on baseDoc, release commits once. */
export function selectPointer(state: EditorState, tool: SelectToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  switch (e.type) {
    case "pointerDown":
      // The duplicate's ghost places its copies on press (ghost.01), before press could start a box or reselect.
      if (tool.kind === "splitting") return splitPress(state, tool, pointer.world, host);
      return tool.kind === "copying" ? placeCopy(state, tool, host) : { state: press(state, pointer.world, pointer.mods.shift), effects: [] };
    case "pointerMove":
      return { state: move(state, tool, pointer.world), effects: [] };
    case "pointerUp": {
      // After a press, a drag or a box the handle under a still pointer is worked out again (furnish.10): the click
      // that selects a piece already shows its grip's cursor.
      const out = release(state, tool, pointer.world, host);
      const next = out.state.tool;
      const settled = (tool.kind === "pressing" || tool.kind === "moving" || tool.kind === "box") && next.name === "select" && next.state.kind === "idle";
      return settled ? { ...out, state: withHover(out.state, hitTest(out.state, pointer.world)) } : out;
    }
    default:
      return assertNever(e.type);
  }
}

/** The helper-dimension value field while editing (spec: tools precedence 1). */
export function selectKey(state: EditorState, tool: SelectToolState, key: string, host: Host): Step | null {
  if (tool.kind === "splitting") return splitKey(state, tool, key, host);
  if (tool.kind === "moving" && tool.target.kind === "walls") return movingKey(state, tool, key, host);
  if (tool.kind === "editingGap") return gapKey(state, tool, key, host);
  return tool.kind === "editingHelper" ? helperKey(state, tool, key, host) : null;
}

/** Esc: cancel a press, drag or helper edit; when idle, clear the selection. */
export function selectEscape(state: EditorState, tool: SelectToolState): EditorState {
  switch (tool.kind) {
    case "idle":
      return { ...state, selection: [], hoverHandle: null };
    case "splitting": // the value first, then the gesture (spec M2)
      return tool.value === "" ? withSelect({ ...state, snap: null }, { kind: "idle" }) : withSelect(state, { ...tool, value: "" });
    case "moving": // a typed distance first (straight.20), then the drag
      if (tool.value) return attemptMove(state, { ...tool, value: "" }, state.pointer?.world ?? tool.attempt.cursor);
      return withSelect({ ...state, snap: null, hoverHandle: null }, { kind: "idle" });
    case "pressing":
    case "box":
    case "editingHelper":
    case "editingGap":
    case "nudging": // nothing committed (direct.10)
    case "copying": // nothing committed; the originals stay selected (AC-07)
      return withSelect({ ...state, snap: null, hoverHandle: null }, { kind: "idle" });
    default:
      return assertNever(tool);
  }
}

function press(state: EditorState, world: Point, shift: boolean): EditorState {
  // The helper texts (the total, then the chain pieces) first: on a vertical wall their boxes overlap the wall's hit zone.
  const helper = helperHit(state, world);
  if (helper) {
    // A press on the plate being edited keeps the typed value (tidy C10b); another plate starts a new one.
    const t = state.tool.name === "select" ? state.tool.state : null;
    if (t?.kind === "editingHelper" && t.wallId === helper.wallId && t.piece === helper.piece) return state;
    return withSelect({ ...state, snap: null }, { kind: "editingHelper", ...helper, value: "" });
  }
  // A selected hole's gap plates (stairwell.36), likewise: a press on the one being edited keeps the typed value.
  const gap = holeGapHit(state, world);
  if (gap) {
    const t = state.tool.name === "select" ? state.tool.state : null;
    if (t?.kind === "editingGap" && t.holeId === gap.holeId && t.side === gap.side) return state;
    return withSelect({ ...state, snap: null }, { kind: "editingGap", ...gap, value: "" });
  }
  const hit = hitTest(state, world);
  // Empty canvas, a floor or a tag starts a box (direct.07); a room is selected on release, so a box from its floor
  // never leaves it selected. A plain press clears the selection at once, a Shift press keeps it to add to. A deck
  // not selected alone is pressed as floor: a click selects it, a drag boxes the pieces on it (decks.06).
  // A hole likewise (stairwell.19).
  const asFloor = (hit?.ref.table === "decks" || hit?.ref.table === "deckHoles" || hit?.ref.table === "areas") && hit.handle === null && (shift || !onlySelected(state, hit.ref)); // a named area too (areas.29)
  if (!hit || hit.ref.table === "zoneLabels" || asFloor) {
    const box: SelectToolState = { kind: "box", pressWorld: world, corner: null, additive: shift, click: hit?.ref ?? null };
    return withSelect(withHover({ ...state, selection: shift ? state.selection : [] }, hit), box);
  }
  // A zone chip of the selected piece (smart.24): the selection stays and nothing drags; its click toggles the side.
  if (hit.chip) return withSelect(withHover(state, hit), { kind: "pressing", pressWorld: world, target: null, clickSelection: null, chip: hit.chip });
  const flip = shift ? null : arrowPressed(state, hit, world);
  if (flip !== null) return withSelect(withHover(state, hit), { kind: "pressing", pressWorld: world, target: null, clickSelection: null, flip });
  const doc = state.document ? visibleDoc(state.document) : null;
  const wallHit = hit.handle === null && hit.ref.table === "walls" && groupable(doc, hit.ref);
  const { now, onClick } = pressSelection(state.selection, hit, shift, wallHit, groupMembers(doc, state.selection));
  // A press on a piece leaves it selected, so a group of two or more selected pieces holds it (direct.19).
  // A handle starts its own drag (a joint, a side grip, the rotation grip); otherwise the group or the thing pressed.
  const group = hit.handle === null && (hit.ref.table === "placements" || wallHit) ? selectedPlacements(state, now) : [];
  // A group with walls in it moves exactly its walls and pieces (straight.09); one wall alone drags its run (dragTarget).
  const walls = hit.handle === null && wallGroup(doc, now) ? selectedWalls(doc, now) : [];
  const target: DragTarget | null = hit.handle ?? (walls.length > 0 ? groupTarget(walls, group) : group.length > 1 ? { kind: "placements", placementIds: group } : doc && dragTarget(doc, hit.ref));
  return withSelect(withHover({ ...state, selection: now }, hit), { kind: "pressing", pressWorld: world, target, clickSelection: onClick });
}

function move(state: EditorState, tool: SelectToolState, world: Point): EditorState {
  switch (tool.kind) {
    case "idle":
    case "editingHelper":
    case "editingGap":
    case "nudging":
      return withHover(state, hitTest(state, world));
    case "splitting": {
      const doc = state.document ? visibleDoc(state.document) : null;
      const tick = doc ? splitTick(state, doc, tool.wallId, world) : null;
      return withSelect({ ...state, snap: tick?.snap ?? null, hover: null, hoverHandle: null }, { ...tool, tick });
    }
    case "pressing": {
      if (!tool.target || !state.document || !canCommit(state.document)) return state; // no drag while edits are blocked
      // In world units at the current zoom: the cursor follows the camera (spec: tools), so a scroll
      // under a still press starts the drag and a zoom at the cursor does not.
      if (distance(world, tool.pressWorld) * state.camera.zoom <= DRAG_THRESHOLD_PX) return state;
      const baseDoc = visibleDoc(state.document);
      const start: Moving = {
        kind: "moving",
        turn: 0,
        target: tool.target,
        pressWorld: tool.pressWorld,
        baseDoc,
        // replaced below, or the press ends; the zero move gives the dependencies until an attempt succeeds
        attempt: { ok: false, doc: baseDoc, cursor: world, tried: { kind: "none" }, blocked: [], dependencies: zeroMoveDependencies(baseDoc, tool.target), guides: [] },
      };
      return attemptMove(state, start, world);
    }
    case "moving":
      return attemptMove(state, tool, world);
    case "copying":
      return moveGhost(state, tool, world);
    case "box":
      // Not an edit, so no canCommit gate: a box works while an edit is in flight. The hover stays as it was.
      if (tool.corner === null && distance(world, tool.pressWorld) * state.camera.zoom <= DRAG_THRESHOLD_PX) return state;
      return withSelect(state, { ...tool, corner: world });
    default:
      return assertNever(tool);
  }
}

/** A click sets the press's click selection; a drag commits the last attempt's moves, as previewed, whatever the release point and mods. */
function release(state: EditorState, tool: SelectToolState, world: Point, host: Host): Step {
  switch (tool.kind) {
    case "idle":
    case "editingHelper":
    case "editingGap":
    case "nudging":
    case "splitting": // the press split, or was refused and keeps the gesture
    case "copying": // the press placed the copies, or was refused and keeps the ghost
      return { state, effects: [] };
    case "pressing": {
      const idle = withSelect(state, { kind: "idle" });
      // A click: the release is still within the threshold (a press blocked from dragging may travel far).
      const click = distance(world, tool.pressWorld) * state.camera.zoom <= DRAG_THRESHOLD_PX;
      const chip = click ? tool.chip : undefined;
      // A chip's click flips its side as the piece is now: a remote toggle during the press is not undone.
      const p = chip && state.document ? visibleDoc(state.document).placements[chip.placementId] : undefined;
      if (chip && p) return runCommand(idle, { type: "setZoneSides", placementId: p.id, sides: withSide(p.sides, chip.side, !p.sides[chip.side]) }, host);
      // An arrow's click flips the section as it is now, likewise.
      const flipped = click && tool.flip !== undefined && state.document ? visibleDoc(state.document).sections[tool.flip] : undefined;
      if (flipped) return runCommand(idle, { type: "setSection", sectionId: flipped.id, side: flipped.side === 1 ? -1 : 1 }, host);
      // pruned: a remote delete during the press may have removed a piece the click selection holds
      return { state: click && tool.clickSelection ? pruneSelection({ ...idle, selection: tool.clickSelection }) : idle, effects: [] };
    }
    case "moving": {
      const idle = withSelect({ ...state, snap: null }, { kind: "idle" });
      // No deck of the viewed level under the piece (levels.16): the editor's refusal, nothing sent.
      const level = viewedLevel(state);
      if (tool.attempt.tried.kind === "noFloor" && level) return refuse(idle, noFloorAt(level), host);
      const tried = tryCommand(tool.target, tool.attempt.tried);
      if (!tried) return { state: idle, effects: [] }; // unreachable (see attemptMove)
      const command = tried.type === "connectJoint" ? { ...tried, opId: host.newId() } : tried; // a fresh id for a split's fragment
      // A fresh execute on the visible document: an invalid (red) attempt is a toast and no commit.
      const out = runCommand(idle, command, host);
      return { state: out.state, effects: out.effects };
    }
    case "box": {
      const idle = withSelect(state, { kind: "idle" });
      // A click selects the room alone, with or without Shift (pruned: a remote delete may have removed it), and
      // clears the selection on empty canvas.
      if (tool.corner === null || !state.document) return { state: pruneSelection({ ...idle, selection: tool.click ? [tool.click] : [] }), effects: [] };
      // The current visible document: a remote change during the box needs nothing more.
      const doc = visibleDoc(state.document);
      const inside = placementsInBox(doc, activeStateId(state), viewedLevelOn(state, doc), tool.pressWorld, tool.corner);
      const walls = wallsInBox(doc, activeStateId(state), viewedLevelOn(state, doc), tool.pressWorld, tool.corner); // walls wholly inside (straight.09)
      return { state: { ...idle, selection: boxSelection(state.selection, inside, tool.additive, walls) }, effects: [] };
    }
    default:
      return assertNever(tool);
  }
}

/** R during a drag (AC-01): 90° more, shown at once at the pointer. Only a piece's and a group's drags read the turn. */
export function turnMoving(state: EditorState, tool: Moving): EditorState {
  return attemptMove(state, { ...tool, turn: (tool.turn + 90) % 360 }, state.pointer?.world ?? tool.attempt.cursor);
}

/** Each pointer move re-runs the command on baseDoc (spec: tools). */
function attemptMove(state: EditorState, tool: Moving, world: Point): EditorState {
  const dragged = dragTry(state, tool.baseDoc, tool.target, tool.pressWorld, world, tool.turn);
  // A distance typed during a walls drag replaces the pointer's, in its direction (straight.20): the preview is the commit.
  const metres = tool.target.kind === "walls" && tool.value ? readValue(tool.value, "metres") : null;
  const typed = tool.target.kind === "walls" && metres !== null && metres > 0 && dragged.tried.kind === "wallsMove" ? typedDelta(tool.target, sub(world, tool.pressWorld), metres) : null;
  const { tried, snap } = typed ? { tried: { kind: "wallsMove" as const, by: typed }, snap: null } : dragged;
  // Refused without running: red at the cursor, the last valid preview kept, as a refused attempt (levels.16).
  if (tried.kind === "noFloor") return withSelect({ ...state, snap }, { ...tool, attempt: { ok: false, doc: tool.attempt.doc, cursor: world, tried, blocked: [], dependencies: tool.attempt.dependencies, guides: [] } });
  const command = tryCommand(tool.target, tried);
  // The target is not in baseDoc: it vanished during the press (phase 7: a remote delete). Nothing to drag.
  if (!command) return withSelect({ ...state, snap: null }, { kind: "idle" });
  const r = execute(tool.baseDoc, command);
  // A column in a wall's line stops at its last valid place (spec "Moving and deleting a column"): a refusal after a
  // valid attempt that moved it keeps that attempt, cursor included, and its release commits it. A kept no-move (the
  // start, on a coarse snap step) would hide the refusal: it shows red and toasts instead (gate M2).
  const moved = tool.attempt.doc !== tool.baseDoc;
  if (!r.ok && tool.attempt.ok && moved && stopsAtLimit(tool.baseDoc, tool.target)) return withSelect({ ...state, snap }, tool);
  const blocked = r.ok ? [] : blockedPlacements(r.error, tool.target);
  const dependencies = r.ok ? r.value.patch.dependencies : tool.attempt.dependencies;
  // A refused attempt shows red and no guides; Ctrl turns guides off with the rest of snapping (AC-13).
  const level = viewedLevel(state);
  const guides = r.ok && level && !state.pointer?.mods.ctrl ? alignmentGuides(r.value.doc, guideTargets(tool.target), activeStateId(state), level) : [];
  const attempt: MoveAttempt = { ok: r.ok, doc: r.ok ? r.value.doc : tool.attempt.doc, cursor: world, tried, blocked, dependencies, guides, ...(r.ok ? {} : { refused: { error: r.error, cmd: command } }) };
  return withSelect({ ...state, snap }, { ...tool, attempt });
}

/** The section whose arrow this press is on (section.54), if it's already the selection: the first click on a mark selects. */
function arrowPressed(state: EditorState, hit: Hit, world: Point): string | null {
  if (hit.handle !== null || hit.ref.table !== "sections" || !onlySelected(state, hit.ref) || !state.document) return null;
  const row = visibleDoc(state.document).sections[hit.ref.id];
  const { zoom } = state.camera;
  return row && distanceToArrows(row, CANVAS_STYLE.mark, zoom, world) <= HIT_TOLERANCE_PX / zoom ? row.id : null;
}

function onlySelected(state: EditorState, ref: EntityRef): boolean {
  const [only, ...more] = state.selection;
  return more.length === 0 && only?.table === ref.table && only.id === ref.id;
}

/**
 * A remote change that does not touch the drag (spec: tools): rerun it on the new visible document from the
 * same cursor. `attempt.doc` restarts at the new base, not ok, so an invalid rerun shows the current drawing.
 */
export function rerunMove(state: EditorState, tool: Moving): EditorState {
  if (!state.document) return state;
  const baseDoc = visibleDoc(state.document);
  return attemptMove(state, { ...tool, baseDoc, attempt: { ...tool.attempt, ok: false, doc: baseDoc } }, tool.attempt.cursor);
}

/** The entity and the drawn handle under the pointer (furnish.10). */
function withHover(state: EditorState, hit: Hit | null): EditorState {
  return { ...state, hover: hit?.ref ?? null, hoverHandle: hit?.drawn ?? null };
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}

type Splitting = Extract<SelectToolState, { kind: "splitting" }>;

/** A press on the wall splits at the tick; off the wall it cancels the gesture and presses as usual. */
function splitPress(state: EditorState, tool: Splitting, world: Point, host: Host): Step {
  if (tool.tick === null) return { state: press(withSelect({ ...state, snap: null }, { kind: "idle" }), world, state.pointer?.mods.shift ?? false), effects: [] };
  return splitAt(state, tool, tool.tick.offset, host);
}

/** The value field while splitting: digits and units; Enter splits at the typed distance; a bad number keeps the gesture. */
function splitKey(state: EditorState, tool: Splitting, key: string, host: Host): Step | null {
  const value = editedValue(tool.value, key);
  if (value !== null) return { state: withSelect(state, { ...tool, value }), effects: [] };
  if (key !== "Enter") return null;
  if (tool.value === "") return tool.tick ? splitAt(state, tool, tool.tick.offset, host) : { state, effects: [] };
  const offset = readValue(tool.value, "metres");
  return offset === null ? showToast(state, cantRead(tool.value), host) : splitAt(state, { ...tool, value: "" }, offset, host);
}

/** Runs the split; on success the gesture ends and the wall stays selected; a refusal keeps it armed. */
function splitAt(state: EditorState, tool: Splitting, offset: number, host: Host): Step {
  const out = runCommand(withSelect(state, tool), splitCommand(host.newId(), tool.wallId, offset), host);
  const ok = out.state.toast === null || out.state.toast === state.toast;
  return ok ? { ...out, state: withSelect({ ...out.state, snap: null }, { kind: "idle" }) } : out;
}

/**
 * Keys during a walls drag (straight.20): a value key edits the typed distance and re-runs the preview; Enter commits
 * what the preview shows, as a release would; other single characters are swallowed, so a letter never picks a tool
 * mid-drag. Esc and the rest go on.
 */
function movingKey(state: EditorState, tool: Moving, key: string, host: Host): Step | null {
  const world = state.pointer?.world ?? tool.attempt.cursor;
  const value = editedValue(tool.value ?? "", key);
  if (value !== null) return { state: attemptMove(state, { ...tool, value }, world), effects: [] };
  if (key === "Enter") return release(state, tool, world, host);
  return key.length === 1 ? { state, effects: [] } : null;
}
