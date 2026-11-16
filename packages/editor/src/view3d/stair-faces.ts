import { hasOption, stairGeometry, stairRuleOf, type StairGeometry, type StairRule } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { handrailFaces } from "./handrail-faces";
import { drawerFront, drawerPull } from "./stair-drawers";
import { winderFaces } from "./winder";
import { ladderFaces } from "./ladder";
import { openFlightFaces } from "./open-flight";
import { placer } from "./local-frame";
import { orient, prism } from "./prism";
import { spiralFaces } from "./spiral";
import type { Shades } from "./style";
import { stepsFrom, type Face3d, type PieceItem, type Point3 } from "./types";

// A stair in the 3D view (stairs step 09): parts in place of the box, its handrails with them, in one owner, in any order
// (the depth buffer hides what is behind, real3d.09). The parts come from the item's kind, size and range through the
// domain's stair geometry; the fit still sees the box (heights.05).

const DOOR_INSET = 0.03; // m: a cubby door's margin on the block's side
const DOOR_GAP = 0.035; // m: above and below a door
const DOOR_PROUD = 0.002; // m: off the side, so the depth buffer never ties it with the side
const TWO_DOORS = 0.62; // m: a block taller than this has two cubbies
const MIN_DOOR_BLOCK = 0.14; // m: a block lower than this has none

/**
 * A stair piece's faces by its body (stairs.20) and its handrails, or null for furniture (its box stays). `glass` is the
 * colour of a Glass handrail's panes (guards.28): the windows' glass.
 */
export function stairFaces(owner: string, item: PieceItem, shades: Shades, glass: string): Face3d[] | null {
  const rule = stairRuleOf(item.objectKind);
  if (rule === null) return null;
  const g = stairGeometry(rule, item.w, item.d, item.top - stepsFrom(item), item.riser ?? null); // the rise its steps count (stairs.49)
  return [...bodyFaces(owner, item, shades, rule, g, glass), ...handrailFaces(owner, item, shades, g, placer(item), glass)];
}

function bodyFaces(owner: string, item: PieceItem, shades: Shades, rule: StairRule, g: StairGeometry, glass: string): Face3d[] {
  switch (rule.body) {
    case "solid":
    case "storage":
    case "drawers":
      return blockFaces(owner, item, shades, g, rule.body);
    case "winder":
      return winderFaces(owner, item, shades, g, placer(item), hasOption(item, "leftEntry"));
    case "open":
    case "ship":
      return openFlightFaces(owner, item, shades, g, placer(item));
    case "alternating":
      return openFlightFaces(owner, item, shades, g, placer(item), true);
    case "rungs":
      return ladderFaces(owner, item, shades, g, placer(item), hasOption(item, "hooks"));
    case "spiral":
      return spiralFaces(owner, item, shades, rule, g, glass);
    default:
      return assertNever(rule.body);
  }
}

/**
 * A solid flight's step blocks; a storage stair's with cubby doors on both long sides (real3d.09); storage steps' with a
 * drawer in each step's riser (steps.03).
 */
function blockFaces(owner: string, item: PieceItem, shades: Shades, g: StairGeometry, body: "solid" | "storage" | "drawers"): Face3d[] {
  const at = placer(item);
  const { w, d } = item;
  const r = (item.rotation * Math.PI) / 180;
  const faces: Face3d[] = [];
  for (let k = 1; k <= g.treads; k++) {
    const [y0, y1] = [-d / 2 + (k - 1) * g.going, -d / 2 + k * g.going];
    const top = stepsFrom(item) + k * g.riser; // the block itself stands on the floor below
    const ring = [at(-w / 2, y0), at(w / 2, y0), at(w / 2, y1), at(-w / 2, y1)];
    faces.push(...prism(owner, ring, item.bottom, top, shades));
    if (body === "drawers") {
      const n = { x: Math.sin(r), y: -Math.cos(r), z: 0 };
      faces.push(drawerFront(owner, at, w, y0, top - g.riser, top, n, shades), drawerPull(owner, at, y0, top - g.riser, top, n));
    }
    if (body !== "storage" || top - item.bottom < MIN_DOOR_BLOCK) continue;
    for (const side of [1, -1]) faces.push(...doors(owner, at, side * (w / 2 + DOOR_PROUD), { x: side * Math.cos(r), y: side * Math.sin(r), z: 0 }, y0, y1, item.bottom, top, shades));
  }
  return faces;
}

/** A block's cubby doors on the plane x = `x` (local), one or two stacked, in the side's other shade, wound to face `n`. */
function doors(owner: string, at: (x: number, y: number) => Point, x: number, n: Point3, y0: number, y1: number, bottom: number, top: number, shades: Shades): Face3d[] {
  const count = top - bottom > TWO_DOORS ? 2 : 1;
  const step = (top - bottom) / count;
  const out: Face3d[] = [];
  for (let i = 0; i < count; i++) {
    const [z0, z1] = [bottom + i * step + DOOR_GAP, bottom + (i + 1) * step - DOOR_GAP];
    const p = (y: number, z: number): Point3 => ({ ...at(x, y), z });
    out.push({ points: orient([p(y0 + DOOR_INSET, z0), p(y1 - DOOR_INSET, z0), p(y1 - DOOR_INSET, z1), p(y0 + DOOR_INSET, z1)], n), holes: [], color: shades.shaded, owner });
  }
  return out;
}
