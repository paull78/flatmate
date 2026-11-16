import { EPS, add, dot, length, normalize, perpLeft, scale, sub, shown } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { textWidth } from "./fonts";
import type { PlanStyle } from "./plan-style";

/** A placed dimension as drawn (dims.09, dims.19), in world coordinates; sizes come from the style at the zoom. */
export type DimensionLayout = {
  line: [Point, Point];
  extensions: [Point, Point][]; // 0 or 2, at a then b
  ticks: [Point, Point][]; // 2, at a then b
  text: { value: string; at: Point; rotation: number; box: Point[] }; // box: 4 world corners, for hit tests
};

const FLIP_TOLERANCE = 1e-6; // radians, at 90° and 270°

/** The value drawn: metres with two decimals and no unit ("3.65"). */
export function dimensionValue(length: number): string {
  return shown(length);
}

/** The dimension line: a and b moved by the offset along the left normal of a→b, null under 1 mm (dims.20). */
export function dimensionLine(a: Point, b: Point, offset: number): [Point, Point] | null {
  const d = sub(b, a);
  const len = length(d);
  if (len < EPS) return null;
  const shift = scale(perpLeft(scale(d, 1 / len)), offset);
  return [add(a, shift), add(b, shift)];
}

/** The inverse: the signed distance of `p` from the line a→b, positive to its left; 0 when a and b coincide. */
export function acrossLine(a: Point, b: Point, p: Point): number {
  const n = normalize(sub(b, a));
  return n ? dot(sub(p, a), perpLeft(n)) : 0;
}

/**
 * The look of a dimension from a to b, offset along the left normal, null under 1 mm. It reads from the bottom or the
 * right: a direction between 90° and 270° is laid out as b→a with −offset, so B→A with −o draws exactly as A→B with
 * o (dims.19). Text that does not fit between the ticks goes past the end it reads toward, measured in the style's
 * font by the core's tables (render.15).
 */
export function dimensionLayout(from: Point, to: Point, offset: number, style: PlanStyle, zoom: number): DimensionLayout | null {
  const theta = Math.atan2(to.y - from.y, to.x - from.x);
  const turned = theta > Math.PI / 2 + FLIP_TOLERANCE || theta <= -Math.PI / 2 + FLIP_TOLERANCE;
  // Swapping the inputs (not negating a reading vector) keeps the two orders bit-identical, with no −0.
  const [a, b, o] = turned ? [to, from, -offset] : [from, to, offset];
  const line = dimensionLine(a, b, o);
  if (!line) return null;
  const d = sub(b, a);
  const len = length(d);
  const u = scale(d, 1 / len);
  const n = perpLeft(u);
  const angle = Math.atan2(d.y, d.x);
  const { dim } = style;

  const slant = scale(add(u, n), (Math.SQRT1_2 * dim.tick) / 2 / zoom); // 45°, half a tick
  const ticks = line.map((p): [Point, Point] => [sub(p, slant), add(p, slant)]);
  const extensions: [Point, Point][] = [];
  if (Math.abs(o) * zoom > dim.gap) {
    const e = scale(n, Math.sign(o));
    const ends: [Point, Point][] = [[a, line[0]], [b, line[1]]]; // a measured point and its line end
    for (const [p, q] of ends) extensions.push([add(p, scale(e, dim.gap / zoom)), add(q, scale(e, dim.overshoot / zoom))]);
  }

  const value = dimensionValue(len);
  const w = textWidth(style.font, value, dim.textSize); // the style's font: Inter on screen, Helvetica on paper (render.15)
  const fits = w + 2 * dim.textGap <= len * zoom;
  const along = fits ? scale(add(line[0], line[1]), 0.5) : add(line[1], scale(u, (dim.textGap + w / 2) / zoom));
  const at = add(along, scale(n, (dim.textGap + dim.textSize / 2) / zoom));
  const hu = scale(u, w / 2 / zoom);
  const hn = scale(n, dim.textSize / 2 / zoom);
  const box = [sub(sub(at, hu), hn), sub(add(at, hu), hn), add(add(at, hu), hn), add(sub(at, hu), hn)];
  const rotation = Math.abs(angle - Math.PI / 2) <= FLIP_TOLERANCE ? Math.PI / 2 : angle;
  return { line, extensions, ticks, text: { value, at, rotation, box } };
}
