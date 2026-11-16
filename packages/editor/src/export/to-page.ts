import { assertNever, type Point } from "@fm/protocol";
import type { Primitive, Width } from "../view/scene-types";

/** A world primitive drawn at k millimetres per metre, moved by (dx, dy): drawing-unit sizes are already millimetres. */
export function toPage(p: Primitive, k: number, dx: number, dy: number): Primitive {
  const at = (q: Point): Point => ({ x: q.x * k + dx, y: q.y * k + dy });
  const width = (w: Width): Width => ("px" in w ? w : { px: w.m * k });
  switch (p.kind) {
    case "segment":
      return { ...p, a: at(p.a), b: at(p.b), width: width(p.width) };
    case "polygon":
      return { ...p, points: p.points.map(at), holes: p.holes.map((h) => h.map(at)) };
    case "arc":
      return { ...p, center: at(p.center), radius: p.radius * k, width: width(p.width) };
    case "disc":
      return { ...p, center: at(p.center), radius: width(p.radius) };
    case "text":
      return { ...p, at: at(p.at) };
    default:
      return assertNever(p);
  }
}
