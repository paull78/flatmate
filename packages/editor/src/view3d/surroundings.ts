import { SURROUNDINGS_VALUES, surroundingsOf, type Document, type Surroundings } from "@fm/domain";
import type { Bounds3 } from "./types";

// What the 3D view shows round the house (surroundings.03, .04, .12, .14): one row of data per surroundings, read by `look`
// and the panel. None is no row, and draws as before.

/**
 * A surroundings' ground: its colour at the centre, the `background` the picture is cleared to and the ground fades into,
 * the plate's shape (`round` about the house, or `box`, the walls' box grown with round corners), and how far `below`
 * the floor the ground lies (metres; also the bottom of the box the camera frames). A round plate may have `lines`, the
 * colour of 1 m lines over it outside the walls' box (surroundings.16).
 */
export type SurroundingsRow = { ground: string; background: string; below: number } & ({ plate: "round"; lines?: string } | { plate: "box" });

/** Outside's grass and sky, which On wheels shares. */
const OUTSIDE: SurroundingsRow = { ground: "#b9c9a3", background: "#eef3f5", plate: "round", below: 0 };

/** Every surroundings' row, so a new value doesn't compile until it's drawn. Colours from the approved mock-ups. */
export const SURROUNDINGS: Readonly<Record<Surroundings, SurroundingsRow>> = {
  interior: { ground: "#d9d8d3", background: "#ffffff", plate: "box", below: 0 },
  outside: OUTSIDE,
  wheels: { ...OUTSIDE, below: 0.75 }, // the same grass, down at the wheels (surroundings.12)
  grid: { ground: "#dbeee3", background: "#ffffff", plate: "round", lines: "#a9c4b4", below: 0 },
};

/** The camera's pull with any surroundings (Bounds3): one for every surroundings, so they all frame alike (AC-03). */
const PULL = 0.88;

/** The project's surroundings with its row and its name as the menu shows it; null for None. */
export function surroundingsRow(doc: Document): { row: SurroundingsRow; label: string } | null {
  const value = surroundingsOf(doc);
  const label = SURROUNDINGS_VALUES.find((s) => s.value === value)?.label;
  return value === null || label === undefined ? null : { row: SURROUNDINGS[value], label };
}

/** The box the camera frames for a surroundings: the shell's, from the ground up when it lies below the floor, pulled back. */
export function framedBounds(row: SurroundingsRow, shell: Bounds3): Bounds3 {
  return { ...shell, ...(row.below > 0 ? { bottom: -row.below } : {}), pull: PULL };
}
