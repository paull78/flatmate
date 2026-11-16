import { assertNever } from "@fm/protocol";

// The stair kinds' rules (stairs.01, .05, .20, spec "Kinds and sizes"): one row per body, read through the kinds'
// `stair` column, so code dispatches on the shape and the data, never on a kind id. A stair is sized by the box every
// piece has: width, depth (the run) and height (the rise); risers and going are derived (queries/stairs.ts).

/** How a stair is laid out: a straight flight, a flight winding through a quarter turn at its foot (steps.04), a spiral around a column, or a ladder of rungs. */
export type StairShape = "flight" | "winder" | "spiral" | "ladder";
/** What a stair is made of, which decides its symbol, its 3D parts and its checks. */
export type StairBody = "solid" | "storage" | "drawers" | "winder" | "open" | "ship" | "alternating" | "spiral" | "rungs";
/**
 * The recommended going for a riser: the step formula (length − 2 × riser, kept within min and max), the tiny-house
 * loft formula (length − slope × riser, IRC Appendix AQ), a climb at a fixed angle, or a spiral's turn per tread.
 */
export type GoingRule =
  | { kind: "step"; length: number; min: number; max: number }
  | { kind: "loft"; length: number; slope: number }
  | { kind: "angle"; deg: number }
  | { kind: "turn"; deg: number };
/** A rule-of-thumb check on a stair's size (stairs.05): what it measures. */
export type SizeCheckId = "riser" | "going" | "step" | "width" | "slope" | "spacing" | "angle" | "clearWidth" | "walkingTread" | "rise";
/** Its bounds, in metres or degrees; "loft" is the tiny-house formula's going for the stair's riser (its going rule). */
export type SizeCheck = { id: SizeCheckId; min?: number | "loft"; max?: number };

/**
 * `maxRiser` is the largest riser (rung spacing for a ladder) the riser count rounds to; `headroom` the clearance
 * over the pitch line, null for none (stairs.03, .12); `underside` whether a piece may stand under the flight, below
 * its pitch line less the side boards (stairs.11); `checks` its rules of thumb, shown as warnings (stairs.05); `turns`
 * whether it makes an L on a deck's edge (stairdraw.09); `minRisers` the fewest risers it takes (steps.09).
 */
export type StairRule = { body: StairBody; shape: StairShape; maxRiser: number; minRisers: number; going: GoingRule; headroom: number | null; underside: boolean; checks: readonly SizeCheck[]; turns: boolean };

const STEP: GoingRule = { kind: "step", length: 0.63, min: 0.25, max: 0.3 };

// The spec's table (IRC 2021 R311.7 and Appendix AQ, DIN 18065, the step formula).
const MAIN_STAIR: readonly SizeCheck[] = [{ id: "riser", max: 0.197 }, { id: "going", min: 0.254 }, { id: "step", min: 0.6, max: 0.66 }, { id: "width", min: 0.8 }];
const LOFT_STAIR: readonly SizeCheck[] = [{ id: "riser", min: 0.178, max: 0.305 }, { id: "going", min: "loft" }, { id: "width", min: 0.508 }];
const STEEP: readonly SizeCheck[] = [{ id: "riser", max: 0.241 }, { id: "slope", min: 50, max: 70 }, { id: "width", min: 0.508 }];
const SPIRAL: readonly SizeCheck[] = [{ id: "riser", max: 0.241 }, { id: "clearWidth", min: 0.66 }, { id: "walkingTread", min: 0.171 }];
/** Storage steps (steps.03): a main stair's riser and going, no step formula (their deep treads break it on purpose), for platforms only. */
const STEPS: readonly SizeCheck[] = [{ id: "riser", max: 0.197 }, { id: "going", min: 0.254 }, { id: "width", min: 0.4 }, { id: "rise", max: 0.76 }];
const LADDER: readonly SizeCheck[] = [{ id: "spacing", min: 0.254, max: 0.356 }, { id: "angle", min: 70, max: 80 }, { id: "width", min: 0.305 }];
const MAIN_HEADROOM = 2;
/** A tiny-house loft stair's headroom (IRC Appendix AQ). */
const LOFT_HEADROOM = 1.88;
/** Fewer than two risers is no stair: one step is a platform's edge. */
const TWO = 2;
/** A winder's fewest risers: its three winders, a straight tread and the step onto the deck (steps.09). */
const WINDER_RISERS = 5;
/** Storage steps' treads, deep enough for a drawer about 0.30 m deep (steps.03, .09). */
const DRAWER_GOING = 0.35;

export const STAIR_RULES: Readonly<Record<StairBody, StairRule>> = {
  solid: { body: "solid", shape: "flight", maxRiser: 0.19, minRisers: TWO, going: STEP, headroom: MAIN_HEADROOM, underside: false, checks: MAIN_STAIR, turns: true },
  open: { body: "open", shape: "flight", maxRiser: 0.19, minRisers: TWO, going: STEP, headroom: MAIN_HEADROOM, underside: true, checks: MAIN_STAIR, turns: true },
  storage: { body: "storage", shape: "flight", maxRiser: 0.23, minRisers: TWO, going: { kind: "loft", length: 0.508, slope: 4 / 3 }, headroom: LOFT_HEADROOM, underside: false, checks: LOFT_STAIR, turns: true },
  drawers: { body: "drawers", shape: "flight", maxRiser: 0.19, minRisers: TWO, going: { kind: "step", length: 0.63, min: DRAWER_GOING, max: DRAWER_GOING }, headroom: MAIN_HEADROOM, underside: false, checks: STEPS, turns: false },
  winder: { body: "winder", shape: "winder", maxRiser: 0.19, minRisers: WINDER_RISERS, going: STEP, headroom: MAIN_HEADROOM, underside: false, checks: MAIN_STAIR, turns: false },
  ship: { body: "ship", shape: "flight", maxRiser: 0.241, minRisers: TWO, going: { kind: "angle", deg: 60 }, headroom: MAIN_HEADROOM, underside: true, checks: STEEP, turns: false },
  alternating: { body: "alternating", shape: "flight", maxRiser: 0.22, minRisers: TWO, going: { kind: "angle", deg: 60 }, headroom: MAIN_HEADROOM, underside: true, checks: STEEP, turns: false },
  spiral: { body: "spiral", shape: "spiral", maxRiser: 0.22, minRisers: TWO, going: { kind: "turn", deg: 30 }, headroom: MAIN_HEADROOM, underside: false, checks: SPIRAL, turns: false },
  rungs: { body: "rungs", shape: "ladder", maxRiser: 0.3, minRisers: TWO, going: { kind: "angle", deg: 75 }, headroom: null, underside: false, checks: LADDER, turns: false },
};

/** What a person needs over a flight's pitch line to get past (riser.15): anything leaving less collides. A judgement, not a standard. */
export const MIN_PASSAGE = 1;

/** A typed target riser's bounds (riser.07): wider than every rule of thumb, they only stop nonsense. */
export const MIN_TARGET_RISER = 0.1;
export const MAX_TARGET_RISER = 0.35;

/** A winder's three turning treads, in the square at its front (steps.04). */
export const WINDERS = 3;
/** How much deeper than wide a winder must be, so a straight part follows its front square (steps.09). */
export const MIN_WINDER_EXTRA = 0.05;

export const MIN_GOING = 0.05; // a rung ladder's is about 0.08
export const MAX_GOING = 0.6;

/** Whether a stair of this rule has handrails, and so a handrail setting (guards.28): a flight and a spiral do, a rung ladder doesn't. */
export function hasHandrails(rule: StairRule): boolean {
  switch (rule.shape) {
    case "flight":
    case "winder":
    case "spiral":
      return true;
    case "ladder":
      return false;
    default:
      return assertNever(rule.shape);
  }
}

export function isTargetRiser(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_TARGET_RISER && v <= MAX_TARGET_RISER;
}

/** A spiral's centre column, 0.13 across (stairs.21). */
export const SPIRAL_COLUMN_RADIUS = 0.065;
/** Where a spiral's tread is measured: this far from the column's edge (IRC R311.7.10.1). */
export const SPIRAL_WALKING_LINE = 0.305;
