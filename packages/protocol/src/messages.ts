import type { Changeset, EntityKey, EntityValue, Expectation, Patch, StoredDocument, VersionMap } from "./patch";
import { emptyStored, emptyVersions, isTableName, keyOf, TABLE_NAMES } from "./patch";
import type { Point, Result } from "./util";
import { err, isRecord, ok } from "./util";

// ── Wire types (spec §7.2, README contracts) ─────────────────────────────────

export type ProjectMeta = { id: string; name: string };

export type RejectReason =
  | { kind: "malformed"; message: string }
  | { kind: "tooLarge" }
  | { kind: "unknownProject" }
  | { kind: "conflict"; entities: EntityKey[] }
  | { kind: "invalid"; violations: string[] };

export type ClientMessage =
  | { type: "hello"; clientId: string; name: string }
  | { type: "listProjects"; requestId: string }
  | { type: "createProject"; requestId: string; name: string }
  | { type: "deleteProject"; requestId: string; projectId: string }
  | { type: "openProject"; projectId: string; generation: string }
  | { type: "submit"; projectId: string; generation: string; changeset: Changeset }
  | { type: "presence"; projectId: string; generation: string; cursor: Point | null; selection: EntityKey[] };

// `error` answers a workspace request (its `requestId`) or a malformed message that cannot be answered
// with `rejected` (`requestId: null`); it never ends an open. An unknown project on `openProject` is
// answered with `openFailed`, which carries the `projectId` and `generation` of the open it answers.
// `deleteProject` is answered with `projects` (the new list); `projectDeleted` goes to every session that has it open.
export type ServerMessage =
  | { type: "welcome"; clientId: string; color: string }
  | { type: "projects"; requestId: string; items: ProjectMeta[] }
  | { type: "projectCreated"; requestId: string; meta: ProjectMeta }
  | { type: "error"; requestId: string | null; message: string }
  | { type: "snapshot"; projectId: string; generation: string; meta: ProjectMeta; doc: StoredDocument; versions: VersionMap; seq: number }
  | { type: "openFailed"; projectId: string; generation: string; message: string }
  | { type: "projectDeleted"; projectId: string; generation: string }
  | { type: "changes"; projectId: string; generation: string; seq: number; changeset: Changeset; clientId: string }
  | { type: "ack"; projectId: string; generation: string; changesetId: string; seq: number }
  | { type: "rejected"; projectId: string; generation: string; changesetId: string; reason: RejectReason }
  | { type: "presence"; projectId: string; generation: string; clientId: string; name: string; color: string; cursor: Point | null; selection: EntityKey[] }
  | { type: "presenceLeft"; projectId: string; generation: string; clientId: string };

export type ParseFailure = { reason: RejectReason; changesetId: string | null };

export const MAX_MESSAGE_BYTES = 1_000_000;
/** Project names and display names. */
export const MAX_NAME_CHARS = 200;

/** Same pattern as the domain's isValidId. Project IDs are UUIDs; entity IDs look like "<uuid>/j0". */
const ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,128}$/;

// ── Small predicates ─────────────────────────────────────────────────────────

/** Also refuses names of Object.prototype members ("constructor", "__proto__", …): IDs key plain objects. */
export function isWireId(v: unknown): v is string {
  return typeof v === "string" && ID_PATTERN.test(v) && !(v in Object.prototype);
}

function parseEntityKey(v: unknown): EntityKey | null {
  if (!isRecord(v)) return null;
  const { table, id } = v;
  return isTableName(table) && isWireId(id) ? { table, id } : null;
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

/**
 * Entity fields may be primitives or flat objects of primitives (points); the domain checks the exact
 * fields. The depth limit keeps recursive code (canonicalJson, deepEqual) safe from nesting attacks.
 */
function parseEntityValue(v: unknown): Result<EntityValue, string> {
  if (!isRecord(v)) return err("put entity needs a valid id");
  const { id } = v;
  if (!isWireId(id)) return err("put entity needs a valid id");
  const flat = Object.values(v).every((field) => isPrimitive(field) || (isRecord(field) && Object.values(field).every(isPrimitive)));
  return flat ? ok({ ...v, id }) : err("put entity fields must be primitives or flat objects");
}

// ── Changesets (spec §4.1, §7.9 j) ───────────────────────────────────────────

export function validateChangeset(value: unknown): Result<Changeset, string> {
  if (!isRecord(value)) return err("changeset must be an object");
  const { id, patch } = value;
  if (!isWireId(id)) return err("changeset id is invalid");
  if (!isRecord(patch)) return err("patch must be an object");
  const rawPuts = patch.puts;
  const rawDeletes = patch.deletes;
  const rawExpect = value.expect;
  if (!Array.isArray(rawPuts) || !Array.isArray(rawDeletes) || !Array.isArray(rawExpect)) {
    return err("puts, deletes and expect must be arrays");
  }

  const puts: Patch["puts"] = [];
  for (const put of rawPuts) {
    if (!isRecord(put)) return err("put must be an object");
    const { table } = put;
    if (!isTableName(table)) return err(typeof table === "string" ? `unknown table ${table}` : "unknown table");
    const entity = parseEntityValue(put.entity);
    if (!entity.ok) return entity;
    puts.push({ table, entity: entity.value });
  }

  const deletes: EntityKey[] = [];
  for (const raw of rawDeletes) {
    const key = parseEntityKey(raw);
    if (!key) return err("delete must name a known table and a valid id");
    deletes.push(key);
  }

  const expect: Expectation[] = [];
  for (const raw of rawExpect) {
    const key = parseEntityKey(raw);
    if (!key || !isRecord(raw)) return err("expectation must name a known table and a valid id");
    const rawLastCs = raw.lastCs;
    const lastCs = rawLastCs === null ? null : isWireId(rawLastCs) ? rawLastCs : undefined;
    if (lastCs === undefined) return err("expectation lastCs must be an id or null");
    expect.push({ table: key.table, id: key.id, lastCs });
  }

  if (puts.length + deletes.length === 0) return err("patch writes nothing");
  const putKeys = puts.map((put) => keyOf({ table: put.table, id: put.entity.id }));
  const deleteKeys = deletes.map(keyOf);
  const expectKeys = expect.map(keyOf);
  const duplicatePut = firstDuplicate(putKeys);
  if (duplicatePut !== null) return err(`duplicate put ${duplicatePut}`);
  const duplicateDelete = firstDuplicate(deleteKeys);
  if (duplicateDelete !== null) return err(`duplicate delete ${duplicateDelete}`);
  const putSet = new Set(putKeys);
  const overlap = deleteKeys.find((k) => putSet.has(k));
  if (overlap !== undefined) return err(`${overlap} is both put and deleted`);
  const duplicateExpectation = firstDuplicate(expectKeys);
  if (duplicateExpectation !== null) return err(`duplicate expectation ${duplicateExpectation}`);
  const expected = new Set(expectKeys);
  const missing = [...putKeys, ...deleteKeys].find((k) => !expected.has(k));
  if (missing !== undefined) return err(`missing expectation for ${missing}`);

  return ok({ id, patch: { puts, deletes }, expect });
}

function firstDuplicate(keys: string[]): string | null {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) return k;
    seen.add(k);
  }
  return null;
}

// ── Client → server (spec §7.2) ──────────────────────────────────────────────

/** UTF-8 byte length without TextEncoder (core packages have no DOM or Node typings). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // surrogate pair = one code point above U+FFFF
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function isName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MAX_NAME_CHARS;
}

function malformed(message: string): RejectReason {
  return { kind: "malformed", message };
}

function parsePoint(v: unknown): Point | null {
  if (!isRecord(v)) return null;
  const { x, y } = v;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? { x, y } : null;
}

function parseCursor(v: unknown): Result<Point | null, string> {
  if (v === null) return ok(null);
  const point = parsePoint(v);
  return point ? ok(point) : err("invalid cursor");
}

function parseKeys(v: unknown): EntityKey[] | null {
  if (!Array.isArray(v)) return null;
  const keys: EntityKey[] = [];
  for (const item of v) {
    const key = parseEntityKey(item);
    if (!key) return null;
    keys.push(key);
  }
  return keys;
}

function projectTarget(m: Record<string, unknown>): { projectId: string; generation: string } | null {
  const { projectId, generation } = m;
  return isWireId(projectId) && isWireId(generation) ? { projectId, generation } : null;
}

/** The changeset ID of a submit, if one can be read, so even a malformed submission gets `rejected` for its ID. */
function submittedChangesetId(json: unknown): string | null {
  if (!isRecord(json) || json.type !== "submit") return null;
  const { changeset } = json;
  if (!isRecord(changeset)) return null;
  const { id } = changeset;
  return isWireId(id) ? id : null;
}

export function parseClientMessage(raw: string): Result<ClientMessage, ParseFailure> {
  const tooLarge = utf8Length(raw) > MAX_MESSAGE_BYTES;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err({ reason: tooLarge ? { kind: "tooLarge" } : malformed("Message is not JSON"), changesetId: null });
  }
  const changesetId = submittedChangesetId(json);
  if (tooLarge) return err({ reason: { kind: "tooLarge" }, changesetId });
  const message = clientMessage(json);
  if (typeof message === "string") return err({ reason: malformed(message), changesetId });
  return ok(message);
}

/** A ClientMessage, or the malformed reason as a string. */
function clientMessage(json: unknown): ClientMessage | string {
  if (!isRecord(json)) return "Message must be an object";
  switch (json.type) {
    case "hello": {
      const { clientId, name } = json;
      return isWireId(clientId) && isName(name) ? { type: "hello", clientId, name } : "Invalid hello";
    }
    case "listProjects": {
      const { requestId } = json;
      return isWireId(requestId) ? { type: "listProjects", requestId } : "Invalid listProjects";
    }
    case "createProject": {
      const { requestId, name } = json;
      return isWireId(requestId) && isName(name) ? { type: "createProject", requestId, name } : "Invalid createProject";
    }
    case "deleteProject": {
      const { requestId, projectId } = json;
      return isWireId(requestId) && isWireId(projectId) ? { type: "deleteProject", requestId, projectId } : "Invalid deleteProject";
    }
    case "openProject": {
      const target = projectTarget(json);
      return target ? { type: "openProject", ...target } : "Invalid openProject";
    }
    case "submit": {
      const target = projectTarget(json);
      if (!target) return "Invalid submit";
      const changeset = validateChangeset(json.changeset);
      return changeset.ok ? { type: "submit", ...target, changeset: changeset.value } : changeset.error;
    }
    case "presence": {
      const target = projectTarget(json);
      const cursor = parseCursor(json.cursor);
      const selection = parseKeys(json.selection);
      return target && cursor.ok && selection ? { type: "presence", ...target, cursor: cursor.value, selection } : "Invalid presence";
    }
    default:
      return "Unknown message type";
  }
}

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isSeq(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isColor(v: unknown): v is string {
  return typeof v === "string" && COLOR_PATTERN.test(v);
}

// ── Shared document parsers (snapshots here; project files in the server) ────

export function parseProjectMeta(v: unknown): ProjectMeta | null {
  if (!isRecord(v)) return null;
  const { id, name } = v;
  return isWireId(id) && isName(name) ? { id, name } : null;
}

/** Generic tables only: entity fields are checked by the domain (fromStored), not here. */
export function parseStoredDocument(v: unknown): StoredDocument | null {
  if (!isRecord(v)) return null;
  const out = emptyStored();
  for (const table of TABLE_NAMES) {
    const rows = v[table];
    if (!isRecord(rows)) return null;
    for (const [id, value] of Object.entries(rows)) {
      const entity = parseEntityValue(value);
      if (!entity.ok || entity.value.id !== id) return null;
      out[table][id] = entity.value;
    }
  }
  return out;
}

export function parseVersionMap(v: unknown): VersionMap | null {
  if (!isRecord(v)) return null;
  const out = emptyVersions();
  for (const table of TABLE_NAMES) {
    const rows = v[table];
    if (!isRecord(rows)) return null;
    for (const [id, lastCs] of Object.entries(rows)) {
      if (!isWireId(id) || !isWireId(lastCs)) return null;
      out[table][id] = lastCs;
    }
  }
  return out;
}

function parseRejectReason(v: unknown): RejectReason | null {
  if (!isRecord(v)) return null;
  switch (v.kind) {
    case "malformed": {
      const { message } = v;
      return typeof message === "string" ? { kind: "malformed", message } : null;
    }
    case "tooLarge":
      return { kind: "tooLarge" };
    case "unknownProject":
      return { kind: "unknownProject" };
    case "conflict": {
      const entities = parseKeys(v.entities);
      return entities ? { kind: "conflict", entities } : null;
    }
    case "invalid": {
      const { violations } = v;
      if (!Array.isArray(violations)) return null;
      const texts: string[] = [];
      for (const violation of violations) {
        if (typeof violation !== "string") return null;
        texts.push(violation);
      }
      return { kind: "invalid", violations: texts };
    }
    default:
      return null;
  }
}

// ── Server → client (spec §7.2) ──────────────────────────────────────────────

export function parseServerMessage(raw: string): Result<ServerMessage, string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err("Message is not JSON");
  }
  const message = serverMessage(json);
  return typeof message === "string" ? err(message) : ok(message);
}

/** A ServerMessage, or the reason it is invalid. */
function serverMessage(json: unknown): ServerMessage | string {
  if (!isRecord(json)) return "Message must be an object";
  switch (json.type) {
    case "welcome": {
      const { clientId, color } = json;
      return isWireId(clientId) && isColor(color) ? { type: "welcome", clientId, color } : "Invalid welcome";
    }
    case "projects": {
      const { requestId, items } = json;
      if (!isWireId(requestId) || !Array.isArray(items)) return "Invalid projects";
      const metas: ProjectMeta[] = [];
      for (const item of items) {
        const meta = parseProjectMeta(item);
        if (!meta) return "Invalid projects";
        metas.push(meta);
      }
      return { type: "projects", requestId, items: metas };
    }
    case "projectCreated": {
      const { requestId } = json;
      const meta = parseProjectMeta(json.meta);
      return isWireId(requestId) && meta ? { type: "projectCreated", requestId, meta } : "Invalid projectCreated";
    }
    case "error": {
      const { requestId, message } = json;
      return (requestId === null || isWireId(requestId)) && typeof message === "string" ? { type: "error", requestId, message } : "Invalid error";
    }
    case "snapshot": {
      const target = projectTarget(json);
      const meta = parseProjectMeta(json.meta);
      const doc = parseStoredDocument(json.doc);
      const versions = parseVersionMap(json.versions);
      const { seq } = json;
      return target && meta && doc && versions && isSeq(seq) ? { type: "snapshot", ...target, meta, doc, versions, seq } : "Invalid snapshot";
    }
    case "openFailed": {
      const target = projectTarget(json);
      const { message } = json;
      return target && typeof message === "string" ? { type: "openFailed", ...target, message } : "Invalid openFailed";
    }
    case "projectDeleted": {
      const target = projectTarget(json);
      return target ? { type: "projectDeleted", ...target } : "Invalid projectDeleted";
    }
    case "changes": {
      const target = projectTarget(json);
      const changeset = validateChangeset(json.changeset);
      const { seq, clientId } = json;
      return target && changeset.ok && isSeq(seq) && isWireId(clientId)
        ? { type: "changes", ...target, seq, changeset: changeset.value, clientId }
        : "Invalid changes";
    }
    case "ack": {
      const target = projectTarget(json);
      const { changesetId, seq } = json;
      return target && isWireId(changesetId) && isSeq(seq) ? { type: "ack", ...target, changesetId, seq } : "Invalid ack";
    }
    case "rejected": {
      const target = projectTarget(json);
      const { changesetId } = json;
      const reason = parseRejectReason(json.reason);
      return target && isWireId(changesetId) && reason ? { type: "rejected", ...target, changesetId, reason } : "Invalid rejected";
    }
    case "presence": {
      const target = projectTarget(json);
      const { clientId, name, color } = json;
      const cursor = parseCursor(json.cursor);
      const selection = parseKeys(json.selection);
      return target && isWireId(clientId) && isName(name) && isColor(color) && cursor.ok && selection
        ? { type: "presence", ...target, clientId, name, color, cursor: cursor.value, selection }
        : "Invalid presence";
    }
    case "presenceLeft": {
      const target = projectTarget(json);
      const { clientId } = json;
      return target && isWireId(clientId) ? { type: "presenceLeft", ...target, clientId } : "Invalid presenceLeft";
    }
    default:
      return "Unknown message type";
  }
}
