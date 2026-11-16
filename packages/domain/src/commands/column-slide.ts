import { err, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import type { ColumnView } from "../column-checks";
import { MESSAGES, domainError, topologyMessage } from "../errors";
import { dot, sub } from "../geometry";
import { EPS, MIN_EDGE, type Document, type Joint, type Opening, type Wall } from "../model";
import { diffPatch } from "../patch";
import { validateDocument } from "../validate";
import { sizeRefusal } from "./column-line";
import { wallReach } from "../queries/openings";
import { coverRefusal, rehost, runFrom } from "./split-openings";
import type { CommandResult } from "./types";

// A column in a wall's line slides along it (pillars.13, .25; AC-14, AC-16): its centre goes to `at` projected onto the
// line through its halves' far joints, its joints at the centre ∓ half its width along that line. The halves stretch and
// shrink; every opening on them keeps its place in the world. Depth changes its thickness only.

/** Rotations closer than this, in degrees, are the same. */
const SAME_TURN = 1e-6;

/** A column as typed, every field checked and defaulted from the column. */
type Shape = { at: Point; width: number; depth: number; rotation: number };

/** Whether `deg` turns away from `current` (degrees, either way round). */
function turned(deg: number, current: number): boolean {
  const d = (((deg - current) % 360) + 540) % 360 - 180;
  return Math.abs(d) > SAME_TURN;
}

/** Validates `next` and returns it with its patch, or the refusal. */
function finish(doc: Document, next: Document, deps: EntityKey[]): CommandResult {
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** The end of half `half` away from the column's joint `jointId`. */
function farJoint(doc: Document, half: Wall | undefined, jointId: string): Joint | undefined {
  return half ? doc.joints[half.a === jointId ? half.b : half.a] : undefined;
}

/**
 * Sets column `wall`, in the line of walls `line` (the one at its joint a first), to shape `s`. Refused when the
 * rotation differs from the column's, a half would be shorter than MIN_EDGE, or the column would cover an opening on a
 * half, or pass one on the way, by more than EPS (a slide stops at an opening, pillars.25); then validated (I20 refuses a column thinner than its walls).
 */
export function slideInLine(doc: Document, wall: Wall, column: ColumnView, line: readonly [string, string], s: Shape): CommandResult {
  const sized = sizeRefusal(wall.id, s.width, s.depth);
  if (sized) return err(sized);
  if (turned(s.rotation, column.rotation)) return err(domainError("invalidInput", MESSAGES.columnTurnsWithWall));
  const halves = [doc.walls[line[0]], doc.walls[line[1]]];
  const deps: EntityKey[] = [
    { table: "walls", id: wall.id },
    { table: "joints", id: wall.a },
    { table: "joints", id: wall.b },
    ...line.map((id): EntityKey => ({ table: "walls", id })),
  ];
  const deepened: Document = { ...doc, walls: { ...doc.walls, [wall.id]: { ...wall, thickness: s.depth } } };
  const moved = s.at.x !== column.centre.x || s.at.y !== column.centre.y || s.width !== column.width;
  if (!moved) return s.depth === wall.thickness ? ok({ doc, patch: diffPatch(doc, doc, deps) }) : finish(doc, deepened, deps);

  const far0 = farJoint(doc, halves[0], wall.a);
  const far1 = farJoint(doc, halves[1], wall.b);
  if (!far0 || !far1) return err(domainError("notFound", "Wall not found"));
  const { a: origin, dir: u } = runFrom(far0, far1);
  const length = dot(sub(far1, far0), u);
  const t = dot(sub(s.at, origin), u);
  const [lo, hi] = [t - s.width / 2, t + s.width / 2];
  if (lo < MIN_EDGE || length - hi < MIN_EDGE) return err(domainError("tooShort", MESSAGES.columnHalves));
  const was = dot(sub(column.centre, origin), u);
  const [sweptLo, sweptHi] = [Math.min(lo, was - column.width / 2), Math.max(hi, was + column.width / 2)];
  const point = (d: number): Point => ({ x: origin.x + u.x * d, y: origin.y + u.y * d });
  const joints: Record<string, Joint> = { ...doc.joints, [wall.a]: { id: wall.a, ...point(lo) }, [wall.b]: { id: wall.b, ...point(hi) } };

  const openings: Record<string, Opening> = { ...doc.openings };
  for (const o of Object.values(doc.openings)) {
    const half = o.wall === line[0] || o.wall === line[1] ? doc.walls[o.wall] : undefined;
    const [a, b, a2, b2] = half ? [doc.joints[half.a], doc.joints[half.b], joints[half.a], joints[half.b]] : [];
    if (!a || !b || !a2 || !b2) continue;
    deps.push({ table: "openings", id: o.id });
    const from = runFrom(a, b);
    const reach = wallReach(o); // its span, and a pocket door's pocket (openkinds.16)
    const ends = [reach.from, reach.to].map((d) => dot(sub({ x: a.x + from.dir.x * d, y: a.y + from.dir.y * d }, origin), u));
    const [from0, to0] = [Math.min(...ends), Math.max(...ends)];
    if (from0 + EPS < hi && lo < to0 - EPS) return err(coverRefusal(o, o.wall, (what) => `A column can't cover ${what}`));
    if (from0 + EPS < sweptHi && sweptLo < to0 - EPS) return err(coverRefusal(o, o.wall, (what) => `A column can't pass ${what}`));
    openings[o.id] = rehost(o, from, runFrom(a2, b2), o.wall);
  }
  return finish(doc, { ...deepened, joints, openings }, deps);
}
