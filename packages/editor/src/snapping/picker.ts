// The one snap rule for furniture gestures (direct.17): each gesture lists its targets (wall faces, wall angles,
// guides) in one unit; the nearest within its own tolerance wins, else the snap step applies; Ctrl skips both.

/** A value a gesture can snap to, `distance` from the dragged value, in range up to `tolerance` (same unit). */
export type SnapTarget<T> = { value: number; distance: number; tolerance: number; tag: T };

/** The value a gesture takes, and the target that gave it (null for the step or Ctrl's free value). */
export type Picked<T> = { value: number; target: SnapTarget<T> | null };

/**
 * Ctrl gives `free`. Otherwise the target with the smallest raw distance among those with distance ≤ tolerance wins,
 * ties going to the earlier one (callers list targets in a deterministic order); with none in range, `stepped`.
 */
export function pickSnap<T>(input: { targets: readonly SnapTarget<T>[]; stepped: number; free: number; ctrl: boolean }): Picked<T> {
  if (input.ctrl) return { value: input.free, target: null };
  let best: SnapTarget<T> | null = null;
  for (const t of input.targets) {
    if (t.distance <= t.tolerance && (!best || t.distance < best.distance)) best = t;
  }
  return best ? { value: best.value, target: best } : { value: input.stepped, target: null };
}
