// The aggregates' geometry (spec "Seating: aggregates", seating.06, .07, .15): a table or desk and its fully tucked
// chairs as one piece. One owner for what the domain, the plan symbol and the 3D parts all read: the chair's size and
// backrest, chair counts by size, the dining set's end chairs (library.06), the round set's table and the desk set's depth. A leaf module: the kinds table and
// the presets read it, so it imports neither.

/**
 * An aggregate's parts, its kind row's `aggregate` column (seating.06): its table or desk, a kind and configuration drawn
 * and built as that kind's own, and its chairs, on the two long `sides` (front and back), `around` a round table, or one
 * at the `front`. `reach` is the table's edge to the piece's edge, where a chair's back stands: `SEAT_BACK` for chairs fully
 * tucked, more to stand them clear of the table (seated.01).
 */
export type Aggregate = { table: string; config: string; chairs: "sides" | "around" | "front"; reach: number };

/** A seat's backrest: the back strip that stays solid when the seat tucks under a piece you sit at (seating.14). */
export const SEAT_BACK = 0.1;

/** The chair kind's default size (its row in the kinds table reads it), so a set's chairs are loose chairs. */
export const CHAIR_SIZE = { w: 0.45, d: 0.45 } as const;
export const CHAIR_W = CHAIR_SIZE.w;

/** The table's edge to the piece's edge of a set with room to sit (seated.01): a chair 15 cm off the table, and the chair. */
export const SEATED_REACH = 0.6;

/** A set's table is at least this long and deep, or the set is a bare table: at a long reach, chairs can fit a piece with no table left. */
export const MIN_SET_TABLE = 0.2;

/** A diner's share of a table's long side, the usual planning figure (seating.07). */
const PLACE_WIDTH = 0.6;

/** A dining set's chairs on each long side: max(1, round(w / 0.60)), so 1.50 m is 3 (1.5 / 0.6 is 2.4999…). */
export function diningChairsPerSide(w: number): number {
  return Math.max(1, Math.round(w / PLACE_WIDTH + 1e-9));
}

/** The shortest dining table with a chair at each end (library.06). */
const ENDS_FROM = 1.4;

/** Whether a dining table of this length seats one at each end: from 1.40 m. */
export function diningEnds(table: number): boolean {
  return table >= ENDS_FROM - 1e-9;
}

/** A dining table's seats: its two long sides, and its two ends from 1.40 m (1.20 → 4, 1.40 → 6, 2.00 → 8, 2.60 → 10). */
export function diningSeats(table: number): number {
  return 2 * diningChairsPerSide(table) + (diningEnds(table) ? 2 : 0);
}

/**
 * The table inside a w × d dining set: `reach` less at each long side, and at each end when the table left is long
 * enough for end chairs. A piece too short to hold a 1.40 table and its end chairs has none, and its table is its whole
 * length: at a reach of 0.10 that's under 1.60 m, at 0.60 under 2.60 m, where the table jumps at a resize, a stated limit.
 *
 *   ends                    no ends
 *   ┌─▓───▓───▓─┐           ┌─▓───▓─┐
 *   ▓ ┌───────┐ ▓           │┌─────┐│
 *   ▓ │ table │ ▓           ││table││
 *   ▓ └───────┘ ▓           │└─────┘│
 *   └─▓───▓───▓─┘           └─▓───▓─┘
 */
export function diningTable(w: number, d: number, reach: number): { w: number; d: number; ends: boolean } {
  const ends = diningEnds(w - 2 * reach);
  return { w: ends ? w - 2 * reach : w, d: d - 2 * reach, ends };
}

/** A round set's chairs for its table's diameter: 4 under 1.10 m, 6 under 1.40, else 8 (seating.07). */
export function roundChairs(table: number): number {
  return table < 1.1 ? 4 : table < 1.4 ? 6 : 8;
}

/**
 * A round piece's fit ring is a 32-gon inscribed in its circle (shapes.ts): every point of it is at least
 * R · cos(π/32) from the centre, so a corner within that distance is inside it at any angle.
 */
const RING_INRADIUS = Math.cos(Math.PI / 32);

/**
 * The table's diameter inside a round set of diameter D: the largest table whose chairs, their backs `reach` from its
 * edge, keep their back corners inside the piece's fit ring:
 *
 *            ┌──W──┐  ← back corners at (±W/2, r + reach) from the centre
 *            │▓▓▓▓▓│     √((W/2)² + (r + reach)²) = (D/2) · cos(π/32)
 *        ────┴─────┴──── the table's edge, r from the centre
 *
 * Never negative: a piece too small for a chair holds a table of 0.
 */
export function roundSetTable(D: number, reach: number): number {
  const inside = (D / 2) * RING_INRADIUS;
  const r = Math.sqrt(Math.max(0, inside * inside - (CHAIR_W / 2) ** 2)) - reach;
  return Math.max(0, 2 * r);
}

/** The round set's diameter around a table of diameter `table`: `roundSetTable`'s inverse, for presets. */
export function roundSetDiameter(table: number, reach: number): number {
  return (2 * Math.hypot(CHAIR_W / 2, table / 2 + reach)) / RING_INRADIUS;
}

/** A desk set's depth: the desk's and the tucked chair's backrest in front of it. */
export function deskSetDepth(desk: number): number {
  return desk + SEAT_BACK;
}
