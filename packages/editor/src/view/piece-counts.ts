import { configsOf, shownCm, type Arms } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";

// Counts and sizes a piece's plan symbol and its 3D parts share (parts.15), so the plan and the 3D view never disagree.

/** A WC draws a cistern from this depth (symbols.02): a wall-hung one is shallower, and symbols see only the plan size. */
export const hasCistern = (d: number): boolean => d >= 0.6 - 1e-9;

/** How deep a WC's cistern is, from the back, in the plan and in 3D. */
export const cisternDepth = (d: number): number => Math.min(0.17, 0.28 * d);

/** How many basins a vanity unit w wide has: one, or two from 1.40 m (symbols.03); each stands centred in its share of the width. */
export const vanityBasins = (w: number): 1 | 2 => (w >= 1.4 - 1e-9 ? 2 : 1);

/**
 * A vanity unit's basins, the plan's and 3D's: where each stands along the width, how wide each is, the margin round them
 * and the ledge at the back where the taps stand.
 */
export function vanityLayout(w: number, d: number): { xs: number[]; width: number; margin: number; ledge: number } {
  const xs = vanityBasins(w) === 2 ? [-w / 4, w / 4] : [0];
  const small = Math.min(w, d);
  const margin = Math.min(0.05, 0.12 * small);
  return { xs, margin, ledge: Math.min(0.1, 0.22 * small), width: Math.min(0.55, w / xs.length - 2 * margin) };
}

/** An open built-in unit's cabinet: the kind's closed depth, at most half the piece. */
export const builtInCabinetDepth = (kind: string, d: number): number => Math.min(configsOf({ kind })[0]?.d ?? d / 2, d / 2);

/** A towel rail's post radius (catalog.23): 0.02 m, less on a piece too small to hold it. */
export const towelRailPost = (w: number, d: number): number => Math.min(0.02, 0.15 * w, 0.2 * d);

/** Book depths as shares of a shelf's depth, cycling: the plan's spines and the 3D view's blocks. */
export const BOOK_DEPTHS: readonly number[] = [0.72, 0.62, 0.68, 0.75, 0.6, 0.7, 0.66, 0.58];

/**
 * A TV's screen and stand plate on a unit w wide and d deep: widths, and distances from the back edge. A unit shallower
 * than its 0.40 m default keeps these depths' shares of 0.40.
 */
export function tvLayout(w: number, d: number): { screenWidth: number; plateWidth: number; screenBack: number; screenFront: number; plateFront: number } {
  const screenWidth = Math.min(1.4, 0.85 * w);
  const fromBack = (y: number) => Math.min(y, (y / 0.4) * d);
  return { screenWidth, plateWidth: Math.min(0.4, 0.35 * screenWidth), screenBack: fromBack(0.06), screenFront: fromBack(0.11), plateFront: fromBack(0.3) };
}

/** A sofa's arm width: 0.15 m, or a quarter of a narrow sofa. */
export const sofaArm = (w: number): number => Math.min(0.15, w / 4);

/**
 * How many seats a sofa w wide draws: 0.70 m each between its arms, at least one (seating.03): 2 under 2.05 m, 3 to
 * 2.75 m, then 4. The 1e-9 nudge rounds a half seat up even when floating point stores it just below (a computed 2.05 m).
 */
export function sofaSeats(w: number): number {
  return Math.max(1, Math.round((w - 2 * sofaArm(w)) / 0.7 + 1e-9));
}

/**
 * A corner sofa's armrest at the far end of each run (catalog.14): `sofaArm` of the run's length, from the other arm's
 * inner face to the end (the back run w − t2, the left run d − t1), so it always leaves three quarters for the seats.
 * `arms` are `armsFor`'s.
 */
export function cornerSofaEnds(w: number, d: number, arms: Arms): { back: number; left: number } {
  return { back: sofaArm(w - arms.left), left: sofaArm(d - arms.back) };
}

/**
 * How many seats each run of a corner sofa draws, by the sofa's 0.70 m rule (seating.03) between the inner corner and
 * the armrest, at least one; the corner seat comes on top. At arms 0.90: 2.20 × 1.60 → 2 and 1, 2.60 × 2.00 → 2 and 1,
 * 3.00 × 2.40 → 3 and 2.
 */
export function cornerSofaSeats(w: number, d: number, arms: Arms): { back: number; left: number } {
  const ends = cornerSofaEnds(w, d, arms);
  const seats = (run: number) => Math.max(1, Math.round(run / 0.7 + 1e-9));
  return { back: seats(w - arms.left - ends.back), left: seats(d - arms.back - ends.left) };
}

/**
 * How many pillows a bed w wide draws: one centred below 1.30 m, two from 1.30 m, compared at the centimetre the Width
 * field shows, rounded as `presetOf` rounds (smart.17, `shownCm`): a 1.2996 m bed reads 1.30 and draws two, and so
 * does a 1.295 m bed, whose half centimetre rounds away from zero (cleanup.13; toFixed read it as 1.29, furnish.06).
 */
export function bedPillows(w: number): 1 | 2 {
  return shownCm(w) < 130 ? 1 : 2;
}

/**
 * How many burners a hob w wide has (spec "Preset lists"): 2 below 0.45 m, 4 to 0.70 m, 5 to 0.85 m, then 6, compared at
 * the centimetre the Width field shows, as `bedPillows` compares.
 */
export function hobBurners(w: number): 2 | 4 | 5 | 6 {
  const cm = shownCm(w);
  return cm < 45 ? 2 : cm < 70 ? 4 : cm < 85 ? 5 : 6;
}

/** A hob's ring: its centre about the footprint's centre (the front at y −d/2) and its radius on the plan. */
export type HobRing = Point & { r: number };

/** Where a hob's `hobBurners` rings stand: two in line along the depth, 2 × 2 (the large ones on one diagonal), 2 × 2 and a centre wok, or 3 × 2. */
export function hobRings(w: number, d: number): HobRing[] {
  const m = Math.min(w, d);
  const ring = (x: number, sy: number, r: number): HobRing => ({ x, y: (sy * d) / 4, r });
  const burners = hobBurners(w);
  switch (burners) {
    case 2: {
      const by = Math.min(1.6 * w, d); // a narrow hob's rings go by its width, held to its depth
      return [ring(0, 1, 0.11 * by), ring(0, -1, 0.15 * by)];
    }
    case 4:
      return [ring(-w / 4, 1, 0.16 * m), ring(w / 4, 1, 0.11 * m), ring(-w / 4, -1, 0.11 * m), ring(w / 4, -1, 0.16 * m)];
    case 5:
      return [...[-1, 1].flatMap((sx) => [1, -1].map((sy) => ring((sx * w) / 3, sy, 0.1 * m))), ring(0, 0, 0.15 * m)];
    case 6:
      return [-1, 0, 1].flatMap((sx) => [1, -1].map((sy) => ring((sx * w) / 3.2, sy, (sx === 0 ? 0.13 : 0.1) * m)));
    default:
      return assertNever(burners);
  }
}
