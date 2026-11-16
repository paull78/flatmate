import { assertNever, type Point } from "@fm/protocol";
import { add, rotateAbout, signedArea } from "./geometry";
import { kindOf, type Outline } from "./kinds";
import { armsFor, type Arms } from "./arms";

// The shapes a kind draws inside its w × d footprint (furnish.12, .18, .22, catalog.16): a piece has an outline, the
// one ring that draws it, and its parts, the convex rings fit checks (shapefit.01). For every outline but `ell` the
// parts are the outline itself, so what is drawn is what fits; an `ell` outline is not convex, so its parts are its two
// arms. Footprint space, as the editor's symbols: x from −w/2 to w/2, y from −d (front) to 0 (back). Curves are runs of
// straight lines inscribed in the curve (the 32-gon is up to 0.5 % short of the ellipse), so a shape never leaves its
// rectangle and every ring is convex but the `ell`'s, whose parts are: `convexOverlap` stays exact on each part.

/** A piece's two shapes by job (catalog.16): the outline draws, the parts (convex) fit. */
export type PieceShape = { outline: Point[]; parts: Point[][] };

/** Lines to a full ellipse; a quarter takes a quarter of them. Divisible by 4, so the ellipse touches all four sides. */
const ROUND_SEGMENTS = 32;
const QUARTER = ROUND_SEGMENTS / 4;
const TAU = Math.PI * 2;

/** A kind's outline (the kinds table's column); a rectangle for an unknown kind. */
export function outlineOf(kind: string): Outline {
  return kindOf(kind)?.outline ?? "rect";
}

/**
 * The shape's ring, counter-clockwise; its bounding box is the w × d rectangle. An `ell` ring takes its arms from
 * `pieceShape(kind, …)` (`armsFor`); without them it is drawn with arms half its sides.
 */
export function shapeRing(o: Outline, w: number, d: number, arms?: Arms): Point[] {
  switch (o) {
    case "rect":
      return [{ x: -w / 2, y: -d }, { x: w / 2, y: -d }, { x: w / 2, y: 0 }, { x: -w / 2, y: 0 }];
    case "round":
      return Array.from({ length: ROUND_SEGMENTS }, (_, i) => ellipsePoint(w, d, i));
    case "quarter":
      return [{ x: -w / 2, y: 0 }, ...quarterCurve(w, d)];
    case "corner":
      return [{ x: -w / 2, y: 0 }, { x: -w / 2, y: -d }, { x: w / 2, y: 0 }];
    case "soft":
      return softRing(w, d);
    case "pan":
      return panRing(w, d);
    case "ell": { // counter-clockwise from the front-left; the front is points 2 to 4, the two inner edges (catalog.17)
      const { back: t1, left: t2 } = arms ?? { back: d / 2, left: w / 2 };
      return [{ x: -w / 2, y: -d }, { x: -w / 2 + t2, y: -d }, { x: -w / 2 + t2, y: -t1 }, { x: w / 2, y: -t1 }, { x: w / 2, y: 0 }, { x: -w / 2, y: 0 }];
    }
    default:
      return assertNever(o);
  }
}

/**
 * A kind's outline and parts at w × d (catalog.16, .17); an `ell` kind's arms through `armsFor` (the given ones or the
 * kind's, kept inside the footprint). An `ell`'s parts are the back arm [−w/2, w/2] × [−t1, 0] and the left arm
 * [−w/2, −w/2 + t2] × [−d, −t1] below it; every other outline's are `[outline]`.
 */
export function pieceShape(kind: string, w: number, d: number, arms?: Arms): PieceShape {
  const o = outlineOf(kind);
  if (o !== "ell") {
    const outline = shapeRing(o, w, d);
    return { outline, parts: [outline] };
  }
  const a = armsFor(kind, w, d, arms);
  const [x0, x1, xm] = [-w / 2, w / 2, -w / 2 + a.left];
  const box = (left: number, right: number, front: number, back: number): Point[] => [{ x: left, y: front }, { x: right, y: front }, { x: right, y: back }, { x: left, y: back }];
  return { outline: shapeRing(o, w, d, a), parts: [box(x0, x1, -a.back, 0), box(x0, xm, -d, -a.back)] };
}

/**
 * A piece's shapes in the world: `pieceShape` moved to `at` (the middle of the back edge) and turned by `rotation`
 * about it, as `footprintQuad`.
 */
export function placedPiece(kind: string, at: Point, w: number, d: number, rotation: number, arms?: Arms): PieceShape {
  const place = (ring: readonly Point[]): Point[] => ring.map((p) => rotateAbout(add(p, at), at, rotation));
  const { outline, parts } = pieceShape(kind, w, d, arms);
  return { outline: place(outline), parts: parts.map(place) };
}

/**
 * A piece's outline in the world (`placedPiece`'s). For a rectangle kind it equals `footprintQuad(at, w, d, rotation)`.
 */
export function placedShape(kind: string, at: Point, w: number, d: number, rotation: number, arms?: Arms): Point[] {
  return pieceShape(kind, w, d, arms).outline.map((p) => rotateAbout(add(p, at), at, rotation));
}

/** The area of `shapeRing(o, w, d, arms)`: what a piece takes from the free floor. */
export function shapeArea(o: Outline, w: number, d: number, arms?: Arms): number {
  switch (o) {
    case "rect":
      return w * d;
    case "round": // ROUND_SEGMENTS triangles from the centre, radii w/2 and d/2
      return (ROUND_SEGMENTS / 2) * (w / 2) * (d / 2) * Math.sin(TAU / ROUND_SEGMENTS);
    case "quarter": // QUARTER triangles from the back-left corner, radii w and d
      return (QUARTER / 2) * w * d * Math.sin(TAU / ROUND_SEGMENTS);
    case "corner":
      return (w * d) / 2;
    case "soft":
      return signedArea(softRing(w, d));
    case "pan":
      return signedArea(panRing(w, d));
    case "ell": { // the back arm, then the left arm below it
      const { back: t1, left: t2 } = arms ?? { back: d / 2, left: w / 2 };
      return w * t1 + t2 * (d - t1);
    }
    default:
      return assertNever(o);
  }
}

/** What a piece of `kind` takes from the free floor: its outline's area, an `ell`'s with `armsFor`'s arms. */
export function pieceArea(kind: string, w: number, d: number, arms?: Arms): number {
  const o = outlineOf(kind);
  return shapeArea(o, w, d, o === "ell" ? armsFor(kind, w, d, arms) : undefined);
}

/** The rounded corners of `soft` and `pan` (symbols.01): 6 cm, less on a small piece, so a thin one keeps a straight edge. */
export const cornerRadius = (w: number, d: number): number => Math.min(0.06, 0.2 * Math.min(w, d));

/** Lines to a rounded corner, as a quarter of the round ring has at each corner's scale. */
const CORNER_SEGMENTS = 4;

/** A corner's arc about (cx, cy), counter-clockwise from `from` radians through a quarter turn; its ends lie exactly on the sides. */
function cornerArc(cx: number, cy: number, r: number, from: number): Point[] {
  return Array.from({ length: CORNER_SEGMENTS + 1 }, (_, k) => {
    const t = from + (k / CORNER_SEGMENTS) * (Math.PI / 2);
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

/** A rounded rectangle, counter-clockwise from the front edge's left end, so the straight front is its first two points. */
function softRing(w: number, d: number): Point[] {
  const r = cornerRadius(w, d);
  const [x, y0, y1] = [w / 2 - r, -d + r, -r];
  return [
    ...cornerArc(-x, y0, r, Math.PI).slice(-1),
    ...cornerArc(x, y0, r, -Math.PI / 2),
    ...cornerArc(x, y1, r, 0),
    ...cornerArc(-x, y1, r, Math.PI / 2),
    ...cornerArc(-x, y0, r, Math.PI).slice(0, -1),
  ];
}

/** Lines to each side of a pan's front, and how much fuller than an ellipse it is: a superellipse of power 3.2. */
const PAN_FRONT_SEGMENTS = 12;
const PAN_FULLNESS = 2 / 3.2;

/**
 * A sanitary pan (symbols.01), counter-clockwise from the front's middle: to each side a superellipse quarter, whose
 * tangents meet the side and the front square, so the ring stays convex, then the rounded back corners and a flat back.
 * Built on the right and mirrored, so it is exactly symmetric.
 */
function panRing(w: number, d: number): Point[] {
  const r = cornerRadius(w, d);
  const front = Array.from({ length: PAN_FRONT_SEGMENTS }, (_, k) => {
    const t = ((k + 1) / PAN_FRONT_SEGMENTS) * (Math.PI / 2);
    return { x: (w / 2) * Math.sin(t) ** PAN_FULLNESS, y: -r - (d - r) * Math.cos(t) ** PAN_FULLNESS };
  });
  const right = [...front, ...cornerArc(w / 2 - r, -r, r, 0).slice(1)];
  return [{ x: 0, y: -d }, ...right, ...[...right].reverse().map((p) => ({ x: -p.x, y: p.y }))];
}

/** Point i of the inscribed ellipse; i = ROUND_SEGMENTS wraps exactly to point 0. */
function ellipsePoint(w: number, d: number, i: number): Point {
  const k = i % ROUND_SEGMENTS;
  const t = (k / ROUND_SEGMENTS) * TAU;
  return { x: (w / 2) * Math.cos(t), y: -d / 2 + (d / 2) * Math.sin(t) };
}

/**
 * The quarter ellipse about the back-left corner, radii w and d, from the front-left corner to the back-right one.
 * Its ends are the corners exactly, so the straight left side is exactly vertical.
 */
function quarterCurve(w: number, d: number): Point[] {
  return Array.from({ length: QUARTER + 1 }, (_, k) => {
    if (k === 0) return { x: -w / 2, y: -d };
    if (k === QUARTER) return { x: w / 2, y: 0 };
    const t = -Math.PI / 2 + (k / QUARTER) * (Math.PI / 2);
    return { x: -w / 2 + w * Math.cos(t), y: d * Math.sin(t) };
  });
}
