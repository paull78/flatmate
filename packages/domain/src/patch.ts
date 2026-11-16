import { TABLE_NAMES, assertNever, deepEqual, err, keyOf, ok, uniqueKeys } from "@fm/protocol";
import type { EntityKey, EntityValue, Patch, Result, TableName } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import { copyTables, type Document } from "./model";
import { parseCeiling, parseDeck, parseDeckHole, parseDimension, parseJoint, parseLayoutObject, parseLayoutState, parseLogo, parseOpening, parsePlacement, parseProjectField, parseSheet, parseUnderlay, parseWall, parseZoneLabel } from "./shape";
import { parseSection } from "./shape-sections";
import { parseArea } from "./shape-areas";

export type DomainPatch = Patch & {
  before: (EntityKey & { value: EntityValue | null })[];
  dependencies: EntityKey[];
};

export function entityValue(doc: Document, key: EntityKey): EntityValue | null {
  switch (key.table) {
    case "joints": return doc.joints[key.id] ?? null;
    case "walls": return doc.walls[key.id] ?? null;
    case "zoneLabels": return doc.zoneLabels[key.id] ?? null;
    case "decks": return doc.decks[key.id] ?? null;
    case "deckHoles": return doc.deckHoles[key.id] ?? null;
    case "states": return doc.states[key.id] ?? null;
    case "objects": return doc.objects[key.id] ?? null;
    case "placements": return doc.placements[key.id] ?? null;
    case "openings": return doc.openings[key.id] ?? null;
    case "dimensions": return doc.dimensions[key.id] ?? null;
    case "projectFields": return doc.projectFields[key.id] ?? null;
    case "underlays": return doc.underlays[key.id] ?? null;
    case "logos": return doc.logos[key.id] ?? null;
    case "ceilings": return doc.ceilings[key.id] ?? null;
    case "sheets": return doc.sheets[key.id] ?? null;
    case "sections": return doc.sections[key.id] ?? null;
    case "areas": return doc.areas[key.id] ?? null;
    default: return assertNever(key.table);
  }
}

function tableIds(doc: Document, table: TableName): string[] {
  return Object.keys(doc[table]);
}

const byKey = (x: EntityKey, y: EntityKey): number => (keyOf(x) < keyOf(y) ? -1 : keyOf(x) > keyOf(y) ? 1 : 0);

/**
 * The patch that turns `before` into `after`: puts for new or changed entities, deletes for removed
 * ones, previous values for every write, and the command's semantic dependencies (sorted, unique).
 * Entries are ordered by table (TABLE_NAMES order: joints, walls, zoneLabels, decks, states, objects, placements,
 * openings, dimensions, projectFields, underlays, logos, ceilings, sheets, sections, areas), then by ID.
 */
export function diffPatch(before: Document, after: Document, dependencies: EntityKey[]): DomainPatch {
  const patch: DomainPatch = { puts: [], deletes: [], before: [], dependencies: uniqueKeys(dependencies).sort(byKey) };
  for (const table of TABLE_NAMES) {
    const ids = [...new Set([...tableIds(before, table), ...tableIds(after, table)])].sort();
    for (const id of ids) {
      const key = { table, id };
      const was = entityValue(before, key);
      const now = entityValue(after, key);
      if (was === now) continue;
      if (now && (!was || !deepEqual(was, now))) {
        patch.puts.push({ table, entity: now });
        patch.before.push({ table, id, value: was });
      } else if (!now && was) {
        patch.deletes.push(key);
        patch.before.push({ table, id, value: was });
      }
    }
  }
  return patch;
}

/** Applies puts and deletes; put values are shape-checked. Does not validate the result. */
export function applyPatch(doc: Document, p: Patch): Result<Document, DomainError> {
  const next: Document = copyTables(doc);
  for (const { table, id } of p.deletes) delete next[table][id];
  for (const { table, entity } of p.puts) {
    const invalid = err(domainError("format", `Invalid ${table} entity ${entity.id}`));
    switch (table) {
      case "joints": { const v = parseJoint(entity); if (!v) return invalid; next.joints[v.id] = v; break; }
      case "walls": { const v = parseWall(entity); if (!v) return invalid; next.walls[v.id] = v; break; }
      case "zoneLabels": { const v = parseZoneLabel(entity); if (!v) return invalid; next.zoneLabels[v.id] = v; break; }
      case "decks": { const v = parseDeck(entity); if (!v) return invalid; next.decks[v.id] = v; break; }
      case "deckHoles": { const v = parseDeckHole(entity); if (!v) return invalid; next.deckHoles[v.id] = v; break; }
      case "states": { const v = parseLayoutState(entity); if (!v) return invalid; next.states[v.id] = v; break; }
      case "objects": { const v = parseLayoutObject(entity); if (!v) return invalid; next.objects[v.id] = v; break; }
      case "placements": { const v = parsePlacement(entity); if (!v) return invalid; next.placements[v.id] = v; break; }
      case "openings": { const v = parseOpening(entity); if (!v) return invalid; next.openings[v.id] = v; break; }
      case "dimensions": { const v = parseDimension(entity); if (!v) return invalid; next.dimensions[v.id] = v; break; }
      case "projectFields": { const v = parseProjectField(entity); if (!v) return invalid; next.projectFields[v.id] = v; break; }
      case "underlays": { const v = parseUnderlay(entity); if (!v) return invalid; next.underlays[v.id] = v; break; }
      case "logos": { const v = parseLogo(entity); if (!v) return invalid; next.logos[v.id] = v; break; }
      case "ceilings": { const v = parseCeiling(entity); if (!v) return invalid; next.ceilings[v.id] = v; break; }
      case "sheets": { const v = parseSheet(entity); if (!v) return invalid; next.sheets[v.id] = v; break; }
      case "sections": { const v = parseSection(entity); if (!v) return invalid; next.sections[v.id] = v; break; }
      case "areas": { const v = parseArea(entity); if (!v) return invalid; next.areas[v.id] = v; break; }
      default: assertNever(table);
    }
  }
  return ok(next);
}

/** Puts back every previous value and deletes every created entity. */
export function invertPatch(p: DomainPatch): Patch {
  const puts: Patch["puts"] = [];
  const deletes: EntityKey[] = [];
  for (const b of p.before) {
    if (b.value) puts.push({ table: b.table, entity: b.value });
    else deletes.push({ table: b.table, id: b.id });
  }
  return { puts, deletes };
}

/** True when `p` creates or deletes a joint or wall, or changes a wall's endpoints (spec: collaboration). */
export function changesTopology(doc: Document, p: Patch): boolean {
  for (const { table, id } of p.deletes) {
    if ((table === "joints" && doc.joints[id]) || (table === "walls" && doc.walls[id])) return true;
  }
  for (const { table, entity } of p.puts) {
    if (table === "joints" && !doc.joints[entity.id]) return true;
    if (table === "walls") {
      const was = doc.walls[entity.id];
      const now = parseWall(entity);
      if (!was || !now || was.a !== now.a || was.b !== now.b) return true;
    }
  }
  return false;
}
