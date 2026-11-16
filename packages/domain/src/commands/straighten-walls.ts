import { err, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import { dot, normalize, sub } from "../geometry";
import { incidentWalls, jointWalls } from "../graph";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { roundMm } from "../queries/footprints";
import { isValidId } from "../shape";
import { lockJoints } from "./column-lock";
import { keepLabelsInRooms } from "./labels";
import { applyMoves } from "./move-joints";
import type { CommandOf, CommandResult } from "./types";

// straightenWalls (straight.43): a side that is nearly straight and nearly square, in one or several pieces, is put
// exactly on one horizontal or vertical line: every joint along it takes the same y (or x). The side is the chain of
// walls through joints where exactly one other wall goes on within 1°, so a slant of millimetres and the pieces around
// it are fixed together and no neighbour in the chain is tilted. Walls meeting the side stretch by the same millimetres.

/** Walls within this angle of each other continue one side; a side within it of an axis can be straightened. */
const NEAR_DEG = 1;
const COS = Math.cos((NEAR_DEG * Math.PI) / 180);
const TAN = Math.tan((NEAR_DEG * Math.PI) / 180);

function far(doc: Document, wallId: string, jointId: string): Point | null {
  const w = doc.walls[wallId];
  const j = w ? doc.joints[w.a === jointId ? w.b : w.a] : undefined;
  return j ? { x: j.x, y: j.y } : null;
}

/** The one other wall at `jointId` going on from `wallId` within 1°, and its far joint; null with none or several. */
function goesOn(doc: Document, at: Map<string, string[]>, wallId: string, jointId: string): { wall: string; joint: string } | null {
  const j = doc.joints[jointId];
  const from = far(doc, wallId, jointId);
  const dir = j && from ? normalize(sub(j, from)) : null;
  if (!j || !dir) return null;
  const next = (at.get(jointId) ?? []).filter((id) => {
    const to = id === wallId ? null : far(doc, id, jointId);
    const d = to ? normalize(sub(to, j)) : null;
    return d !== null && dot(dir, d) >= COS;
  });
  const [only] = next;
  const w = only === undefined ? undefined : doc.walls[only];
  return next.length === 1 && only !== undefined && w ? { wall: only, joint: w.a === jointId ? w.b : w.a } : null;
}

/** The joints along the nearly straight side `wallId` is part of, in order, and its walls. */
export function nearSide(doc: Document, wallId: string): { joints: string[]; walls: string[] } | null {
  const w = doc.walls[wallId];
  if (!w) return null;
  const at = jointWalls(doc);
  const seen = new Set([wallId]);
  const walk = (wall: string, joint: string): { joints: string[]; walls: string[] } => {
    const out: { joints: string[]; walls: string[] } = { joints: [joint], walls: [] };
    let [cw, cj] = [wall, joint];
    for (;;) {
      const next = goesOn(doc, at, cw, cj);
      if (!next || seen.has(next.wall)) return out;
      seen.add(next.wall);
      out.walls.push(next.wall);
      out.joints.push(next.joint);
      [cw, cj] = [next.wall, next.joint];
    }
  };
  const before = walk(wallId, w.a);
  const after = walk(wallId, w.b);
  return { joints: [...before.joints.reverse(), ...after.joints], walls: [...before.walls.reverse(), wallId, ...after.walls] };
}

/**
 * What straightening the side of `wallId` would do: the axis coordinate each joint takes, by candidate value, the one
 * most of the side already holds first. Null when the side is already straight on an axis, or isn't within 1° of one.
 */
export function straightenPlans(doc: Document, wallId: string): { jointId: string; to: Point }[][] | null {
  const side = nearSide(doc, wallId);
  const points = side?.joints.map((id) => doc.joints[id]) ?? [];
  const [first, last] = [points[0], points.at(-1)];
  if (!side || !first || !last || points.some((p) => p === undefined)) return null;
  const [dx, dy] = [Math.abs(last.x - first.x), Math.abs(last.y - first.y)];
  const key: "x" | "y" | null = dy <= dx * TAN ? "y" : dx <= dy * TAN ? "x" : null; // horizontal: one y; vertical: one x
  if (key === null) return null;
  const values = points.flatMap((p) => (p ? [p[key]] : []));
  if (values.every((v) => v === values[0])) return null;
  // Each wall votes its length for its ends' values, rounded to the millimetre: the longest straight stretch wins.
  const weight = new Map<number, number>();
  for (const id of side.walls) {
    const w = doc.walls[id];
    const [a, b] = w ? [doc.joints[w.a], doc.joints[w.b]] : [];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (const v of [roundMm(a[key]), roundMm(b[key])]) weight.set(v, (weight.get(v) ?? 0) + len / 2);
  }
  const candidates = [...weight.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).map(([v]) => v);
  return candidates.map((v) => side.joints.flatMap((id) => {
    const j = doc.joints[id];
    return j && j[key] !== v ? [{ jointId: id, to: key === "y" ? { x: j.x, y: v } : { x: v, y: j.y } }] : [];
  }));
}

/** Puts the nearly straight side of `cmd.wallId` exactly on one axis line: the first candidate line the drawing allows. */
export function straightenWalls(doc: Document, cmd: CommandOf<"straightenWalls">): CommandResult {
  if (!isValidId(cmd.wallId) || !doc.walls[cmd.wallId]) return err(domainError("notFound", "Wall not found"));
  const plans = straightenPlans(doc, cmd.wallId);
  if (plans === null) return err(domainError("invalidInput", "This side is already straight, or more than 1° off horizontal and vertical"));
  let refusal: DomainError | null = null;
  for (const moves of plans) {
    const ids = moves.map((m) => m.jointId);
    const locked = lockJoints(doc, ids);
    if (locked) { refusal ??= locked; continue; }
    const deps: EntityKey[] = ids.flatMap((id): EntityKey[] => [{ table: "joints", id }, ...incidentWalls(doc, id).map((w): EntityKey => ({ table: "walls", id: w }))]);
    const moved = applyMoves(doc, moves, deps);
    if (!moved.ok) { refusal ??= moved.error; continue; }
    const next = keepLabelsInRooms(doc, moved.value, deps);
    return ok({ doc: next, patch: diffPatch(doc, next, deps) });
  }
  return err(refusal ?? domainError("invalid", "This side can't be straightened"));
}
