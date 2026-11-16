import { FLOOR_BASE, holeView, incidentWalls, isFloor, openingShown, placementLevel, shownAt, type Document, type EntityRef, type Level } from "@fm/domain";
import { assertNever } from "@fm/protocol";

/** Whether a column's row ends at joint `jointId`. */
export function columnJoint(doc: Document, jointId: string): boolean {
  return Object.values(doc.walls).some((w) => w.column && (w.a === jointId || w.b === jointId));
}

/** What the walls at joint `jointId` stand on: one base per joint (pillars.09); the floor for a joint with none. */
function jointBase(doc: Document, jointId: string): string {
  return doc.walls[incidentWalls(doc, jointId)[0] ?? ""]?.base ?? FLOOR_BASE;
}

/**
 * Whether the viewed level can hit, box-select or keep `ref` selected (spec "Selecting at a level", levels.06, .19):
 * never a column's joint (a column is one piece, pillars.13), and a wall's joint only at its base's level, so a joint
 * drag stays within one base (pillars.09); a piece only when the level shows it and it belongs to the level (the
 * domain's `shownAt` and `placementLevel`, shown.02), so the floor doesn't offer a loft's mattress; otherwise at the
 * floor level anything; at an upper level only its own decks, the pieces of `layout` standing on them, the wall and
 * column rows based on them (pillars.23), the openings it draws (sills.12) and every section.
 */
export function selectableAt(doc: Document, layout: string | null, ref: EntityRef, level: Level): boolean {
  if (ref.table === "joints") {
    const base = jointBase(doc, ref.id);
    return !columnJoint(doc, ref.id) && (isFloor(level) ? base === FLOOR_BASE : level.deckIds.includes(base));
  }
  if (ref.table === "placements" && !ownPiece(doc, ref.id, level)) return false;
  // An opening where the level draws it (sills.12); at the floor also one under the cut, so a low window can be clicked,
  // but never one on a loft's wall, which belongs to the loft (sills.28).
  if (ref.table === "openings") return openingShown(doc, ref.id, level) !== "hidden" || (isFloor(level) && doc.walls[doc.openings[ref.id]?.wall ?? ""]?.base === FLOOR_BASE);
  if (isFloor(level)) return true;
  switch (ref.table) {
    case "decks":
      return level.deckIds.includes(ref.id);
    case "placements":
      return doc.placements[ref.id]?.state === layout;
    case "walls": {
      const w = doc.walls[ref.id];
      return w !== undefined && level.deckIds.includes(w.base);
    }
    case "deckHoles": { // at the floor, or at its own deck's level (smalls.12)
      const deck = holeView(doc, ref.id)?.deck;
      return deck !== undefined && level.deckIds.includes(deck.id);
    }
    case "zoneLabels":
    case "areas": // the floor's, like its room tags (areas.11)
    case "states":
    case "objects":
    case "dimensions":
    case "projectFields":
    case "underlays":
    case "logos":
    case "ceilings":
    case "sheets":
      return false;
    case "sections": // a section cuts every level, and its mark draws at every level (section.55)
      return true;
    default:
      return assertNever(ref.table);
  }
}

/**
 * Whether `level` shows the placement and the placement belongs to it (shown.02). An unknown row passes, as before:
 * pruning drops it by `entityExists`, and a press whose piece a collaborator deleted is not "off the level".
 */
function ownPiece(doc: Document, placementId: string, level: Level): boolean {
  const own = placementLevel(doc, placementId);
  return own === null || (own.height === level.height && shownAt(doc, placementId, level));
}
