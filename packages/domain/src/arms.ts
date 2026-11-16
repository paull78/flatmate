import { isRecord } from "@fm/protocol";
import { toMm } from "./format";
import { kindOf } from "./kinds";

// An `L` piece's arms (catalog.02, .17, .19): `back` (t1) is the back arm's depth, across the footprint's depth;
// `left` (t2) the left arm's, across its width. Stored on the object, only for `ell` kinds. Row modules import only the
// type from here, so the kinds table never waits on this module.

export type Arms = { back: number; left: number };

/** The shallowest arm, and how much shallower than its side an arm must be (catalog.12). */
export const MIN_ARM = 0.1;
const SLACK = 1e-9;

/** Whether arms keep the rule on a w × d footprint: each at least 0.10 m and 0.10 m shallower than its side. */
export function armsFit(arms: Arms, w: number, d: number): boolean {
  const fits = (t: number, side: number): boolean => t >= MIN_ARM - SLACK && t <= side - MIN_ARM + SLACK;
  return fits(arms.back, d) && fits(arms.left, w);
}

/** Exactly `back` and `left`, each a finite number, as a fresh object; null otherwise. Bounds are validation's. */
export function parseArms(v: unknown): Arms | null {
  if (!isRecord(v) || Object.keys(v).length !== 2 || !Object.hasOwn(v, "back") || !Object.hasOwn(v, "left")) return null;
  const { back, left } = v;
  return typeof back === "number" && Number.isFinite(back) && typeof left === "number" && Number.isFinite(left) ? { back, left } : null;
}

/** An object's arms: its stored ones, else its kind's default; null for a kind without arms. */
export function armsOf(object: { kind: string; arms?: Arms }): Arms | null {
  const own = kindOf(object.kind)?.arms ?? null;
  return own === null ? null : (object.arms ?? own);
}

/**
 * The arms an `ell` piece draws and fits with (catalog.19): `arms`, else the kind's default (half of each side for a
 * kind without one), clamped so the shape stays inside its w × d footprint: from 0.10 m to 0.10 m short of its side,
 * or half the side when the side is under 0.20 m, to the millimetre. Validation still refuses stored arms that break
 * `armsFit`, so a side under 0.20 m holds no arm (`armsPlaceable`).
 */
export function armsFor(kind: string, w: number, d: number, arms?: Arms): Arms {
  const given = arms ?? kindOf(kind)?.arms ?? { back: d / 2, left: w / 2 };
  return { back: clampArm(given.back, d), left: clampArm(given.left, w) };
}

function clampArm(t: number, side: number): number {
  const arm = side < 2 * MIN_ARM ? side / 2 : Math.min(Math.max(t, MIN_ARM), side - MIN_ARM);
  return toMm(arm) / 1000;
}

/**
 * Whether a piece of `kind` at w × d can hold its arms (sizing.04): true for a kind without arms, else whether the
 * clamped arms keep the rule. The one test the ghost's fit and the place command share, so a green `L` ghost is placed.
 */
export function armsPlaceable(kind: string, w: number, d: number, arms?: Arms): boolean {
  return (kindOf(kind)?.arms ?? null) === null || armsFit(armsFor(kind, w, d, arms), w, d);
}
