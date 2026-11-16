import { EPS, add, deckLabel, deckRing, deckView, footprintOf, footprintQuad, geometryOf, length, perpLeft, quadCentre, scale, sub, type Document, type Level, type StairEdge, shown } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import { ghostPieces } from "../duplicate";
import { alignmentGuides, guideBoxes, guidesBetween, shapedBoxAt, type Guide } from "../snapping/guides";
import { sideOf } from "../snapping/resize";
import { activeStateId, type EditorState } from "../state";
import { deckDraft } from "../tools/deck-tool";
import { holeDraft } from "../tools/hole-tool";
import { zoneDraft } from "../tools/area-draft";
import { sectionDraft } from "../tools/section-tool";
import { scaleOverlay } from "../tools/scale-tool";
import { attemptedOpening, blockedPrimitives, guideTargets, refusedOverlay, refusedPlaces } from "./refused-overlay";
import type { StairLGhost, WallPreview } from "../tools/types";
import { COLORS } from "./colors";
import { drawDistances } from "./distances";
import { CHROME_FONT, HELPER_FONT } from "./fonts";
import { ROTATE_GRIP_PX, resizeLabelBox } from "./handles";
import { drawChain } from "./helper";
import { drawSplit } from "./split-view";
import { labelBox, slideClear, textBox } from "./labels";
import { deckLabelBox } from "./deck-label";
import type { Layers, Primitive } from "./scene-types";
import { sectionMark } from "./section-marks-layer";
import { drawnLabel } from "./drawn-label";
import { ghostAbove, ghostPrimitives } from "./objects-layer";
import { INVALID_LOOK, PREVIEW_LOOK, openingPrimitives, openingsDetailed } from "./openings-layer";
import { CANVAS_STYLE, type PlanStyle } from "./plan-style";
import type { PlanView } from "./plan-view";
import { ringEdges } from "./rings";

const DRAWN_FRONT_PX = 6; // a drawn footprint's front edge, read at a glance while drawing (sizing.12)

const ANGLE_LABEL_PX = ROTATE_GRIP_PX + 16; // a turn's angle label, beyond the rotation grip
const CAUGHT_EDGE_PX = 3; // the stair gesture's caught edge
const EDGE_TAG_PX = 8; // its tag's box, this far behind the edge

/** The tool's marks; `pieces` is the frame's style for pieces, so a ghost fills as the picture's pieces do (seating.02). */
export function drawToolOverlay(state: EditorState, doc: Document, view: PlanView, pieces: PlanStyle, layers: Layers): void {
  const tool = state.tool;
  switch (tool.name) {
    case "wall": {
      const p = tool.state.kind === "drawing" ? tool.state.preview : null;
      if (!p) return;
      if (!p.ok) layers.overlays.push({ kind: "segment", a: p.from, b: p.to, width: { m: state.wallThickness }, color: COLORS.invalid, cap: "butt" });
      drawLengthLabel(p, state.camera, layers.annotations);
      return;
    }
    case "select": {
      if (tool.state.kind === "box" && tool.state.corner) layers.overlays.push(...boxPrimitives(tool.state.pressWorld, tool.state.corner));
      if (tool.state.kind === "nudging") {
        const { attempt, target, baseDoc } = tool.state; // a nudge has no cursor, so no disc
        if (!attempt.ok) layers.overlays.push(...refusedPlaces(baseDoc, target, attempt.tried, attempt.blocked, activeStateId(state)));
        // The guides the run's preview lands on, none while refused; a nudge never snaps to them (direct.13).
        if (attempt.ok) layers.overlays.push(...guidePrimitives(alignmentGuides(attempt.doc, guideTargets(target), activeStateId(state), view.level)));
      }
      // The duplicate's ghost, drawn as the Object tool's, and every piece it would hit red, with no cursor disc; the
      // scene's document stays the visible one (ghost.01). Its guides as a drag's, none while refused (ghost.02).
      if (tool.state.kind === "copying") {
        const t = tool.state;
        layers.overlays.push(...ghostPieces(t).flatMap((g) => ghostPrimitives(g, ghostAbove(view.level, g), pieces)), ...blockedPrimitives(t.baseDoc, t.attempt.blocked, activeStateId(state)));
        layers.overlays.push(...guidePrimitives(t.attempt.guides));
      }
      drawDistances(state, doc, layers.annotations); // furniture moved, resized, nudged or copied (AC-12)
      const s = tool.state;
      if (s.kind === "splitting" && s.tick && doc) drawSplit(state, doc, s.wallId, s.tick, s.value, layers.annotations); // the tick and the clear distances (straight step 15)
      if (tool.state.kind !== "moving") return;
      const { attempt, target, baseDoc } = tool.state;
      if (!attempt.ok) layers.overlays.push(...refusedOverlay(baseDoc, target, attempt, activeStateId(state)));
      layers.overlays.push(...guidePrimitives(attempt.guides)); // furniture moves only (AC-13)
      // An opening drag, valid or not, shows its wall's chain with the opening at the attempted offset (ux-polish item 3).
      const opening = attemptedOpening(baseDoc, target, attempt.tried);
      if (opening) drawChain(state, baseDoc, opening.wall, layers.annotations, opening);
      const size = resizeLabelBox(state); // a resize's new size by the moving side (AC-04), red while refused
      if (size) gripLabel(size.text, size.at, size.ok, state.camera, layers.annotations);
      if (target.kind === "rotate" && attempt.tried.kind === "place") drawAngleLabel(baseDoc, target.placementId, attempt.tried, attempt.ok, state.camera, layers.annotations);
      return;
    }
    case "zone": {
      // The area being drawn (areas.06): the deck style's dashed outline, red where addArea refuses it.
      const draft = zoneDraft(state);
      const { line, dash } = CANVAS_STYLE.deck;
      if (draft) layers.overlays.push(...ringEdges(draft.ring, draft.ok ? line.color : COLORS.invalid, line.width, "butt", dash));
      return;
    }
    case "dimension": // the preview is the dimensions layer's draft (dims.19); the snap mark comes from state.snap
      return;
    case "scale":
      layers.overlays.push(...scaleOverlay(state));
      return;
    case "section": {
      const draft = sectionDraft(state);
      if (draft) layers.overlays.push(...sectionMark(draft, CANVAS_STYLE, state.camera.zoom, CANVAS_STYLE.mark.selected));
      return;
    }
    case "deck": {
      // The deck being drawn: the deck style's dashed outline, red where addDeck refuses it.
      const draft = deckDraft(state);
      const { line, dash } = CANVAS_STYLE.deck;
      if (draft) layers.overlays.push(...ringEdges(draft.ring, draft.ok ? line.color : COLORS.invalid, line.width, "butt", dash));
      return;
    }
    case "hole": {
      const draft = holeDraft(state);
      const { line, dash } = CANVAS_STYLE.deck;
      if (draft) layers.overlays.push(...ringEdges(draft.ring, draft.ok ? line.color : COLORS.invalid, line.width, "butt", dash));
      return;
    }
    case "column": {
      // The column a click would place (pillars.19): its body, see-through blue, red where placeColumn refuses.
      const ghost = tool.state.ghost;
      if (ghost) layers.overlays.push({ kind: "polygon", points: [...ghost.ring], holes: [], color: ghost.ok ? COLORS.preview : COLORS.invalidFill });
      return;
    }
    case "object": {
      const ghost = tool.state.preview ?? tool.state.ghost; // a hovered fix chip's stair, in the ghost's place (stairdraw.13)
      if (!ghost) return;
      if (ghost.set) layers.overlays.push(...ghost.set.flatMap((g) => ghostPrimitives({ ...g, fits: ghost.fits }, ghostAbove(view.level, ghost), pieces)));
      else layers.overlays.push(...ghostPrimitives(ghost, ghostAbove(view.level, ghost), ghost.drawn ? { ...pieces, objectFront: DRAWN_FRONT_PX } : pieces)); // dashed on a loft (decks.11); a drawn one's front a thick bar (sizing.07)
      layers.overlays.push(...drawnLabel(state, ghost));
      if (ghost.l) layers.overlays.push(...lGhostPrimitives(ghost.l, ghost.fits, view.level, pieces));
      // A caught edge, highlighted and tagged; its ghost is on the edge, never moved by a guide (stairdraw.02).
      const caught = tool.state.stair?.edge;
      if (caught) return drawCaughtEdge(doc, caught, ghost.at, state.camera, layers);
      // Its guides as a drag's (furnish.16): none while red or with Ctrl.
      const centre = quadCentre(footprintQuad(ghost.at, ghost.w, ghost.d, ghost.rotation));
      if (!ghost.fits || state.pointer?.mods.ctrl || !centre) return;
      layers.overlays.push(...guidePrimitives(guidesBetween(shapedBoxAt(centre, ghost.w, ghost.d, ghost.rotation, ghost.kind), guideBoxes(doc, activeStateId(state), new Set(), view.level))));
      return;
    }
    case "opening": {
      if (!tool.state.preview) return;
      const { opening, ok } = tool.state.preview;
      const doc = state.document ? visibleDoc(state.document) : null;
      const g = doc ? geometryOf(doc, opening) : null;
      if (g) layers.overlays.push(...openingPrimitives(opening, g, ok ? PREVIEW_LOOK : INVALID_LOOK, true, openingsDetailed(CANVAS_STYLE, state.camera.zoom)));
      if (doc) drawChain(state, doc, opening.wall, layers.annotations, opening); // a red preview keeps its chain
      return;
    }
    default:
      assertNever(tool);
  }
}

/**
 * The Select tool's box (direct.07): a faint fill, then four dashed 1 px outlines. The fill goes first because WebGL
 * draws a layer's polygons before its segments; Canvas2D then draws them in the same order.
 */
function boxPrimitives(a: Point, b: Point): Primitive[] {
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  const edge = (p: Point, i: number): Primitive => ({
    kind: "segment", a: p, b: corners[(i + 1) % 4] ?? p, width: { px: 1 }, color: COLORS.wallSelected, cap: "butt", dash: [4, 3],
  });
  return [{ kind: "polygon", points: corners, holes: [], color: COLORS.boxFill }, ...corners.map(edge)];
}

/** Alignment guides (AC-13): thin lines in the aligned snap guides' orange. */
function guidePrimitives(guides: readonly Guide[]): Primitive[] {
  return guides.map((g) => ({ kind: "segment", a: g.a, b: g.b, width: { px: 1 }, color: COLORS.snapGuide, cap: "butt" }));
}

/** Live length and angle of the wall being drawn (F1). */
function drawLengthLabel(p: WallPreview, camera: Camera, out: Primitive[]): void {
  const d = sub(p.to, p.from);
  const len = length(d);
  if (len < EPS) return;
  const degrees = Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI);
  const text = `${shown(len)} m  ${degrees}°`;
  const at = add(scale(add(p.from, p.to), 0.5), scale(perpLeft(scale(d, 1 / len)), 16 / camera.zoom));
  out.push(textBox(text, at, HELPER_FONT, camera));
  out.push({ kind: "text", text, at, size: HELPER_FONT.size, color: p.ok ? COLORS.text : COLORS.invalid, align: "center", rotation: 0, font: CHROME_FONT });
}

/** A turn's angle by the rotation grip, at the tried rotation (AC-05), red while refused. */
function drawAngleLabel(baseDoc: Document, placementId: string, tried: { at: Point; rotation: number }, ok: boolean, camera: Camera, out: Primitive[]): void {
  const p = baseDoc.placements[placementId];
  const quad = p ? footprintOf(baseDoc, { ...p, at: tried.at, rotation: tried.rotation }) : null;
  const front = quad ? sideOf(quad, "front") : null;
  if (!front) return;
  gripLabel(`${tried.rotation}°`, add(front.mid, scale(front.normal, ANGLE_LABEL_PX / camera.zoom)), ok, camera, out);
}

/** An L's landing, drawn as the Deck tool draws its draft (a dashed outline, red where the L doesn't fit), and its lower flight. */
function lGhostPrimitives(l: StairLGhost, fits: boolean, level: Level, pieces: PlanStyle): Primitive[] {
  const { line, dash } = CANVAS_STYLE.deck;
  return [...ringEdges(deckRing(l.landing), fits ? line.color : COLORS.invalid, line.width, "butt", dash), ...ghostPrimitives(l.lower, ghostAbove(level, l.lower), pieces)];
}

/**
 * The stair gesture's caught edge (stairdraw.11): drawn in the snap colour, tagged "Loft edge · 2.15" behind `at`, over
 * the deck, clear of the ghost and slid along the edge off the deck's own label.
 */
function drawCaughtEdge(doc: Document, edge: StairEdge, at: Point, camera: Camera, layers: Layers): void {
  layers.overlays.push({ kind: "segment", a: edge.a, b: edge.b, width: { px: CAUGHT_EDGE_PX }, color: COLORS.snap, cap: "butt" });
  const deck = deckView(doc, edge.deck);
  if (!deck) return;
  const text = `${deckLabel(deck)} edge · ${shown(deck.top)}`;
  const half = labelBox(text, { x: 0, y: 0 }, HELPER_FONT, camera).max; // so the whole box clears the edge
  const behind = add(at, scale(edge.normal, -(EDGE_TAG_PX / camera.zoom + Math.abs(edge.normal.x) * half.x + Math.abs(edge.normal.y) * half.y)));
  // Off the deck's own label, along the edge (stairwell.37): a hole's side can run past the deck's top-left corner.
  const along = scale(sub(edge.b, edge.a), 1 / Math.max(length(sub(edge.b, edge.a)), EPS));
  const where = slideClear(behind, labelBox(text, behind, HELPER_FONT, camera), deckLabelBox(deck, CANVAS_STYLE, camera.zoom), along, EDGE_TAG_PX / camera.zoom);
  layers.annotations.push(textBox(text, where, HELPER_FONT, camera));
  layers.annotations.push({ kind: "text", text, at: where, size: HELPER_FONT.size, color: COLORS.text, align: "center", rotation: 0, font: CHROME_FONT });
}

/** A grip drag's label on its background box, red while refused. */
function gripLabel(text: string, at: Point, ok: boolean, camera: Camera, out: Primitive[]): void {
  out.push(textBox(text, at, HELPER_FONT, camera));
  out.push({ kind: "text", text, at, size: HELPER_FONT.size, color: ok ? COLORS.text : COLORS.invalid, align: "center", rotation: 0, font: CHROME_FONT });
}
