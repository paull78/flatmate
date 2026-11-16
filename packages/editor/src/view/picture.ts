import { deckFloorIds, deckFloors } from "./deck-floors-layer";
import { dimensionPoints, footprints, geometryOf, isFloor, levelOf, sectionsOf, shownAt, sortedIds, wallOutlines, type Document, type Level } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { deckLabelsLayer, decksLayer, overheadsLayer } from "./decks-layer";
import { roofEdge, roofLines } from "./roof-layer";
import { dimensionLine } from "./dimension-layout";
import { dimensionsLayer } from "./dimensions-layer";
import { floorsLayer } from "./finishes-layer";
import { piecesStyle } from "./floor-look";
import { objectsLayer } from "./objects-layer";
import { openingCut, openingReach, openingsDetailed, openingsLayer, spanVisible } from "./openings-layer";
import type { PlanStyle } from "./plan-style";
import { upperLevel, type PlanView } from "./plan-view";
import type { Primitive } from "./scene-types";
import { sectionMarksLayer } from "./section-marks-layer";
import { ghostsLayer, wallsLayer } from "./walls-layer";
import { openBelowLayer, tagsLayer } from "./zones-layer";

export { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, presentationStyle, type PlanStyle } from "./plan-style";

/**
 * The picture of a document in a layout (export.01, arch-review L1): its floors, ghost walls, decks, objects, overhead
 * lines, walls, openings, deck labels, tags, dimensions and section marks, drawn from the document alone with a style. `zoom` is drawing
 * units per metre: screen pixels on the canvas, paper millimetres in an export (1000 / scale). The canvas Scene takes
 * these layers from the same builders, so canvas and paper cannot drift.
 */
export type PlanPicture = {
  floors: readonly Primitive[]; // under everything: the finished rooms' colours and patterns (finishes.10)
  ghosts: readonly Primitive[]; // under the level's decks and pieces: the ghost walls below an upper level (levels.50)
  deckFloors: readonly Primitive[]; // over the ghosts, under the decks' edges: the finishes of the decks the level owns
  decks: readonly Primitive[];
  objects: readonly Primitive[];
  overheads: readonly Primitive[]; // over the pieces: drafting draws overhead lines on top
  walls: readonly Primitive[];
  openings: readonly Primitive[];
  roof: readonly Primitive[]; // the roof's overhead lines (roofs.11), over the walls and openings so a door never cuts an arrow; a card leaves it out
  deckLabels: readonly Primitive[]; // over the walls, so a partition under a loft never hides its label
  tags: readonly Primitive[];
  dimensions: readonly Primitive[];
  marks: readonly Primitive[]; // sections, at every level
};

const NONE = "";

/**
 * The picture at the view's level; at an upper level it has no floors, tags or dimensions (levels.04). `finishes` is the
 * export's With / Without; a style without a finish (look) draws none either way. A flag, not a second style, so the
 * other memoised layers keep their arrays between a With and a Without export.
 */
export function planPicture(doc: Document, view: PlanView, style: PlanStyle, zoom: number, finishes: boolean): PlanPicture {
  // Pieces draw white over finishes (seating.02), in a style memoised per style, so the objects layer keeps its array.
  const floor = !upperLevel(view);
  return {
    floors: floorsLayer(doc, view, style, zoom, finishes),
    ghosts: ghostsLayer(doc, view.level, style, NONE, null, NONE, null),
    deckFloors: deckFloors(doc, view, style, zoom, finishes), // decks the level owns (deck-floors.06)
    decks: decksLayer(doc, view.level, style, NONE, deckFloorIds(doc, view, style, finishes)),
    objects: objectsLayer(doc, view, piecesStyle(doc, style, finishes), NONE, zoom),
    overheads: overheadsLayer(doc, view.level, style, NONE, null),
    roof: roofLines(doc, style),
    walls: wallsLayer(doc, view.level, style, NONE, null, NONE, null),
    openings: openingsLayer(doc, view.level, style, NONE, finishes, spanVisible(doc, style, zoom), openingsDetailed(style, zoom)),
    deckLabels: deckLabelsLayer(doc, view.level, style, zoom),
    tags: floor ? tagsLayer(doc, style, zoom, NONE, view.layout) : openBelowLayer(doc, view.level, style, zoom), // a loft's level: Open to below (edges.07)
    dimensions: floor ? dimensionsLayer(doc, style, zoom, NONE, null) : [],
    marks: sectionMarksLayer(doc, style, zoom, NONE, false),
  };
}

/** The picture's primitives in drawing order, as the canvas layers stack them. */
export function pictureLayers(p: PlanPicture): Primitive[] {
  return [...p.floors, ...p.ghosts, ...p.deckFloors, ...p.decks, ...p.objects, ...p.overheads, ...p.walls, ...p.openings, ...p.roof, ...p.deckLabels, ...p.tags, ...p.dimensions, ...p.marks];
}

const BOUNDS_MARGIN_M = 0.5;

export type Bounds = { min: Point; max: Point };

const boundsOf = (points: readonly Point[]): Bounds | null => {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
};

const wallPoints = (doc: Document): Point[] => [...wallOutlines(doc)].flatMap(([, outline]) => outline);

const labelPoints = (doc: Document): Point[] => Object.values(doc.zoneLabels).map((label) => label.at);

function dimensionPointsOf(doc: Document): Point[] {
  return Object.values(doc.dimensions).flatMap((d) => {
    const p = dimensionPoints(doc, d); // null only when an anchor's joint is gone, which I15 rules out
    return p ? [p.a, p.b, ...(dimensionLine(p.a, p.b, d.offset) ?? [])] : [];
  });
}

/** Where the door swings and a sliding door's parked leaf, cut at `level`, reach. */
function swingPoints(doc: Document, level: Level): Point[] {
  return sortedIds(doc.openings).flatMap((id) => {
    const o = doc.openings[id];
    const g = o && openingCut(doc, id, level) ? geometryOf(doc, o) : null;
    return o && g ? openingReach(o, g) : [];
  });
}

/**
 * What a level draws in a layout, in metres, with no margin; null when nothing (sheetset.10). The fit test reads it, on
 * paper. Every wall draws at every level, filled or as a ghost; pieces and door swings as the level's layers choose them;
 * labels and dimensions at the floor alone. A dimension's text has paper sizes and a sliding leaf stands 4 cm past its
 * wall's face: both rely on the frame's inset.
 */
export function drawnBounds(doc: Document, layout: string | null, level: Level = levelOf(doc, null)): Bounds | null {
  const points = wallPoints(doc);
  for (const [id, quad] of footprints(doc)) if (doc.placements[id]?.state === layout && shownAt(doc, id, level)) points.push(...quad);
  points.push(...swingPoints(doc, level));
  if (isFloor(level)) points.push(...labelPoints(doc), ...dimensionPointsOf(doc));
  points.push(...roofEdge(doc)); // the roof's overhang at every level (roofs.11)
  return boundsOf(points);
}

/**
 * What an image frames: the wall outlines, the layout's footprints, the labels, every dimension's measured points and
 * line and the floor's door swings, plus a margin (a margin box when empty). Every level's image takes the floor's swings,
 * so two levels' images line up. Pure geometry in metres (dims.20): a dimension's text and overshoot have paper sizes, so
 * they rely on the margin. Cards; PNG, SVG and look read `markedBounds`, a sheet's fit `drawnBounds`.
 */
export function pictureBounds(doc: Document, layout: string | null): Bounds {
  const pieces = [...footprints(doc)].flatMap(([id, quad]) => (doc.placements[id]?.state === layout ? [...quad] : []));
  const b = boundsOf([...wallPoints(doc), ...pieces, ...labelPoints(doc), ...dimensionPointsOf(doc), ...swingPoints(doc, levelOf(doc, null))]) ?? { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  return {
    min: { x: b.min.x - BOUNDS_MARGIN_M, y: b.min.y - BOUNDS_MARGIN_M },
    max: { x: b.max.x + BOUNDS_MARGIN_M, y: b.max.y + BOUNDS_MARGIN_M },
  };
}

/**
 * What PNG, SVG and look frame: `pictureBounds`, grown to take each section's ends with the same margin, which holds their
 * arrows and letters at those pictures' scales (they have paper sizes, as a dimension's text). A sheet's frame ignores
 * marks, so adding a section moves no sheet (section.12); cards draw none.
 */
export function markedBounds(doc: Document, layout: string | null): Bounds {
  const b = pictureBounds(doc, layout);
  const ends = boundsOf([...sectionsOf(doc).flatMap((s) => [s.a, s.b]), ...roofEdge(doc)]); // with the roof's edge (roofs.11)
  if (!ends) return b;
  return {
    min: { x: Math.min(b.min.x, ends.min.x - BOUNDS_MARGIN_M), y: Math.min(b.min.y, ends.min.y - BOUNDS_MARGIN_M) },
    max: { x: Math.max(b.max.x, ends.max.x + BOUNDS_MARGIN_M), y: Math.max(b.max.y, ends.max.y + BOUNDS_MARGIN_M) },
  };
}
