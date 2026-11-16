import type { Document } from "./model";

// The trailer under a house on wheels (trailer.02 to .05): three project fields beside Surroundings, read here as one
// value. A project that never chose has today's trailer: the hitch on the long side's high end, two axles, no tongue box.
// Only drawn: nothing here is checked against the drawing.

/** Which end of the walls' box's long axis (x on a tie) the hitch is on: the low or the high one (trailer.02). */
export const TRAILER_HITCHES = ["low", "high"] as const;
export type TrailerHitch = (typeof TRAILER_HITCHES)[number];
export const TRAILER_AXLES = [2, 3] as const;
export type TrailerAxles = (typeof TRAILER_AXLES)[number];

export type Trailer = { hitch: TrailerHitch; axles: TrailerAxles; tongueBox: boolean };

export const HITCH_REFUSAL = "Hitch must be low or high; empty means high";
export const AXLES_REFUSAL = "Axles must be 2 or 3; empty means 2";
export const TONGUE_BOX_REFUSAL = "Tongue box must be on, or empty for none";

/** The project's trailer, each field read from its row, today's value without one. */
export function trailerOf(doc: Document): Trailer {
  const field = (key: string): string | undefined => doc.projectFields[key]?.value;
  return {
    hitch: TRAILER_HITCHES.find((h) => h === field("trailerHitch")) ?? "high",
    axles: TRAILER_AXLES.find((n) => String(n) === field("trailerAxles")) ?? 2,
    tongueBox: field("tongueBox") === "on",
  };
}

/** The hitch's end as the plan shows it: Left or Right on a house long along x, Lower or Upper on one long along y. */
export function hitchName(hitch: TrailerHitch, alongX: boolean): string {
  if (alongX) return hitch === "low" ? "Left" : "Right";
  return hitch === "low" ? "Lower" : "Upper";
}
