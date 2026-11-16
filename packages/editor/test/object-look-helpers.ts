import { defaultSides, distanceToSegment, emptyDocument, nullZones, pointInPolygon, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Primitive } from "../src/view/scene-types";

const NO_SIDES = { front: false, back: false, left: false, right: false };

/** A document with one object of `kind` placed at the origin, unturned, as placement "p" in s0 with its kind's sides. */
export function place(kind: string, config: string, w: number, d: number): Document {
  const doc = emptyDocument();
  doc.objects["o"] = { id: "o", kind, name: kind, w: { [config]: w }, d: { [config]: d }, h: { [config]: 1 }, z: { [config]: 0 } };
  doc.placements["p"] = { id: "p", object: "o", state: "s0", at: { x: 0, y: 0 }, rotation: 0, config, sides: defaultSides(kind) ?? NO_SIDES, zones: nullZones(), deck: null };
  return doc;
}

/** Points a primitive reaches: polygon corners, segment ends, and an arc's or disc's centre ± radius. */
export function reach(p: Primitive): Point[] {
  switch (p.kind) {
    case "polygon":
      return [...p.points];
    case "segment":
      return [p.a, p.b];
    case "arc":
      return circleExtent(p.center, p.radius);
    case "disc":
      if (!("m" in p.radius)) throw new Error("a symbol disc must be sized in metres");
      return circleExtent(p.center, p.radius.m);
    case "text":
      throw new Error("a symbol has no text");
  }
}
const circleExtent = (c: Point, r: number): Point[] => [
  { x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }, { x: c.x, y: c.y - r }, { x: c.x, y: c.y + r },
];

type Segment = Extract<Primitive, { kind: "segment" }>;
type Arc = Extract<Primitive, { kind: "arc" }>;
const near = (u: number, v: number, tol = 1e-9) => Math.abs(u - v) < tol;
const at = (p: Point, x: number, y: number) => near(p.x, x) && near(p.y, y);
const joins = (s: Segment, ax: number, ay: number, bx: number, by: number) =>
  (at(s.a, ax, ay) && at(s.b, bx, by)) || (at(s.a, bx, by) && at(s.b, ax, ay));

/** A closed rounded rectangle [x0, x1] × [y0, y1] with corner radius r. */
export type Box = { x0: number; y0: number; x1: number; y1: number; r: number };

/**
 * The closed rounded rectangles in ps: four quarter arcs of one radius at the corners of [x0, x1] × [y0, y1], and the
 * four straight sides between them (as `roundRect` draws them).
 */
export function roundRects(ps: readonly Primitive[]): Box[] {
  const quarters = ps.flatMap((p): Arc[] => (p.kind === "arc" && near(p.to - p.from, Math.PI / 2, 1e-12) ? [p] : []));
  const from = (angle: number) => quarters.filter((a) => near(a.from, angle, 1e-12));
  const lines = ps.flatMap((p): Segment[] => (p.kind === "segment" ? [p] : []));
  const found: Box[] = [];
  for (const tr of from(0)) {
    const r = tr.radius;
    for (const tl of from(Math.PI / 2).filter((a) => near(a.radius, r) && near(a.center.y, tr.center.y) && a.center.x <= tr.center.x)) {
      for (const bl of from(Math.PI).filter((a) => near(a.radius, r) && near(a.center.x, tl.center.x) && a.center.y <= tl.center.y)) {
        const br = from(Math.PI * 1.5).find((a) => near(a.radius, r) && near(a.center.x, tr.center.x) && near(a.center.y, bl.center.y));
        if (!br) continue;
        const [x0, x1, y0, y1] = [tl.center.x - r, tr.center.x + r, bl.center.y - r, tr.center.y + r];
        const sides = [
          [x0 + r, y0, x1 - r, y0], [x1, y0 + r, x1, y1 - r], [x1 - r, y1, x0 + r, y1], [x0, y1 - r, x0, y0 + r],
        ] as const;
        if (sides.every(([ax, ay, bx, by]) => lines.some((s) => joins(s, ax, ay, bx, by)))) found.push({ x0, y0, x1, y1, r });
      }
    }
  }
  return found;
}

/** Whether p lies inside `ring` (any polygon, convex or not) or within `tol` of its boundary. */
export function insideRing(p: Point, ring: readonly Point[], tol: number): boolean {
  if (pointInPolygon(p, ring)) return true;
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return distanceToSegment(p, a, b) <= tol;
  });
}
