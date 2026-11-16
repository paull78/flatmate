import { armsFor, type Arms } from "@fm/domain";
import { cornerSofaEnds, cornerSofaSeats } from "../../view/piece-counts";
import { MAX_REPEAT, box, capped, countOf, doorGap, spans, topThickness } from "./sizes";
import type { Appearance, AppearanceTable, Part } from "./types";

// The corner pieces in 3D (catalog.17, .21): parts inside the two arms, never in the empty quarter, and never the
// "outline" part, which extrudes the `L` as if it were convex. Local frame (parts/types.ts): y from the front (−d/2) to
// the back (d/2), so the back arm is [d/2 − t1, d/2] and the left arm [−d/2, d/2 − t1] below it.

/**
 * A corner desk: a wood top over each arm, the left one below the back one so they don't overlap, on metal legs at the
 * outer corners and the arm ends (back-left, back-right, the back arm's inner end, the left arm's front corners).
 */
const cornerDesk: Appearance = (_config, w, d, h, _options, arms) => {
  const { back, left } = armsFor("cornerDesk", w, d, arms);
  const seam = d / 2 - back;
  const topZ = h - topThickness(h);
  const s = capped(0.04, 0.1, Math.min(back, left)); // a leg's side, inside the narrower arm
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -d / 2, d / 2];
  const leg = (x: number, y: number): Part => box("metal", x, x + s, y, y + s, 0, topZ);
  return [
    box("wood", x0, x1, seam, y1, topZ, h),
    box("wood", x0, x0 + left, y0, seam, topZ, h),
    leg(x0, y1 - s), leg(x1 - s, y1 - s), leg(x1 - s, seam),
    leg(x0, y0), leg(x0 + left - s, y0),
  ];
};

/** An `L`'s frame: the footprint's sides, the seam between the arms (the back arm's inner face) and the left arm's inner face. */
function frameOf(kind: string, w: number, d: number, arms: Arms | undefined) {
  const { back, left } = armsFor(kind, w, d, arms);
  return { x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2, seam: d / 2 - back, ix: -w / 2 + left, arm: Math.min(back, left) };
}

/**
 * A corner wardrobe: a dark plinth set back from the inner faces, a wood carcass per arm, and wood door fronts (one per
 * 0.50 m) standing on both inner faces, the back arm's run starting at the corner so the two runs meet.
 */
const cornerWardrobe: Appearance = (_config, w, d, h, _options, arms) => {
  const { x0, x1, y0, y1, seam, ix, arm } = frameOf("cornerWardrobe", w, d, arms);
  const plinthH = capped(0.08, 0.1, h);
  const recess = capped(0.04, 0.1, arm);
  const t = capped(0.02, 0.1, arm); // a door's thickness
  const gap = doorGap(Math.min(w, d));
  const backDoors = spans(ix - t, x1, countOf(x1 - ix + t, 0.5), gap).map(([a, b]) => box("wood", a, b, seam, seam + t, plinthH, h));
  const leftDoors = spans(y0, seam, countOf(seam - y0, 0.5), gap).map(([a, b]) => box("wood", ix - t, ix, a, b, plinthH, h));
  return [
    box("dark", x0, x1, seam + recess, y1, 0, plinthH),
    box("dark", x0, ix - recess, y0, seam + recess, 0, plinthH),
    box("wood", x0, x1, seam + t, y1, plinthH, h),
    box("wood", x0, ix - t, y0, seam + t, plinthH, h),
    ...backDoors,
    ...leftDoors,
  ];
};

/** A corner counter: per arm, a dark plinth set back from the inner faces, a laminate carcass and a wood worktop on top. */
const cornerCounter: Appearance = (_config, w, d, h, _options, arms) => {
  const { x0, x1, y0, y1, seam, ix, arm } = frameOf("cornerCounter", w, d, arms);
  const plinthH = capped(0.1, 0.12, h);
  const recess = capped(0.05, 0.1, arm);
  const topZ = h - capped(0.04, 0.06, h);
  return [
    box("dark", x0, x1, seam + recess, y1, 0, plinthH),
    box("dark", x0, ix - recess, y0, seam + recess, 0, plinthH),
    box("laminate", x0, x1, seam, y1, plinthH, topZ),
    box("laminate", x0, ix, y0, seam, plinthH, topZ),
    box("wood", x0, x1, seam, y1, topZ, h),
    box("wood", x0, ix, y0, seam, topZ, h),
  ];
};

/**
 * A corner sofa, as the straight sofa (parts.02) bent round the corner: dark legs, a back box along each outer edge at
 * 0.24 of its arm's depth, an armrest box at each far end, a seat base per run and a seat box per plan cushion
 * (`cornerSofaSeats`, each run capped at MAX_REPEAT) plus the corner seat.
 */
const cornerSofa: Appearance = (_config, w, d, h, _options, given) => {
  const { x0, x1, y0, y1, seam, ix, arm } = frameOf("cornerSofa", w, d, given);
  const arms = { back: y1 - seam, left: ix - x0 };
  const ends = cornerSofaEnds(w, d, arms);
  const n = cornerSofaSeats(w, d, arms);
  const [by, bx] = [y1 - 0.24 * arms.back, x0 + 0.24 * arms.left]; // the backs' inner faces
  const [ex, ey] = [x1 - ends.back, y0 + ends.left]; // the armrests' inner faces
  const legH = capped(0.08, 0.12, h);
  const armTop = legH + capped(0.54, 0.6, h);
  const seatBase = legH + capped(0.2, 0.25, h);
  const seatTop = seatBase + capped(0.15, 0.17, h);
  const s = capped(0.05, 0.1, arm); // a leg's side
  const leg = (x: number, y: number): Part => box("dark", x, x + s, y, y + s, 0, legH);
  return [
    leg(x0, y1 - s), leg(x1 - s, y1 - s), leg(x1 - s, seam), leg(x0, y0), leg(ix - s, y0),
    box("fabric", x0, ex, by, y1, legH, h), box("fabric", x0, bx, ey, by, legH, h), // the backs
    box("fabric", ex, x1, seam, y1, legH, armTop), box("fabric", x0, ix, y0, ey, legH, armTop), // the armrests
    box("fabric", bx, ex, seam, by, legH, seatBase), box("fabric", bx, ix, ey, seam, legH, seatBase), // the seat bases
    ...spans(ix, ex, Math.min(MAX_REPEAT, n.back)).map(([a, b]) => box("fabric", a, b, seam, by, seatBase, seatTop)),
    ...spans(ey, seam, Math.min(MAX_REPEAT, n.left)).map(([a, b]) => box("fabric", bx, ix, a, b, seatBase, seatTop)),
    box("fabric", bx, ix, seam, by, seatBase, seatTop), // the corner seat
  ];
};

export const CORNERS: AppearanceTable = new Map([
  ["cornerDesk", cornerDesk],
  ["cornerWardrobe", cornerWardrobe],
  ["cornerCounter", cornerCounter],
  ["cornerSofa", cornerSofa],
]);
