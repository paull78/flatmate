import { armsOf, columnOf, deckView, execute, holeView, type Command, type Document, type DomainError } from "@fm/domain";
import { assertNever, type EntityKey } from "@fm/protocol";
import { widthSide } from "../snapping/resize";
import { zoneFrame } from "../snapping/zone-drag";
import { draggedJoints, draggedPlacements } from "./targets";
import { PREVIEW_OP, type DragTarget, type DragTry } from "./types";

/**
 * The command a drag commits: the joints' moves, the placement's new place (moved or turned), the group's places, the
 * opening's new offset, the resized side's size, an `L`'s new arms, the dimension's new offset, or the zone's new extent.
 */
export function tryCommand(target: DragTarget, tried: DragTry): Command | null {
  switch (tried.kind) {
    case "none":
    case "noFloor": // refused by the editor (levels.16)
      return null;
    case "moves": { // a joint drag connects where it lands (straight.18); the preview's opId is re-issued at release
      const [move] = tried.moves;
      if (target.kind === "joint" && move !== undefined && tried.moves.length === 1) return { type: "connectJoint", opId: PREVIEW_OP, jointId: move.jointId, to: move.to };
      return tried.moves.length > 0 ? { type: "moveJoints", moves: tried.moves } : null;
    }
    case "wallsMove":
      return target.kind === "walls" ? { type: "moveWalls", walls: target.wallIds, by: tried.by, ...(target.placementIds.length > 0 ? { placements: target.placementIds } : {}) } : null;
    case "place":
      return target.kind === "placement" || target.kind === "rotate" ? { type: "movePlacement", placementId: target.placementId, at: tried.at, rotation: tried.rotation, deck: tried.deck } : null;
    case "places":
      return target.kind === "placements" ? { type: "movePlacements", moves: tried.places } : null;
    case "slide":
      return target.kind === "opening" ? { type: "moveOpening", openingId: target.openingId, offset: tried.offset } : null;
    case "resize":
      return target.kind === "resize" ? { type: "resizePlacement", placementId: target.placementId, side: tried.side, size: tried.size } : null;
    case "arms": // the current width and depths with the new arms (catalog.18, .35)
      return target.kind === "armGrip" ? { type: "setObjectSize", objectId: tried.objectId, w: tried.w, d: {}, arms: tried.arms } : null;
    case "dimensionOffset":
      return target.kind === "dimension" ? { type: "setDimensionOffset", id: target.dimensionId, offset: tried.offset } : null;
    case "zoneExtent":
      return target.kind === "zoneDepth" || target.kind === "zoneEnd" ? { type: "setZoneExtent", placementId: target.placementId, side: tried.side, extent: tried.extent } : null;
    case "deckMove": // only the centre, so a move stays apart from a resize (step 07 carries the pieces on a move)
      return target.kind === "deck" ? { type: "setDeck", deckId: target.deckId, at: tried.at } : null;
    case "deckSize":
      return target.kind === "deckSide" ? { type: "setDeck", deckId: target.deckId, at: tried.at, w: tried.w, d: tried.d } : null;
    case "areaMove":
      return target.kind === "area" ? { type: "setArea", areaId: target.areaId, at: tried.at } : null;
    case "areaSize":
      return target.kind === "areaSide" ? { type: "setArea", areaId: target.areaId, at: tried.at, w: tried.w, d: tried.d } : null;
    case "holeMove":
      return target.kind === "hole" ? { type: "setDeckHole", holeId: target.holeId, at: tried.at } : null;
    case "holeSize":
      return target.kind === "holeSide" ? { type: "setDeckHole", holeId: target.holeId, at: tried.at, w: tried.w, d: tried.d } : null;
    case "columnMove": // only the centre: the size and angle are typed (pillars.14)
      return target.kind === "column" ? { type: "setColumn", wallId: target.wallId, at: tried.at } : null;
    case "sectionEnd":
      return target.kind === "sectionEnd" ? { type: "setSection", sectionId: target.sectionId, ...(target.end === "a" ? { a: tried.at } : { b: tried.at }) } : null;
    case "sectionDepth":
      return target.kind === "sectionFar" ? { type: "setSection", sectionId: target.sectionId, depth: tried.depth } : null;
    default:
      return assertNever(tried);
  }
}

/** Whether a refused try keeps the last valid one instead (spec "Moving and deleting a column"): a column in a wall's line stops at its limits. */
export function stopsAtLimit(doc: Document, target: DragTarget): boolean {
  const column = target.kind === "column" ? columnOf(doc, target.wallId) : null;
  return column !== null && column.line !== null;
}

/** The placements whose fit a refused try breaks (I10, I11), drawn red; the target's own pieces are drawn red on their own. */
export function blockedPlacements(error: DomainError, target: DragTarget): string[] {
  return hitPlacements(error, new Set(draggedPlacements(target)));
}

/** The placements a refused command's overlaps (I10, I11) name, without `exclude`, each once. */
export function hitPlacements(error: DomainError, exclude: ReadonlySet<string>): string[] {
  const keys = error.violations.flatMap((v) => (v.invariant === "I10" || v.invariant === "I11" ? v.entities : []));
  return [...new Set(keys.filter((k) => k.table === "placements" && !exclude.has(k.id)).map((k) => k.id))];
}

/** The dependencies of the drag's command when nothing moves yet: every target's no-op move is valid. */
export function zeroMoveDependencies(doc: Document, target: DragTarget): EntityKey[] {
  const r = execute(doc, zeroMove(doc, target));
  return r.ok ? r.value.patch.dependencies : [];
}

function zeroMove(doc: Document, target: DragTarget): Command {
  switch (target.kind) {
    case "walls":
      return { type: "moveWalls", walls: target.wallIds, by: { x: 0, y: 0 }, ...(target.placementIds.length > 0 ? { placements: target.placementIds } : {}) };
    case "joint":
      return { type: "moveJoints", moves: draggedJoints(doc, target).flatMap((id) => { const j = doc.joints[id]; return j ? [{ jointId: id, to: { x: j.x, y: j.y } }] : []; }) };
    case "placement":
    case "rotate": {
      const p = doc.placements[target.placementId];
      return { type: "movePlacement", placementId: target.placementId, at: p?.at ?? { x: 0, y: 0 }, rotation: p?.rotation ?? 0 };
    }
    case "placements":
      return { type: "movePlacements", moves: target.placementIds.flatMap((id) => { const p = doc.placements[id]; return p ? [{ placementId: id, at: p.at, rotation: p.rotation }] : []; }) };
    case "opening":
      return { type: "moveOpening", openingId: target.openingId, offset: doc.openings[target.openingId]?.offset ?? 0 };
    case "resize": {
      // The current size; 0 for a piece that is gone, which the domain refuses like the other targets' gone pieces.
      const p = doc.placements[target.placementId];
      const object = p ? doc.objects[p.object] : undefined;
      const size = p ? (widthSide(target.side) ? object?.w : object?.d)?.[p.config] : undefined;
      return { type: "resizePlacement", placementId: target.placementId, side: target.side, size: size ?? 0 };
    }
    case "armGrip": { // the arms as they are; an empty id for a gone piece, which the domain refuses as notFound
      const p = doc.placements[target.placementId];
      const object = p ? doc.objects[p.object] : undefined;
      const arms = object ? armsOf(object) : null;
      return { type: "setObjectSize", objectId: object?.id ?? "", w: (p && object?.w[p.config]) ?? 0, d: {}, ...(arms ? { arms } : {}) };
    }
    case "dimension": // 0 for a gone row, which the domain refuses as notFound
      return { type: "setDimensionOffset", id: target.dimensionId, offset: doc.dimensions[target.dimensionId]?.offset ?? 0 };
    case "zoneDepth":
    case "zoneEnd": // today's resolved extent; null for a gone piece, which the domain refuses as notFound
      return { type: "setZoneExtent", placementId: target.placementId, side: target.side, extent: zoneFrame(doc, target.placementId, target.side, target.strip)?.extent ?? null };
    case "deck":
    case "deckSide": { // as it is; the origin for a gone deck, which the domain refuses as notFound
      const deck = deckView(doc, target.deckId);
      return { type: "setDeck", deckId: target.deckId, at: deck?.at ?? { x: 0, y: 0 }, ...(target.kind === "deckSide" && deck ? { w: deck.w, d: deck.d } : {}) };
    }
    case "hole":
    case "holeSide": { // as it is; a gone hole is refused as notFound
      const hole = holeView(doc, target.holeId)?.hole;
      return { type: "setDeckHole", holeId: target.holeId, at: hole?.at ?? { x: 0, y: 0 }, ...(target.kind === "holeSide" && hole ? { w: hole.w, d: hole.d } : {}) };
    }
    case "area":
    case "areaSide": { // as it is; the origin for a gone area, which the domain refuses as notFound
      const a = Object.hasOwn(doc.areas, target.areaId) ? doc.areas[target.areaId] : undefined;
      return { type: "setArea", areaId: target.areaId, at: a?.at ?? { x: 0, y: 0 }, ...(target.kind === "areaSide" && a ? { w: a.w, d: a.d } : {}) };
    }
    case "column": // as it is; a gone row is refused as notFound
      return { type: "setColumn", wallId: target.wallId, at: columnOf(doc, target.wallId)?.centre ?? { x: 0, y: 0 } };
    case "sectionEnd":
    case "sectionFar": // no field changes; a gone row is refused as notFound
      return { type: "setSection", sectionId: target.sectionId };
    default:
      return assertNever(target);
  }
}
