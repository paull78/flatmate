import { err, isRecord, isWireId, ok } from "@fm/protocol";
import type { Point, Result, StoredDocument, TableName } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import { MAX_NAME_LENGTH, type Document, type Joint, type Wall, type ZoneLabel } from "./model";

/**
 * A short ID from a plain alphabet (I8). Tables are plain objects keyed by ID, so an ID that names an
 * Object.prototype member ("constructor", "toString", "__proto__", …) is refused: looking it up would
 * find the inherited member, and storing "__proto__" would set the prototype instead of a key.
 */
export function isValidId(v: unknown): v is string {
  return isWireId(v);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidName(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_NAME_LENGTH;
}

/** Exactly these own keys: unknown fields are rejected, so a stored document holds only validated fields (spec §3). */
function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
}

export function parsePoint(v: unknown): Point | null {
  if (!isRecord(v) || !hasExactKeys(v, ["x", "y"])) return null;
  const { x, y } = v;
  return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : null;
}

export function parseJoint(v: unknown): Joint | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "x", "y"])) return null;
  const { id, x, y } = v;
  return isValidId(id) && isFiniteNumber(x) && isFiniteNumber(y) ? { id, x, y } : null;
}

export function parseWall(v: unknown): Wall | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "a", "b"])) return null;
  const { id, a, b } = v;
  return isValidId(id) && isValidId(a) && isValidId(b) ? { id, a, b } : null;
}

export function parseZoneLabel(v: unknown): ZoneLabel | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "at", "name"])) return null;
  const { id, at, name } = v;
  const point = parsePoint(at);
  return isValidId(id) && point && isValidName(name) ? { id, at: point, name } : null;
}

/** Parses one table of unknown values; each entry's key must equal its ID (I8). */
function parseTable<T extends { id: string }>(
  table: TableName,
  raw: unknown,
  parse: (v: unknown) => T | null,
): Result<Record<string, T>, DomainError> {
  if (!isRecord(raw)) return err(domainError("format", `Invalid ${table} table`));
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parse(value);
    if (!parsed || parsed.id !== key) return err(domainError("format", `Invalid ${table} entry ${key}`));
    out[key] = parsed;
  }
  return ok(out);
}

/** Shape-checks the three tables of an unknown object (no geometry validation). */
export function parseTables(raw: Record<string, unknown>): Result<Document, DomainError> {
  const joints = parseTable("joints", raw.joints, parseJoint);
  if (!joints.ok) return joints;
  const walls = parseTable("walls", raw.walls, parseWall);
  if (!walls.ok) return walls;
  const zoneLabels = parseTable("zoneLabels", raw.zoneLabels, parseZoneLabel);
  if (!zoneLabels.ok) return zoneLabels;
  return ok({ joints: joints.value, walls: walls.value, zoneLabels: zoneLabels.value });
}

export function fromStored(stored: StoredDocument): Result<Document, DomainError> {
  return parseTables(stored);
}

export function toStored(doc: Document): StoredDocument {
  return { joints: { ...doc.joints }, walls: { ...doc.walls }, zoneLabels: { ...doc.zoneLabels } };
}
