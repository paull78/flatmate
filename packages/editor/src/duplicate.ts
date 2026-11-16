import { add, boxOf, execute, footprintQuad, footprints, heightsOf, quadCentre, rangeOf, roundMm, sub, type Command, type Document, type EntityRef, type Placement } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { blockedMessage, runCommand } from "./commit";
import { canCommit, visibleDoc } from "./document/open-document";
import type { Event } from "./ports/events";
import type { Host } from "./ports/host";
import { alignDelta, alignmentGuides, alongAxis, boxAt, type AxisBox } from "./snapping/guides";
import type { Piece } from "./snapping/piece";
import { placeFootprint } from "./snapping/placement";
import { alignAfterContact } from "./snapping/settle";
import { snapStep, snapToleranceM } from "./snapping/snap";
import { activeStateId, pruneSelection, viewedLevel, type EditorState, type Step } from "./state";
import { showToast } from "./toast";
import { furnitureDelta } from "./tools/drag";
import { hitPlacements, zeroMoveDependencies } from "./tools/drag-commit";
import { turnedPlaces } from "./tools/turn";
import { PREVIEW_OP, type DragTry, type ObjectGhost, type Places, type SelectToolState } from "./tools/types";
import { NO_MODS } from "./types";

// The duplicate's ghost (ghost.01, ghost.06): Cmd/Ctrl+D or Properties' Duplicate picks up copies of the selected
// furniture; they follow the cursor by the drag's delta (the step, or a guide of the furniture, the originals
// included), see-through where they fit and red where they do not, with every piece they would hit; R turns them 90°
// counter-clockwise (ghost.03); a click places them as one duplicatePlacements and selects them. Nothing is in the
// document until then.
//
//   idle ──Cmd/Ctrl+D──► copying ──pointer move or R──► copying (re-tried on baseDoc)
//                          │  └──click, refused──► toast, copying
//                          ├──click, fits──► duplicatePlacements, the copies selected, idle
//                          └──Esc, Cmd/Ctrl+Z, Undo/Redo, a tool, a UI action or command──► idle, nothing committed

type Copying = Extract<SelectToolState, { kind: "copying" }>;

const NOTHING: DragTry = { kind: "none" };

const none = (state: EditorState): Step => ({ state, effects: [] });

/**
 * Picks up the selected furniture of the active layout as a ghost centred on the pointer, or over the originals
 * (offset 0) when there is none, as after a click in Properties, whose canvas sent pointerLeave (ghost.03); the next
 * pointer move centres it. Select tool, idle; a selection with anything other than furniture of the active layout
 * does nothing.
 */
export function duplicateSelection(state: EditorState, host: Host): Step {
  const tool = state.tool;
  const d = state.document;
  if (!d || tool.name !== "select" || tool.state.kind !== "idle" || state.selection.length === 0) return none(state);
  const baseDoc = visibleDoc(d);
  const layout = activeStateId(state);
  if (!state.selection.every((r) => r.table === "placements" && baseDoc.placements[r.id]?.state === layout)) return none(state);
  // As a nudge run, nothing starts while an edit is in flight, and the key says why (direct.36).
  if (!canCommit(d)) return showToast(state, blockedMessage(d), host);
  const sources = state.selection.map((r) => r.id).sort();
  const all = footprints(baseDoc);
  const quads = sources.flatMap((id) => all.get(id) ?? []);
  if (quads.length === 0) return none(state);
  const box = boxOf(quads);
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const cursor = state.pointer?.world ?? centre;
  // Replaced below; a zero move gives the dependencies until a try fits (the first, over the originals, does not).
  const dependencies = zeroMoveDependencies(baseDoc, { kind: "placements", placementIds: sources });
  const start: Copying = {
    kind: "copying", sources, centre, baseDoc, offset: { x: 0, y: 0 }, turn: 0,
    attempt: { ok: false, doc: baseDoc, cursor, tried: NOTHING, blocked: [], dependencies, guides: [] },
  };
  return none(withSelect({ ...state, hover: null, hoverHandle: null, snap: null }, tryGhost(state, start, cursor)));
}

/**
 * The ghost with its cursor at `world`, moved as a drag (ghost.02). One piece takes contact plus fit, then the guides
 * on the axes no wall holds (onePieceGhost, furnish.16). A group's box at R's turn aligns to the furniture of the
 * layout, the originals included, else keeps the step (furnitureDelta). The command runs on baseDoc. A refused try
 * keeps the last valid preview and dependencies, shows no guides, and names every placement the copies hit, the
 * originals included.
 */
function tryGhost(state: EditorState, t: Copying, world: Point): Copying {
  const all = footprints(t.baseDoc);
  // A source gone from baseDoc: nothing to try, as a drag whose piece is gone.
  if (t.sources.some((id) => !all.get(id))) return { ...t, attempt: { ...t.attempt, ok: false, cursor: world, tried: NOTHING } };
  const quads = t.sources.flatMap((id) => all.get(id) ?? []);
  const raw = sub(world, t.centre);
  const mods = state.pointer?.mods ?? NO_MODS;
  const one = onePieceGhost(state, t, raw);
  const offset = one?.offset ?? furnitureDelta(state, t.baseDoc, groupBox(quads, t), raw, [], mods);
  const places = one?.places ?? ghostPlaces(t.baseDoc, t, offset, t.turn);
  if (!places) return { ...t, offset, attempt: { ...t.attempt, ok: false, cursor: world, tried: NOTHING, blocked: [], guides: [] } };
  const cmd: Command = { type: "duplicatePlacements", opId: PREVIEW_OP, copies: places };
  const r = execute(t.baseDoc, cmd);
  const dependencies = r.ok ? r.value.patch.dependencies : t.attempt.dependencies;
  const blocked = r.ok ? [] : hitPlacements(r.error, new Set());
  const level = viewedLevel(state);
  const guides = r.ok && level && !mods.ctrl ? alignmentGuides(r.value.doc, ghostCopyIds(t), activeStateId(state), level) : [];
  return { ...t, offset, attempt: { ok: r.ok, doc: r.ok ? r.value.doc : t.attempt.doc, cursor: world, tried: { kind: "places", places }, blocked, dependencies, guides, ...(r.ok ? {} : { refused: { error: r.error, cmd } }) } };
}

/** The IDs the domain gives the preview's copies: `${opId}/p${i}` in sorted source order (ghost.06 D1). */
export function ghostCopyIds(t: Copying): string[] {
  return t.sources.map((_, i) => `${PREVIEW_OP}/p${i}`);
}

/**
 * One piece moved by `raw` (ghost.02): contact plus fit at the stepped delta, from its angle plus R's turns, which Ctrl
 * keeps (ghost.03), the original counted in the fit (ghost.15); then, on each axis no wall face within the tolerance
 * holds (and Shift keeps), the guides of the layout's furniture, the original included, measured from the unstepped
 * box (furnish.16). Its place and the offset of its footprint's centre, to the millimetre; null for a group.
 * `t.turn` keeps only R's presses, so away from the wall again R's angle shows (ghost.13).
 */
function onePieceGhost(state: EditorState, t: Copying, raw: Point): { places: Places; offset: Point } | null {
  const one = onePiece(t);
  if (!one) return null;
  const { p, w, d } = one;
  const mods = state.pointer?.mods ?? NO_MODS;
  const tolerance = snapToleranceM(state);
  const layout = activeStateId(state);
  // With no other furniture listed, alignDelta gives the drag's step delta (Shift's axis, Ctrl's raw delta).
  const stepped = add(t.centre, alignDelta(boxAt(t.centre, w, d, p.rotation), raw, [], { tolerance, step: snapStep(state), mods }));
  const object = t.baseDoc.objects[p.object];
  const heights = p && object ? heightsOf(object, p.config) : null;
  const level = viewedLevel(state);
  if (!object || !heights || !level) return null;
  // A copy keeps its source's surface: no landing (decks.11); its snaps see what the viewed level shows (levels.19).
  const piece: Piece = { kind: object.kind, config: p.config, arms: object.arms, riser: object.riser ?? null, heights, land: false, surface: p.deck, ignore: [], level };
  const placed = placeFootprint(t.baseDoc, layout ?? "", { w, d }, stepped, norm(p.rotation + t.turn), { tolerance, free: mods.ctrl, ...piece });
  const along = alongAxis(raw, mods.shift);
  const axes = { x: !mods.shift || along.x !== 0, y: !mods.shift || along.y !== 0 };
  const c = alignAfterContact(t.baseDoc, { layout, exclude: new Set(), size: { w, d }, free: add(t.centre, along), placed, tolerance, ctrl: mods.ctrl, axes, ...piece });
  const centre = quadCentre(footprintQuad(c.at, w, d, c.rotation));
  if (!centre) return null;
  const offset = sub(centre, t.centre);
  return { places: [{ placementId: p.id, at: c.at, rotation: c.rotation }], offset: { x: roundMm(offset.x), y: roundMm(offset.y) } };
}

/** A group's bounding box (of `quads`, the sources' footprints) on `t.centre`, turned by R's turns, along the screen axes (direct.55). */
function groupBox(quads: readonly Point[], t: Copying): AxisBox {
  const b = boxOf(quads);
  return { ...boxAt(t.centre, b.maxX - b.minX, b.maxY - b.minY, t.turn), edges: true };
}

/** The ghost's only source with its size, or null for a group (or a piece whose object is gone). */
function onePiece(t: Copying): { p: Placement; w: number; d: number } | null {
  const [only, ...rest] = t.sources;
  const p = only !== undefined && rest.length === 0 ? t.baseDoc.placements[only] : undefined;
  const object = p ? t.baseDoc.objects[p.object] : undefined;
  const w = p ? object?.w[p.config] : undefined;
  const d = p ? object?.d[p.config] : undefined;
  return p && w !== undefined && d !== undefined ? { p, w, d } : null;
}

/**
 * The copies' places: unturned, each anchor moved by `offset` to the millimetre; turned, about `centre` (a group's box
 * centre, or the piece's own) and then moved, each rotation normalised as the domain stores it. Null when a piece has
 * no footprint.
 */
function ghostPlaces(doc: Document, t: Copying, offset: Point, turn: number): Places | null {
  if (turn === 0) {
    return t.sources.flatMap((id) => {
      const p = doc.placements[id];
      return p ? [{ placementId: id, at: { x: roundMm(p.at.x + offset.x), y: roundMm(p.at.y + offset.y) }, rotation: p.rotation }] : [];
    });
  }
  const turned = turnedPlaces(doc, t.sources, t.centre, turn, offset);
  return turned ? turned.map((p) => ({ ...p, rotation: norm(p.rotation) })) : null;
}

/** R while the ghost is up: 90° more counter-clockwise, re-tried at the last cursor; the document never changes. */
export function turnGhost(state: EditorState, t: Copying): Step {
  return none(withSelect(state, tryGhost(state, { ...t, turn: (t.turn + 90) % 360 }, t.attempt.cursor)));
}

/** A pointer move re-tries the ghost at the cursor (spec: tools). */
export function moveGhost(state: EditorState, t: Copying, world: Point): EditorState {
  return withSelect(state, tryGhost(state, t, world));
}

/**
 * A click commits the ghost's copies at the click as one duplicatePlacements and selects them. A refused click toasts
 * the reason and keeps the ghost (ghost.03).
 */
export function placeCopy(state: EditorState, t: Copying, host: Host): Step {
  const ghost = tryGhost(state, t, state.pointer?.world ?? t.attempt.cursor);
  const withGhost = withSelect(state, ghost);
  const tried = ghost.attempt.tried;
  if (tried.kind !== "places") return none(withGhost);
  const opId = host.newId();
  const out = runCommand(withGhost, { type: "duplicatePlacements", opId, copies: tried.places }, host);
  // The copies are in the visible document only if the command went through (a pending one included).
  const visible = out.state.document ? visibleDoc(out.state.document) : null;
  const copies = visible ? Object.keys(visible.placements).filter((id) => id.startsWith(`${opId}/`)).sort() : [];
  if (copies.length === 0) return { state: out.state, effects: out.effects };
  const selection = copies.map((id): EntityRef => ({ table: "placements", id }));
  return { state: pruneSelection({ ...idle(out.state), selection }), effects: out.effects }; // as every selection change
}

/**
 * A remote change that does not touch the ghost (spec: tools): rerun it on the new visible document from the same cursor.
 * `centre` stays: a change that moves a source writes a dependency and cancels the ghost instead.
 */
export function rerunCopy(state: EditorState, t: Copying): EditorState {
  if (!state.document) return state;
  const baseDoc = visibleDoc(state.document);
  return moveGhost(state, { ...t, baseDoc, attempt: { ...t.attempt, doc: baseDoc } }, t.attempt.cursor);
}

/**
 * The gate in front of every event while the ghost is up (update.ts): a second duplicate is ignored (ghost.06 D3);
 * Cmd/Ctrl+Z, Undo and Redo drop the ghost and are swallowed; any other UI action or command drops it, then runs.
 * Esc and the tool keys reach selectEscape and switchTool, which drop it too.
 */
export function ghostGate(state: EditorState, event: Event): { state: EditorState; consumed: boolean } {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "copying") return { state, consumed: false };
  const action = gateAction(event);
  switch (action) {
    case "keep":
      return { state, consumed: false };
    case "ignore":
      return { state, consumed: true };
    case "cancel":
      return { state: idle(state), consumed: true };
    case "drop":
      return { state: idle(state), consumed: false };
    default:
      return assertNever(action);
  }
}

function gateAction(event: Event): "keep" | "ignore" | "cancel" | "drop" {
  switch (event.type) {
    case "pointerDown":
    case "pointerMove":
    case "pointerUp":
    case "pointerLeave":
    case "pointAt":
    case "wheel": // the camera replays the pointer (followCamera), so the ghost follows the cursor's new world point
    case "frame":
    case "viewportResized":
    case "saveResult":
    case "rasterised":
    case "timerFired":
    case "serverEvent": // remote notices reach the ghost through selectRemote and cancelGestures (gestures.ts)
    case "workspaceEvent":
      return "keep";
    case "key": {
      const command = event.mods.meta || event.mods.ctrl;
      const key = event.key.toLowerCase();
      return command && key === "d" ? "ignore" : command && key === "z" ? "cancel" : "keep";
    }
    case "ui":
      return event.action.type === "duplicate" ? "ignore" : event.action.type === "undo" || event.action.type === "redo" ? "cancel" : "drop";
    case "command":
      return "drop";
    default:
      return assertNever(event);
  }
}

/** The ghost's pieces, drawn as the Object tool's ghost: see-through where they fit, red where they do not. */
export function ghostPieces(t: Copying): ObjectGhost[] {
  const tried = t.attempt.tried;
  if (tried.kind !== "places") return [];
  return tried.places.flatMap((place) => {
    const p = t.baseDoc.placements[place.placementId];
    const object = p ? t.baseDoc.objects[p.object] : undefined;
    const w = p ? object?.w[p.config] : undefined;
    const d = p ? object?.d[p.config] : undefined;
    const heights = p && object ? heightsOf(object, p.config) : null;
    if (!p || !object || w === undefined || d === undefined || !heights) return [];
    const range = rangeOf(t.baseDoc, heights, footprintQuad(place.at, w, d, place.rotation), p.deck); // on its source's surface
    return [{ kind: object.kind, config: p.config, w, d, at: place.at, rotation: place.rotation, fits: t.attempt.ok, surface: p.deck, range }];
  });
}

function norm(r: number): number {
  return ((r % 360) + 360) % 360;
}

function idle(state: EditorState): EditorState {
  return { ...state, tool: { name: "select", state: { kind: "idle" } }, snap: null };
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}
