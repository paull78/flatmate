import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { MESSAGES, domainError, type DomainError } from "../errors";
import { finishProblem, givenColour, parseFinish, sameFinish, type Finish, type Surface } from "../finishes";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { interiorPoint } from "../queries/floor";
import { faceAt, zones, type Zone } from "../queries/zones";
import { isFiniteNumber, isValidId, isValidName } from "../shape";
import type { CommandOf, CommandResult } from "./types";

/** Adds a zone label inside an unlabelled room (spec: walls-rooms). */
export function labelZone(doc: Document, cmd: CommandOf<"labelZone">): CommandResult {
  if (!isValidId(cmd.id)) return err(domainError("invalidInput", "Invalid label ID"));
  if (doc.zoneLabels[cmd.id]) return err(domainError("invalidInput", "Label already exists"));
  if (!isFiniteNumber(cmd.at.x) || !isFiniteNumber(cmd.at.y)) return err(domainError("invalidInput", "Invalid position"));
  if (!isValidName(cmd.name)) return err(domainError("invalidInput", "Name too long"));
  const finish = checkedFinish(cmd.finish, "floor");
  if (!finish.ok) return finish;
  const face = faceAt(doc, cmd.at);
  if (!face) return err(domainError("notInRoom", MESSAGES.notInRoom));
  if (zones(doc).some((z) => z.face.key === face.key && z.labelIds.length > 0)) {
    return err(domainError("invalidInput", "This room already has a label"));
  }
  const next: Document = {
    ...doc,
    zoneLabels: { ...doc.zoneLabels, [cmd.id]: { id: cmd.id, at: { x: cmd.at.x, y: cmd.at.y }, name: cmd.name, finish: finish.value } },
  };
  const deps: EntityKey[] = [
    { table: "zoneLabels", id: cmd.id },
    ...face.wallIds.map((id): EntityKey => ({ table: "walls", id })),
    ...face.jointIds.map((id): EntityKey => ({ table: "joints", id })),
  ];
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * After a move, a resize or an added wall: a label whose point left the room it resolved to goes to a
 * point inside that room, when the room still exists (same boundary walls) and has one (spec: walls-rooms).
 * A wall closing a loop around the label is such a case (holes.03). Labels still inside their room,
 * orphans and labels whose room is gone stay put. Adds each moved label and its room's boundary and
 * holes to `deps`.
 */
export function keepLabelsInRooms(before: Document, after: Document, deps: EntityKey[]): Document {
  // Skips the room analysis on unlabelled drawings, such as the wall preview or each step of an MCP `add_walls` batch there.
  if (Object.keys(before.zoneLabels).length === 0) return after;
  const roomsAfter = new Map(zones(after).map((z) => [z.face.key, z]));
  let labels = after.zoneLabels;
  for (const was of zones(before)) {
    const room = roomsAfter.get(was.face.key);
    if (!room) continue;
    for (const id of was.labelIds) {
      const label = labels[id];
      if (!label || room.labelIds.includes(id)) continue;
      const at = pointInside(after, room);
      if (!at) continue;
      labels = { ...labels, [id]: { ...label, at } };
      deps.push(
        { table: "zoneLabels", id },
        ...room.face.wallIds.map((w): EntityKey => ({ table: "walls", id: w })),
        ...room.face.jointIds.map((j): EntityKey => ({ table: "joints", id: j })),
        // The target is on the floor only while the room's holes stay where they are (holes.09).
        ...room.face.holes.flatMap((h) => [
          ...h.wallIds.map((w): EntityKey => ({ table: "walls", id: w })),
          ...h.jointIds.map((j): EntityKey => ({ table: "joints", id: j })),
        ]),
      );
    }
  }
  return labels === after.zoneLabels ? after : { ...after, zoneLabels: labels };
}

/** A point on the zone's floor, in no hole, that resolves to the zone's face. */
function pointInside(doc: Document, zone: Zone): Point | null {
  const p = interiorPoint(zone);
  // A safety net: a point on the floor and off every hole is in the zone's face, so this check has not been seen to fail.
  return p && faceAt(doc, p)?.key === zone.face.key ? p : null;
}

export function renameZone(doc: Document, cmd: CommandOf<"renameZone">): CommandResult {
  const label = isValidId(cmd.id) ? doc.zoneLabels[cmd.id] : undefined;
  if (!label) return err(domainError("notFound", "Zone not found"));
  if (!isValidName(cmd.name)) return err(domainError("invalidInput", "Name too long"));
  const deps: EntityKey[] = [{ table: "zoneLabels", id: cmd.id }];
  if (cmd.name === label.name) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, [cmd.id]: { ...label, name: cmd.name } } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** Sets or clears a label's finish (finishes.14); the label is the only dependency, as for a rename. */
export function setFinish(doc: Document, cmd: CommandOf<"setFinish">): CommandResult {
  const label = isValidId(cmd.id) ? doc.zoneLabels[cmd.id] : undefined;
  if (!label) return err(domainError("notFound", "Zone not found"));
  const finish = checkedFinish(cmd.finish, "floor");
  if (!finish.ok) return finish;
  const deps: EntityKey[] = [{ table: "zoneLabels", id: cmd.id }];
  if (sameFinish(label.finish, finish.value)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, [cmd.id]: { ...label, finish: finish.value } } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * A command's finish as a fresh row with its colour as stored (givenColour), or the refusal naming the broken field
 * (finishes.17); a label's and a deck's alike (deck-floors.04).
 */
export function checkedFinish(given: Finish | null, surface: Surface): Result<Finish | null, DomainError> {
  if (given === null) return ok(null);
  const parsed = parseFinish(given);
  if (!parsed) return err(domainError("invalidInput", "Invalid finish"));
  const finish = { ...parsed, colour: givenColour(parsed.colour) };
  const problem = finishProblem(finish, surface);
  return problem ? err(domainError("invalidInput", problem)) : ok(finish);
}
