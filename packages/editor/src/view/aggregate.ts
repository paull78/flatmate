import {
  CHAIR_SIZE, MIN_SET_TABLE, convexIntersection, diningChairsPerSide, diningTable, footprintQuad, inConvex, kindOf, outlineOf, rotateAbout, roundChairs, roundSetTable, shapeRing, signedArea, type Aggregate, type ObjectOptions,
} from "@fm/domain";
import type { Point } from "@fm/protocol";

// An aggregate's parts (seating.15, AC-04): its table or desk and its chairs as loose chairs fully tucked, in footprint
// space (x from −w/2 to w/2, y from −d at the front to 0 at the back). The one owner of the chair poses: the plan
// symbol, the fill and the 3D parts all read them.
//
//   dining (sides)           round (around)            desk (front)
//   ┌─▓▓▓─────▓▓▓─┐ y = 0      ▓▓▓                     ┌────────────┐ y = 0
//   │ ┌─────────┐ │          ▓┌───┐▓                   │    desk    │
//   ▓ │  table  │ ▓          ▓│ ● │▓  from the front,  │            │
//   │ └─────────┘ │          ▓└───┘▓  facing ●         └────▓▓▓─────┘ y = −d
//   └─▓▓▓─────▓▓▓─┘ y = −d     ▓▓▓
//   ▓ a chair's backrest strip, its back `reach` from the table's edge: at SEAT_BACK flush, fully tucked (seating.14), and
//   further out clear of the table (seated.01); the dining set's end chairs only from a 1.40 table (library.06)

/** A chair as a loose chair would be placed relative to the set: its back edge's middle and its turn (degrees). */
export type ChairPose = { at: Point; rotation: number };

/**
 * A set's table (its kind, configuration and size, placed at `tableAt`, its back edge's middle, unturned) with its ring,
 * and its chairs. Chairs are drawn only when every one lies inside the piece and no two overlap; with
 * none the table is the whole piece (a circle of the smaller side for a round set).
 */
export type AggregateLayout = { table: Point[]; tableKind: string; tableConfig: string; tableAt: Point; tableSize: { w: number; d: number }; chairs: ChairPose[] };

type Arranged = { tableAt: Point; tableSize: { w: number; d: number }; chairs: ChairPose[] };

/** The table less the chairs' backrests, and the chairs, for each arrangement. */
const ARRANGE: Readonly<Record<Aggregate["chairs"], (w: number, d: number, reach: number) => Arranged>> = {
  // Each side's chairs centred in L/n cells along the table, the back row facing −y and the front row turned to face +y;
  // from a 1.40 table (library.06) one at each end, its back on the piece's short side, turned to face the table.
  sides: (w, d, reach) => {
    const table = diningTable(w, d, reach);
    const n = diningChairsPerSide(table.w);
    const xs = Array.from({ length: n }, (_, i) => -table.w / 2 + (table.w / n) * (i + 0.5));
    const ends = table.ends ? [{ at: { x: -w / 2, y: -d / 2 }, rotation: 90 }, { at: { x: w / 2, y: -d / 2 }, rotation: 270 }] : [];
    const chairs = [...xs.map((x) => ({ at: { x, y: 0 }, rotation: 0 })), ...xs.map((x) => ({ at: { x, y: -d }, rotation: 180 })), ...ends];
    return { tableAt: { x: 0, y: -reach }, tableSize: { w: table.w, d: table.d }, chairs };
  },
  // The table of the smaller side (seating.34), chairs evenly round it from the front, each turned to face the centre.
  around: (w, d, reach) => {
    const t = roundSetTable(Math.min(w, d), reach);
    const n = roundChairs(t);
    const centre = { x: 0, y: -d / 2 };
    const front = { x: 0, y: -d / 2 - t / 2 - reach };
    const chairs = Array.from({ length: n }, (_, k) => ({ at: rotateAbout(front, centre, (360 * k) / n), rotation: (180 + (360 * k) / n) % 360 }));
    return { tableAt: { x: 0, y: -d / 2 + t / 2 }, tableSize: { w: t, d: t }, chairs };
  },
  front: (w, d, reach) => ({ tableAt: { x: 0, y: 0 }, tableSize: { w, d: d - reach }, chairs: [{ at: { x: 0, y: -d }, rotation: 180 }] }),
};

/**
 * A round chair's ring in its footprint space (library.09, seated.05): the rectangle with its corners rounded by 0.12 m, or
 * as much as fits, each a quarter circle of four lines, counter-clockwise from the front right like `footprintQuad`.
 */
export function roundChairRing(w: number, d: number): Point[] {
  const r = Math.min(0.12, w / 2, d / 2);
  const corners = [{ x: w / 2 - r, y: -d + r }, { x: w / 2 - r, y: -r }, { x: -w / 2 + r, y: -r }, { x: -w / 2 + r, y: -d + r }];
  return corners.flatMap((c, k) => Array.from({ length: 5 }, (_, i) => {
    const t = (Math.PI / 2) * (k - 1 + i / 4);
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  }));
}

const ROUND_CHAIR = roundChairRing(CHAIR_SIZE.w, CHAIR_SIZE.d);

/**
 * A chair's ring at its pose, both its fill and its outline: the chair kind's rectangle (`CHAIR_SIZE`), or with the
 * set's round chairs (library.07) the rounded one. Fit reads only the rectangle.
 */
export const chairRing = (c: ChairPose, round = false): Point[] =>
  round ? ROUND_CHAIR.map((p) => rotateAbout({ x: p.x + c.at.x, y: p.y + c.at.y }, c.at, c.rotation)) : footprintQuad(c.at, CHAIR_SIZE.w, CHAIR_SIZE.d, c.rotation);

/** Whether `kind` is an aggregate: its fill and outline are its parts, and it has no front line (seating.15). */
export const isAggregate = (kind: string): boolean => (kindOf(kind)?.aggregate ?? null) !== null;

/** The parts of a set of `kind` at w × d, or null for a kind that isn't an aggregate. */
export function aggregateLayout(kind: string, w: number, d: number): AggregateLayout | null {
  const set = kindOf(kind)?.aggregate;
  return set ? arrangedSet(set, kind, w, d) : null;
}

/**
 * The parts of `set` in a piece of `kind` (its outline bounds the chairs) at w × d: its table and chairs while the table is
 * at least `MIN_SET_TABLE` and they fit, else the bare table.
 */
export function arrangedSet(set: Aggregate, kind: string, w: number, d: number): AggregateLayout {
  const tableOf = (a: Arranged): Point[] => shapeRing(outlineOf(set.table), a.tableSize.w, a.tableSize.d).map((p) => ({ x: p.x + a.tableAt.x, y: p.y + a.tableAt.y }));
  const seated = ARRANGE[set.chairs](w, d, set.reach);
  const m = Math.min(w, d);
  const whole: Arranged = set.chairs === "around" ? { tableAt: { x: 0, y: -d / 2 + m / 2 }, tableSize: { w: m, d: m }, chairs: [] } : { tableAt: { x: 0, y: 0 }, tableSize: { w, d }, chairs: [] };
  const fits = seated.tableSize.w >= MIN_SET_TABLE - 1e-9 && seated.tableSize.d >= MIN_SET_TABLE - 1e-9 && chairsFit(seated.chairs.map((c) => chairRing(c)), shapeRing(outlineOf(kind), w, d));
  const used = fits ? seated : whole;
  return { table: tableOf(used), tableKind: set.table, tableConfig: set.config, tableAt: used.tableAt, tableSize: used.tableSize, chairs: used.chairs };
}

/** Every chair inside the piece's ring, and no two sharing floor, under the table or anywhere: chairs are real (seated.23). */
function chairsFit(chairs: readonly Point[][], piece: readonly Point[]): boolean {
  const inside = (ring: readonly Point[], of: readonly Point[]): boolean => ring.every((p) => inConvex(p, of, 1e-9));
  const apart = (a: readonly Point[], b: readonly Point[]): boolean => Math.abs(signedArea(convexIntersection(a, b))) < 1e-12;
  return chairs.every((c) => inside(c, piece)) && chairs.every((a, i) => chairs.slice(i + 1).every((b) => apart(a, b)));
}

/**
 * The set's fill: each chair's ring (rounded with `options.roundChairs`), then the table's over them, as loose tucked
 * chairs fill before their table (seating.10).
 */
export const aggregateRings = (l: AggregateLayout, options: ObjectOptions = {}): Point[][] => [...l.chairs.map((c) => chairRing(c, options.roundChairs === true)), l.table];
