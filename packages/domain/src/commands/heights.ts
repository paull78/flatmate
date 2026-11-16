import { err, ok, type Result } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage, type DomainError } from "../errors";
import { CEILING_ID, type Ceiling, type Document } from "../model";
import { sameFinish } from "../finishes";
import { outsideFields } from "../wall-defaults";
import { checkedFinish } from "./labels";
import { FALLS, ROOF_SHAPES, type Falls } from "../roof-shapes";
import { roofBox, roofOf, solveRoof } from "../roof";
import { diffPatch } from "../patch";
import { roundMm } from "../queries/footprints";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { lockWall } from "./column-lock";
import type { CommandOf, CommandResult } from "./types";

// Wall tops and the ceiling (heights.10, .11). Each result is validated: I17 bounds a half wall and the ceiling,
// I12 keeps openings off walls lower than 2.00 m (decks.17), and fit (I10, I11, I17) refuses a wall or ceiling that meets a piece.

function finish(doc: Document, next: Document, deps: EntityKey[]): CommandResult {
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * Sets a wall's top: a half wall's height above its base (kept to the millimetre) or "ceiling"; a deck as top is a free
 * column's only (pillars.23). Depends on the wall only.
 */
export function setWallTop(doc: Document, cmd: CommandOf<"setWallTop">): CommandResult {
  const wall = isValidId(cmd.wallId) ? doc.walls[cmd.wallId] : undefined;
  if (!wall) return err(domainError("notFound", "Wall not found"));
  const locked = lockWall(doc, wall.id); // pillars.22
  if (locked) return err(locked);
  const top: unknown = cmd.top; // MCP and the editor build commands from JSON
  if (isValidId(top) && Object.hasOwn(doc.decks, top)) return err(domainError("invalidInput", MESSAGES.onlyColumnsReachDecks));
  if (top !== "ceiling" && !isFiniteNumber(top)) return err(domainError("invalidInput", "Invalid height"));
  const value = top === "ceiling" ? top : roundMm(top);
  const deps: EntityKey[] = [{ table: "walls", id: wall.id }];
  if (wall.top === value) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  return finish(doc, { ...doc, walls: { ...doc.walls, [wall.id]: { ...wall, top: value } } }, deps);
}

/**
 * Sets the ceiling's height, kept to the millimetre, writing the one row (created the first time). Every wall and
 * placement may change range with it, so the command depends on all of them: a concurrent edit to any conflicts.
 */
export function setCeiling(doc: Document, cmd: CommandOf<"setCeiling">): CommandResult {
  const next = nextCeiling(doc, cmd);
  if (!next.ok) return next;
  const deps: EntityKey[] = [
    { table: "ceilings", id: CEILING_ID },
    ...Object.keys(doc.walls).map((id): EntityKey => ({ table: "walls", id })),
    ...Object.keys(doc.placements).map((id): EntityKey => ({ table: "placements", id })),
  ];
  const before = doc.ceilings[CEILING_ID];
  if (before && sameCeiling(before, next.value)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  return finish(doc, { ...doc, ceilings: { [CEILING_ID]: next.value } }, deps);
}

const sameCeiling = (a: Ceiling, b: Ceiling): boolean => sameFinish(a.covering ?? null, b.covering ?? null) &&
  a.height === b.height && a.shape === b.shape && a.pitch === b.pitch && a.falls === b.falls && a.overhang === b.overhang;

/** The direction a first Shed or Gable starts from: falling across the box's shorter span, toward −y or −x (roofs.15). */
function fallsFromBox(doc: Document): Falls {
  const box = roofBox(doc);
  return box && box.maxY - box.minY > box.maxX - box.minX ? "-x" : "-y";
}

/**
 * The row after a setCeiling: what isn't given stays (roofs.20); a high side solves the pitch through the roof's edit
 * rule (roofs.03), never with a pitch; a first slope takes its direction from the box and the default pitch.
 */
function nextCeiling(doc: Document, cmd: CommandOf<"setCeiling">): Result<Ceiling, DomainError> {
  const { height, shape, pitch, highSide, falls, overhang } = cmd; // MCP and the editor build commands from JSON
  for (const v of [height, pitch, highSide, overhang]) if (v !== undefined && !isFiniteNumber(v)) return err(domainError("invalidInput", "Invalid height"));
  if (shape !== undefined && !ROOF_SHAPES.some((s) => s === shape)) return err(domainError("invalidInput", "Invalid roof shape"));
  if (falls !== undefined && !FALLS.some((f) => f === falls)) return err(domainError("invalidInput", "Invalid roof direction"));
  if (pitch !== undefined && highSide !== undefined) return err(domainError("invalidInput", "Give the pitch or the high side, not both"));
  const was = doc.ceilings[CEILING_ID];
  const roof = roofOf(doc);
  const newShape = shape ?? roof.shape;
  const firstSlope = newShape !== "flat" && (was?.shape ?? "flat") === "flat" && was?.falls === undefined;
  const base = { ...roof, shape: newShape, height: height ?? roof.height, falls: falls ?? (firstSlope ? fallsFromBox(doc) : roof.falls) };
  let solved = { height: base.height, pitch: pitch ?? roof.pitch };
  if (highSide !== undefined) {
    const r = solveRoof(base, roofBox(doc), { highSide });
    if (!r) return err(domainError("invalidInput", "A flat ceiling has no high side"));
    solved = r;
  }
  const row: Ceiling = { id: CEILING_ID, height: roundMm(solved.height), ...(was?.covering ? { covering: was.covering } : {}), ...outsideFields(was) }; // kept while flat (surfaces step 11, inherit.07)
  if (newShape === "flat" && was?.shape === undefined && shape === undefined) return ok(row); // a flat drawing stores what it did
  return ok({ ...row, shape: newShape, pitch: solved.pitch, falls: base.falls, overhang: overhang === undefined ? base.overhang : roundMm(overhang) });
}

/**
 * Sets or clears the roof's covering (surfaces step 11, AC-06) on the one ceiling row, with a floor's checks on the
 * roof's motifs; refused under a flat ceiling, which has no roof (roofs.01). The ceiling row is its only dependency.
 */
export function setRoofCovering(doc: Document, cmd: CommandOf<"setRoofCovering">): CommandResult {
  const was = doc.ceilings[CEILING_ID];
  if (!was || roofOf(doc).shape === "flat") return err(domainError("invalidInput", "A flat ceiling has no roof"));
  const finish = checkedFinish(cmd.finish, "roof");
  if (!finish.ok) return finish;
  const deps: EntityKey[] = [{ table: "ceilings", id: CEILING_ID }];
  if (sameFinish(was.covering ?? null, finish.value)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const row: Ceiling = { ...was };
  if (finish.value) row.covering = finish.value;
  else delete row.covering;
  const next: Document = { ...doc, ceilings: { [CEILING_ID]: row } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
