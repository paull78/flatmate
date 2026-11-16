import type { Point } from "@fm/protocol";
import type { Color, Dash, Primitive } from "./scene-types";

/** A closed ring's edges as segments, one per edge, `px` drawing units wide; dashed when `dash` is given (heights.15). */
export function ringEdges(ring: readonly Point[], color: Color, px: number, cap: "butt" | "round", dash?: Dash): Primitive[] {
  return ring.map((a, i): Primitive => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return dash ? { kind: "segment", a, b, width: { px }, color, cap, dash } : { kind: "segment", a, b, width: { px }, color, cap };
  });
}
