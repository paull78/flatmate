// "With computer" (seating.12, AC-09): the gear a desk carries, drawn on the plan (symbols/sit-and-eat.ts) and as 3D
// parts (view3d/parts/sit-and-eat.ts) from this one layout, when the object's options have it on (library.10). Never
// fitted: the piece's size and range don't change.

/** An axis-aligned rectangle in footprint space (y from −d at the front to 0 at the back). */
export type GearRect = { x0: number; x1: number; y0: number; y1: number };
/** The gear on a w × d desk top; `scale` shrinks the fixed sizes on a desk under 0.60 × 0.40 m (heights in 3D too). */
export type Gear = { monitor: GearRect; foot: GearRect; keyboard: GearRect; mouse: GearRect; scale: number };

/**
 *   y = 0  ┌──────[foot]──────┐   back
 *          │  [====monitor===] │   the monitor's panel, seen edge on, its foot behind it
 *          │                   │
 *          │   [keyboard] (m)  │   centred at −0.62·d, the mouse to its right
 *   y = −d └───────────────────┘   front
 *
 * The mockup's numbers on a desk of at least 0.60 × 0.40 m: monitor min(0.55, 0.5w) wide at y −0.13…−0.09, its foot
 * min(0.22, 0.4 × monitor) at −0.09…−0.03, keyboard min(0.44, 0.4w) × min(0.14, 0.25d), mouse 0.06 × 0.10 starting
 * 0.08 right of the keyboard. On a smaller desk the fixed sizes scale by min(1, w / 0.60, d / 0.40), which keeps every
 * rectangle inside the top (the monitor's back within 0.33·d, the mouse's right within 0.44·w).
 */
export function computerGear(w: number, d: number): Gear {
  const s = Math.min(1, w / 0.6, d / 0.4);
  const mw = Math.min(0.55, w * 0.5);
  const sw = Math.min(0.22, mw * 0.4);
  const kw = Math.min(0.44, w * 0.4);
  const kd = Math.min(0.14, d * 0.25);
  const ky = -d * 0.62;
  const mx = kw / 2 + 0.08 * s;
  return {
    monitor: { x0: -mw / 2, x1: mw / 2, y0: -0.13 * s, y1: -0.09 * s },
    foot: { x0: -sw / 2, x1: sw / 2, y0: -0.09 * s, y1: -0.03 * s },
    keyboard: { x0: -kw / 2, x1: kw / 2, y0: ky - kd / 2, y1: ky + kd / 2 },
    mouse: { x0: mx, x1: mx + 0.06 * s, y0: ky - 0.05 * s, y1: ky + 0.05 * s },
    scale: s,
  };
}
