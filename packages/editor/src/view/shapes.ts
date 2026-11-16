import { add, armsOf, outlineOf, pieceShape, placedShape, rotateAbout, shapeRing, type Arms, type ObjectOptions, type Outline } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { aggregateLayout, aggregateRings, roundChairRing } from "./aggregate";

// What the symbols draw of a kind's shape (furnish.12, .18, .22). The ring itself is the domain's (`shapeRing`,
// shapefit.01): fit checks the same ring the outline and the fill draw. Footprint space, as the symbols: x from −w/2
// to w/2, y from −d (front) to 0 (back).

/** The shape's front, an open polyline drawn as the heavier front line: the side a person uses; an `ell`'s with `arms`. */
export function shapeFront(o: Outline, w: number, d: number, arms?: Arms): Point[] {
  const ring = shapeRing(o, w, d, arms);
  switch (o) {
    case "rect": // front-left, front-right
    case "soft": // the straight front; soft kinds draw no front line (catalog.54), so this only completes the switch
      return ring.slice(0, 2);
    case "round": { // the front half, from the left extreme round to the right one
      const half = ring.length / 2;
      return [...ring.slice(half), ...ring.slice(0, 1)];
    }
    case "quarter": // the curve, after the back-left corner
    case "corner": // the long side, front-left to back-right
      return ring.slice(1);
    case "pan": { // the curved front, from the left side round to the right; pans draw no front line (catalog.54), so this only completes the switch
      const half = (ring.length - 1) / 2;
      return [...ring.slice(-half), ...ring.slice(0, half + 1)];
    }
    case "ell": // the two inner edges, the left arm's then the back arm's (catalog.17)
      return ring.slice(1, 4);
    default:
      return assertNever(o);
  }
}

/** An object's arms for drawing: an `L`'s own (catalog.17); none for any other kind or a missing object. */
export const objectArms = (object: { kind: string; arms?: Arms } | undefined): Arms | undefined => (object ? (armsOf(object) ?? undefined) : undefined);

/**
 * A piece's fill in the world: its kind's shape placed at `at`, turned by `rotation` (`placedShape`), an `L`'s with
 * `arms` (the object's; none for a ghost, the kind's default). For a rectangle kind it is `rectangle` itself, the same
 * array, so memoised layers keep their identity.
 */
export function shapedFill(kind: string, w: number, d: number, at: Point, rotation: number, rectangle: readonly Point[], arms?: Arms): readonly Point[] {
  return outlineOf(kind) === "rect" ? rectangle : placedShape(kind, at, w, d, rotation, arms);
}

/**
 * A piece's fill in footprint space: its kind's shape, or an aggregate's parts, each chair then the table (seating.15),
 * the chairs rounded with the object's round chairs (library.07); an `L`'s outline with `arms`.
 */
export function fillRings(kind: string, w: number, d: number, options: ObjectOptions = {}, arms?: Arms): Point[][] {
  const set = aggregateLayout(kind, w, d);
  return set ? aggregateRings(set, options) : [pieceRing(kind, w, d, options, arms)];
}

/** A piece's outline as it draws: its kind's shape, or a loose chair's rounded ring with round chairs (seated.05); fit keeps the shape. */
export const pieceRing = (kind: string, w: number, d: number, options: ObjectOptions = {}, arms?: Arms): Point[] =>
  options.roundChairs === true ? roundChairRing(w, d) : pieceShape(kind, w, d, arms).outline;

/**
 * A piece's fills in the world: `shapedFill`, one ring, or an aggregate's parts placed as its symbol is. The canvas
 * fills, selects and refuses these (with the object's `options`: round chairs; its `arms`: an `L`'s outline); fit,
 * grips and the hit test keep the piece's own shape.
 */
export function shapedFills(kind: string, w: number, d: number, at: Point, rotation: number, rectangle: readonly Point[], options: ObjectOptions = {}, arms?: Arms): readonly (readonly Point[])[] {
  const set = aggregateLayout(kind, w, d);
  return set ? aggregateRings(set, options).map((ring) => ring.map((p) => rotateAbout(add(p, at), at, rotation))) : options.roundChairs === true ? [roundChairRing(w, d).map((p) => rotateAbout(add(p, at), at, rotation))] : [shapedFill(kind, w, d, at, rotation, rectangle, arms)];
}
