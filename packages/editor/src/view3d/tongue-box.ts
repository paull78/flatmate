import { orient, sideShade } from "./prism";
import type { Shades } from "./style";
import type { Face3d, Point3 } from "./types";

// The tongue box on the drawbar's base (trailer.05): a storage box against the end wall, its lid sloping down toward
// the hitch like a little roof of its own, in the trailer's steel. Only drawn.

const LONG = 0.6; // along the bar, out from the deck's end
const IN = 0.3; // in from each of the deck's sides
const NARROW = 1.2; // a deck narrower than this takes a box half its width
const TALL = 0.9; // above the bar, at the end wall
const LOW = 0.7; // above the bar, at the hitch's side: the lid slopes

/**
 * The box's faces in the trailer's frame `at` (u toward the hitch, v across, a point or a direction): from the deck's
 * end `u1` out LONG, across the deck from `v0` to `v1` less IN a side (half the width on a narrow deck), from the bar's
 * top `bottom` up. No face against the deck's end, which would tie with it, and no bottom, as the camera looks down; no
 * outlines, as the bar's (they would show through where the box meets it).
 */
export function tongueBoxFaces(at: (u: number, v: number, z: number) => Point3, end: { u1: number; v0: number; v1: number; bottom: number }, steel: Shades): Face3d[] {
  const width = end.v1 - end.v0;
  const inset = width < NARROW ? width / 4 : IN;
  const [a, b] = [end.v0 + inset, end.v1 - inset];
  const [near, far] = [end.u1, end.u1 + LONG];
  const [high, low] = [end.bottom + TALL, end.bottom + LOW];
  const face = (points: Point3[], n: Point3, color: string): Face3d => ({ points: orient(points, n), holes: [], color, owner: "trailer/tongue-box", outline: false });
  const out = at(1, 0, 0);
  const [left, right] = [at(0, -1, 0), at(0, 1, 0)];
  const lid = { ...at(TALL - LOW, 0, 0), z: LONG }; // up and toward the hitch: square to the slope
  return [
    face([at(far, a, end.bottom), at(far, b, end.bottom), at(far, b, low), at(far, a, low)], out, sideShade(out, steel)),
    face([at(near, a, end.bottom), at(far, a, end.bottom), at(far, a, low), at(near, a, high)], left, sideShade(left, steel)),
    face([at(near, b, end.bottom), at(far, b, end.bottom), at(far, b, low), at(near, b, high)], right, sideShade(right, steel)),
    face([at(near, a, high), at(far, a, low), at(far, b, low), at(near, b, high)], lid, steel.top),
  ];
}
