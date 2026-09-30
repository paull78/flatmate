import { err, isRecord, ok } from "@fm/protocol";
import type { Result } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import { sortedIds } from "./graph";
import type { Document } from "./model";
import { parseTables } from "./shape";
import { validateDocument } from "./validate";

export type DocumentJson = { format: "flatmate"; version: number; joints: unknown; walls: unknown; zoneLabels: unknown };
export const CURRENT_VERSION = 1;

/**
 * Upgrades a file from `from` to `from + 1` by rewriting its JSON (spec §3.7). `migrate` must not
 * throw; return the input unchanged when expected fields are missing.
 */
export type Migration = { from: number; migrate(json: Record<string, unknown>): Record<string, unknown> };

/** Version 1 is the first format, so there is nothing to migrate yet. */
export const MIGRATIONS: readonly Migration[] = [];

/** The lowest file version that can hold a document's content; every document fits version 1. */
function requiredVersion(): number {
  return 1;
}

function sortedTable<T>(table: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of sortedIds(table)) {
    const v = table[id];
    if (v !== undefined) out[id] = v;
  }
  return out;
}

export function serialize(doc: Document): DocumentJson {
  return {
    format: "flatmate",
    version: requiredVersion(),
    joints: sortedTable(doc.joints),
    walls: sortedTable(doc.walls),
    zoneLabels: sortedTable(doc.zoneLabels),
  };
}

/** Applies migrations in order until the JSON reaches `target`. */
export function migrateJson(
  json: Record<string, unknown>,
  version: number,
  target: number,
  migrations: readonly Migration[],
): Result<Record<string, unknown>, DomainError> {
  let current = json;
  for (let v = version; v < target; v++) {
    const m = migrations.find((x) => x.from === v);
    if (!m) return err(domainError("format", `No migration from file version ${v}`));
    current = m.migrate(current);
  }
  return ok(current);
}

export function deserialize(json: unknown): Result<Document, DomainError> {
  if (!isRecord(json) || json.format !== "flatmate") return err(domainError("format", "Not a Flatmate drawing"));
  const version = json.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return err(domainError("format", "Unknown file version"));
  }
  if (version > CURRENT_VERSION) {
    return err(domainError("format", `This drawing needs a newer Flatmate (file version ${version}, supported ${CURRENT_VERSION})`));
  }
  const migrated = migrateJson(json, version, CURRENT_VERSION, MIGRATIONS);
  if (!migrated.ok) return migrated;
  const doc = parseTables(migrated.value);
  if (!doc.ok) return doc;
  const valid = validateDocument(doc.value);
  if (!valid.ok) {
    return err(domainError("format", `Drawing is invalid: ${valid.error[0]?.message ?? "unknown problem"}`, valid.error));
  }
  return ok(doc.value);
}
