import type { Point } from "@fm/protocol";
import { pointInPolygon } from "../geometry";
import { wallFrame } from "../graph";
import { SHEER, SHUTTER_BOX } from "../kinds";
import { memo } from "../memo";
import type { Document } from "../model";
import { floorRings } from "./floor";
import { zones } from "./zones";

export { SHEER, SHUTTER_BOX };

// A window's dressing (hangings.04): a shutter box and a sheer curtain on its room side, shared by every layout.
//
//        ceiling                     section through the wall, the room on the right
//   ─────────────────
//     wall │▓▓│┌──┐ ┊   ┌──┐ the box: SHUTTER_BOX.height above the head, SHUTTER_BOX.depth deep
//          │▓▓││  │ ┊   ┊    the sheer: SHEER.off in front of the face (or of the box), from the box's top
//     head ├──┤└──┘ ┊        (or SHEER.rail above the head) down to the sill or the floor
//    glass │  │     ┊
//     sill ├──┤     ┊
//          │▓▓│     ┊
//   ───────┴──┴─────┴── floor

/** How far past each face the room test looks, as for the doors to the outside. */
const PROBE = 0.01;

const inRoom = (doc: Document, p: Point): boolean =>
  zones(doc).some((z) => {
    const { outer, holes } = floorRings(z);
    return pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));
  });

/**
 * The side of the wall a window's dressing hangs on: the face toward a room when the other side has none (an outer
 * window, whichever way its wall runs), else the opening's own side (a divider's, or a window with no room either side).
 */
export function roomSideOf(doc: Document, openingId: string): "left" | "right" | null {
  const o = doc.openings[openingId];
  const f = o ? wallFrame(doc, o.wall) : null;
  if (!o || !f) return null;
  const t = o.offset + o.width / 2;
  const mid = { x: f.a.x + f.dir.x * t, y: f.a.y + f.dir.y * t };
  const past = (sign: number): Point => ({ x: mid.x + sign * f.left.x * (f.half + PROBE), y: mid.y + sign * f.left.y * (f.half + PROBE) });
  const [left, right] = [inRoom(doc, past(1)), inRoom(doc, past(-1))];
  return left === right ? o.side : left ? "left" : "right";
}

/** A box on the plan (`quad`, the face's two ends then the front's) between two heights above its wall's bottom. */
export type DressingBox = { quad: readonly Point[]; bottom: number; top: number };
/** A curtain hanging along `line` (on the plan, a → b along the wall) between two heights above its wall's bottom. */
export type DressingCurtain = { line: readonly [Point, Point]; bottom: number; top: number };
/** A window's dressing: the side it hangs on, its box and its curtain, each absent when the window has none. */
export type Dressing = { side: "left" | "right"; out: Point; box?: DressingBox; curtain?: DressingCurtain };

/** The window's dressing as drawn on the plan, in 3D and in sections, or null when it has none (or isn't found). */
export const dressingOf = (doc: Document, openingId: string): Dressing | null => dressings(doc).get(openingId) ?? null;

/** Every dressed opening's dressing, by id. */
export const dressings = memo((doc: Document): ReadonlyMap<string, Dressing> => {
  const out = new Map<string, Dressing>();
  for (const [id, o] of Object.entries(doc.openings)) {
    if (!o || (o.sheer === undefined && o.shutterBox === undefined)) continue;
    const f = wallFrame(doc, o.wall);
    const side = roomSideOf(doc, id);
    if (!f || !side) continue;
    const n = side === "left" ? f.left : { x: -f.left.x, y: -f.left.y };
    const at = (t: number, off: number): Point => ({ x: f.a.x + f.dir.x * t + n.x * (f.half + off), y: f.a.y + f.dir.y * t + n.y * (f.half + off) });
    const [s, e] = [o.offset, o.offset + o.width];
    const box: DressingBox | undefined = o.shutterBox
      ? { quad: [at(s, 0), at(e, 0), at(e, SHUTTER_BOX.depth), at(s, SHUTTER_BOX.depth)], bottom: o.head, top: o.head + SHUTTER_BOX.height }
      : undefined;
    const off = (box ? SHUTTER_BOX.depth : 0) + SHEER.off;
    const curtain: DressingCurtain | undefined = o.sheer
      ? { line: [at(s, off), at(e, off)], bottom: o.sheer === "floor" ? 0 : o.sill, top: box ? box.top : o.head + SHEER.rail }
      : undefined;
    out.set(id, { side, out: n, ...(box ? { box } : {}), ...(curtain ? { curtain } : {}) });
  }
  return out;
});
