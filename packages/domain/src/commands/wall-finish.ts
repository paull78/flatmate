import { err, ok, type Result } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import type { Finish } from "../finishes";
import { CEILING_ID, type Ceiling, type Document, type SideFinish, type Wall, type WallSide } from "../model";
import { diffPatch } from "../patch";
import { ceilingHeight } from "../queries/vertical";
import { isValidId } from "../shape";
import { outsideOf, roomWallsOf, withOutside, withRoomWalls } from "../wall-defaults";
import { lowerHeightProblem, sameSide, sidesOf, withSides } from "../wall-sides";
import { checkedFinish } from "./labels";
import type { CommandOf, CommandResult } from "./types";

// Wall finishes (surfaces.03, .04; inherit.01): a room's walls default on its label, the house's outside default on the
// ceiling row, and a custom side on the wall row, which always has a finish (inherit.02) and is set whole by Customize
// (inherit.04). Each command's one dependency is the row it writes, so a room's repaint never touches a wall.

const NEEDS_FINISH = "A custom side needs a finish; Reset returns it to its room's";
const FINISH_FIRST = "Set this side's finish first: a custom side needs one";

/** The value after setting one part; null when neither part is left, so "none" has one form. */
function withPartSet(prev: SideFinish | null, part: "finish" | "lower", finish: Finish | null, height: number): SideFinish | null {
  const base = prev ?? { finish: null, lower: null };
  const next: SideFinish = part === "finish" ? { ...base, finish } : { ...base, lower: finish === null ? null : { finish, height } };
  return next.finish === null && next.lower === null ? null : next;
}

/** The wall the command names, or the refusal. */
function wallOf(doc: Document, wallId: string): Result<Wall, DomainError> {
  const wall = isValidId(wallId) ? doc.walls[wallId] : undefined;
  if (!wall) return err(domainError("notFound", "Wall not found"));
  if (wall.column) return err(domainError("invalidInput", "A column takes no finish"));
  return ok(wall);
}

/** `doc` with the wall's `side` set to `value` (null: not custom); the same document when nothing changes. */
function withSide(doc: Document, wall: Wall, side: WallSide, value: SideFinish | null): Document {
  const sides = sidesOf(wall);
  if (sameSide(sides?.[side] ?? null, value)) return doc;
  const next = withSides(wall, { left: sides?.left ?? null, right: sides?.right ?? null, [side]: value });
  return { ...doc, walls: { ...doc.walls, [wall.id]: next } };
}

/** One part of a custom side: its finish, never None (inherit.02), or its band, once the side has a finish. */
export function setWallFinish(doc: Document, cmd: CommandOf<"setWallFinish">): CommandResult {
  const wall = wallOf(doc, cmd.wallId);
  if (!wall.ok) return wall;
  const part = checkedPart(cmd);
  if (!part.ok) return part;
  const before = sidesOf(wall.value)?.[cmd.side] ?? null;
  if (cmd.part === "finish" && part.value.finish === null) return err(domainError("invalidInput", NEEDS_FINISH));
  if (cmd.part === "lower" && part.value.finish !== null && !before?.finish) return err(domainError("invalidInput", FINISH_FIRST));
  const next = withSide(doc, wall.value, cmd.side, withPartSet(before, cmd.part, part.value.finish, part.value.height));
  return ok({ doc: next, patch: diffPatch(doc, next, [{ table: "walls", id: wall.value.id }]) });
}

/** A whole custom side, finish and band (inherit.04): what Customize sends, one undo step. */
export function setWallSide(doc: Document, cmd: CommandOf<"setWallSide">): CommandResult {
  const wall = wallOf(doc, cmd.wallId);
  if (!wall.ok) return wall;
  const finish = checkedFinish(cmd.finish, "wall");
  if (!finish.ok) return finish;
  if (finish.value === null) return err(domainError("invalidInput", NEEDS_FINISH));
  const lower = checkedPart({ part: "lower", finish: cmd.lower, height: cmd.height });
  if (!lower.ok) return lower;
  const value: SideFinish = { finish: finish.value, lower: lower.value.finish ? { finish: lower.value.finish, height: lower.value.height } : null };
  const next = withSide(doc, wall.value, cmd.side, value);
  return ok({ doc: next, patch: diffPatch(doc, next, [{ table: "walls", id: wall.value.id }]) });
}

/** Returns a custom side to the default it faces (inherit.04). */
export function resetWallSide(doc: Document, cmd: CommandOf<"resetWallSide">): CommandResult {
  const wall = wallOf(doc, cmd.wallId);
  if (!wall.ok) return wall;
  const next = withSide(doc, wall.value, cmd.side, null);
  return ok({ doc: next, patch: diffPatch(doc, next, [{ table: "walls", id: wall.value.id }]) });
}

/**
 * Sets one part of a room's walls default on its label (inherit.01): every side facing the room that isn't custom shows
 * it. The label is its only dependency.
 */
export function setRoomWallFinishes(doc: Document, cmd: CommandOf<"setRoomWallFinishes">): CommandResult {
  const label = isValidId(cmd.labelId) ? doc.zoneLabels[cmd.labelId] : undefined;
  if (!label) return err(domainError("notFound", "Zone not found"));
  const part = checkedPart(cmd);
  if (!part.ok) return part;
  const before = roomWallsOf(label);
  const after = withPartSet(before, cmd.part, part.value.finish, part.value.height);
  const deps: EntityKey[] = [{ table: "zoneLabels", id: label.id }];
  if (sameSide(before, after)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, [label.id]: withRoomWalls(label, after) } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** Sets one part of the house's outside walls default on the ceiling row (inherit.07), creating the row if missing. */
export function setOutsideFinish(doc: Document, cmd: CommandOf<"setOutsideFinish">): CommandResult {
  const part = checkedPart(cmd);
  if (!part.ok) return part;
  const before = outsideOf(doc);
  const after = withPartSet(before, cmd.part, part.value.finish, part.value.height);
  const deps: EntityKey[] = [{ table: "ceilings", id: CEILING_ID }];
  if (sameSide(before, after)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const row: Ceiling = doc.ceilings[CEILING_ID] ?? { id: CEILING_ID, height: ceilingHeight(doc) };
  const next: Document = { ...doc, ceilings: { [CEILING_ID]: withOutside(row, after) } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** A command's finish as stored and, for a band, its height in whole millimetres; the refusal naming what's wrong. */
function checkedPart(cmd: { part: "finish" | "lower"; finish: Finish | null; height?: number }): Result<{ finish: Finish | null; height: number }, DomainError> {
  const finish = checkedFinish(cmd.finish, "wall");
  if (!finish.ok) return finish;
  if (cmd.part === "lower" && finish.value !== null) {
    const problem = lowerHeightProblem(cmd.height);
    if (problem) return err(domainError("invalidInput", problem));
  }
  return ok({ finish: finish.value, height: Math.round((cmd.height ?? 0) * 1000) / 1000 });
}
