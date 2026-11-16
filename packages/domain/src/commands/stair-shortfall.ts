import type { DomainError } from "../errors";
import { MIN_OBJECT_SIZE } from "../kinds";
import type { Document } from "../model";
import type { StairParts } from "../queries/stair-edge";
import { stairFits } from "./place-stair";

/** How far a stair is short (metres), or, when no run fits at all, the commit's refusal. */
export type StairShortfall = { short: number } | { reason: DomainError };

/**
 * How short the stair `parts` are (stairdraw.19, spec "Hints and fixes"): null when they fit; else their run less the
 * longest run, back kept on the edge, that passes the commit's own fit (stairFits), found by bisection to the
 * millimetre over [MIN_OBJECT_SIZE, run], about 12 fit checks; the commit's refusal (`reason`) when not even the
 * shortest run a piece can have fits, and always for an L, whose runs the split sets. One rule decides fit, so the
 * number can't disagree with the refusal.
 */
export function stairShortfall(doc: Document, parts: StairParts, state: string): StairShortfall | null {
  const fit = stairFits(doc, parts, state);
  if (fit.ok) return null;
  const [flight] = parts.flights;
  const reason = { reason: fit.error };
  if (parts.landing !== null || flight === undefined) return reason;
  const fitsAt = (mm: number): boolean => stairFits(doc, { ...parts, flights: [{ ...flight, d: mm / 1000 }] }, state).ok;
  let lo = Math.round(MIN_OBJECT_SIZE * 1000); // whole millimetres: lo fits, hi doesn't
  const run = Math.round(flight.d * 1000);
  let hi = run;
  if (lo >= hi || !fitsAt(lo)) return reason;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  return { short: (run - lo) / 1000 };
}
