import { guardPosts } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { prism } from "./prism";
import type { Style3d } from "./style";
import type { Face3d, GuardItem } from "./types";

// A deck's guard in 3D (AC-07): boxes on its edge line, in `metal`. A Railing has posts and a top rail; a Glass guard a
// pane under a top rail, opaque until the 3D view has Transparency (guards.06).

export const RAIL_THICK = 0.04;
export const POST_SIDE = 0.04;
export const PANE_THICK = 0.012;

/** A box along a→b, `thick` across, as a ring. */
function along(a: Point, b: Point, thick: number): Point[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: ((b.y - a.y) / len) * (thick / 2), y: (-(b.x - a.x) / len) * (thick / 2) };
  return [{ x: a.x + n.x, y: a.y + n.y }, { x: b.x + n.x, y: b.y + n.y }, { x: b.x - n.x, y: b.y - n.y }, { x: a.x - n.x, y: a.y - n.y }];
}

/** A post's square on the plan, centred on `p`. */
export function postRing(p: Point): Point[] {
  const half = POST_SIDE / 2;
  return [{ x: p.x - half, y: p.y - half }, { x: p.x + half, y: p.y - half }, { x: p.x + half, y: p.y + half }, { x: p.x - half, y: p.y + half }];
}

/** A guard's solid boxes, for the 3D view and a section alike (guards.09): a pane or posts, then the top rail. */
type GuardBox = { ring: Point[]; bottom: number; top: number; pane: boolean };

export function guardBoxes(item: Pick<GuardItem, "kind" | "a" | "b" | "bottom" | "top">): GuardBox[] {
  const railBottom = Math.max(item.bottom, item.top - RAIL_THICK); // under a very low ceiling, only as much rail as fits
  const rail: GuardBox = { ring: along(item.a, item.b, RAIL_THICK), bottom: railBottom, top: item.top, pane: false };
  if (railBottom <= item.bottom) return [rail];
  if (item.kind === "glass") return [{ ring: along(item.a, item.b, PANE_THICK), bottom: item.bottom, top: railBottom, pane: true }, rail];
  return [...guardPosts(item).map((p): GuardBox => ({ ring: postRing(p), bottom: item.bottom, top: railBottom, pane: false })), rail];
}

export function guardFaces(owner: string, item: GuardItem, style: Style3d): Face3d[] {
  const pane = { top: style.glass, lit: style.glass, shaded: style.glass };
  return guardBoxes(item).flatMap((b) => prism(owner, b.ring, b.bottom, b.top, b.pane ? pane : style.slots.metal));
}
