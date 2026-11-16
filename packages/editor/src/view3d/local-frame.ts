import type { Point } from "@fm/protocol";
import type { PieceItem } from "./types";

// A piece's local frame in the world, the one owner for stairs and furniture parts: x across, y from the front edge
// (−d/2) to the back edge (d/2), turned by the piece's rotation about its centre (at rotation 0 the front faces −y).

/** A local point in the world. */
export function placer(item: Pick<PieceItem, "centre" | "rotation">): (x: number, y: number) => Point {
  const r = (item.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return (x, y) => ({ x: item.centre.x + x * c - y * s, y: item.centre.y + x * s + y * c });
}

/** A local direction in the world. */
export function turner(item: PieceItem): (x: number, y: number) => Point {
  const r = (item.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
}
