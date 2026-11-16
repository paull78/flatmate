import { jointOrder, wallCorners, wallTopAt, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { WallCap } from "./types";

// Joint caps (studio.05, .10). Each wall is its own mitred outline raised to its own top, so where a shorter wall meets
// taller ones at a joint of three or more walls, the joint's share held by the shorter wall is empty above it: a notch
// in the taller walls. The lower of its two neighbours carries that share up to its own top, so the cap is drawn and
// hidden with a wall and needs no rule of its own.
//
//          shorter wall (2.03)
//              │   │
//         tip  ●   ●  tip       the share: the shorter wall's outline between its corners, through the joint
//               ╲ ╱
//   ───────────── ● ─────────────   joint
//   neighbour (3.05)   neighbour (3.05)   the cap: the share from 2.03 to the lower neighbour's top

const EPS = 1e-9;

/** Twice a ring's signed area. */
const area2 = (ring: readonly Point[]): number =>
  ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length] ?? p; return s + p.x * q.y - q.x * p.y; }, 0);

/** The caps each wall carries, by owner wall ID. */
export function jointCaps(doc: Document): ReadonlyMap<string, readonly WallCap[]> {
  const corners = wallCorners(doc);
  const out = new Map<string, WallCap[]>();
  for (const [jointId, order] of jointOrder(doc)) {
    if (order.length < 3) continue; // at an L or a straight joint both neighbours are one wall
    order.forEach((id, i) => {
      const next = order[(i + 1) % order.length];
      const prev = order[(i - 1 + order.length) % order.length];
      // Tops at the joint itself: under a slope full walls differ in their highest points but meet the ceiling here (roofs.16).
      const at = doc.joints[jointId];
      const topOf = (wallId: string | undefined): number | null => (wallId === undefined || !at ? null : wallTopAt(doc, wallId, at));
      const [mine, n, p] = [topOf(id), topOf(next), topOf(prev)];
      if (!next || !prev || mine === null || n === null || p === null || mine >= Math.min(n, p) - EPS) return;
      const owner = n < p - EPS ? next : p < n - EPS ? prev : next < prev ? next : prev;
      const ends = corners.get(id);
      const end = ends && (ends.a.joint === jointId ? ends.a : ends.b);
      if (!end) return;
      const ring = [...end.left.points, ...end.through, ...[...end.right.points].reverse()];
      if (Math.abs(area2(ring)) < EPS) return;
      out.set(owner, [...(out.get(owner) ?? []), { ring, bottom: mine }]);
    });
  }
  return out;
}
