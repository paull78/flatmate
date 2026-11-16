import { defaultSize, distance, execute, heightsOf, isObjectSize, kindConfigs, placementFit, squareSize, stairRuleOf, type Command, type Document, type Heights, type Landed, type Level } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import { furnitureSet, setBox, setPieces, setPoses, type FurnitureSet } from "../furniture-sets";
import type { PointerInput, UiAction } from "../ports/events";
import type { Host } from "../ports/host";
import { drawnFootprint, footprintCorner, roundCm } from "../snapping/drawn-footprint";
import { pieceFit, type Piece } from "../snapping/piece";
import { placeFootprint } from "../snapping/placement";
import { alignAfterContact } from "../snapping/settle";
import { snapStep, snapToleranceM } from "../snapping/snap";
import { activeStateId, switchTool, viewedLevel, type EditorState, type Step } from "../state";
import { refuse } from "../toast";
import { noFloorAt, reasonOf } from "../toast-text";
import { NO_MODS, type Mods } from "../types";
import { DRAG_THRESHOLD_PX } from "./hit-test";
import { lowerGhost, rangeAt } from "./lowered-ghost";
import { armedPreset, armedSize, armedTyped, typedHeight } from "./armed-size";
import { fixGhost, liveOffer, shownOffer } from "./stair-fixes";
import { catchEdge, fixedStairGhost, runOf, slideOnEdge, stairAsk, stairGhost, turnsAt, wallSides } from "./stair-gesture";
import { PREVIEW_OP, type ObjectGhost, type ObjectToolState } from "./types";

/** What a set's overall box is, for walls: a plain rectangle (seated.11). */
const SET_BOX_KIND = "block";

/**
 * The Object tool (spec: layouts, ux-polish item 1): a see-through ghost of the armed kind follows the pointer, centred on it, at
 * its start angle (0 when a kind is armed, plus 90° for each R); its back within 10 px of a wall face straightens it and
 * lands it flush; another side within 10 px turns it so that side is its back, flush on the face, only when it then fits
 * (contact plus fit, furnish.16); then, on each screen axis no wall face within 10 px holds, it aligns to the edges and
 * centre lines of the layout's other furniture within 10 px (spec: tools guides); Ctrl keeps the start angle with no snap and
 * no guide. Red where it would not fit. The size is the size picker's preset (furnish.05). A click (a press released
 * within 4 px) places exactly the ghost where it is released, in the active layout, in the kind's default
 * configuration. A press dragged past 4 px draws a footprint instead (furnish.04, .17), placed on release with its
 * drawn size. Either stands where the landing rule lands it at the viewed level, tested at every place the snap tries
 * (decks.11, levels.08): at the floor level the floor first, else the deck under its centre below the floor's cut; at
 * an upper level the level's deck under its centre, and with none there the ghost is red and a release sends nothing,
 * with "No floor at +2.15 here" (levels.16). The kind stays armed. A refused release toasts why. With a stair kind
 * armed, a deck edge caught under the cursor takes the gesture instead (stairPointer, stairdraw.06).
 */
export function objectPointer(state: EditorState, given: ObjectToolState, e: PointerInput, host: Host): Step {
  const world = state.pointer?.world ?? null;
  const set = (t: ObjectToolState): EditorState => ({ ...state, tool: { name: "object", state: { ...t, preview: null } } });
  if (world === null) return { state: set({ ...given, ghost: null }), effects: [] };
  const caught = stairPointer(state, given, e, world, host);
  if (caught) return caught;
  const tool: ObjectToolState = { ...given, stair: null }; // no edge caught: today's Object tool (stairdraw.07)
  const pressing = tool.pressing;
  switch (e.type) {
    case "pointerDown":
      return { state: set({ ...tool, ghost: ghostAt(state, tool, e.mods, world), pressing: { pressWorld: world, corner: null } }), effects: [] };
    case "pointerMove": {
      if (pressing === null || !beyondClick(state, pressing, world)) return { state: set({ ...tool, ghost: ghostAt(state, tool, e.mods, world) }), effects: [] };
      return { state: set({ ...tool, pressing: { ...pressing, corner: world }, ghost: drawnGhost(state, tool, e.mods, pressing.pressWorld, world) }), effects: [] };
    }
    case "pointerUp": {
      if (pressing === null) return { state: set({ ...tool, ghost: ghostAt(state, tool, e.mods, world) }), effects: [] };
      const drawn = beyondClick(state, pressing, world);
      const ghost = drawn ? drawnGhost(state, tool, e.mods, pressing.pressWorld, world) : ghostAt(state, tool, e.mods, world);
      const next = set({ ...tool, pressing: null, ghost });
      const layout = activeStateId(state);
      if (!ghost || layout === null) return { state: next, effects: [] };
      const level = viewedLevel(state);
      if (ghost.noFloor && level) return refuse(next, noFloorAt(level), host);
      // A red ghost still sends, so the refusal toasts.
      const out = runCommand(next, placeCommand(state, ghost, layout, drawn, host.newId()), host);
      return { state: out.state, effects: out.effects };
    }
    default:
      return assertNever(e.type);
  }
}

/**
 * What a release sends. The armed preset goes too, the default included: the domain sizes every configuration from it
 * (smart.43), like the ghost; a drawn piece sends its size too, and takes the preset's heights (catalog.07). A lowered
 * piece's `h` travels in that size, so a click sends the w and d it already has from the preset (clarity.06).
 */
function placeCommand(state: EditorState, ghost: ObjectGhost, layout: string, drawn: boolean, opId: string): Command {
  const set = armedSet(state);
  if (set) return { type: "placePieces", opId, pieces: setPieces(set, ghost.at, ghost.rotation, layout, ghost.surface) };
  const armed = armedPreset(state);
  const h = ghost.lowered?.h ?? typedHeight(state); // a shortened height, else a typed one (sizing.15)
  const lowered = h === null ? {} : { h };
  const sized = drawn || ghost.lowered !== undefined || armedTyped(state); // a typed size travels as a drawn one does (sizing.06)
  const object = { kind: ghost.kind, ...(armed ? { preset: armed.id } : {}), ...(sized ? { size: { w: ghost.w, d: ghost.d, ...lowered } } : {}) };
  return { type: "placeObject", opId, state: layout, object, at: ghost.at, rotation: ghost.rotation, deck: ghost.surface };
}

/**
 * Why the red ghost would be refused, in the words its release would toast (clarity.07). It runs with a preview ID, a
 * click with a new one, so the two can name a pair of pieces in the other order (clarity.13). Null with no reason.
 */
export function reasonOfGhost(state: EditorState, tool: ObjectToolState): string | null {
  const { ghost } = tool;
  const layout = activeStateId(state);
  const doc = state.document ? visibleDoc(state.document) : null;
  const level = viewedLevel(state);
  if (!ghost || layout === null || !doc || !level) return null;
  if (ghost.noFloor) return noFloorAt(level);
  return reasonOf(doc, placeCommand(state, ghost, layout, !!tool.pressing?.corner, PREVIEW_OP));
}

/** A press is drawing once the pointer has passed 4 px from it (the Select box's rule), even if it comes back. */
function beyondClick(state: EditorState, pressing: NonNullable<ObjectToolState["pressing"]>, world: Point): boolean {
  return pressing.corner !== null || distance(world, pressing.pressWorld) * state.camera.zoom > DRAG_THRESHOLD_PX;
}

/**
 * R: the ghost's start angle turns 90° counter-clockwise, and the ghost under the pointer follows at once (null without
 * one). While a footprint is drawn, R turns that piece a quarter turn in its rectangle instead, over the facing rule,
 * for this drag only (sizing.07); a set's press still turns the set.
 */
export function turnObjectGhost(state: EditorState, tool: ObjectToolState): EditorState {
  if (tool.stair !== null) return state; // a caught edge sets the rotation (spec "Other rules")
  const pressing = tool.pressing;
  if (pressing?.corner && tool.ghost?.drawn) return rebuildObjectGhost(state, { ...tool, pressing: { ...pressing, turns: ((pressing.turns ?? 0) + 1) % 4 } });
  return rebuildObjectGhost(state, { ...tool, rotation: (tool.rotation + 90) % 360 });
}

/** Esc: a stair's fixed top goes back to hovering its edge (stairdraw.06), the offer ended; otherwise the tool ends, as Esc does. */
export function objectEscape(state: EditorState, tool: ObjectToolState): EditorState {
  if (tool.stair?.phase !== "fixed") return switchTool(state, "select");
  return rebuildObjectGhost(state, { ...tool, pressing: null, offer: null, stair: { phase: "hover", edge: tool.stair.edge, cursor: tool.stair.cursor } });
}

/**
 * A fix chip in the hint line (stairdraw.13, .48), live before click 1 or pinned at it: hovered, its stair is previewed
 * in the ghost's place (null, or a chip that is gone, ends the preview); clicked, that stair is placed in one edit, at
 * the point it was offered for. The armed kind stays; the offer ends, and the ghost goes until the pointer moves on the
 * canvas again (placed).
 */
export function objectChip(state: EditorState, action: Extract<UiAction, { type: "chipHover" | "chipClick" }>, host: Host): Step {
  const tool = state.tool.name === "object" ? state.tool.state : null;
  const offer = tool ? shownOffer(state, tool) : null;
  const fix = offer && action.id !== null ? offer.chips.find((f) => f.id === action.id) : undefined;
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!tool || !offer || !doc) return { state, effects: [] };
  const set = (t: ObjectToolState): EditorState => ({ ...state, tool: { name: "object", state: t } });
  if (action.type === "chipHover") return { state: set({ ...tool, preview: fix ? fixGhost(doc, fix, offer) : null }), effects: [] };
  if (!fix) return { state, effects: [] };
  const out = runCommand(set({ ...tool, preview: null }), { type: "placeStair", opId: host.newId(), ...fix.request }, host);
  if (out.committed === null) return { state: out.state, effects: out.effects };
  const stair = tool.stair && { phase: "hover" as const, edge: tool.stair.edge, cursor: tool.stair.cursor };
  return { state: placed(out.state, { ...tool, stair }), effects: out.effects };
}

/** After a stair is placed: no ghost, press, preview or offer, so nothing red sits over it until the pointer moves on the canvas. */
function placed(state: EditorState, tool: ObjectToolState): EditorState {
  return { ...state, tool: { name: "object", state: { ...tool, ghost: null, pressing: null, preview: null, offer: null } } };
}

/**
 * The ghost worked out again at the pointer, as the next move would (null without a pointer): after R, and when the
 * view follows its deck to a new height, so the ghost never shows the old level's landing (levels.43, .46). With the
 * pointer off the canvas, a caught stair is worked out at its last cursor, so it stays frozen (stairdraw.43).
 */
export function rebuildObjectGhost(state: EditorState, tool: ObjectToolState): EditorState {
  const p = state.pointer;
  const world = p?.world ?? tool.stair?.cursor ?? null;
  const caught = world ? stairPointer(state, tool, { type: "pointerMove" }, world, null) : null;
  if (caught) return caught.state;
  const mods = p?.mods ?? NO_MODS;
  const pressing = tool.pressing;
  const ghost = !p ? null : pressing?.corner ? drawnGhost(state, tool, mods, pressing.pressWorld, p.world) : ghostAt(state, tool, mods, p.world);
  return { ...state, tool: { name: "object", state: { ...tool, ghost, stair: null, preview: null } } };
}

/**
 * The stair gesture (stairdraw.06, .10, .11): null when it doesn't take the event, so the Object tool is today's.
 * Hovering, the caught edge's ghost slides along it; a press fixes the top there (click 1), the cursor then swings it
 * straight or into an L, and a later release places that (click 2), as does the release of a press dragged past 4 px.
 * A stair that can't turn there places on click 1's release where it fits (stairdraw.56, .58). A refused place stays fixed, with
 * its toast; a placed one goes back to hovering. `host` is null for a rebuild, which never places.
 */
function stairPointer(state: EditorState, tool: ObjectToolState, e: Pick<PointerInput, "type">, world: Point, host: Host | null): Step | null {
  const ask = stairAsk(state);
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!ask || !doc) return null;
  const step = (t: ObjectToolState): Step => ({ state: { ...state, tool: { name: "object", state: { ...t, preview: null } } }, effects: [] });
  const held = tool.stair && { ...tool.stair, cursor: world };
  // The fixed top's deck moved or went under a collaborator (stairdraw.28): back to hovering, not a click that can only refuse.
  const lost = held?.phase === "fixed" && fixedStairGhost(doc, ask, held.edge, held.at, world) === null;
  const g = lost ? null : held;
  if (g?.phase === "fixed") {
    const ghost = fixedStairGhost(doc, ask, g.edge, g.at, world); // the cursor picks straight or an L (stairdraw.06)
    const pressing = tool.pressing;
    if (e.type === "pointerDown") return step({ ...tool, ghost, stair: g, pressing: { pressWorld: world, corner: null } });
    if (e.type === "pointerMove" || pressing === null || host === null) return step({ ...tool, ghost, stair: g, pressing: pressing && beyondClick(state, pressing, world) ? { ...pressing, corner: world } : pressing });
    const held = step({ ...tool, ghost, stair: g, pressing: null }); // a refused click 2 keeps the offer; placed() ends it
    // Click 1's release holds the top, except for a stair that can't turn there and fits: that one click places it (stairdraw.56, .58).
    const oneClick = ghost?.fits === true && !turnsAt(doc, ask, g.edge, g.at);
    if (pressing.fixes && !beyondClick(state, pressing, world) && !oneClick) return held;
    const out = runCommand(held.state, { type: "placeStair", opId: host.newId(), ...ask, deck: g.edge.deck, at: g.at, shape: ghost?.shape ?? "straight" }, host);
    if (out.committed === null) return { state: out.state, effects: out.effects };
    return { state: placed(out.state, { ...tool, stair: { phase: "hover", edge: g.edge, cursor: world } }), effects: out.effects };
  }
  if (tool.pressing !== null) return null; // a press with no edge caught draws a footprint, as today
  const w = kindConfigs(ask.kind)[0]?.w;
  const edge = w === undefined ? null : catchEdge(doc, ask, world, g?.edge ?? null);
  if (!edge || w === undefined) return null;
  const at = slideOnEdge(edge, world, w, state.pointer?.mods.ctrl ? null : { step: snapStep(state), end: snapToleranceM(state), walls: wallSides(doc, edge, runOf(doc, ask, edge), w) }); // Ctrl: no snap (stairdraw.59)
  const ghost = stairGhost(doc, ask, edge, at);
  if (e.type === "pointerDown" && host !== null) {
    // Click 1: a red straight flight pins its point's chips while the top is fixed (stairdraw.48).
    const fixed: ObjectToolState = { ...tool, ghost, stair: { phase: "fixed", edge, at, cursor: world }, pressing: { pressWorld: world, corner: null, fixes: true } };
    return step({ ...fixed, offer: liveOffer(state, fixed) });
  }
  return step({ ...tool, ghost, stair: { phase: "hover", edge, cursor: world } });
}

/** The ghost centred on `world`, on the visible document, a red one lowered if that fits it; null without a document or an active layout. */
function ghostAt(state: EditorState, tool: ObjectToolState, mods: Mods, world: Point): ObjectGhost | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  const layout = activeStateId(state);
  const level = viewedLevel(state);
  const armed = armedSet(state);
  if (armed) return doc && layout !== null && level ? setGhost(state, tool, armed, { doc, layout, level }, mods, world) : null;
  // The size picker's preset (furnish.05), sized as placeObject sizes it, so the ghost is what a click places.
  const size = armedSize(state);
  const config = kindConfigs(state.objectKind)[0]?.id;
  if (!doc || layout === null || !level || !size || config === undefined) return null;
  const w = size.w[config];
  const d = size.d[config];
  if (w === undefined || d === undefined) return null;
  const heights = heightsOf(size, config); // a new piece takes its preset's or kind's (heights.09, catalog.07)
  if (!heights) return null;
  const centre: Point = { x: roundCm(world.x), y: roundCm(world.y) };
  const tolerance = snapToleranceM(state);
  const search = (tried: Heights): ObjectGhost => {
    const piece: Piece = { kind: state.objectKind, config, riser: null, heights: tried, land: true, current: undefined, level }; // a new piece lands (decks.11)
    const placed = placeFootprint(doc, layout, { w, d }, centre, tool.rotation, { tolerance, free: mods.ctrl, ...piece });
    // Then the other furniture's guides, measured from the pointer's box, on the axes no wall holds; never the step (direct.19).
    const { at, rotation, landed } = alignAfterContact(doc, { layout, exclude: new Set(), size: { w, d }, free: centre, placed, tolerance, ctrl: mods.ctrl, axes: { x: true, y: true }, ...piece });
    const surface = landedDeck(landed);
    const fits = landed.kind === "surface" && placementFit(doc, { kind: state.objectKind, state: layout, at, rotation, config, w, d, surface, h: tried.h, z: tried.z }).fits;
    return { kind: state.objectKind, config, w, d, at, rotation, fits, surface, range: rangeAt(doc, tried, { w, d }, at, rotation, surface), ...noFloor(landed) };
  };
  return lowerGhost(doc, layout, search(heights), heights, search);
}

const armedSet = (state: EditorState): FurnitureSet | null => (state.objectSet === null ? null : (furnitureSet(state.objectSet) ?? null));

/**
 * A set's ghost (seated.11): its overall box takes wall contact and guides as one rectangular piece, a block as tall as the
 * set's tallest piece, and its pieces follow; each lands on the box's surface. It fits where placePieces would take it.
 */
function setGhost(state: EditorState, tool: ObjectToolState, set: FurnitureSet, on: { doc: Document; layout: string; level: Level }, mods: Mods, world: Point): ObjectGhost | null {
  const { doc, layout, level } = on;
  const size = setBox(set);
  const heights = set.pieces.map((p) => defaultSize(p.kind)).flatMap((s) => (s ? Object.keys(s.h).flatMap((c) => heightsOf(s, c) ?? []) : []));
  const h = Math.max(...heights.map((x) => x.h));
  const config = kindConfigs(SET_BOX_KIND)[0]?.id;
  if (config === undefined) return null;
  const centre: Point = { x: roundCm(world.x), y: roundCm(world.y) };
  const tolerance = snapToleranceM(state);
  const piece: Piece = { kind: SET_BOX_KIND, config, riser: null, heights: { h, z: 0 }, land: true, current: undefined, level };
  const placed = placeFootprint(doc, layout, size, centre, tool.rotation, { tolerance, free: mods.ctrl, ...piece });
  const { at, rotation, landed } = alignAfterContact(doc, { layout, exclude: new Set(), size, free: centre, placed, tolerance, ctrl: mods.ctrl, axes: { x: true, y: true }, ...piece });
  const surface = landedDeck(landed);
  const cmd: Command = { type: "placePieces", opId: PREVIEW_OP, pieces: setPieces(set, at, rotation, layout, surface) };
  const fits = landed.kind === "surface" && execute(doc, cmd).ok;
  return { kind: SET_BOX_KIND, config, ...size, at, rotation, fits, surface, range: rangeAt(doc, { h, z: 0 }, size, at, rotation, surface), ...noFloor(landed), set: setPoses(set, at, rotation) };
}

/** The deck a landed piece stands on; the floor (null) for "none", which is drawn there and never sent. */
function landedDeck(landed: Landed): string | null {
  switch (landed.kind) {
    case "surface":
      return landed.deck;
    case "none":
      return null;
    default:
      return assertNever(landed);
  }
}

/** The ghost's `noFloor` mark: present only when no deck of the viewed level is under it (levels.16). */
const noFloor = (landed: Landed): { noFloor?: true } => (landed.kind === "none" ? { noFloor: true } : {});

/**
 * The piece a press at `pressWorld` dragged to `world` draws (furnish.17): the corners snap to wall face corners, else
 * onto faces (Ctrl off), and the open-side rule turns it, else the angle of the ghost the press showed, worked out
 * again here. Red under 0.10 m or where it would not fit. Null exactly when `ghostAt` is.
 */
function drawnGhost(state: EditorState, tool: ObjectToolState, mods: Mods, pressWorld: Point, world: Point): ObjectGhost | null {
  if (state.objectSet !== null) return ghostAt(state, tool, mods, world); // a set has one size: its press only places it
  const doc = state.document ? visibleDoc(state.document) : null;
  const layout = activeStateId(state);
  const level = viewedLevel(state);
  const config = kindConfigs(state.objectKind)[0]?.id;
  const size = armedSize(state); // a drawn piece takes the armed preset's heights, as placeObject gives it
  if (!doc || layout === null || !level || !size || config === undefined) return null;
  const heights = heightsOf(size, config);
  if (!heights) return null;
  const corner = (p: Point): Point => footprintCorner(doc, state.camera, state.snapSettings.tolerancePx, p, mods.ctrl, level, layout); // pieces too (sizing.35)
  const start = ghostAt(state, tool, mods, pressWorld)?.rotation ?? tool.rotation;
  const drawn = drawnFootprint(doc, corner(pressWorld), corner(world), start, level, tool.pressing?.turns ?? 0);
  const f = { ...drawn, d: squareSize(stairRuleOf(state.objectKind), drawn, drawn) ?? drawn.d }; // as placeObject stores a spiral: `at` is its back edge
  const search = (tried: Heights): ObjectGhost => {
    const fit = pieceFit(doc, layout, { kind: state.objectKind, config, riser: null, heights: tried, land: true, current: undefined, level }, f, f.at, f.rotation);
    const fits = isObjectSize(f.w) && isObjectSize(f.d) && fit.fits;
    const surface = landedDeck(fit.landed);
    return { kind: state.objectKind, config, ...f, fits, surface, range: rangeAt(doc, tried, f, f.at, f.rotation, surface), ...noFloor(fit.landed), drawn: true };
  };
  return lowerGhost(doc, layout, search(heights), heights, search);
}
