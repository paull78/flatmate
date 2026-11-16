import { assertNever } from "@fm/protocol";
import type { Box3, Panel, Part, Slot } from "./types";

// Sizes by rule (parts.02, .10): a fixed size kept by a share of the box, one formula at every size, so small pieces and
// every step of a flip tween stay sound. Helpers shared by the kinds' parts.

/** A real size, capped by a share of the extent it sits in. */
export const capped = (real: number, share: number, extent: number): number => Math.min(real, share * extent);

/** At most this many of any repeated part (cushions, doors), so a 10 m piece stays under the face cap (parts.06). */
export const MAX_REPEAT = 8;

/** How many of a repeated part fit `extent` at about one per `each` metres, from `least` to MAX_REPEAT. */
export const countOf = (extent: number, each: number, least = 1): number => Math.max(least, Math.min(MAX_REPEAT, Math.round(extent / each)));

/** The gap between door fronts and around a front. */
export const doorGap = (w: number): number => capped(0.003, 0.01, w);

/** A table or desk top's thickness. */
export const topThickness = (h: number): number => capped(0.03, 0.08, h);

export const box = (slot: Slot, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, panels?: readonly Panel[]): Part =>
  panels && panels.length > 0 ? { shape: "box", at: { x0, x1, y0, y1, z0, z1 }, slot, panels } : { shape: "box", at: { x0, x1, y0, y1, z0, z1 }, slot };

export const at = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box3 => ({ x0, x1, y0, y1, z0, z1 });

/** `n` equal spans of [a, b], each with `gap` left on both ends, as [start, end] pairs. */
export function spans(a: number, b: number, n: number, gap = 0): [number, number][] {
  const step = (b - a) / n;
  return Array.from({ length: n }, (_, i) => [a + i * step + gap, a + (i + 1) * step - gap]);
}

/** Four square legs of side `s` at the corners of [x0, x1] × [y0, y1], from 0 to `top`. */
export function legs(slot: Slot, x0: number, x1: number, y0: number, y1: number, s: number, top: number): Part[] {
  return [[x0, y0], [x1 - s, y0], [x0, y1 - s], [x1 - s, y1 - s]].map(([x, y]) => box(slot, x ?? 0, (x ?? 0) + s, y ?? 0, (y ?? 0) + s, 0, top));
}

/** Parts moved by (dx, dy) in the local frame, panels with them. */
export function shifted(parts: readonly Part[], dx: number, dy: number): Part[] {
  const move = (b: Box3): Box3 => ({ ...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy });
  return parts.map((p): Part => {
    const panels = p.panels?.map((q) => ({ ...q, at: move(q.at) }));
    const rest = panels ? { panels } : {};
    switch (p.shape) {
      case "outline":
        return { ...p, ...rest };
      case "ring":
        return { ...p, ring: p.ring.map((q) => ({ x: q.x + dx, y: q.y + dy })), ...rest };
      case "box":
      case "cylinder":
        return { ...p, at: move(p.at), ...rest };
      default:
        return assertNever(p);
    }
  });
}

/** `n` door fronts as thin boxes across [x0, x1] on the front face (y from −d/2 to −d/2 + t), from z0 to z1, each with `panels`. */
export function doorFronts(slot: Slot, x0: number, x1: number, d: number, t: number, z0: number, z1: number, n: number, gap: number, panels: (a: number, b: number) => readonly Panel[] = () => []): Part[] {
  return spans(x0, x1, n, gap).map(([a, b]) => box(slot, a, b, -d / 2, -d / 2 + t, z0, z1, panels(a, b)));
}

/** A front's bar handle: a dark panel across the middle of [x0, x1] × [z0, z1], on the face at `y`. */
export function barHandle(x0: number, x1: number, z0: number, z1: number, y: number): Panel {
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  const [hw, ht] = [capped(0.16, 0.3, x1 - x0), capped(0.015, 0.2, z1 - z0)];
  return { normal: "-y", at: { x0: cx - hw / 2, x1: cx + hw / 2, y0: y, y1: y, z0: cz - ht / 2, z1: cz + ht / 2 }, slot: "dark" };
}

/** `n` drawer fronts stacked as thin boxes up [z0, z1] on the front face (y from −d/2 to −d/2 + t), each with its bar handle. */
export function drawerFronts(slot: Slot, x0: number, x1: number, d: number, t: number, z0: number, z1: number, n: number, gap: number): Part[] {
  return spans(z0, z1, n, gap).map(([a, b]) => box(slot, x0 + gap, x1 - gap, -d / 2, -d / 2 + t, a, b, [barHandle(x0 + gap, x1 - gap, a, b, -d / 2)]));
}
