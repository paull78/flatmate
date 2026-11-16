import type { Point } from "@fm/protocol";
import { pointInPolygon } from "../geometry";
import { sortedIds, wallFrame } from "../graph";
import { memo } from "../memo";
import { isFloorWall, type Document } from "../model";
import { OPENING_KINDS } from "../kinds";
import { floorRings } from "./floor";
import { zones } from "./zones";

// The doors that open to the outside (trailer.06, .15): the domain decides what counts, the editor draws steps there.
//
//    room │ door │ room   no: rooms both sides          room
//   ──────┴──────┴──────                              ──┤    ├──  a → b on the outer face
//                                                         ↓ out    no room this side

/** A door to the outside: its opening's id, its span `a` → `b` on the wall's outer face, and `out`, the unit normal away from the room. */
export type OutsideDoor = { id: string; a: Point; b: Point; out: Point };

/** How far past each face the room test looks. */
const PROBE = 0.01;

const inRoom = (doc: Document, p: Point): boolean =>
  zones(doc).some((z) => {
    const { outer, holes } = floorRings(z);
    return pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));
  });

/** The doors on floor walls with a room on one side only, in opening id order. */
export const outsideDoors = memo((doc: Document): readonly OutsideDoor[] =>
  sortedIds(doc.openings).flatMap((id): OutsideDoor[] => {
    const o = doc.openings[id];
    const w = o ? doc.walls[o.wall] : undefined;
    const f = o ? wallFrame(doc, o.wall) : null;
    if (!o || !w || !f || !isFloorWall(w) || !OPENING_KINDS[o.kind].walkThrough) return [];
    const along = (t: number): Point => ({ x: f.a.x + f.dir.x * t, y: f.a.y + f.dir.y * t });
    const mid = along(o.offset + o.width / 2);
    const past = (n: Point): Point => ({ x: mid.x + n.x * (f.half + PROBE), y: mid.y + n.y * (f.half + PROBE) });
    const right = { x: -f.left.x, y: -f.left.y };
    const [leftRoom, rightRoom] = [inRoom(doc, past(f.left)), inRoom(doc, past(right))];
    if (leftRoom === rightRoom) return [];
    const out = leftRoom ? right : f.left;
    const face = (p: Point): Point => ({ x: p.x + out.x * f.half, y: p.y + out.y * f.half });
    return [{ id, a: face(along(o.offset)), b: face(along(o.offset + o.width)), out }];
  }),
);
