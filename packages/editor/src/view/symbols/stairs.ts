import { SPIRAL_COLUMN_RADIUS, kindConfigs, spiralTreads, stairGeometry, stairRuleOf, type StairGeometry, type StairRule } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import type { Primitive } from "../scene-types";
import { stairLines } from "../stair-lines";
import { TAU, arc, inner, seg, type SymbolOf, type SymbolTable } from "./lines";

// Stairs (stairs.01) on palette tiles and ghosts: the plan symbol's lines at the kind's default rise (side boards, a
// centre stringer or rails along the run; nosings or rungs across; a winder's rays; a spiral's circle, column and radial treads), without
// its cut, walking line or label. The front edge (y = −d) is the bottom step.

const stairTile: SymbolOf = (w, d, kind) => {
  const rule = stairRuleOf(kind);
  const h = kindConfigs(kind)[0]?.h ?? 0;
  if (rule === null || h <= 0) return inner([]);
  return inner(tileLines(rule, w, d, stairGeometry(rule, w, d, h, null)));
};

function tileLines(rule: StairRule, w: number, d: number, g: StairGeometry): Primitive[] {
  switch (rule.shape) {
    case "flight":
    case "winder":
    case "ladder": {
      const { along, across, slants } = stairLines(rule, w, g);
      const inside = along.filter((x) => Math.abs(x) < w / 2 - 1e-9); // the long sides are the outline's
      // A winder's rays too (steps.04); a tile stretched shallower than wide has no room for its square, so none.
      const rays = d >= w ? slants.map(([a, b]) => seg(a.x, -d + a.y, b.x, -d + b.y)) : [];
      return [...inside.map((x) => seg(x, -d, x, 0)), ...across.map(({ a, x0, x1 }) => seg(x0, -d + a, x1, -d + a)), ...rays];
    }
    case "spiral": { // centred in the footprint, 90° toward the back edge (spiral-plan.ts)
      const r = Math.min(w, d) / 2; // a tile stretched off square keeps the circle inside
      const [rc, cy] = [Math.min(SPIRAL_COLUMN_RADIUS, r / 2), -d / 2];
      const radial = (deg: number): Primitive => {
        const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
        return seg(rc * c, cy + rc * s, r * c, cy + r * s);
      };
      return [arc(0, cy, r, 0, TAU), arc(0, cy, rc, 0, TAU), radial(90), ...spiralTreads(rule, g.treads).map((t) => radial(t.to))];
    }
    default:
      return assertNever(rule.shape);
  }
}

export const STAIRS: SymbolTable = new Map<string, SymbolOf>(
  ["stair", "openStair", "storageStair", "storageSteps", "winderStair", "shipsLadder", "alternatingTread", "rungLadder", "spiralStair"].map((kind) => [`${kind}.standard`, stairTile]),
);
