import { assertNever, err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError } from "../errors";
import { incidentWalls } from "../graph";
import { MAX_NAME_LENGTH, type Document, type Joint, type Wall, type ZoneLabel } from "../model";
import { diffPatch } from "../patch";
import type { Face } from "../queries/faces";
import { zones } from "../queries/zones";
import { isValidId } from "../shape";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult } from "./types";

/**
 * Deletes the selected entities (spec §3.4, §3.6): a joint takes its incident walls with it, deleted
 * walls' endpoints that no surviving wall uses are removed, and when the deletion leaves exactly two
 * labels from different rooms in one supported room they combine ("Kitchen / Dining", label-ID
 * order, first label kept).
 */
export function deleteEntities(doc: Document, cmd: CommandOf<"deleteEntities">): CommandResult {
  if (cmd.ids.length === 0) return err(domainError("invalidInput", "Nothing selected"));
  const deps: EntityKey[] = [...cmd.ids];
  const walls: Record<string, Wall> = { ...doc.walls };
  const joints: Record<string, Joint> = { ...doc.joints };
  const labels: Record<string, ZoneLabel> = { ...doc.zoneLabels };
  const wallsToDelete = new Set<string>();

  for (const ref of cmd.ids) {
    switch (ref.table) {
      case "joints":
        if (!isValidId(ref.id) || !doc.joints[ref.id]) return err(domainError("notFound", "Joint not found"));
        for (const w of incidentWalls(doc, ref.id)) wallsToDelete.add(w);
        break;
      case "walls":
        if (!isValidId(ref.id) || !doc.walls[ref.id]) return err(domainError("notFound", "Wall not found"));
        wallsToDelete.add(ref.id);
        break;
      case "zoneLabels":
        if (!isValidId(ref.id) || !doc.zoneLabels[ref.id]) return err(domainError("notFound", "Zone not found"));
        delete labels[ref.id];
        break;
      default:
        return assertNever(ref.table);
    }
  }

  // In a valid document a selected joint is an endpoint of its deleted walls, so this removes it too.
  const endpoints = new Set<string>();
  for (const id of wallsToDelete) {
    const w = doc.walls[id];
    if (!w) continue;
    delete walls[id];
    endpoints.add(w.a).add(w.b);
    deps.push({ table: "walls", id }, { table: "joints", id: w.a }, { table: "joints", id: w.b });
  }
  const stillUsed = new Set(Object.values(walls).flatMap((w) => [w.a, w.b]));
  for (const id of endpoints) if (!stillUsed.has(id)) delete joints[id];

  let next: Document = { joints, walls, zoneLabels: labels };
  if (wallsToDelete.size > 0) next = mergeLabels(doc, next, deps);

  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", MESSAGES.invalid, valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * Combines exactly two labels that now share a supported room but resolved to different rooms before;
 * three or more labels in one room stay as they are (spec §3.6, §11). Adds the merge's dependencies to
 * `deps`: both labels and the boundaries of both source rooms and of the merged room.
 */
function mergeLabels(before: Document, after: Document, deps: EntityKey[]): Document {
  const faceBefore = new Map<string, Face>();
  for (const z of zones(before)) for (const id of z.labelIds) faceBefore.set(id, z.face);
  let labels = after.zoneLabels;
  for (const z of zones(after)) {
    const [firstId, secondId, ...rest] = z.labelIds; // sorted by ID
    if (firstId === undefined || secondId === undefined || rest.length > 0) continue;
    const f1 = faceBefore.get(firstId);
    const f2 = faceBefore.get(secondId);
    const first = labels[firstId];
    const second = labels[secondId];
    if (!f1 || !f2 || f1.key === f2.key || !first || !second) continue;
    const name = cutName([first.name, second.name].filter((n) => n !== "").join(" / "));
    const kept = { ...labels, [firstId]: { ...first, name } };
    delete kept[secondId];
    labels = kept;
    for (const f of [f1, f2, z.face]) {
      deps.push(...f.wallIds.map((id): EntityKey => ({ table: "walls", id })));
      deps.push(...f.jointIds.map((id): EntityKey => ({ table: "joints", id })));
    }
    deps.push({ table: "zoneLabels", id: firstId }, { table: "zoneLabels", id: secondId });
  }
  return labels === after.zoneLabels ? after : { ...after, zoneLabels: labels };
}

/** Cuts a name to MAX_NAME_LENGTH UTF-16 units, dropping a high surrogate whose pair was cut off. */
function cutName(name: string): string {
  const cut = name.slice(0, MAX_NAME_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return cut.length < name.length && last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
