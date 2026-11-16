import { localFacer, type LocalFace } from "./local-faces";
import { partSolids } from "./parts/solids";
import { capped } from "./parts/sizes";
import type { Shades, Style3d } from "./style";
import type { Face3d, PieceItem, Point3 } from "./types";

// The kitchen sink's and the bathtub's taps (showcase, the user's review): the piece's parts' faces, then a metal tap
// standing on its top. A worktop and a tub's rim are the piece's height, so the tap rises above it (a washbasin's and
// a vanity's stay inside theirs, `parts/bathroom.ts`): drawn, not counted by the height checks, like a plant's leaves.
//
//      ┌────────┐ spout       sink: the neck behind the bowl, the spout over it (towards the front, −y)
//      │neck    ╵ nozzle      tub:  the neck on the foot rim (−x, as the plan's tap), the spout over the water (+x)
//   ───┴──────────── top

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

/** A box's top and four sides (its bottom stands on something). */
function boxFaces(face: LocalFace, b: Box, shades: Shades): Face3d[] {
  const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
  const side = (a: [number, number], c: [number, number], n: Point3): Face3d =>
    face([p(a[0], a[1], b.z0), p(c[0], c[1], b.z0), p(c[0], c[1], b.z1), p(a[0], a[1], b.z1)], shades, n);
  return [
    face([p(b.x0, b.y0, b.z1), p(b.x1, b.y0, b.z1), p(b.x1, b.y1, b.z1), p(b.x0, b.y1, b.z1)], shades, { x: 0, y: 0, z: 1 }),
    side([b.x0, b.y0], [b.x1, b.y0], { x: 0, y: -1, z: 0 }),
    side([b.x1, b.y1], [b.x0, b.y1], { x: 0, y: 1, z: 0 }),
    side([b.x0, b.y1], [b.x0, b.y0], { x: -1, y: 0, z: 0 }),
    side([b.x1, b.y0], [b.x1, b.y1], { x: 1, y: 0, z: 0 }),
  ];
}

/**
 * A tap's boxes: a neck `r` wide at (`x`, `y`) from `z0` up `height`, a spout at its top reaching `reach` along
 * (`dx`, `dy`), a unit axis direction, and a nozzle turned down at its end.
 */
function tapBoxes(x: number, y: number, r: number, z0: number, height: number, reach: number, dx: number, dy: number): Box[] {
  const top = z0 + height;
  const t = Math.min(r, height / 4); // the spout's thickness
  const along = (from: number, to: number): Pick<Box, "x0" | "x1" | "y0" | "y1"> => {
    const [a, b] = [Math.min(from, to), Math.max(from, to)];
    return dx !== 0
      ? { x0: x + (dx > 0 ? a : -b), x1: x + (dx > 0 ? b : -a), y0: y - r / 2, y1: y + r / 2 }
      : { x0: x - r / 2, x1: x + r / 2, y0: y + (dy > 0 ? a : -b), y1: y + (dy > 0 ? b : -a) };
  };
  return [
    { x0: x - r / 2, x1: x + r / 2, y0: y - r / 2, y1: y + r / 2, z0, z1: top },
    { ...along(r / 2, reach), z0: top - t, z1: top },
    { ...along(reach - r, reach), z0: top - 2 * t, z1: top - t },
  ];
}

export function tapFaces(owner: string, item: PieceItem, style: Style3d): Face3d[] | null {
  if (item.objectKind !== "sinkUnit" && item.objectKind !== "bathtub") return null;
  const { face } = localFacer(owner, item);
  const shades = item.selected ? style.selected : style.slots.metal;
  const { w, d } = item;
  const h = item.top - item.bottom;
  let boxes: Box[];
  if (item.objectKind === "sinkUnit") {
    const bowlBack = capped(0.36, 0.6, d) / 2; // the bowl's back edge (`bowl` in parts/kitchen.ts)
    const r = capped(0.03, 0.1, Math.min(w, d));
    const y = (bowlBack + d / 2) / 2;
    boxes = tapBoxes(0, y, r, h, capped(0.26, 0.3, h), y - bowlBack + capped(0.12, 0.25, d), 0, -1);
  } else {
    const rim = capped(0.07, 0.2, Math.min(w, d)); // the tub's rim (`bathtub` in parts/bathroom.ts)
    const r = capped(0.03, 0.5, rim);
    const x = -w / 2 + rim / 2;
    boxes = tapBoxes(x, 0, r, h, capped(0.1, 0.15, h), rim / 2 + capped(0.08, 0.1, w), 1, 0);
  }
  return [...partSolids(owner, item, style).flatMap((p) => p.faces), ...boxes.flatMap((b) => boxFaces(face, b, shades))];
}
