import { assertNever } from "@fm/protocol";
import type { Document, WallSide } from "../model";
import { sortedIds } from "../graph";
import { wallSideRooms, type SideFacing } from "./helpers";
import { zoneOfLabel } from "./zones";

/** Whether a side faces the room of face `key`. */
function faces(facing: SideFacing, key: string): boolean {
  switch (facing.kind) {
    case "room": return facing.key === key;
    case "outside":
    case "loft": return false;
    default: return assertNever(facing);
  }
}

/**
 * Every wall side facing the room of label `labelId` (surfaces step 09): its boundary's and its holes' walls on the
 * room's side, and both sides of a free wall standing in it; columns take no finish and are left out, and so is a wall
 * standing on a loft, which faces no room (spec: levels). By wall ID, left before right. Empty for an unknown or orphan label.
 */
export function roomWallSides(doc: Document, labelId: string): { wallId: string; side: WallSide }[] {
  const zone = zoneOfLabel(doc, labelId);
  if (!zone) return [];
  const out: { wallId: string; side: WallSide }[] = [];
  for (const id of sortedIds(doc.walls)) {
    if (doc.walls[id]?.column) continue;
    const rooms = wallSideRooms(doc, id);
    if (rooms && faces(rooms.left, zone.face.key)) out.push({ wallId: id, side: "left" });
    if (rooms && faces(rooms.right, zone.face.key)) out.push({ wallId: id, side: "right" });
  }
  return out;
}
