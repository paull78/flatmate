import { highlightedWalls, runJointTicks } from "./run-highlight";
import { areaOutlinesLayer } from "./area-outlines";
import { UNDERLAY_ID, deckView, newWallId, incidentWalls, underlayRect, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { screenToWorld, type Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import { gridSpacingFor } from "../snapping/snap";
import type { EditorState } from "../state";
import { dimensionDraft } from "../tools/dimension-tool";
import { draggedJoints } from "../tools/targets";
import { PREVIEW_OP } from "../tools/types";
import { COLORS } from "./colors";
import { drawHelper } from "./helper";
import { drawHoleGaps } from "./hole-gaps";
import type { Layer, LayerName, Layers, Primitive, Scene, SceneUnderlay } from "./scene-types";
import { deckLabelsLayer, decksLayer, overheadsLayer, slabFill } from "./decks-layer";
import { roofLines, withRoof } from "./roof-layer";
import { dimensionsLayer } from "./dimensions-layer";
import { floorsLayer } from "./finishes-layer";
import { piecesStyle } from "./floor-look";
import { idsKey, idsOf } from "./memo";
import { flipObjectsLayer, objectsLayer, warningsLayer } from "./objects-layer";
import { openingsDetailed, openingsLayer, spanVisible } from "./openings-layer";
import { notePlate, platePrimitives } from "./plate";
import { CANVAS_STYLE } from "./plan-style";
import { planView } from "../levels";
import { upperLevel } from "./plan-view";
import { deckFloorIds, deckFloors } from "./deck-floors-layer";
import { warningMarks } from "./warnings";
import { ghostsLayer, wallsLayer } from "./walls-layer";
import { sectionMarksLayer } from "./section-marks-layer";
import { openBelowLayer, selectedFloorsLayer, tagsLayer, zoneFillsLayer } from "./zones-layer";
import { drawSelection } from "./scene-selection";
import { drawToolOverlay } from "./scene-tools";
import { drawPresence, drawSnap } from "./scene-marks";

export const LAYER_ORDER: readonly LayerName[] = ["grid", "ghosts", "finishes", "zoneFills", "deckFloors", "decks", "objects", "overheads", "warnings", "walls", "openings", "deckLabels", "tags", "dimensions", "marks", "annotations", "overlays", "presence"];
const MAX_GRID_LINES = 400;
const PREVIEW_WALL = newWallId(PREVIEW_OP); // the wall created by the wall tool's preview addWall

const NONE: readonly Primitive[] = [];

export function buildScene(given: EditorState): Scene {
  // A row of the right-click list under the pointer is marked as a selection would be (AC-06); nothing is selected.
  const hovered = given.underPointer?.hovered;
  const state = hovered ? { ...given, selection: [hovered] } : given;
  const layers: Layers = { grid: [], annotations: [], overlays: [], presence: [] };
  drawGrid(state.camera, layers.grid);
  const doc = sceneDocument(state);
  const view = planView(state); // once per frame, the same object while the document and layout are (levels.16)
  let walls = NONE;
  let ghosts = NONE;
  let openings = NONE;
  let finishes = NONE;
  let zoneFills = NONE;
  let decks = NONE;
  let floorsOfDecks = NONE;
  let overheads = NONE;
  let deckLabels = NONE;
  let tags = NONE;
  let dimensions = NONE;
  let marks = NONE;
  let objects = NONE;
  let warnings = NONE;
  if (doc && view) {
    const { layout, level } = view;
    const pieces = piecesStyle(doc, CANVAS_STYLE, state.finishesOn); // white over finishes (seating.02), once per frame
    objects = state.flip
      ? flipObjectsLayer(doc, level, state.flip, pieces)
      : objectsLayer(doc, view, pieces, idsKey(state.selection.filter((r) => r.table === "placements").map((r) => r.id)), state.camera.zoom);
    warnings = warningsLayer(doc, view);
    const selectedDecks = idsKey(state.selection.filter((r) => r.table === "decks" || r.table === "deckHoles").map((r) => r.id)); // a hole outlines in blue too
    decks = decksLayer(doc, level, CANVAS_STYLE, selectedDecks, deckFloorIds(doc, view, CANVAS_STYLE, state.finishesOn));
    floorsOfDecks = deckFloors(doc, view, CANVAS_STYLE, state.camera.zoom, state.finishesOn); // where the level owns the deck (deck-floors.06)
    const hovered = state.tool.name === "zone" && state.tool.state.hoverDeck !== null ? deckView(doc, state.tool.state.hoverDeck) : null;
    if (hovered) decks = [...decks, ...slabFill(hovered, COLORS.zoneFinishTint)]; // the Floor mode's deck, under the pieces as a hovered room's tint (deck-floors.02)
    overheads = overheadsLayer(doc, level, CANVAS_STYLE, selectedDecks, state.hover?.table === "deckHoles" ? state.hover.id : null);
    deckLabels = withRoof(roofLines(doc, CANVAS_STYLE), deckLabelsLayer(doc, level, CANVAS_STYLE, state.camera.zoom)); // the roof's lines over the walls and openings, under the labels
    finishes = floorsLayer(doc, view, CANVAS_STYLE, state.camera.zoom, state.finishesOn); // this viewer's switch (finishes.09)
    if (!upperLevel(view)) { // room fills, tags and dimensions are the floor level's (levels.04)
      const labels = idsKey(state.selection.filter((r) => r.table === "zoneLabels").map((r) => r.id));
      const zoneTool = state.tool.name === "zone" ? state.tool.state : null;
      zoneFills = zoneFillsLayer(doc, labels, zoneTool !== null, zoneTool?.hoverFaceKey ?? null, state.finishesOn);
      layers.annotations.push(...selectedFloorsLayer(doc, labels, state.finishesOn)); // above the walls: the floor's edges are their faces (finishes.47)
      const areas = idsKey(state.selection.filter((r) => r.table === "areas").map((r) => r.id));
      layers.annotations.push(...areaOutlinesLayer(doc, CANVAS_STYLE, areas, state.hover?.table === "areas" ? state.hover.id : null, zoneTool !== null)); // on screen only (areas.02)
      tags = tagsLayer(doc, CANVAS_STYLE, state.camera.zoom, idsKey([...idsOf(labels), ...idsOf(areas)]), layout); // a selected room's or area's name in blue
      dimensions = dimensionsLayer(doc, CANVAS_STYLE, state.camera.zoom, idsKey(state.selection.filter((r) => r.table === "dimensions").map((r) => r.id)), dimensionDraft(state));
    } else {
      tags = openBelowLayer(doc, level, CANVAS_STYLE, state.camera.zoom); // a loft's level: Open to below (edges.07)
    }
    marks = sectionMarksLayer(doc, CANVAS_STYLE, state.camera.zoom, idsKey(state.selection.filter((r) => r.table === "sections").map((r) => r.id)), !state.sectionMarksOn); // at every level
    const wallArgs: Parameters<typeof wallsLayer> = [
      doc,
      level,
      CANVAS_STYLE,
      idsKey(state.selection.filter((r) => r.table === "walls").map((r) => r.id)),
      idsKey(highlightedWalls(state, doc)) || null, // none as null, as exports pass it (one memo); the hovered or selected wall's run, a moving drag's walls (straight.16)
      idsKey([...invalidWalls(state, doc)]),
      doc.walls[PREVIEW_WALL] ? PREVIEW_WALL : null, // only while the Wall tool previews a wall
    ];
    walls = wallsLayer(...wallArgs);
    ghosts = ghostsLayer(...wallArgs); // the same memoised build: drawn before the decks (levels.50)
    openings = openingsLayer(doc, level, CANVAS_STYLE, idsKey(state.selection.filter((r) => r.table === "openings").map((r) => r.id)), state.finishesOn, spanVisible(doc, CANVAS_STYLE, state.camera.zoom), openingsDetailed(CANVAS_STYLE, state.camera.zoom));
    layers.overlays.push(...warningMarks(doc, view, state.camera.zoom)); // first, so a grip is never under a mark
    layers.overlays.push(...runJointTicks(state, doc)); // the joints between a lit run's pieces (straight.42)
    drawSelection(state, doc, layers.overlays, layers.annotations);
    drawHelper(state, doc, layers.annotations); // selected wall, Select tool only
    drawHoleGaps(state, doc, layers.annotations); // one selected hole, Select tool only (stairwell.36)
    drawToolOverlay(state, doc, view, pieces, layers);
  }
  drawSnap(state, layers.overlays);
  drawPresence(state, layers.presence);
  // In the last layer: on the GPU polygons draw first within a layer, so in `overlays` lines would cross its box (clarity.13).
  if (state.plate) layers.presence.push(...platePrimitives(state.plate.text, state.plate.anchor, "refusal", state.camera, state.plate.advice));
  else if (doc) layers.presence.push(...notePlate(state, doc));
  const all: Record<LayerName, readonly Primitive[]> = { ...layers, walls, ghosts, openings, finishes, zoneFills, deckFloors: floorsOfDecks, decks, overheads, deckLabels, tags, dimensions, marks, objects, warnings };
  return { layers: LAYER_ORDER.map((name): Layer => ({ name, primitives: all[name] })), underlay: sceneUnderlay(state) };
}

/**
 * The plan underlay (import.11): read from the visible document, not the gesture's preview, so a stale preview never
 * hides it; null with no picture or while this viewer hides it. `data` is the row's string, never copied.
 */
function sceneUnderlay(state: EditorState): SceneUnderlay | null {
  if (!state.document || !state.underlayView.visible) return null;
  const doc = visibleDoc(state.document);
  const row = doc.underlays[UNDERLAY_ID];
  const rect = underlayRect(doc);
  return row && rect ? { pictureId: row.pictureId, data: row.data, rect, fade: state.underlayView.fade } : null;
}

/** The document to draw: a gesture's preview while one is active, otherwise the visible document. */
export function sceneDocument(state: EditorState): Document | null {
  if (!state.document) return null;
  const tool = state.tool;
  switch (tool.name) {
    case "select":
      return tool.state.kind === "moving" || tool.state.kind === "nudging" ? tool.state.attempt.doc : visibleDoc(state.document);
    case "wall":
      return tool.state.kind === "drawing" && tool.state.preview?.ok ? tool.state.preview.doc : visibleDoc(state.document);
    case "zone":
    case "object":
    case "opening":
    case "dimension":
    case "column": // its ghost is an overlay
    case "deck":
    case "hole":
    case "section": // its preview is an overlay
    case "scale":
      return visibleDoc(state.document);
    default:
      return assertNever(tool);
  }
}

function drawGrid(camera: Camera, out: Primitive[]): void {
  const s = gridSpacingFor(camera.zoom);
  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: camera.viewport.width, y: camera.viewport.height });
  const x0 = Math.ceil(topLeft.x / s);
  const x1 = Math.floor(bottomRight.x / s);
  const y0 = Math.ceil(bottomRight.y / s);
  const y1 = Math.floor(topLeft.y / s);
  if (x1 - x0 + (y1 - y0) > MAX_GRID_LINES) return;
  const line = (a: Point, b: Point, major: boolean): Primitive => ({
    kind: "segment", a, b, width: { px: 1 }, color: major ? COLORS.gridMajor : COLORS.grid, cap: "butt",
  });
  for (let i = x0; i <= x1; i++) out.push(line({ x: i * s, y: bottomRight.y }, { x: i * s, y: topLeft.y }, i % 5 === 0));
  for (let j = y0; j <= y1; j++) out.push(line({ x: topLeft.x, y: j * s }, { x: bottomRight.x, y: j * s }, j % 5 === 0));
}

/** While a drag is invalid, the walls around the dragged joints are drawn red (spec: tools). */
function invalidWalls(state: EditorState, doc: Document): Set<string> {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "moving" || tool.state.attempt.ok) return new Set();
  return new Set(draggedJoints(doc, tool.state.target).flatMap((j) => incidentWalls(doc, j)));
}
