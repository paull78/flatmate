// A leaf, so the area edits can snap without importing deck-edit.ts (an import cycle through drag.ts otherwise).

/**
 * The centre of a span `centre` ± `half` on one axis, shifted so its side nearer one of `lines`, within `tol`, lies on
 * it; the smallest shift wins, and `centre` as given when no line is near. Decks and holes snap by it.
 */
export function pullToLine(centre: number, half: number, lines: readonly number[], tol: number): number {
  const shifts = lines.flatMap((l) => [l - (centre - half), l - (centre + half)]).filter((s) => Math.abs(s) <= tol);
  const best = shifts.sort((p, q) => Math.abs(p) - Math.abs(q))[0];
  return centre + (best ?? 0);
}
