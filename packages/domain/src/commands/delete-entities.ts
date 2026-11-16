import { assertNever, err, ok } from "@fm/protocol";
import { syncDeps, syncLinkedCopies } from "./linked-copies";
import { unlinkStairs } from "./stairs";
import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage } from "../errors";
import { incidentWalls } from "../graph";
import { type Document, type Joint, type Wall, type ZoneLabel } from "../model";
import { diffPatch } from "../patch";
import { carriedBy, deckLabel } from "../queries/decks";
import type { Face } from "../queries/faces";
import { zones } from "../queries/zones";
import { cutName, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { healColumn } from "./column-heal";
import { nearStraightRefusal, stitchJoint, stitchMismatch } from "./stitch";
import { isStraightJoint } from "../queries/runs";
import { lockJoints } from "./column-lock";
import { lockDeck } from "./deck-lock";
import { withoutPlacements } from "./objects";
import { sheetsInStep } from "./sheets-strip";
import type { CommandOf, CommandResult } from "./types";

/**
 * Deletes the selected entities (spec: walls-rooms): a joint takes its incident walls with it, a wall its openings,
 * deleted walls' endpoints that no surviving wall uses are removed with the dimensions anchored to them, and when
 * the deletion leaves exactly two labels from different rooms in one supported room they combine
 * ("Kitchen / Dining", label-ID order, first label kept). A column in a wall's line heals its wall (column-heal.ts).
 */
export function deleteEntities(doc: Document, cmd: CommandOf<"deleteEntities">): CommandResult {
  if (cmd.ids.length === 0) return err(domainError("invalidInput", "Nothing selected"));
  const deps: EntityKey[] = [...cmd.ids];
  const labels: Record<string, ZoneLabel> = { ...doc.zoneLabels };
  const wallsToDelete = new Set<string>();
  const jointsToStitch = new Set<string>(); // selected straight joints (straight.05)
  const placementsToDelete = new Set<string>();
  const openingsToDelete = new Set<string>();
  const dimensionsToDelete = new Set<string>();
  const decksToDelete = new Set<string>();
  const holesToDelete = new Set<string>();
  const sections = { ...doc.sections };
  const areas = { ...doc.areas };

  for (const ref of cmd.ids) {
    switch (ref.table) {
      case "joints": {
        if (!isValidId(ref.id) || !doc.joints[ref.id]) return err(domainError("notFound", "Joint not found"));
        const locked = lockJoints(doc, [ref.id]); // a column goes by its row, never by a joint (pillars.22)
        if (locked) return err(locked);
        // A straight joint joins its walls instead (straight.05); one up to 1° out of line refuses, naming the angle.
        const near = nearStraightRefusal(doc, ref.id);
        if (near) return err(near);
        if (isStraightJoint(doc, ref.id)) {
          const why = stitchMismatch(doc, ref.id);
          if (why !== null) return err(domainError("invalid", why));
          jointsToStitch.add(ref.id);
          break;
        }
        for (const w of incidentWalls(doc, ref.id)) wallsToDelete.add(w);
        break;
      }
      case "walls":
        if (!isValidId(ref.id) || !doc.walls[ref.id]) return err(domainError("notFound", "Wall not found"));
        wallsToDelete.add(ref.id);
        break;
      case "zoneLabels":
        if (!isValidId(ref.id) || !doc.zoneLabels[ref.id]) return err(domainError("notFound", "Zone not found"));
        delete labels[ref.id];
        break;
      case "placements":
        if (!isValidId(ref.id) || !doc.placements[ref.id]) return err(domainError("notFound", "Placement not found"));
        placementsToDelete.add(ref.id);
        break;
      case "objects":
        if (!isValidId(ref.id) || !doc.objects[ref.id]) return err(domainError("notFound", "Object not found"));
        for (const [id, p] of Object.entries(doc.placements)) if (p.object === ref.id) placementsToDelete.add(id);
        break;
      case "openings":
        if (!isValidId(ref.id) || !doc.openings[ref.id]) return err(domainError("notFound", "Opening not found"));
        openingsToDelete.add(ref.id);
        break;
      case "dimensions":
        if (!isValidId(ref.id) || !doc.dimensions[ref.id]) return err(domainError("notFound", "Dimension not found"));
        dimensionsToDelete.add(ref.id);
        break;
      case "decks":
        if (!isValidId(ref.id) || !doc.decks[ref.id]) return err(domainError("notFound", "Deck not found"));
        decksToDelete.add(ref.id);
        break;
      case "deckHoles":
        if (!isValidId(ref.id) || !doc.deckHoles[ref.id]) return err(domainError("notFound", "Hole not found"));
        holesToDelete.add(ref.id);
        break;
      case "sections":
        if (!isValidId(ref.id) || !doc.sections[ref.id]) return err(domainError("notFound", "Section not found"));
        delete sections[ref.id];
        break;
      case "areas":
        if (!isValidId(ref.id) || !doc.areas[ref.id]) return err(domainError("notFound", "Area not found"));
        delete areas[ref.id];
        break;
      case "states":
        // States go with deleteState, which keeps the last one (spec: layouts).
        return err(domainError("invalidInput", "Layouts are removed with their own command"));
      case "projectFields":
        return err(domainError("invalidInput", "Project fields are cleared, not deleted"));
      case "underlays":
        return err(domainError("invalidInput", "The underlay is removed with its own command"));
      case "logos":
        return err(domainError("invalidInput", "The logo is removed with its own command"));
      case "ceilings":
        // The ceiling is set, never removed (spec, Data).
        return err(domainError("invalidInput", "The ceiling is set, not deleted"));
      case "sheets":
        return err(domainError("invalidInput", "Sheets are removed with their own command"));
      default:
        return assertNever(ref.table);
    }
  }

  // A deck is deleted only with nothing standing on it, or with every piece on it (decks.13): no surface dangles. A
  // wall or column referencing it is named first (pillars.23), unless it goes too.
  for (const id of decksToDelete) {
    const held = lockDeck(doc, id, wallsToDelete);
    if (held) return err(held);
  }
  for (const id of decksToDelete) {
    const piece = carriedBy(doc, id).find((p) => !placementsToDelete.has(p.id));
    if (!piece) continue;
    const text = MESSAGES.deckCarries(deckLabel(doc.decks[id] ?? { name: "" }), doc.objects[piece.object]?.name || "Object", doc.states[piece.state]?.name || "a layout");
    return err(domainError("invalid", text));
  }

  // Columns heal first, one after another, and the rest runs on the healed document.
  let base = doc;
  for (const id of [...wallsToDelete].sort()) {
    const healed = doc.walls[id]?.column ? healColumn(base, id, wallsToDelete, deps) : null;
    if (!healed) continue;
    base = healed;
    wallsToDelete.delete(id);
  }
  const walls: Record<string, Wall> = { ...base.walls };
  const joints: Record<string, Joint> = { ...base.joints };
  // In a valid document a selected joint is an endpoint of its deleted walls, so this removes it too.
  const endpoints = new Set<string>();
  for (const id of wallsToDelete) {
    const w = base.walls[id];
    if (!w) continue;
    delete walls[id];
    endpoints.add(w.a).add(w.b);
    deps.push({ table: "walls", id }, { table: "joints", id: w.a }, { table: "joints", id: w.b });
  }
  const stillUsed = new Set(Object.values(walls).flatMap((w) => [w.a, w.b]));
  for (const id of endpoints) if (!stillUsed.has(id)) delete joints[id];
  // Joints go only here, so this is the one place a dimension loses its anchor: it goes with the joint (dims.07).
  for (const d of Object.values(base.dimensions)) {
    if ([d.a, d.b].some((end) => "joint" in end && !joints[end.joint])) dimensionsToDelete.add(d.id);
  }
  // A deleted wall takes its openings (spec: openings).
  for (const o of Object.values(base.openings)) if (wallsToDelete.has(o.wall)) openingsToDelete.add(o.id);
  const openings = { ...base.openings };
  for (const id of openingsToDelete) {
    delete openings[id];
    deps.push({ table: "openings", id });
  }
  const dimensions = { ...base.dimensions };
  for (const id of dimensionsToDelete) {
    delete dimensions[id];
    deps.push({ table: "dimensions", id });
  }

  const decks = { ...doc.decks };
  for (const id of decksToDelete) delete decks[id];
  // A deck takes its holes (stairwell.03).
  for (const h of Object.values(doc.deckHoles)) if (decksToDelete.has(h.deck)) holesToDelete.add(h.id);
  const deckHoles = { ...doc.deckHoles };
  for (const id of holesToDelete) {
    delete deckHoles[id];
    deps.push({ table: "deckHoles", id });
  }
  let next: Document = withoutPlacements({ ...base, joints, walls, zoneLabels: labels, decks, deckHoles, openings, dimensions, sections, areas }, placementsToDelete, deps);
  next = unlinkStairs(next, decksToDelete); // stairs reaching a deleted deck keep their height (stairs.10)
  const synced = syncLinkedCopies(doc, next); // a stair deleted in one layout goes from every layout (stairs.18)
  deps.push(...syncDeps(next, synced));
  next = synced;
  if (wallsToDelete.size > 0) next = mergeLabels(doc, next, deps);
  // Stitch the straight joints a deleted wall left behind, and the selected ones, after the labels settle: what a side
  // shows depends on the room it faces (straight.17). Each stitch runs on the document the last one left.
  for (const id of [...new Set([...endpoints, ...jointsToStitch])].sort()) {
    if (!next.joints[id]) continue;
    next = stitchJoint(next, id, deps) ?? next;
  }
  next = sheetsInStep(doc, next, deps); // a deleted deck's drawings go from its sheets (sheetset.02)

  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * Combines exactly two labels that now share a supported room but resolved to different rooms before;
 * three or more labels in one room stay as they are (spec: walls-rooms, roadmap). Adds the merge's dependencies to
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
