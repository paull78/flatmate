import { isRecord } from "./util";

// Layout states (spec: layouts) added states, objects, placements and openings (layout-states.39); the sheet cycle added the
// title block's project fields (sheet.02), the dims cycle placed dimensions, the import cycle the plan underlay and the
// heights cycle the ceiling (heights.28), the decks cycle the decks, shared like walls (decks.03), the sheetset cycle the sheets (sheetset.02), the section cycle the sections (section.09), the areas cycle the named areas (areas.05).
export const TABLE_NAMES = ["joints", "walls", "zoneLabels", "decks", "deckHoles", "states", "objects", "placements", "openings", "dimensions", "projectFields", "underlays", "logos", "ceilings", "sheets", "sections", "areas"] as const;

/** From the list, so a table can't be named without being in it: the wire and the stores loop over TABLE_NAMES. */
export type TableName = (typeof TABLE_NAMES)[number];

export function isTableName(v: unknown): v is TableName {
  return TABLE_NAMES.some((t) => t === v);
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
  return { joints: {}, walls: {}, zoneLabels: {}, decks: {}, deckHoles: {}, states: {}, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {}, underlays: {}, logos: {}, ceilings: {}, sheets: {}, sections: {}, areas: {} };
}

export function emptyVersions(): VersionMap {
  return { joints: {}, walls: {}, zoneLabels: {}, decks: {}, deckHoles: {}, states: {}, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {}, underlays: {}, logos: {}, ceilings: {}, sheets: {}, sections: {}, areas: {} };
}

/** A copy of every table (rows shared), so a patch can write into it without touching the input. */
function copyTables<T>(doc: Record<TableName, Record<string, T>>): Record<TableName, Record<string, T>> {
  return {
    joints: { ...doc.joints },
    walls: { ...doc.walls },
    zoneLabels: { ...doc.zoneLabels },
    decks: { ...doc.decks },
    deckHoles: { ...doc.deckHoles },
    states: { ...doc.states },
    objects: { ...doc.objects },
    placements: { ...doc.placements },
    openings: { ...doc.openings },
    dimensions: { ...doc.dimensions },
    projectFields: { ...doc.projectFields },
    underlays: { ...doc.underlays },
    logos: { ...doc.logos },
    ceilings: { ...doc.ceilings },
    sheets: { ...doc.sheets },
    sections: { ...doc.sections },
    areas: { ...doc.areas },
  };
}

/** Pure: returns a new document. Puts and deletes never overlap in a valid changeset, so their order is irrelevant. */
export function applyStoredPatch(doc: StoredDocument, p: Patch): StoredDocument {
  const next: StoredDocument = copyTables(doc);
  for (const d of p.deletes) delete next[d.table][d.id];
  for (const put of p.puts) next[put.table][put.entity.id] = put.entity;
  return next;
}

/** Stamps every written entity, deleted ones included (tombstones), with the changeset ID. */
export function stampVersions(v: VersionMap, p: Patch, changesetId: string): VersionMap {
  const next: VersionMap = copyTables(v);
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
