import { add, areaRing, columnOf, deckRing, deckView, footprintOf, holeView, footprints, geometryOf, sub, wallBodies, type Arms, type Document, type Opening } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { resizedPreview } from "../snapping/resize";
import type { DragTarget, DragTry, MoveAttempt } from "../tools/types";
import { COLORS } from "./colors";
import { placedFills, placedSymbol, polygons, symbolAt } from "./objects-layer";
import { shapedFills } from "./shapes";
import { spanQuad } from "./openings-layer";
import type { Primitive } from "./scene-types";
import { ringEdges } from "./rings";

/** The placements a drag's live distances measure (direct.12, AC-12): a moved or resized piece, or a group; a turn shows none. */
export function measuredPlacements(target: DragTarget): string[] {
  switch (target.kind) {
    case "placement":
    case "resize":
      return [target.placementId];
    case "placements":
      return target.placementIds;
    case "joint":
    case "walls":
    case "opening":
    case "rotate":
    case "armGrip": // the footprint stays: the depth label tells the arm
    case "dimension":
    case "zoneDepth":
    case "zoneEnd":
    case "deck":
    case "deckSide":
    case "hole":
    case "holeSide":
    case "area":
    case "areaSide":
    case "sectionEnd":
    case "sectionFar":
    case "column":
      return [];
    default:
      return assertNever(target);
  }
}

/** The placements whose alignment guides a drag shows (direct.13, AC-13): a moved piece or a group; a resize or a turn none. */
export function guideTargets(target: DragTarget): string[] {
  switch (target.kind) {
    case "placement":
      return [target.placementId];
    case "placements":
      return target.placementIds;
    case "joint":
    case "walls":
    case "opening":
    case "resize":
    case "rotate":
    case "armGrip":
    case "dimension":
    case "zoneDepth":
    case "zoneEnd":
    case "deck":
    case "deckSide":
    case "hole":
    case "holeSide":
    case "area":
    case "areaSide":
    case "sectionEnd":
    case "sectionFar":
    case "column":
      return [];
    default:
      return assertNever(target);
  }
}

/**
 * A refused attempt, drawn over the drawing (spec: tools, layouts, openings): a red disc at the cursor, the refused place of
 * an object or span of an opening, and every placement of the active layout the attempt would break.
 */
export function refusedOverlay(baseDoc: Document, target: DragTarget, attempt: MoveAttempt, layout: string | null): Primitive[] {
  const disc: Primitive = { kind: "disc", center: attempt.cursor, radius: { px: 4 }, color: COLORS.invalid };
  return [disc, ...refusedPlaces(baseDoc, target, attempt.tried, attempt.blocked, layout)];
}

/** A refused try without the cursor disc (a nudge has no cursor): the target's refused place and the pieces it breaks. */
export function refusedPlaces(baseDoc: Document, target: DragTarget, tried: DragTry, blocked: string[], layout: string | null): Primitive[] {
  return [...refusedTarget(baseDoc, target, tried), ...blockedPrimitives(baseDoc, blocked, layout)];
}

/** The `blocked` placements of the active layout, their shapes filled red, with their symbols; ids not in baseDoc are skipped. */
export function blockedPrimitives(baseDoc: Document, blocked: readonly string[], layout: string | null): Primitive[] {
  const out: Primitive[] = [];
  for (const id of blocked) {
    const p = baseDoc.placements[id];
    const quad = p?.state === layout ? footprints(baseDoc).get(id) : undefined;
    if (p && quad) out.push(...polygons(placedFills(baseDoc, p, quad), COLORS.invalidFill), ...placedSymbol(baseDoc, p, COLORS.invalid));
  }
  return out;
}

function refusedTarget(baseDoc: Document, target: DragTarget, tried: DragTry): Primitive[] {
  switch (target.kind) {
    case "joint":
    case "walls":
      return []; // the walls around the dragged joints are drawn red by the walls layer
    case "placement":
    case "rotate":
      return tried.kind === "place" || tried.kind === "noFloor" ? refusedPlace(baseDoc, target.placementId, tried) : [];
    case "placements":
      return tried.kind === "places" ? tried.places.flatMap((p) => refusedPlace(baseDoc, p.placementId, p)) : []; // every piece red
    case "opening": {
      const opening = attemptedOpening(baseDoc, target, tried);
      const g = opening ? geometryOf(baseDoc, opening) : null;
      return g ? [spanQuad(g, COLORS.invalidFill)] : [];
    }
    case "resize": {
      const ghost = tried.kind === "resize" ? resizedPreview(baseDoc, target.placementId, tried.side, tried.size) : null;
      return ghost ? refusedGhost(baseDoc, target.placementId, ghost) : [];
    }
    case "armGrip": { // the `L` with the refused arms (catalog.09)
      const p = baseDoc.placements[target.placementId];
      const object = p ? baseDoc.objects[p.object] : undefined;
      const w = p ? object?.w[p.config] : undefined;
      const d = p ? object?.d[p.config] : undefined;
      const quad = footprints(baseDoc).get(target.placementId);
      if (!p || !object || w === undefined || d === undefined || !quad || tried.kind !== "arms") return [];
      return refusedGhost(baseDoc, target.placementId, { kind: object.kind, config: p.config, w, d, at: p.at, rotation: p.rotation, quad, arms: tried.arms });
    }
    case "dimension":
      return []; // only an offset out of bounds (I15) is refused; the disc marks it
    case "zoneDepth":
    case "zoneEnd":
      return []; // the cursor disc marks a refused zone
    case "deck":
    case "deckSide": // the refused rectangle's outline in red
      return refusedDeck(baseDoc, target.deckId, tried);
    case "hole":
    case "holeSide":
      return refusedHole(baseDoc, target.holeId, tried);
    case "area":
    case "areaSide": { // the refused rectangle's outline in red (areas.29)
      const a = Object.hasOwn(baseDoc.areas, target.areaId) ? baseDoc.areas[target.areaId] : undefined;
      const r = tried.kind === "areaMove" && a ? { at: tried.at, w: a.w, d: a.d } : tried.kind === "areaSize" ? tried : null;
      return r ? ringEdges(areaRing(r), COLORS.invalid, 2, "round") : [];
    }
    case "column":
      return refusedColumn(baseDoc, target.wallId, tried);
    case "sectionEnd": { // the refused line in red, from the end that stays
      const row = baseDoc.sections[target.sectionId];
      if (!row || tried.kind !== "sectionEnd") return [];
      return [{ kind: "segment", a: target.end === "a" ? row.b : row.a, b: tried.at, width: { px: 2 }, color: COLORS.invalid, cap: "round" }];
    }
    case "sectionFar":
      return []; // a depth past the cut stops at Zero, so nothing here is refused
    default:
      return assertNever(target);
  }
}

/** A piece at a refused size or with refused arms: its shape filled red, and its symbol. */
function refusedGhost(baseDoc: Document, placementId: string, ghost: { kind: string; config: string; w: number; d: number; at: Point; rotation: number; quad: readonly Point[]; arms: Arms | undefined }): Primitive[] {
  const options = baseDoc.objects[baseDoc.placements[placementId]?.object ?? ""]?.options; // a desk keeps its computer, a set its round chairs
  const fills = shapedFills(ghost.kind, ghost.w, ghost.d, ghost.at, ghost.rotation, ghost.quad, options, ghost.arms); // its shape (shapefit.01), or a set's parts
  return [...polygons(fills, COLORS.invalidFill), ...symbolAt(ghost.kind, ghost.config, ghost.w, ghost.d, ghost.at, ghost.rotation, COLORS.invalid, undefined, options, ghost.arms)];
}

/** A deck at its refused place or size: its outline in red. */
function refusedDeck(baseDoc: Document, deckId: string, tried: DragTry): Primitive[] {
  const deck = deckView(baseDoc, deckId);
  if (!deck || (tried.kind !== "deckMove" && tried.kind !== "deckSize")) return [];
  return ringEdges(deckRing({ ...deck, ...tried }), COLORS.invalid, 2, "round");
}

/** A hole at its refused place or size: its outline in red, along its deck's axes. */
function refusedHole(baseDoc: Document, holeId: string, tried: DragTry): Primitive[] {
  const found = holeView(baseDoc, holeId);
  if (!found || (tried.kind !== "holeMove" && tried.kind !== "holeSize")) return [];
  const { at, w, d } = { ...found.hole, ...tried };
  return ringEdges(deckRing({ at, w, d, rotation: found.deck.rotation }), COLORS.invalid, 2, "round");
}

/** A column at its refused place: its body moved there, filled red. */
function refusedColumn(baseDoc: Document, wallId: string, tried: DragTry): Primitive[] {
  const column = columnOf(baseDoc, wallId);
  const body = wallBodies(baseDoc).get(wallId);
  if (!column || !body || tried.kind !== "columnMove") return [];
  const by = sub(tried.at, column.centre);
  return [{ kind: "polygon", points: body.map((p) => add(p, by)), holes: [], color: COLORS.invalidFill }];
}

/** A piece at its refused place: its shape filled red (shapefit.01), and its symbol. */
function refusedPlace(baseDoc: Document, placementId: string, place: { at: Point; rotation: number }): Primitive[] {
  const moved = baseDoc.placements[placementId];
  const refused = moved ? { ...moved, at: place.at, rotation: place.rotation } : undefined;
  const ghost = refused ? footprintOf(baseDoc, refused) : null;
  return refused && ghost ? [...polygons(placedFills(baseDoc, refused, ghost), COLORS.invalidFill), ...placedSymbol(baseDoc, refused, COLORS.invalid)] : [];
}

/** The dragged opening at its attempted offset (its wall's chain follows it, valid or not; ux-polish item 3), or null. */
export function attemptedOpening(baseDoc: Document, target: DragTarget, tried: DragTry): Opening | null {
  const o = target.kind === "opening" ? baseDoc.openings[target.openingId] : undefined;
  return o && tried.kind === "slide" ? { ...o, offset: tried.offset } : null;
}
