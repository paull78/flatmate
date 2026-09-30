import { TABLE_NAMES, assertNever, deepEqual, err, keyOf, ok, uniqueKeys } from "@fm/protocol";
import type { EntityKey, EntityValue, Patch, Result, TableName } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import type { Document } from "./model";
import { parseJoint, parseWall, parseZoneLabel } from "./shape";

export type DomainPatch = Patch & {
  before: (EntityKey & { value: EntityValue | null })[];
  dependencies: EntityKey[];
};

export function entityValue(doc: Document, key: EntityKey): EntityValue | null {
  switch (key.table) {
    case "joints": return doc.joints[key.id] ?? null;
    case "walls": return doc.walls[key.id] ?? null;
    case "zoneLabels": return doc.zoneLabels[key.id] ?? null;
    default: return assertNever(key.table);
  }
}

function tableIds(doc: Document, table: TableName): string[] {
  switch (table) {
    case "joints": return Object.keys(doc.joints);
    case "walls": return Object.keys(doc.walls);
    case "zoneLabels": return Object.keys(doc.zoneLabels);
    default: return assertNever(table);
  }
}

const byKey = (x: EntityKey, y: EntityKey): number => (keyOf(x) < keyOf(y) ? -1 : keyOf(x) > keyOf(y) ? 1 : 0);

/**
 * The patch that turns `before` into `after`: puts for new or changed entities, deletes for removed
 * ones, previous values for every write, and the command's semantic dependencies (sorted, unique).
 * Entries are ordered by table (joints, walls, zoneLabels), then by ID.
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
  const next: Document = { joints: { ...doc.joints }, walls: { ...doc.walls }, zoneLabels: { ...doc.zoneLabels } };
  for (const { table, id } of p.deletes) {
    switch (table) {
      case "joints": delete next.joints[id]; break;
      case "walls": delete next.walls[id]; break;
      case "zoneLabels": delete next.zoneLabels[id]; break;
      default: assertNever(table);
    }
  }
  for (const { table, entity } of p.puts) {
    const invalid = err(domainError("format", `Invalid ${table} entity ${entity.id}`));
    switch (table) {
      case "joints": { const v = parseJoint(entity); if (!v) return invalid; next.joints[v.id] = v; break; }
      case "walls": { const v = parseWall(entity); if (!v) return invalid; next.walls[v.id] = v; break; }
      case "zoneLabels": { const v = parseZoneLabel(entity); if (!v) return invalid; next.zoneLabels[v.id] = v; break; }
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

/** True when `p` creates or deletes a joint or wall, or changes a wall's endpoints (spec §4.1). */
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
