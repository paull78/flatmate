import { configsOf, isRug } from "@fm/domain";
import { appearanceOf } from "../view3d/parts";
import type { Part, Slot } from "../view3d/parts/types";
import { STYLE_3D } from "../view3d/style";
import { PRESENTATION_STYLE, type PlanStyle } from "./plan-style";
import type { Color } from "./scene-types";

// A project card's plan (cards.01): pieces coloured like the 3D view, so a hover shows the same home, and lines that survive
// the card's size. The canvas, the exports and look keep their own styles.

/** The materials' colours on a plan: the 3D view's tops, but for wood, deepened so a table stands out on a wood floor, and appliances. */
const ON_PLAN: Readonly<Record<Slot, Color>> = {
  wood: "#b98f63",
  dark: STYLE_3D.slots.dark.top,
  fabric: STYLE_3D.slots.fabric.top,
  linen: STYLE_3D.slots.linen.top,
  laminate: "#ecebe6",
  metal: STYLE_3D.slots.metal.top,
  ceramic: STYLE_3D.slots.ceramic.top,
  plain: "#e0e0de",
  flame: STYLE_3D.slots.flame.top, // only panels use it, which a card's plan never shows
};

const CELLS = 16;

/** A part's extent on the plan and its top. */
function extent(part: Part, w: number, d: number): { x0: number; x1: number; y0: number; y1: number; top: number } {
  switch (part.shape) {
    case "box":
    case "cylinder":
      return { x0: part.at.x0, x1: part.at.x1, y0: part.at.y0, y1: part.at.y1, top: part.at.z1 };
    case "outline":
      return { x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2, top: part.z1 };
    case "ring": {
      const xs = part.ring.map((p) => p.x);
      const ys = part.ring.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), top: part.z1 };
    }
  }
}

/** The material seen most from above: a coarse grid over the piece, each cell taking its highest part. A new kind needs no entry. */
function mainSlot(parts: readonly Part[], w: number, d: number): Slot {
  const seen = new Map<Slot, number>();
  const extents = parts.map((part) => ({ slot: part.slot, ...extent(part, w, d) }));
  for (let i = 0; i < CELLS; i++) {
    for (let j = 0; j < CELLS; j++) {
      const x = -w / 2 + ((i + 0.5) / CELLS) * w;
      const y = -d / 2 + ((j + 0.5) / CELLS) * d;
      let highest: { slot: Slot; top: number } | null = null;
      for (const e of extents) {
        if (x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1 && (highest === null || e.top > highest.top)) highest = e;
      }
      if (highest !== null) seen.set(highest.slot, (seen.get(highest.slot) ?? 0) + 1);
    }
  }
  let best: Slot = "plain";
  let most = 0;
  for (const [slot, count] of seen) {
    if (count > most) {
      best = slot;
      most = count;
    }
  }
  return best;
}

const known = new Map<string, Color | null>();

/** A kind's colour on a card's plan; null for a rug, which keeps its own fill. Worked out once per kind, at its default size. */
export function cardPieceColour(kind: string): Color | null {
  const cached = known.get(kind);
  if (cached !== undefined) return cached;
  const config = configsOf({ kind })[0];
  const colour = isRug(kind) ? null : ON_PLAN[config ? mainSlot(appearanceOf(kind)(config.id, config.w, config.d, config.h), config.w, config.d) : "plain"];
  known.set(kind, colour);
  return colour;
}

/** Sizes in the card picture's units: its long side is 1100, shown about a fifth of that. */
export const CARD_STYLE: PlanStyle = {
  ...PRESENTATION_STYLE,
  kindFill: cardPieceColour,
  objectLineWidth: 2.2,
  objectDetailWidth: 1.4,
  objectFront: 3,
  openingWeights: { frame: 3, line: 2.5, hair: 2 },
  guard: { ...PRESENTATION_STYLE.guard, line: 2.5, post: 3 },
  openingDetailFrom: Infinity,
};
