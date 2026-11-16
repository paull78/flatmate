import { isValidId, type Document, type EntityRef } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import type { DragTarget } from "./types";

// What a drag acts on, by target kind (moved out of tools/types.ts by straight step 04, straight.25).

/** The joints a drag moves: the joint itself, or both ends of a wall. */
export function draggedJoints(doc: Document, target: DragTarget): string[] {
  switch (target.kind) {
    case "joint":
      return [target.jointId];
    case "walls": // every joint of every wall (straight.22)
      return [...new Set(target.wallIds.flatMap((id) => {
        const w = isValidId(id) ? doc.walls[id] : undefined;
        return w ? [w.a, w.b] : [];
      }))];
    case "placement":
    case "placements":
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
    case "column": // a column's joints move only by setColumn
      return [];
    default:
      return assertNever(target);
  }
}

/** What a drag acts on, as entity refs: the joint, wall, opening, dimension or deck, or every piece it moves or edits. */
export function targetRefs(target: DragTarget): EntityRef[] {
  switch (target.kind) {
    case "joint":
      return [{ table: "joints", id: target.jointId }];
    case "walls":
      return [...target.wallIds.map((id): EntityRef => ({ table: "walls", id })), ...target.placementIds.map((id): EntityRef => ({ table: "placements", id }))];
    case "placement":
    case "resize":
    case "rotate":
    case "armGrip":
    case "zoneDepth":
    case "zoneEnd":
      return [{ table: "placements", id: target.placementId }];
    case "placements":
      return target.placementIds.map((id) => ({ table: "placements", id }));
    case "opening":
      return [{ table: "openings", id: target.openingId }];
    case "dimension":
      return [{ table: "dimensions", id: target.dimensionId }];
    case "deck":
    case "deckSide":
      return [{ table: "decks", id: target.deckId }];
    case "hole":
    case "holeSide":
      return [{ table: "deckHoles", id: target.holeId }];
    case "area":
    case "areaSide":
      return [{ table: "areas", id: target.areaId }];
    case "column":
      return [{ table: "walls", id: target.wallId }];
    case "sectionEnd":
    case "sectionFar":
      return [{ table: "sections", id: target.sectionId }];
    default:
      return assertNever(target);
  }
}

/** The placements a drag moves: the piece, every piece of the group, or the resized, reshaped or turned piece. */
export function draggedPlacements(target: DragTarget): string[] {
  switch (target.kind) {
    case "placement":
    case "resize":
    case "rotate":
    case "armGrip":
      return [target.placementId];
    case "placements":
    case "walls":
      return [...target.placementIds];
    case "joint":
    case "opening":
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
