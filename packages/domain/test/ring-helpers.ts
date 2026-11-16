import type { Point } from "@fm/protocol";

/** Whether every turn of a counter-clockwise ring goes the same way (a straight run counts). */
export function isConvexCcw(ring: readonly Point[]): boolean {
  return ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const c = ring[(i + 2) % ring.length] ?? a;
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > -1e-12;
  });
}
