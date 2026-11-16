import {
  FLOOR_BASE, add, anchorFor, boxOf, columnOf, deckView, dimensionPoints, holeView, distance, dot, footprints, heightsOf, incidentWalls, openingGeometry, placementCentre,
  roundMm, shownAt, sub,
  type Document, type Landed, rotateAbout } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { alignDelta, alongAxis, guideBoxes, type AxisBox } from "../snapping/guides";
import { DIMENSION_POLICIES } from "../snapping/dimension-policies";
import { nearWalls, wallSeenAt } from "../snapping/near-walls";
import { roundTo } from "../snapping/policies";
import { landsOn, type Piece } from "../snapping/piece";
import { placeFootprint, slideOpening } from "../snapping/placement";
import { armSpot, armTo, ellOutline } from "../snapping/arm-drag";
import { resizeTo, sideOf } from "../snapping/resize";
import { alignAfterContact } from "../snapping/settle";
import { zoneDragExtent, zoneFrame } from "../snapping/zone-drag";
import { gripRotation, rotationTowards } from "../snapping/rotation";
import { turnedPlaces } from "./turn";
import { otherParts, orthogonalAxis, projectOnAxis, snapPoint, snapStep, snapToleranceM } from "../snapping/snap";
import { activeStateId, viewedLevel, viewedLevelOn, type EditorState } from "../state";
import { NO_MODS, type Mods, type SnapResult } from "../types";
import { acrossLine } from "../view/dimension-layout";
import { deckResize, snapDeckAt } from "./deck-edit";
import { areaResize, snapAreaAt } from "./area-edit";
import { GAP_SIDES, holeResize, holeSnapMark, snapHoleAt } from "./hole-edit";
import { sectionDepthAt } from "./section-edit";
import { mmPoint, wallsTry } from "./run-drag";
import { slideLine, slidePoint } from "./joint-slide";
import { SPLIT_REACH_PX, splitTickAt, type SplitTick } from "./split-gesture";
import { viewBox } from "../snapping/across";
import type { DragTarget, DragTry, Places } from "./types";

// Drag targets (spec: tools, layouts, openings), each defined once (arch-review R-07): what a drag tries (here), the
// command it commits and its dependencies before the first attempt (drag-commit.ts), and how a refused attempt is
// drawn (view/refused-overlay.ts). Every function switches exhaustively on the target or on what was tried, so a new
// target (a rotation handle, a dimension line) is one case in each, found by the compiler.

const NOTHING: DragTry = { kind: "none" };

/**
 * A joint snaps to the cursor, ignoring itself and its walls; a wall moves by a grid-rounded delta; an object on its
 * grid-rounded centre takes contact plus fit from its angle at the press (furnish.16): flush on a wall face within the
 * tolerance, turned when a side other than its back touches and the turned piece fits; then, on each axis no wall
 * face within the tolerance holds, it aligns to the other furniture's lines (AC-13, snapping/settle.ts); a group moves
 * by a delta aligned by its bounding box or grid-rounded and never turns; an opening slides along its wall by a
 * grid-rounded distance. The grid is snapStep's: the zoom's, 1 cm while a plan picture shows (furnish.08), or the step
 * chosen in the floating bar (direct.14). Ctrl bypasses the
 * grid, the guides and the contact turn and flush. A side grip
 * resizes its piece by the drag along the side's normal (snapping/resize.ts); the rotation grip turns its piece about
 * its centre (snapping/rotation.ts). A placed dimension's offset is the pointer's distance from its line, rounded to the grid
 * (to the mm with Ctrl). A zone handle moves its zone's edge (snapping/zone-drag.ts). Nothing is tried when the target,
 * or any piece of a group, is gone.
 */
export function dragTry(state: EditorState, baseDoc: Document, target: DragTarget, pressWorld: Point, world: Point, turn: number): { tried: DragTry; snap: SnapResult | null } {
  const doc = baseDoc;
  const mods = state.pointer?.mods ?? NO_MODS;
  switch (target.kind) {
    case "joint": {
      const id = target.jointId;
      const j = doc.joints[id];
      if (!j) return { tried: NOTHING, snap: null };
      const others = otherParts(doc, doc.walls[incidentWalls(doc, id)[0] ?? ""]?.base ?? FLOOR_BASE);
      const snap = snapPoint({
        doc,
        cursor: world,
        camera: state.camera,
        mods,
        origin: { x: j.x, y: j.y },
        tolerancePx: state.snapSettings.tolerancePx,
        gridSpacing: snapStep(state),
        excludeJoints: new Set([id, ...others.joints]), // nor onto a column (pillars.39 b) or another base (pillars.09)
        excludeWalls: new Set([...incidentWalls(doc, id), ...others.walls]),
        squareFrom: slideLine(doc, id) ? [] : farEnds(doc, id), // a straight joint slides instead (straight.21)
      });
      const line = mods.ctrl ? null : slideLine(doc, id); // a straight joint slides along its line (straight.21)
      const slid = line ? slidePoint(j, line, world, snap, snapStep(state)) : mods.ctrl ? { ...snap, point: mmPoint(snap.point) } : snap; // Ctrl: to the mm (straight.04)
      return { tried: { kind: "moves", moves: [{ jointId: id, to: slid.point }] }, snap: slid };
    }
    case "walls": {
      if (!target.wallIds.every((id) => doc.walls[id])) return { tried: NOTHING, snap: null };
      const r = wallsTry(doc, target, sub(world, pressWorld), snapStep(state), mods, snapToleranceM(state), viewBox(state.camera));
      return { tried: { kind: "wallsMove", by: r.by }, snap: r.snap };
    }
    case "placement": {
      // The footprint's centre follows the cursor; turning keeps it there, and the anchor follows (layout-states.49).
      const p = doc.placements[target.placementId];
      const object = p ? doc.objects[p.object] : undefined;
      const w = p ? object?.w[p.config] : undefined;
      const d = p ? object?.d[p.config] : undefined;
      const from = p ? placementCentre(doc, p) : null;
      const heights = p && object ? heightsOf(object, p.config) : null;
      const level = viewedLevel(state);
      if (!p || !from || w === undefined || d === undefined || !heights || !level) return { tried: NOTHING, snap: null };
      // Contact plus fit runs on the stepped centre from the angle at the press, the piece's own place ignored. Then,
      // on each axis no wall face within the tolerance holds (and Shift keeps), a guide measured from the unstepped
      // box shifts it at its new angle, so a guide never starts or undoes a turn (direct.55); with no guide in range
      // the place is contactPlace's.
      const raw = sub(world, pressWorld);
      const along = alongAxis(raw, mods.shift);
      const tolerance = snapToleranceM(state);
      // One piece lands at every place tried, at the viewed level, from the surface it stands on (decks.11, levels.08).
      const piece: Piece = { kind: object?.kind, config: p.config, arms: object?.arms, riser: object?.riser ?? null, heights, land: true, current: p.deck, ignore: [target.placementId], level };
      const placed = placeFootprint(doc, p.state, { w, d }, add(from, gridDelta(raw, snapStep(state), mods)), p.rotation + turn, { tolerance, free: mods.ctrl, ...piece });
      const axes = { x: !mods.shift || along.x !== 0, y: !mods.shift || along.y !== 0 };
      const c = alignAfterContact(doc, { layout: activeStateId(state), exclude: new Set([target.placementId]), size: { w, d }, free: add(from, along), placed, tolerance, ctrl: mods.ctrl, axes, ...piece });
      return { tried: placeTry(c.at, c.rotation, c.landed), snap: null };
    }
    case "placements": {
      // Every anchor moves by the same delta, kept to the millimetre (a Ctrl delta is off the grid); no piece turns.
      // The group aligns by the bounding box of its footprints, always along the screen axes.
      const all = footprints(doc);
      const quads = target.placementIds.flatMap((id) => all.get(id) ?? []);
      if (target.placementIds.some((id) => !doc.placements[id]) || quads.length === 0) return { tried: NOTHING, snap: null };
      // R turns the group about its box's centre (AC-01), as idle R does; it aligns by the turned box.
      const whole = boxOf(quads);
      const centre = { x: (whole.minX + whole.maxX) / 2, y: (whole.minY + whole.maxY) / 2 };
      const box: AxisBox = { ...(turn === 0 ? whole : boxOf(quads.map((q) => rotateAbout(q, centre, turn)))), edges: true };
      const delta = furnitureDelta(state, doc, box, sub(world, pressWorld), target.placementIds, mods);
      const places: Places | null = turn === 0
        ? target.placementIds.flatMap((id) => {
            const p = doc.placements[id];
            return p ? [{ placementId: id, at: { x: roundMm(p.at.x + delta.x), y: roundMm(p.at.y + delta.y) }, rotation: p.rotation }] : [];
          })
        : turnedPlaces(doc, target.placementIds, centre, turn, delta);
      if (places === null) return { tried: NOTHING, snap: null };
      return { tried: places.length > 0 ? { kind: "places", places } : NOTHING, snap: null };
    }
    case "opening": {
      // Only the part of the drag along the wall counts; the offset is kept to the centimetre.
      const o = doc.openings[target.openingId];
      const g = openingGeometry(doc, target.openingId);
      if (!o || !g) return { tried: NOTHING, snap: null };
      const along = dot(sub(world, pressWorld), g.along);
      return { tried: { kind: "slide", offset: slideOpening(o.offset, along, snapStep(state), mods.ctrl) }, snap: null };
    }
    case "resize": {
      const quad = footprints(doc).get(target.placementId);
      const side = quad ? sideOf(quad, target.side) : null;
      if (!side) return { tried: NOTHING, snap: null };
      const along = dot(sub(world, pressWorld), side.normal);
      const opts = { step: snapStep(state), tolerance: snapToleranceM(state), free: mods.ctrl, layout: activeStateId(state), hidden: hiddenPieces(state, doc), hiddenWalls: hiddenWalls(state, doc) };
      const size = resizeTo(doc, target.placementId, target.side, along, opts);
      return { tried: size === null ? NOTHING : { kind: "resize", side: target.side, size }, snap: null };
    }
    case "armGrip": {
      // Across the arm's inner edge, as a side grip (catalog.09); flush to walls and other pieces, never its own.
      const outline = ellOutline(doc, target.placementId);
      const spot = outline ? armSpot(outline, target.arm) : null;
      const opts = { step: snapStep(state), tolerance: snapToleranceM(state), free: mods.ctrl, layout: activeStateId(state), hidden: hiddenPieces(state, doc), hiddenWalls: hiddenWalls(state, doc) };
      const r = spot ? armTo(doc, target.placementId, target.arm, dot(sub(world, pressWorld), spot.normal), opts) : null;
      return { tried: r ? { kind: "arms", arm: target.arm, ...r } : NOTHING, snap: null };
    }
    case "rotate": {
      // The turn since the press, not the angle to the cursor: a grip is grabbed anywhere within HANDLE_HIT_PX, so
      // the piece does not jump on the first move. The near walls are those at the starting rotation.
      const p = doc.placements[target.placementId];
      const centre = p ? placementCentre(doc, p) : null;
      const quad = footprints(doc).get(target.placementId);
      const object = p ? doc.objects[p.object] : undefined;
      const w = p ? object?.w[p.config] : undefined;
      const d = p ? object?.d[p.config] : undefined;
      const heights = p && object ? heightsOf(object, p.config) : null;
      const level = viewedLevel(state);
      if (!p || !centre || !quad || !object || w === undefined || d === undefined || !heights || !level) return { tried: NOTHING, snap: null };
      const raw = distance(world, centre) < 1e-9 ? p.rotation : p.rotation + rotationTowards(centre, world) - rotationTowards(centre, pressWorld);
      // Only the walls the viewed level sees give a parallel snap (levels.19).
      const parallel = nearWalls(doc, quad, centre).filter((w) => wallSeenAt(doc, w.wallId, level)).map((w) => w.angleDeg);
      const rotation = gripRotation(raw, mods.ctrl ? [] : parallel, mods.ctrl);
      const at = anchorFor(doc, p, centre, rotation);
      // The turned piece lands at the viewed level, from the surface it stands on (decks.11, levels.08).
      if (!at) return { tried: NOTHING, snap: null };
      const landed = landsOn(doc, p.state, { kind: object.kind, config: p.config, arms: object.arms, riser: object.riser ?? null, heights, land: true, current: p.deck, ignore: [target.placementId], level }, { w, d }, at, rotation);
      return { tried: placeTry(at, rotation, landed), snap: null };
    }
    case "dimension": {
      // Absolute, as on the Dimension tool's third click, not a delta from the press: a press on the text brings the
      // line under the pointer once the drag starts.
      const d = doc.dimensions[target.dimensionId];
      const pts = d ? dimensionPoints(doc, d) : null;
      if (!pts) return { tried: NOTHING, snap: null };
      const across = acrossLine(pts.a, pts.b, world);
      const offset = mods.ctrl ? roundMm(across) : roundTo(across, snapStep(state));
      return { tried: { kind: "dimensionOffset", offset }, snap: null };
    }
    case "zoneDepth":
    case "zoneEnd": {
      const frame = zoneFrame(doc, target.placementId, target.side, target.strip);
      if (!frame) return { tried: NOTHING, snap: null };
      const edge = target.kind === "zoneDepth" ? "depth" : target.end;
      const opts = { step: snapStep(state), tolerance: snapToleranceM(state), free: mods.ctrl, hidden: hiddenPieces(state, doc), hiddenWalls: hiddenWalls(state, doc) };
      const extent = zoneDragExtent(doc, activeStateId(state), target.placementId, frame, edge, sub(world, pressWorld), opts);
      return { tried: { kind: "zoneExtent", side: target.side, extent }, snap: null };
    }
    case "deck": {
      // By the grid-rounded delta, as a wall: the centre keeps its offset from the grid (decks.06); then a side near a
      // wall face or another deck's edge lands on it (stairwell.37).
      const deck = deckView(doc, target.deckId);
      const tol = mods.ctrl ? 0 : state.snapSettings.tolerancePx / state.camera.zoom;
      return { tried: deck ? { kind: "deckMove", at: snapDeckAt(doc, target.deckId, add(deck.at, gridDelta(sub(world, pressWorld), snapStep(state), mods)), tol) } : NOTHING, snap: null };
    }
    case "deckSide": {
      const r = deckResize(doc, target.deckId, target.side, sub(world, pressWorld));
      return { tried: r ? { kind: "deckSize", ...r } : NOTHING, snap: null };
    }
    case "hole": {
      // As a deck: by the grid-rounded delta (stairwell.19); then a side near its deck's lines lands on them (stairwell.35).
      const found = holeView(doc, target.holeId);
      const tol = mods.ctrl ? 0 : state.snapSettings.tolerancePx / state.camera.zoom;
      if (!found) return { tried: NOTHING, snap: null };
      const { deck, hole } = found;
      const at = snapHoleAt(doc, target.holeId, add(hole.at, gridDelta(sub(world, pressWorld), snapStep(state), mods)), tol);
      return { tried: { kind: "holeMove", at }, snap: holeSnapMark(deck, target.holeId, { at, w: hole.w, d: hole.d }, GAP_SIDES, tol) };
    }
    case "holeSide": {
      const tol = mods.ctrl ? 0 : state.snapSettings.tolerancePx / state.camera.zoom;
      const r = holeResize(doc, target.holeId, target.side, sub(world, pressWorld), tol);
      const deck = holeView(doc, target.holeId)?.deck;
      return { tried: r ? { kind: "holeSize", ...r } : NOTHING, snap: r && deck ? holeSnapMark(deck, target.holeId, r, [target.side], tol) : null };
    }
    case "area": { // as a deck: by the grid-rounded delta, then a side near a wall face or another area's side (areas.29)
      const a = Object.hasOwn(doc.areas, target.areaId) ? doc.areas[target.areaId] : undefined;
      const tol = mods.ctrl ? 0 : state.snapSettings.tolerancePx / state.camera.zoom;
      return { tried: a ? { kind: "areaMove", at: snapAreaAt(doc, target.areaId, add(a.at, gridDelta(sub(world, pressWorld), snapStep(state), mods)), tol) } : NOTHING, snap: null };
    }
    case "areaSide": {
      const r = areaResize(doc, target.areaId, target.side, sub(world, pressWorld));
      return { tried: r ? { kind: "areaSize", ...r } : NOTHING, snap: null };
    }
    case "column": {
      // By the grid-rounded delta, as a deck; the centre kept to the millimetre (pillars.13).
      const column = columnOf(doc, target.wallId);
      const at = column ? add(column.centre, gridDelta(sub(world, pressWorld), snapStep(state), mods)) : null;
      return { tried: at ? { kind: "columnMove", at: { x: roundMm(at.x), y: roundMm(at.y) } } : NOTHING, snap: null };
    }
    case "sectionEnd": {
      // As the Section tool's second click: its snaps, angles and Shift's axis run from the end that stays.
      const row = doc.sections[target.sectionId];
      if (!row) return { tried: NOTHING, snap: null };
      const origin = target.end === "a" ? row.b : row.a;
      const snap = snapPoint({ doc, cursor: world, camera: state.camera, mods, origin, tolerancePx: state.snapSettings.tolerancePx, gridSpacing: snapStep(state), angles: true, policies: DIMENSION_POLICIES });
      return { tried: { kind: "sectionEnd", at: snap.point }, snap };
    }
    case "sectionFar": {
      const row = doc.sections[target.sectionId];
      return { tried: row ? { kind: "sectionDepth", depth: sectionDepthAt(row, world, snapStep(state), mods.ctrl) } : NOTHING, snap: null };
    }
    default:
      return assertNever(target);
  }
}

/** One piece's place where it lands, or no floor there at the viewed level (levels.16). */
function placeTry(at: Point, rotation: number, landed: Landed): DragTry {
  switch (landed.kind) {
    case "surface":
      return { kind: "place", at, rotation, deck: landed.deck };
    case "none":
      return { kind: "noFloor", at, rotation };
    default:
      return assertNever(landed);
  }
}

/**
 * A furniture move's delta (direct.17): `box` aligned to the furniture of the active layout the viewed level shows
 * (levels.19) except `exclude`, else the grid. A drag leaves out its own pieces; the duplicate's ghost leaves out none,
 * so a copy aligns to its original.
 */
export function furnitureDelta(state: EditorState, doc: Document, box: AxisBox, raw: Point, exclude: readonly string[], mods: Mods): Point {
  const level = viewedLevel(state);
  const others = level ? guideBoxes(doc, activeStateId(state), new Set(exclude), level) : [];
  return alignDelta(box, raw, others, { tolerance: snapToleranceM(state), step: snapStep(state), mods });
}

function gridDelta(d: Point, spacing: number, mods: Mods): Point {
  const constrained = mods.shift ? projectOnAxis(orthogonalAxis({ x: 0, y: 0 }, d), d) : d; // the larger axis
  return mods.ctrl ? mmPoint(constrained) : { x: roundTo(constrained.x, spacing), y: roundTo(constrained.y, spacing) };
}

/** The pieces the viewed level doesn't show: flush snaps ignore them, as guides and live distances do (levels.19). */
function hiddenPieces(state: EditorState, doc: Document): ReadonlySet<string> {
  const level = viewedLevelOn(state, doc);
  return new Set(Object.keys(doc.placements).filter((id) => !shownAt(doc, id, level)));
}

/** The walls the viewed level's snaps don't see (wallSeenAt): a grip's flush snaps ignore them too. */
function hiddenWalls(state: EditorState, doc: Document): ReadonlySet<string> {
  const level = viewedLevelOn(state, doc);
  return new Set(Object.keys(doc.walls).filter((id) => !wallSeenAt(doc, id, level)));
}

/** The Split gesture's tick for the pointer at `world` (tools/split-gesture.ts), with the snap step and tolerance of the moment. */
export function splitTick(state: EditorState, doc: Document, wallId: string, world: Point): SplitTick | null {
  return splitTickAt(doc, wallId, world, snapStep(state), snapToleranceM(state), SPLIT_REACH_PX / state.camera.zoom);
}

/** The far ends of the walls at joint `id`: what near-square squares a moved joint against (straight.10). */
function farEnds(doc: Document, id: string): Point[] {
  return incidentWalls(doc, id).flatMap((w) => {
    const wall = doc.walls[w];
    const far = wall ? doc.joints[wall.a === id ? wall.b : wall.a] : undefined;
    return far ? [{ x: far.x, y: far.y }] : [];
  });
}
