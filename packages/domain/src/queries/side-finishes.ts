import { firstLabelId } from "../finishes";
import { memo } from "../memo";
import type { Document, SideFinish } from "../model";
import { outsideOf, roomWallsOf } from "../wall-defaults";
import { sidesOf } from "../wall-sides";
import { assertNever } from "@fm/protocol";
import { wallSideRooms, type SideFacing } from "./helpers";
import { zones } from "./zones";

// What a wall side shows (inherit.01, step 02): its custom finish, else the walls default of the room it faces (the
// room's first label holds it, as for the floor, finishes.15), else, facing outside, the house's, else nothing. A side of
// a wall standing on a loft shows its custom finish or nothing: no default reaches it (spec: levels). The one reader every
// display goes through: 3D, `look`, sections, Properties and Claude's listing.

/** Where a side's finish comes from: its own, its room's default, or the house's outside default. */
export type FinishSource = "custom" | "room" | "outside";
/** A side's finish and band as shown, with their source and the label of the room it faces (null outside). */
export type ShownSide = SideFinish & { source: FinishSource; room: string | null };
/** Both sides of a wall as shown; a side null when it shows nothing. */
export type ShownSides = { left: ShownSide | null; right: ShownSide | null };

/** Each room's face key → the label holding its walls default. */
const ownerByFace = memo((doc: Document): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const z of zones(doc)) {
    const id = firstLabelId(z);
    if (id !== null) out.set(z.face.key, id);
  }
  return out;
});

/** Per document, each wall's answer once asked. */
const cacheOf = memo((): Map<string, ShownSides | null> => new Map());

function shown(doc: Document, custom: SideFinish | null, facing: SideFacing): ShownSide | null {
  switch (facing.kind) {
    case "loft": return custom ? { ...custom, source: "custom", room: null } : null;
    case "outside": {
      if (custom) return { ...custom, source: "custom", room: null };
      const outside = outsideOf(doc);
      return outside ? { ...outside, source: "outside", room: null } : null;
    }
    case "room": {
      const room = ownerByFace(doc).get(facing.key) ?? null;
      if (custom) return { ...custom, source: "custom", room };
      const label = room === null ? undefined : doc.zoneLabels[room];
      const value = label ? roomWallsOf(label) : null;
      return value ? { ...value, source: "room", room } : null;
    }
    default: return assertNever(facing);
  }
}

/** What each side of the wall shows; null for an unknown wall or a column, which takes no finish. */
export function sideFinishes(doc: Document, wallId: string): ShownSides | null {
  const cache = cacheOf(doc);
  const hit = cache.get(wallId);
  if (hit !== undefined) return hit;
  const wall = doc.walls[wallId];
  const rooms = wall && !wall.column ? wallSideRooms(doc, wallId) : null;
  const custom = wall ? sidesOf(wall) : undefined;
  const value = rooms ? { left: shown(doc, custom?.left ?? null, rooms.left), right: shown(doc, custom?.right ?? null, rooms.right) } : null;
  cache.set(wallId, value);
  return value;
}
