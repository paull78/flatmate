import { SIDE_BOARD, WINDERS, winderTreads, type StairGeometry, type StairRule } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";

// A stair's lines on the plan by its body (stairs.02, .20), in footprint space (x −w/2..w/2 across; a metres along the
// run from the front edge, the bottom step): the plan symbol and the palette tile draw the same ones.

/** A ladder's rails on the plan: a line this far inside each long side. */
export const RAIL_INSET = 0.025;

/** A hooked ladder's mark (steps.05): a tick this far in from the back edge across each rail, this long. */
const HOOK_IN = 0.03;
const HOOK_MARK = 2 * RAIL_INSET; // centred on the rail, so it ends at the long side
/** How far in from the side you walk in from a winder's walking line starts, as a flight's dot is in from its front edge. */
const WALK_INSET = 0.09;
/** The winder's walking line turns about its inner corner at half the stair's width, in steps of this many degrees. */
const WALK_STEP = 15;

/**
 * `along`: lines the whole run long at x (the long sides, then side boards, a centre stringer or rails); `across`:
 * nosings or rungs, `a` metres from the front edge, from x0 to x1; `slants`: a winder's rays between its winders, as
 * (x, a) pairs; `walk`: a winder's walking line as (x, a) points from the dot to the back edge, null for the straight
 * centre line every other stair has (steps.04).
 */
export type StairLines = { along: readonly number[]; across: readonly { a: number; x0: number; x1: number }[]; slants: readonly (readonly [Point, Point])[]; walk: readonly Point[] | null };

export function stairLines(rule: StairRule, w: number, g: StairGeometry, left = false, hooks = false): StairLines {
  const sides = [-w / 2, w / 2];
  const boards = rule.underside ? [-w / 2 + SIDE_BOARD, w / 2 - SIDE_BOARD] : []; // an open flight's side boards (stairs.03, .41)
  const nosings = (span: (k: number) => [number, number]) =>
    Array.from({ length: Math.max(0, g.treads - 1) }, (_, i) => {
      const [x0, x1] = span(i + 1);
      return { a: g.nosingAt(i + 2), x0, x1 }; // the geometry says where each nosing lies (steps.09)
    });
  switch (rule.body) {
    case "solid":
    case "storage":
    case "drawers":
    case "open":
    case "ship":
    case "spiral":
      return { along: [...sides, ...boards], across: nosings(() => [-w / 2, w / 2]), slants: [], walk: null };
    case "winder":
      return winderLines(w, g, left);
    case "alternating": // half nosings either side of the centre stringer: odd ones on the right half, even on the left
      return { along: [...sides, ...boards, 0], across: nosings((k) => (k % 2 === 1 ? [0, w / 2] : [-w / 2, 0])), slants: [], walk: null };
    case "rungs": {
      const rail = Math.max(0, w / 2 - RAIL_INSET); // a ladder narrower than its two insets keeps its rails at the centre (hangings.03)
      const rungs = Array.from({ length: g.treads }, (_, i) => ({ a: g.nosingAt(i + 1), x0: -rail, x1: rail }));
      // Hooks over the edge it reaches: a tick across each rail inside the back strip, inside the box (the plan clips what lies over the slab).
      const marks = hooks ? [-rail, rail].map((x) => ({ a: g.run - HOOK_IN, x0: x - HOOK_MARK / 2, x1: x + HOOK_MARK / 2 })) : [];
      return { along: [...sides, -rail, rail], across: [...rungs, ...marks], slants: [], walk: null };
    }
    default:
      return assertNever(rule.body);
  }
}

/**
 * A winder's lines (steps.04): its sides, tread 4's nosing (the front square's back) and the straight nosings across,
 * the rays between its winders, and a walking line from a dot just in from the side you walk in from, turning about the
 * inner corner at half the width, then up the centre line to the back edge. "Enters from: Left" mirrors x.
 */
function winderLines(w: number, g: StairGeometry, left: boolean): StairLines {
  const [t1, t2] = winderTreads(w, left);
  const slants: (readonly [Point, Point])[] = [];
  if (t1?.[0] && t1[2]) slants.push([t1[0], t1[2]]);
  if (t2?.[0] && t2[3]) slants.push([t2[0], t2[3]]);
  const across = Array.from({ length: Math.max(0, g.treads - WINDERS) }, (_, i) => ({ a: g.nosingAt(i + WINDERS + 1), x0: -w / 2, x1: w / 2 }));
  const s = left ? -1 : 1;
  const r = w / 2;
  const turn: Point[] = [];
  for (let deg = 270 - WALK_STEP; deg >= 180 - 1e-9; deg -= WALK_STEP) {
    const t = (deg * Math.PI) / 180;
    turn.push({ x: s * (w / 2 + r * Math.cos(t)), y: w + r * Math.sin(t) });
  }
  const walk = [{ x: s * (w / 2 - WALK_INSET), y: w / 2 }, ...turn, { x: 0, y: g.run }];
  return { along: [-w / 2, w / 2], across, slants, walk };
}
