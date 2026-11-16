import { err } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import type { Area, Document } from "../model";
import { roundMm } from "../queries/footprints";
import { faceAt } from "../queries/zones";
import { cutName, isFiniteNumber, isValidId } from "../shape";
import { areaName } from "../validate-areas";
import { finish, key, validPoint } from "./object-helpers";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";

// Named areas' commands (areas.05, .09): plan coordinates in, kept to the millimetre. The centre-in-a-room rule lives
// here only, never in validateDocument, so a wall edit is never refused for an area (areas.04); I26 makes every other
// refusal, reworded to name the area the edited one overlaps.

/** The first "Area N" (N from 1) no area has. */
export function nextAreaName(doc: Document): string {
  const taken = new Set(Object.values(doc.areas).map((a) => a.name));
  let n = 1;
  while (taken.has(`Area ${n}`)) n++;
  return `Area ${n}`;
}

/** I26 reads every area; the centre check reads the walls. A concurrent change to any of them conflicts. */
function areaDeps(doc: Document, id: string, walls: boolean): EntityKey[] {
  return [key("areas", id), ...Object.keys(doc.areas).filter((a) => a !== id).map((a) => key("areas", a)), ...(walls ? Object.keys(doc.walls).map((w) => key("walls", w)) : [])];
}

const size = (v: unknown): number | null => (isFiniteNumber(v) ? roundMm(v) : null);
const at = (p: Point): Point => ({ x: roundMm(p.x), y: roundMm(p.y) });

/** Validates and patches, naming the other area when I26 refuses an overlap with this one. */
function finishArea(doc: Document, next: Document, area: Area, deps: EntityKey[]): CommandResult {
  const r = finish(doc, next, deps);
  if (r.ok) return r;
  const overlap = r.error.violations.find((v) => v.invariant === "I26" && v.entities.length === 2 && v.entities.some((e) => e.id === area.id));
  const otherId = overlap?.entities.find((e) => e.id !== area.id)?.id;
  const other = otherId === undefined ? undefined : next.areas[otherId];
  return other ? err(domainError("invalid", MESSAGES.overlapsArea(areaName(other)), r.error.violations)) : r;
}

/** Adds an area `${opId}/a0` centred at `at`, `w` along x and `d` along y. */
export function addArea(doc: Document, cmd: CommandOf<"addArea">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (!validPoint(cmd.at)) return err(domainError("invalidInput", "Invalid position"));
  const [w, d] = [size(cmd.w), size(cmd.d)];
  if (w === null || d === null) return err(domainError("invalidInput", "Invalid size"));
  if (cmd.name !== undefined && typeof cmd.name !== "string") return err(domainError("invalidInput", "Invalid name"));
  const name = cmd.name === undefined || cmd.name.trim() === "" ? nextAreaName(doc) : cutName(cmd.name);
  const area: Area = { id: `${cmd.opId}/a0`, name, at: at(cmd.at), w, d };
  if (!faceAt(doc, area.at)) return err(domainError("notInRoom", MESSAGES.areaOutsideRoom));
  return finishArea(doc, { ...doc, areas: { ...doc.areas, [area.id]: area } }, area, areaDeps(doc, area.id, true));
}

/** Renames, moves or resizes an area; the fields not given keep their values. A move needs the new centre in a room. */
export function setArea(doc: Document, cmd: CommandOf<"setArea">): CommandResult {
  const was = isValidId(cmd.areaId) && Object.hasOwn(doc.areas, cmd.areaId) ? doc.areas[cmd.areaId] : undefined;
  if (!was) return err(domainError("notFound", "Area not found"));
  if (cmd.at !== undefined && !validPoint(cmd.at)) return err(domainError("invalidInput", "Invalid position"));
  const w = cmd.w === undefined ? was.w : size(cmd.w);
  const d = cmd.d === undefined ? was.d : size(cmd.d);
  if (w === null || d === null) return err(domainError("invalidInput", "Invalid size"));
  if (cmd.name !== undefined && typeof cmd.name !== "string") return err(domainError("invalidInput", "Invalid name"));
  const area: Area = { ...was, name: cmd.name === undefined ? was.name : cutName(cmd.name), at: cmd.at === undefined ? was.at : at(cmd.at), w, d };
  const moved = area.at.x !== was.at.x || area.at.y !== was.at.y;
  if (moved && !faceAt(doc, area.at)) return err(domainError("notInRoom", MESSAGES.areaOutsideRoom));
  return finishArea(doc, { ...doc, areas: { ...doc.areas, [area.id]: area } }, area, areaDeps(doc, area.id, moved));
}
