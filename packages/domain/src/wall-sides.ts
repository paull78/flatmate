import { finishProblem, sameFinish, type Finish } from "./finishes";
import type { SideFinish, Wall, WallFinishFields, WallSide, WallSides } from "./model";
import { isFiniteNumber } from "./shape";

// A wall's side finishes (surfaces.03, .04, .33): stored as flat fields on the wall row (the wire takes only flat
// objects), read as `WallSides` through `sidesOf` and written through `withSides`; the rules a stored row keeps.

export const WALL_SIDES: readonly WallSide[] = ["left", "right"];

/** Each side's stored fields. */
const FIELDS = {
  left: { finish: "finishLeft", lower: "lowerLeft", height: "lowerLeftHeight" },
  right: { finish: "finishRight", lower: "lowerRight", height: "lowerRightHeight" },
} as const satisfies Record<WallSide, { finish: keyof WallFinishFields; lower: keyof WallFinishFields; height: keyof WallFinishFields }>;

function sideOf(wall: WallFinishFields, side: WallSide): SideFinish | null {
  const f = FIELDS[side];
  const [finish, lower, height] = [wall[f.finish] ?? null, wall[f.lower], wall[f.height]];
  const band = lower !== undefined && height !== undefined ? { finish: lower, height } : null;
  return finish === null && band === null ? null : { finish, lower: band };
}

/** A wall's finishes as code reads them, or undefined when neither side has one. */
export function sidesOf(wall: WallFinishFields): WallSides | undefined {
  const [left, right] = [sideOf(wall, "left"), sideOf(wall, "right")];
  return left === null && right === null ? undefined : { left, right };
}

/** The wall with these finishes written to its stored fields, and none left over (null: no finish on either side). */
export function withSides(wall: Wall, sides: WallSides | null | undefined): Wall {
  const out: Wall = { id: wall.id, a: wall.a, b: wall.b, thickness: wall.thickness, top: wall.top, base: wall.base, column: wall.column };
  for (const side of WALL_SIDES) {
    const s = sides?.[side] ?? null;
    const f = FIELDS[side];
    if (s?.finish) out[f.finish] = s.finish;
    if (s?.lower) {
      out[f.lower] = s.lower.finish;
      out[f.height] = s.lower.height;
    }
  }
  return out;
}

/** Whether two sides carry the same finish and band (null for none). */
export function sameSide(a: SideFinish | null, b: SideFinish | null): boolean {
  if (!a || !b) return a === b;
  if (!sameFinish(a.finish, b.finish)) return false;
  if (!a.lower || !b.lower) return a.lower === b.lower;
  return a.lower.height === b.lower.height && sameFinish(a.lower.finish, b.lower.finish);
}

/** Whether two walls' finishes match side for side (undefined: none on either side). */
export function sameSides(a: WallSides | undefined, b: WallSides | undefined): boolean {
  return sameSide(a?.left ?? null, b?.left ?? null) && sameSide(a?.right ?? null, b?.right ?? null);
}

/** The finishes of a wall run the other way: left and right swap, so each stays on its face (surfaces step 10). */
export function swapSides(sides: WallSides | undefined): WallSides | undefined {
  return sides ? { left: sides.right, right: sides.left } : undefined;
}

/** The lower band's height in metres (surfaces.04): from the side's bottom, whole millimetres. */
export const LOWER_HEIGHT = { min: 0.1, max: 3, default: 1.2 } as const;

/** The band height's broken rule, or null. */
export function lowerHeightProblem(height: number | undefined): string | null {
  if (height === undefined || !isFiniteNumber(height)) return "height must be 0.10–3.00";
  if (Math.abs(Math.round(height * 1000) - height * 1000) > 1e-6) return "height must be whole millimetres";
  const mm = Math.round(height * 1000);
  return mm < LOWER_HEIGHT.min * 1000 || mm > LOWER_HEIGHT.max * 1000 ? "height must be 0.10–3.00" : null;
}

/** A stored row's first broken finish rule, naming its field ("finishLeft.motif must be a wall motif: …"), or null. */
export function sidesProblem(wall: WallFinishFields): string | null {
  for (const side of WALL_SIDES) {
    const f = FIELDS[side];
    const [finish, lower, height] = [wall[f.finish], wall[f.lower], wall[f.height]];
    if ((lower === undefined) !== (height === undefined)) return `${f.lower} and ${f.height} go together`;
    if (lower !== undefined && finish === undefined) return `${f.lower} needs ${f.finish}`; // a custom side has a finish (inherit.02)
    const named = (key: string, given: Finish | undefined): string | null => {
      const problem = given === undefined ? null : finishProblem(given, "wall");
      return problem ? problem.replace(/^finish\./, `${key}.`) : null;
    };
    const issue = named(f.finish, finish) ?? named(f.lower, lower) ?? (height === undefined ? null : lowerHeightProblem(height));
    if (issue) return issue.startsWith("height") ? `${f.height} ${issue.slice("height ".length)}` : issue;
  }
  return null;
}

/** Whether a row stores any finish. */
export const hasSides = (wall: WallFinishFields): boolean => sidesOf(wall) !== undefined;
