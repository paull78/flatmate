import type { Point } from "@fm/protocol";
import type { Primitive } from "../view/scene-types";

// The north arrow in paper millimetres, y up (sheetset.15), as on the mockup: a ring, and a needle half filled and half
// outlined, turned in the page's plane. Plans aren't rotated on paper, so an angle on the plan is that angle on the page.

const COLOR = "#000000";
const LINE = { px: 0.18 };
const RING = 3.94;
const LABEL = 2.5;
const LABEL_AT = RING + 1.5; // an N is 1.8 mm square, so it clears the ring at any angle

/** The square the mark takes at any angle: its N reaches furthest when it's due north, east, south or west. */
export const NORTH_MARK_MM = 2 * (LABEL_AT + 0.9);

/** Around `centre`, `degrees` clockwise from up. The N stands off the tip, upright, so the mark can't be read backwards. */
export function northArrow(centre: Point, degrees: number): Primitive[] {
  const turn = (degrees * Math.PI) / 180;
  const at = (x: number, y: number): Point => ({ x: centre.x + x * Math.cos(turn) + y * Math.sin(turn), y: centre.y - x * Math.sin(turn) + y * Math.cos(turn) });
  const tip = at(0, 3.75);
  const notch = at(0, -1.125);
  const left = at(-1.5, -2.25);
  const outline = (a: Point, b: Point): Primitive => ({ kind: "segment", a, b, width: LINE, color: COLOR, cap: "round" });
  return [
    { kind: "arc", center: centre, radius: RING, from: 0, to: 2 * Math.PI, width: LINE, color: COLOR },
    { kind: "polygon", points: [tip, at(1.5, -2.25), notch], holes: [], color: COLOR },
    outline(tip, left),
    outline(left, notch),
    { kind: "text", text: "N", at: at(0, LABEL_AT), size: LABEL, color: COLOR, align: "center", rotation: 0, font: "helvetica" },
  ];
}
