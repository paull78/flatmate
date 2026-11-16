import type { Point } from "@fm/protocol";

// A winder's three turning treads (steps.04): in the square at its front, w × w, radiating from the inner corner, the
// back corner on the side you walk in from, at 30° and 60° from that side. In the footprint's frame: x across the
// stair (−w/2 to w/2), y (`a`) up the run from the front edge. You step onto the first from the entry side; the third
// ends on a = w, where the straight treads begin. "Enters from: Left" mirrors x.
//
//      a = w ┌───────────────●  inner corner (w/2, w), entering from the right
//            │ 3       ╱  ╱  │
//            │     ╱    ╱    │
//            │╱  2    ╱   1  │ ◀ walk in
//      a = 0 └───────────────┘
//
// No code is claimed: the treads meet at the corner with no width there (spec non-goals).

/** The three winder outlines, first first: a triangle, a kite and a triangle that tile the front square. */
export function winderTreads(w: number, left: boolean): Point[][] {
  const tan30 = Math.tan(Math.PI / 6);
  const inner = { x: w / 2, y: w };
  const foot = { x: w / 2 - w * tan30, y: 0 }; // the 30° ray reaches the front edge
  const side = { x: -w / 2, y: w - w * tan30 }; // the 60° ray reaches the far side
  const treads = [
    [inner, { x: w / 2, y: 0 }, foot],
    [inner, foot, { x: -w / 2, y: 0 }, side],
    [inner, side, { x: -w / 2, y: w }],
  ];
  return left ? treads.map((ring) => ring.map((p) => ({ x: -p.x, y: p.y }))) : treads;
}
