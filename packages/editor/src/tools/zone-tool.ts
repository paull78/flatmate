import { faceAt, firstLabelId, isFloor, levelDeckAt, motifDefaults, nextRoomName, type Document, type EntityRef, type Finish, type MotifId } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { activeStateId, switchTool, viewedLevelOn, type EditorState, type Step } from "../state";
import { refuse } from "../toast";
import { noFloorAt } from "../toast-text";
import { tagAt, zoneOfLabel } from "../view/tags";
import { labelAtFloor } from "./hit-test";
import { addedArea, areaCorner, drawnArea, drawsArea } from "./area-draft";
import { areaAt } from "./area-hit";
import { areaTagAt } from "../view/area-tags";
import { pressPointer } from "./deck-tool";
import type { ZoneToolState } from "./types";

/**
 * spec: walls-rooms, tools: hovering highlights a room; a click selects its zone, labelling an unlabelled room first. A drag of
 * at least 0.30 m both ways draws a named area instead (areas.06, .15), through the Deck tool's press. In the Floor mode
 * (finishes.19) a press lays the armed motif in the room first, and drags draw nothing.
 */
export function zonePointer(state: EditorState, tool: ZoneToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  const doc = visibleDoc(state.document);
  if (tool.motif !== null) {
    if (e.type === "pointerDown") return layMotif(state, doc, pointer.world, tool.motif, host);
    return e.type === "pointerMove" ? hovered(state, doc, tool, pointer.world) : { state, effects: [] };
  }
  const base = { hoverFaceKey: tool.hoverFaceKey, hoverDeck: tool.hoverDeck, motif: tool.motif };
  const step = pressPointer(state, tool, e, host, {
    wrap: (s, press) => withZone(s, { ...press, ...base }),
    drawn: (_doc, a, b, opId) => drawnArea(a, b, opId),
    clicked: () => null, // never: `click` takes every press under the size
    mark: () => null,
    draws: drawsArea,
    click: (s, pressWorld, h) => clickZone(s, doc, pressWorld, h),
    corner: (d, p, ctrl) => areaCorner(d, p, state.snapSettings.tolerancePx / state.camera.zoom, ctrl),
    added: addedArea,
    then: (s) => ({ ...switchTool(s, "select"), selection: s.selection }), // the new area's grips at once (areas.41)
  });
  if (e.type !== "pointerMove" || step.state.tool.name !== "zone") return step;
  return hovered(step.state, doc, step.state.tool.state, pointer.world, step.effects);
}

/** The hover: what the Floor mode's click would finish (deck-floors.02), or the plain tool's room under the pointer. */
function hovered(state: EditorState, doc: Document, tool: ZoneToolState, world: Point, effects: Step["effects"] = []): Step {
  const target = tool.motif === null ? null : floorTarget(state, doc, world);
  const hoverDeck = target?.kind === "deck" ? target.id : null;
  const hoverFaceKey = tool.motif !== null && (target === null || hoverDeck !== null) ? null : faceAt(doc, world)?.key ?? null;
  const area = tool.motif === null ? (areaTagAt(doc, world, state.camera, activeStateId(state)) ?? areaAt(doc, world)) : null;
  const hover = area === null ? null : { table: "areas" as const, id: area };
  return { state: withZone({ ...state, hover, hoverHandle: null, ...(tool.kind === "idle" ? { snap: null } : {}) }, { ...tool, hoverFaceKey, hoverDeck }), effects };
}

/**
 * The plain click: an area's tag, a room's tag, an area's body (areas.16: its outline shows, so a hidden tag's area is
 * reachable), a labelled floor; else it labels the room.
 */
function clickZone(state: EditorState, doc: Document, world: Point, host: Host): Step {
  const layout = activeStateId(state);
  const areaTag = areaTagAt(doc, world, state.camera, layout);
  if (areaTag) return { state: select(state, { table: "areas", id: areaTag }), effects: [] };
  const tag = tagAt(doc, world, state.camera, layout);
  const area = tag ? null : areaAt(doc, world);
  if (area) return { state: select(state, { table: "areas", id: area }), effects: [] };
  const existing = tag ?? labelAtFloor(doc, world);
  if (existing) return { state: select(state, { table: "zoneLabels", id: existing }), effects: [] };
  return labelRoom(state, doc, world, null, host);
}

/** What a Floor mode click at a point finishes: a room's first label, an unlabelled room, a deck, or nothing. */
type FloorTarget = { kind: "label"; id: string } | { kind: "room" } | { kind: "deck"; id: string };

/**
 * The surface under a Floor mode click at the viewed level (deck-floors.02, .06), in Select's order (decks.19): at the
 * floor a room's tag, then the floor's deck under the point (`levelDeckAt`, so not a loft overhead), then the room's
 * floor; at an upper level the level's own deck only, since room tags and floors are the floor's.
 */
function floorTarget(state: EditorState, doc: Document, world: Point): FloorTarget | null {
  const level = viewedLevelOn(state, doc);
  const floor = isFloor(level);
  if (floor) {
    const tag = tagAt(doc, world, state.camera, activeStateId(state));
    const room = tag === null ? null : zoneOfLabel(doc, tag);
    const first = room ? firstLabelId(room) : null;
    if (first !== null) return { kind: "label", id: first };
  }
  const deck = levelDeckAt(doc, level, world);
  if (deck) return { kind: "deck", id: deck.id };
  if (!floor) return null;
  const label = labelAtFloor(doc, world);
  if (label !== null) return { kind: "label", id: label };
  return faceAt(doc, world) ? { kind: "room" } : null;
}

/**
 * The Floor mode's click (finishes.19, deck-floors.02): sets the motif's defaults on what `floorTarget` finds and
 * selects it: a room's first label (finishes.40), a deck, or an unlabelled room, labelled with the finish in one command
 * (finishes.01). Off every surface at an upper level, "No floor at +2.15 here" (levels.08); at the floor, outside every
 * room, nothing. The mode stays armed for the next one.
 */
function layMotif(state: EditorState, doc: Document, world: Point, motif: MotifId, host: Host): Step {
  const finish = motifDefaults(motif);
  const target = floorTarget(state, doc, world);
  if (target === null) {
    const level = viewedLevelOn(state, doc);
    return isFloor(level) ? { state, effects: [] } : refuse(state, noFloorAt(level), host);
  }
  switch (target.kind) {
    case "room":
      return labelRoom(state, doc, world, finish, host);
    case "label": {
      const out = runCommand(select(state, { table: "zoneLabels", id: target.id }), { type: "setFinish", id: target.id, finish }, host); // the same finish again commits nothing
      return { state: out.state, effects: out.effects };
    }
    case "deck": {
      const out = runCommand(select(state, { table: "decks", id: target.id }), { type: "setDeckFinish", deckId: target.id, finish }, host);
      return { state: out.state, effects: out.effects };
    }
    default:
      return assertNever(target);
  }
}

/** Labels the room under the point ("Room N", with the finish) and selects it; outside every room, nothing. */
function labelRoom(state: EditorState, doc: Document, world: Point, finish: Finish | null, host: Host): Step {
  if (!faceAt(doc, world)) return { state, effects: [] }; // outside every room, or on a boundary (spec: walls-rooms)
  const id = host.newId();
  const out = runCommand(state, { type: "labelZone", id, at: world, name: nextRoomName(doc), finish }, host);
  if (out.committed === null) return { state: out.state, effects: out.effects }; // refused: the toast explains why
  return { state: select(out.state, { table: "zoneLabels", id }), effects: out.effects };
}

function select(state: EditorState, ref: EntityRef): EditorState {
  return { ...state, selection: [ref] };
}

function withZone(state: EditorState, tool: ZoneToolState): EditorState {
  return { ...state, tool: { name: "zone", state: tool } };
}
