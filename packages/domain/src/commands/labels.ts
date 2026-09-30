import { err, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import { interiorCandidates } from "../geometry";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { faceAt, zones, type Zone } from "../queries/zones";
import { isFiniteNumber, isValidId, isValidName } from "../shape";
import type { CommandOf, CommandResult } from "./types";

/** Adds a zone label inside an unlabelled room (spec §3.6). */
export function labelZone(doc: Document, cmd: CommandOf<"labelZone">): CommandResult {
  if (!isValidId(cmd.id)) return err(domainError("invalidInput", "Invalid label ID"));
  if (doc.zoneLabels[cmd.id]) return err(domainError("invalidInput", "Label already exists"));
  if (!isFiniteNumber(cmd.at.x) || !isFiniteNumber(cmd.at.y)) return err(domainError("invalidInput", "Invalid position"));
  if (!isValidName(cmd.name)) return err(domainError("invalidInput", "Name too long"));
  const face = faceAt(doc, cmd.at);
  if (!face) return err(domainError("notInRoom", MESSAGES.notInRoom));
  if (zones(doc).some((z) => z.face.key === face.key && z.labelIds.length > 0)) {
    return err(domainError("invalidInput", "This room already has a label"));
  }
  const next: Document = {
    ...doc,
    zoneLabels: { ...doc.zoneLabels, [cmd.id]: { id: cmd.id, at: { x: cmd.at.x, y: cmd.at.y }, name: cmd.name } },
  };
  const deps: EntityKey[] = [
    { table: "zoneLabels", id: cmd.id },
    ...face.wallIds.map((id): EntityKey => ({ table: "walls", id })),
    ...face.jointIds.map((id): EntityKey => ({ table: "joints", id })),
  ];
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * After a move or resize (same walls, new positions): a label whose point left the room it resolved
 * to goes to a point inside that room, when the room still exists (same boundary walls) and has one
 * (spec §3.6). Labels still inside their room, orphans and labels whose room is gone stay put. Adds
 * each moved label and its room's boundary to `deps`.
 */
export function keepLabelsInRooms(before: Document, after: Document, deps: EntityKey[]): Document {
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
      );
    }
  }
  return labels === after.zoneLabels ? after : { ...after, zoneLabels: labels };
}

/** A point that resolves to the zone's face: from its floor when it has one, else from its ring. */
function pointInside(doc: Document, zone: Zone): Point | null {
  const candidates = interiorCandidates(zone.floor ?? zone.face.ring);
  return candidates.find((p) => faceAt(doc, p)?.key === zone.face.key) ?? null;
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
