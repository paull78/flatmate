import { deckViews, holeView, isFloor, levels, type EntityRef, type Level } from "@fm/domain";
import { visibleDoc } from "./document/open-document";
import { dropGesture } from "./gestures";
import { activeStateId, pruneSelection, switchTool, viewedLevel, viewedLevelOn, type EditorState } from "./state";
import { rebuildObjectGhost } from "./tools/object-tool";
import { selectableAt } from "./tools/selectable";
import { floorOnlyNow, toolEntry } from "./tools/tool-table";
import { targetRefs } from "./tools/targets";
import type { ToolName } from "./types";
import { viewAt, type PlanView } from "./view/plan-view";

// This viewer's level (levels.09, .10): picked in the strip or stepped with Page Up and Page Down. Never an edit.

/** The view the canvas draws: the active layout of the visible document, at the viewed level. Null with no document. */
export function planView(state: EditorState): PlanView | null {
  const level = viewedLevel(state);
  return level ? viewAt(activeStateId(state), level) : null;
}

/** Whether a level is above the floor; no level (no document) is not. */
const upper = (level: Level | null): boolean => level !== null && !isFloor(level);

/**
 * Views the level of `deck`, or the floor for null, and prunes the selection. A move to another height drops the
 * gesture in progress (levels.40); viewing the same level again keeps it. Above the floor a floor-only tool drops to
 * Select, so build at the floor (levels.07) holds when the view moves up with that tool already active.
 */
export function viewLevel(state: EditorState, deck: string | null): EditorState {
  const viewed: EditorState = { ...state, viewedDeck: deck };
  const level = viewedLevel(viewed);
  const moved = (level?.height ?? 0) !== (viewedLevel(state)?.height ?? 0) ? dropGesture(viewed) : viewed;
  return pruneSelection(upper(level) && floorOnlyNow(state.tool) ? switchTool(moved, "select") : moved);
}

/** A hole's row in Properties (riser.20): the hole selected, here if this level can select it, else at the floor (smalls.12). */
export function selectHole(state: EditorState, id: string): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc || !holeView(doc, id)) return state;
  const ref = { table: "deckHoles" as const, id };
  const here = selectableAt(doc, activeStateId(state), ref, viewedLevelOn(state, doc)) ? state : viewLevel(state, null);
  return { ...switchTool(here, "select"), selection: [ref], hover: null };
}

/**
 * After every event (update.ts): a viewed deck that resolves to the floor is forgotten, so the view stays at the floor
 * when that deck is a level again (raised back, or re-added by a collaborator's undo; levels.31). A Select press whose
 * target the viewed level can no longer select (its deck raised or lowered off the level) ends, so it never becomes a
 * drag there (levels.46). When the viewed height changed, a gesture started at the old height is dropped (levels.40):
 * always on a fallback to the floor (deleted, lowered, a raised ceiling), and when the view follows its raised deck
 * only if the gesture's selection is no longer all at the viewed level (a piece on another deck of the old level); a
 * box or a gesture on the followed deck goes on, and the Object tool's ghost is landed again at the new height. Every
 * document change has already pruned the selection (commit.ts, notices.ts).
 */
export function settleLevel(before: EditorState, after: EditorState): EditorState {
  const level = viewedLevel(after);
  const forgotten: EditorState = after.viewedDeck !== null && !upper(level) ? { ...after, viewedDeck: null } : after;
  const settled = level && pressOffLevel(forgotten, level) ? dropGesture(forgotten) : forgotten;
  if ((level?.height ?? 0) === (viewedLevel(before)?.height ?? 0)) return settled;
  const left = pruneSelection({ ...settled, selection: before.selection }).selection.length < before.selection.length;
  if (!upper(level) || left) return dropGesture(settled);
  const tool = settled.tool;
  return tool.name === "object" && tool.state.ghost !== null ? rebuildObjectGhost(settled, tool.state) : settled;
}

/** Whether the Select tool holds a press on something `level` can't select: a drag target or a zone chip's piece. */
function pressOffLevel(state: EditorState, level: Level): boolean {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "pressing" || !state.document) return false;
  const doc = visibleDoc(state.document);
  const layout = activeStateId(state);
  const chip = tool.state.chip;
  const pressed: EntityRef[] = chip ? [{ table: "placements", id: chip.placementId }] : [];
  const refs = [...(tool.state.target ? targetRefs(tool.state.target) : []), ...pressed];
  return refs.some((ref) => !selectableAt(doc, layout, ref, level));
}

/** Page Up and Page Down: the next level up or down by height, through its lowest deck ID; nothing past the ends. */
export function stepLevel(state: EditorState, direction: 1 | -1): EditorState {
  const current = viewedLevel(state);
  if (!state.document || !current) return state;
  const all = levels(visibleDoc(state.document));
  const next = all[all.findIndex((l) => l.height === current.height) + direction];
  return next ? viewLevel(state, next.deckIds[0] ?? null) : state;
}

/**
 * Picking a tool by key or button (levels.07): a floor-only tool (Wall, Zone, Opening, Dimension, Deck, Scale) views
 * the floor and starts; Select and Object stay at the viewed level. With no viewed deck this is `switchTool`.
 */
export function pickTool(state: EditorState, name: ToolName): EditorState {
  // With no deck in the drawing the Hole tool has nothing to cut (smalls.12).
  if (name === "hole" && (!state.document || deckViews(visibleDoc(state.document)).length === 0)) return state;
  const switched = name === "section" ? { ...switchTool(state, name), sectionMarksOn: true } : switchTool(state, name); // the others are what a new section is drawn against
  return toolEntry(name).floorOnly && state.viewedDeck !== null ? viewLevel(switched, null) : switched;
}
