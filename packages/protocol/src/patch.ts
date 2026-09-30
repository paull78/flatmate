import { isRecord } from "./util";

export type TableName = "joints" | "walls" | "zoneLabels";

export const TABLE_NAMES: readonly TableName[] = ["joints", "walls", "zoneLabels"];

export function isTableName(v: unknown): v is TableName {
  return v === "joints" || v === "walls" || v === "zoneLabels";
}

export type EntityKey = { table: TableName; id: string };
export type EntityValue = { id: string } & Record<string, unknown>;
export type Patch = { puts: { table: TableName; entity: EntityValue }[]; deletes: EntityKey[] };
export type Expectation = EntityKey & { lastCs: string | null };
export type Changeset = { id: string; patch: Patch; expect: Expectation[] };
export type StoredDocument = Record<TableName, Record<string, EntityValue>>;
/** id → id of the last changeset that wrote the entity. Deleted IDs stay (tombstones); absent = never existed. */
export type VersionMap = Record<TableName, Record<string, string>>;

export function keyOf(k: EntityKey): string {
  return `${k.table}/${k.id}`;
}

/** Removes duplicate keys; the first occurrence wins and order is kept. Returns bare `{ table, id }` keys. */
export function uniqueKeys(keys: EntityKey[]): EntityKey[] {
  const seen = new Set<string>();
  const out: EntityKey[] = [];
  for (const k of keys) {
    const s = keyOf(k);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ table: k.table, id: k.id });
  }
  return out;
}

/** Every entity the patch writes: puts, then deletes, without duplicates. */
export function patchWrites(p: Patch): EntityKey[] {
  return uniqueKeys([...p.puts.map((put) => ({ table: put.table, id: put.entity.id })), ...p.deletes]);
}

export function emptyStored(): StoredDocument {
  return { joints: {}, walls: {}, zoneLabels: {} };
}

export function emptyVersions(): VersionMap {
  return { joints: {}, walls: {}, zoneLabels: {} };
}

/** Pure: returns a new document. Puts and deletes never overlap in a valid changeset, so their order is irrelevant. */
export function applyStoredPatch(doc: StoredDocument, p: Patch): StoredDocument {
  const next: StoredDocument = { joints: { ...doc.joints }, walls: { ...doc.walls }, zoneLabels: { ...doc.zoneLabels } };
  for (const d of p.deletes) delete next[d.table][d.id];
  for (const put of p.puts) next[put.table][put.entity.id] = put.entity;
  return next;
}

/** Stamps every written entity, deleted ones included (tombstones), with the changeset ID. */
export function stampVersions(v: VersionMap, p: Patch, changesetId: string): VersionMap {
  const next: VersionMap = { joints: { ...v.joints }, walls: { ...v.walls }, zoneLabels: { ...v.zoneLabels } };
  for (const k of patchWrites(p)) next[k.table][k.id] = changesetId;
  return next;
}

export function buildExpectations(v: VersionMap, keys: EntityKey[]): Expectation[] {
  return uniqueKeys(keys).map((k) => ({ table: k.table, id: k.id, lastCs: v[k.table][k.id] ?? null }));
}

/** Keys whose current version differs from the expectation. An empty list means every expectation holds. */
export function failedExpectations(v: VersionMap, expect: Expectation[]): EntityKey[] {
  return expect
    .filter((e) => (v[e.table][e.id] ?? null) !== e.lastCs)
    .map((e) => ({ table: e.table, id: e.id }));
}

/** JSON with object keys sorted at every level, so equal values give equal strings (receipt fingerprints). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
