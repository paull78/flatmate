# Phase 6: Server

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** A Node WebSocket server that stores projects as JSON files, serializes work per project, validates changesets through the `ChangesetValidator` port, persists before acknowledging, keeps receipts for idempotency, and crashes on any repository error so a restart settles outcomes from disk. The web client comes in phase 7; this phase proves the server with unit tests, a real-socket test and restart tests.

**Spec:** §7.1 (server shape, ports), §7.2 (protocol, delivery rules, crash on save errors, idempotency, validation, rejection reasons), §7.2.1 (project sessions, server side), §7.3 (submit flow), §7.9 i–o (server steps), §8 (malformed submission, server persistence failure), §9 (server integration row; acceptance scenarios on tombstones, retry after 1,000 changes, crash during a save, opening during a submission). First half of §10 step 6.

**Prerequisites:** G5 approved. Phase 1 (`@fm/protocol` `util.ts` and `patch.ts`, lint and dependency rules, `.gitignore` already ignoring `data/` and `*.tmp`) and phase 2 (`@fm/domain`: `fromStored`, `toStored`, `validateDocument`, `execute`, `emptyDocument`, `rectangleRoom`) are in place.

**Design memory to read first:**

- `collaboration.md`. The Don'ts that matter here:
  - never treat a connection close as a rejection;
  - no in-process recovery for save errors (crash-only);
  - never compact receipts or tombstones;
  - never claim universal power-loss durability;
  - never use `seq` as the entity version;
  - no last-writer-wins;
  - never apply changes the server has not validated.
- `architecture.md`. `server/src/app` never imports `@fm/domain`; only `server/src/adapters/domain-validator.ts` does.
- `implementation.md`: P13 (crash-only via an injected `onFatal`).
- `process.md`. Lessons 2 (validate at the single authority), 9 (diagrams and error summaries follow the failure paths), 13 (identify results by unique IDs) and 17 (reuse the existing recovery path).

---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Replace | `packages/protocol/src/messages.ts` | Phase 3 Task 3.1 created it with the wire types only; add the size limit helpers, hand-written parsers and changeset structure rules (types unchanged) |
| Test | `packages/protocol/test/messages.test.ts` | Table tests for every parser |
| Create | `packages/server/package.json`, `packages/server/tsconfig.json` | Package with Node typings, `ws` |
| Create | `packages/server/src/app/ports.ts` | `ChangesetValidator`, `ProjectRepository`, `ProjectState`, `Receipt` |
| Create | `packages/server/src/app/queue.ts` | `KeyedQueue`: strictly one task at a time per key |
| Create | `packages/server/src/app/testing.ts` | In-memory repository with `failNextSave` (tests here and in phase 7) |
| Create | `packages/server/src/app/decide-submit.ts` | Pure submit decision: receipt, expectations, validation, next state |
| Create | `packages/server/src/app/server-app.ts` | Sessions, workspace ops, open/subscribe, submit flow, presence, crash-only `onFatal` |
| Create | `packages/server/src/adapters/json-file-repository.ts` | One `data/<id>.json` per project; tmp + fsync + rename + dir fsync |
| Create | `packages/server/src/adapters/domain-validator.ts` | The only server file importing `@fm/domain` |
| Create | `packages/server/src/adapters/ws-transport.ts` | `ws` server ↔ `ServerApp` sessions |
| Create | `packages/server/src/main.ts` | Composition root; `onFatal` exits the process |
| Create | `packages/server/scripts/dev-server.sh` | Restart loop (crash-only) |
| Create | `packages/server/scripts/smoke.ts` | Manual smoke client for the gate |
| Test | `packages/server/test/helpers.ts` | Shared fixtures: validators, changesets, fake connections, gated repository |
| Test | `packages/server/test/{queue,testing,decide-submit,server-app,json-file-repository,domain-validator,ws-transport,crash-restart}.test.ts` | One file per unit |
| Modify | `package.json` (root) | `dev:server` script |

---

## Tasks

### Task 6.1: Protocol message types and changeset structure rules

**Files:** `packages/protocol/src/messages.ts` (exists since phase 3 Task 3.1 with the wire types), `packages/protocol/test/messages.test.ts`

(revised while planning: phase 3 creates `messages.ts` with the types and already exports it from `index.ts`; this task replaces the file with the version below, whose type section is identical to phase 3's.)

The structural rules come from spec §4.1 and §7.9 j:

- tables are known;
- every entity ID is valid;
- there is at least one write;
- put keys are unique, and so are delete keys;
- puts and deletes are disjoint;
- expectations are unique;
- every put and delete has an expectation.

`ID_PATTERN` is the same pattern as the domain's `isValidId` (README contracts). Changeset IDs, entity IDs, client IDs, request IDs and generations must all match it.

- [x] **Step 1: Write the failing test** `packages/protocol/test/messages.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Changeset } from "../src/patch";
import { validateChangeset } from "../src/messages";

const base: Changeset = {
  id: "c1",
  patch: {
    puts: [{ table: "joints", entity: { id: "j1", x: 0, y: 0 } }],
    deletes: [{ table: "walls", id: "w1" }],
  },
  expect: [
    { table: "joints", id: "j1", lastCs: null },
    { table: "walls", id: "w1", lastCs: "c0" },
    { table: "joints", id: "j2", lastCs: "c0" }, // a read-only semantic dependency
  ],
};

const jointPut = { table: "joints", entity: { id: "j1", x: 0, y: 0 } };

describe("validateChangeset", () => {
  it("accepts a well-formed changeset unchanged", () => {
    expect(validateChangeset(base)).toEqual({ ok: true, value: base });
  });

  it("accepts a changeset whose only write is a delete", () => {
    const deleteOnly = { id: "c2", patch: { puts: [], deletes: [{ table: "walls", id: "w1" }] }, expect: [{ table: "walls", id: "w1", lastCs: "c0" }] };
    expect(validateChangeset(deleteOnly)).toEqual({ ok: true, value: deleteOnly });
  });

  it.each<[string, unknown, string]>([
    ["a non-object", 42, "changeset must be an object"],
    ["an invalid id", { ...base, id: "has space" }, "changeset id is invalid"],
    ["a missing patch", { id: "c1", expect: [] }, "patch must be an object"],
    ["non-array parts", { ...base, expect: {} }, "puts, deletes and expect must be arrays"],
    ["a non-object put", { ...base, patch: { puts: [1], deletes: [] } }, "put must be an object"],
    ["an unknown table", { ...base, patch: { puts: [{ table: "doors", entity: { id: "d1" } }], deletes: [] } }, "unknown table doors"],
    ["an entity without a valid id", { ...base, patch: { puts: [{ table: "joints", entity: { x: 0 } }], deletes: [] } }, "put entity needs a valid id"],
    ["a malformed delete", { ...base, patch: { puts: [], deletes: [{ table: "walls" }] } }, "delete must name a known table and a valid id"],
    ["a malformed expectation", { ...base, expect: [{ table: "doors", id: "d1", lastCs: null }] }, "expectation must name a known table and a valid id"],
    ["a non-id lastCs", { ...base, expect: [{ table: "joints", id: "j1", lastCs: 7 }] }, "expectation lastCs must be an id or null"],
    ["no writes", { ...base, patch: { puts: [], deletes: [] } }, "patch writes nothing"],
    ["a duplicate put", { ...base, patch: { puts: [jointPut, jointPut], deletes: [] } }, "duplicate put joints/j1"],
    ["a duplicate delete", { ...base, patch: { puts: [], deletes: [{ table: "walls", id: "w1" }, { table: "walls", id: "w1" }] } }, "duplicate delete walls/w1"],
    ["a put and delete of one entity", { ...base, patch: { puts: [jointPut], deletes: [{ table: "joints", id: "j1" }] } }, "joints/j1 is both put and deleted"],
    [
      "a duplicate expectation",
      { ...base, expect: [{ table: "joints", id: "j1", lastCs: null }, { table: "joints", id: "j1", lastCs: null }, { table: "walls", id: "w1", lastCs: "c0" }] },
      "duplicate expectation joints/j1",
    ],
    ["a write without an expectation", { ...base, expect: [{ table: "walls", id: "w1", lastCs: "c0" }] }, "missing expectation for joints/j1"],
  ])("rejects %s", (_name, value, message) => {
    expect(validateChangeset(value)).toEqual({ ok: false, error: message });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/protocol test messages`
Expected: FAIL. `validateChangeset` is not exported from `../src/messages` yet (`validateChangeset is not a function`).

- [x] **Step 3: Implement.** Replace `packages/protocol/src/messages.ts` with (revised in phase 2: `ID_PATTERN` has no `\/` escape, which fails `no-useless-escape`; `isWireId` also refuses `Object.prototype` member names, like the domain's `isValidId` since the wave 1 review; add a test that `isWireId("constructor")` and `isWireId("__proto__")` are false):

```ts
import type { Changeset, EntityKey, EntityValue, Expectation, Patch, StoredDocument, VersionMap } from "./patch";
import { isTableName, keyOf } from "./patch";
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
  | { type: "openProject"; projectId: string; generation: string }
  | { type: "submit"; projectId: string; generation: string; changeset: Changeset }
  | { type: "presence"; projectId: string; generation: string; cursor: Point | null; selection: EntityKey[] };

// `error` answers a workspace request (its `requestId`) or a malformed message that cannot be answered
// with `rejected` (`requestId: null`); it never ends an open. An unknown project on `openProject` is
// answered with `openFailed`, which carries the `projectId` and `generation` of the open it answers.
export type ServerMessage =
  | { type: "welcome"; clientId: string; color: string }
  | { type: "projects"; requestId: string; items: ProjectMeta[] }
  | { type: "projectCreated"; requestId: string; meta: ProjectMeta }
  | { type: "error"; requestId: string | null; message: string }
  | { type: "snapshot"; projectId: string; generation: string; meta: ProjectMeta; doc: StoredDocument; versions: VersionMap; seq: number }
  | { type: "openFailed"; projectId: string; generation: string; message: string }
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

function parseEntityValue(v: unknown): EntityValue | null {
  if (!isRecord(v)) return null;
  const { id } = v;
  return isWireId(id) ? { ...v, id } : null;
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
    if (!isTableName(table)) return err(`unknown table ${String(table)}`);
    const entity = parseEntityValue(put.entity);
    if (!entity) return err("put entity needs a valid id");
    puts.push({ table, entity });
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
```

Each later task adds the helpers and imports it needs, so nothing is unused at any commit (`@typescript-eslint/no-unused-vars` is on).

`packages/protocol/src/index.ts` already exports `./messages` (phase 3 Task 3.1).

- [x] **Step 4: Run the test and see it pass**

Run: `pnpm --filter @fm/protocol test messages`
Expected: PASS, 18 tests.

- [x] **Step 5: One ID pattern.** The domain's `isValidId` (phase 2, `packages/domain/src/shape.ts`) must not keep its own copy of the pattern. Replace its `ID_PATTERN` constant and function with a delegation, and keep the name for domain callers:

In `packages/domain/src/shape.ts`, change the first import line to

```ts
import { err, isRecord, isWireId, ok } from "@fm/protocol";
```

then delete the `ID_PATTERN` constant and replace `isValidId` with (revised at review: merge into the existing import instead of a second mid-file import):

```ts
export function isValidId(v: unknown): v is string {
  return isWireId(v);
}
```

Run: `pnpm --filter @fm/domain test shape`
Expected: PASS (the phase 2 shape tests are unchanged).

- [x] **Step 6: Check and commit** (revised while planning: includes Step 5)

Run: `pnpm check`
Expected: typecheck `Done`, lint clean, `no dependency violations found`, all tests pass.

```bash
git add packages/protocol/src/messages.ts packages/protocol/test/messages.test.ts packages/domain/src/shape.ts
git commit -m "protocol: wire message types and changeset structure rules"
```

---

### Task 6.2: Protocol `parseClientMessage` (size limit and envelope)

**Files:** `packages/protocol/src/messages.ts`, `packages/protocol/test/messages.test.ts`

Size is measured in UTF-8 bytes (spec §7.2: "messages over 1 MB → `tooLarge`"). The core has no `TextEncoder` (lib ES2022 only), so `utf8Length` counts bytes by hand. A malformed or oversized submission still names its changeset when the ID can be read, so the server can answer with `rejected` for that ID.

- [x] **Step 1: Write the failing test.** Append to `packages/protocol/test/messages.test.ts`.

Add `MAX_MESSAGE_BYTES`, `parseClientMessage`, `utf8Length`, `type ClientMessage` and `type ParseFailure` to the import from `../src/messages`:

```ts
import { MAX_MESSAGE_BYTES, parseClientMessage, utf8Length, validateChangeset } from "../src/messages";
import type { ClientMessage, ParseFailure } from "../src/messages";
```

```ts
const submit = (changeset: unknown): string => JSON.stringify({ type: "submit", projectId: "p1", generation: "g1", changeset });

function withNote(note: string): Changeset {
  return {
    id: "c1",
    patch: { puts: [{ table: "joints", entity: { id: "j1", x: 0, y: 0, note } }], deletes: [] },
    expect: [{ table: "joints", id: "j1", lastCs: null }],
  };
}

describe("parseClientMessage", () => {
  const valid: ClientMessage[] = [
    { type: "hello", clientId: "tab-1", name: "Alice" },
    { type: "listProjects", requestId: "r1" },
    { type: "createProject", requestId: "r2", name: "Apartment" },
    { type: "openProject", projectId: "p1", generation: "g1" },
    { type: "submit", projectId: "p1", generation: "g1", changeset: base },
    { type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1.5, y: -2 }, selection: [{ table: "walls", id: "w1" }] },
    { type: "presence", projectId: "p1", generation: "g1", cursor: null, selection: [] },
  ];

  it.each(valid)("accepts $type", (msg) => {
    expect(parseClientMessage(JSON.stringify(msg))).toEqual({ ok: true, value: msg });
  });

  it.each<[string, string, ParseFailure]>([
    ["non-JSON", "{nope", { reason: { kind: "malformed", message: "Message is not JSON" }, changesetId: null }],
    ["a non-object", "[]", { reason: { kind: "malformed", message: "Message must be an object" }, changesetId: null }],
    ["an unknown type", JSON.stringify({ type: "shout" }), { reason: { kind: "malformed", message: "Unknown message type" }, changesetId: null }],
    ["a blank name", JSON.stringify({ type: "hello", clientId: "t1", name: "  " }), { reason: { kind: "malformed", message: "Invalid hello" }, changesetId: null }],
    [
      "a create with a bad request id",
      JSON.stringify({ type: "createProject", requestId: "r 1", name: "A" }),
      { reason: { kind: "malformed", message: "Invalid createProject" }, changesetId: null },
    ],
    [
      "an invalid cursor",
      JSON.stringify({ type: "presence", projectId: "p1", generation: "g1", cursor: { x: "1", y: 0 }, selection: [] }),
      { reason: { kind: "malformed", message: "Invalid presence" }, changesetId: null },
    ],
    [
      "a submit with an unknown table",
      submit({ ...base, patch: { puts: [{ table: "doors", entity: { id: "d1" } }], deletes: [] } }),
      { reason: { kind: "malformed", message: "unknown table doors" }, changesetId: "c1" },
    ],
    ["a submit missing an expectation", submit({ ...base, expect: [] }), { reason: { kind: "malformed", message: "missing expectation for joints/j1" }, changesetId: "c1" }],
    ["a submit whose changeset id is unusable", submit({ ...base, id: 5 }), { reason: { kind: "malformed", message: "changeset id is invalid" }, changesetId: null }],
    [
      "a submit without a generation",
      JSON.stringify({ type: "submit", projectId: "p1", changeset: base }),
      { reason: { kind: "malformed", message: "Invalid submit" }, changesetId: "c1" },
    ],
  ])("rejects %s", (_name, raw, failure) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: failure });
  });

  it("answers tooLarge above 1 MB and still names the changeset", () => {
    const raw = submit(withNote("a".repeat(MAX_MESSAGE_BYTES)));
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: { reason: { kind: "tooLarge" }, changesetId: "c1" } });
  });

  it("measures the limit in UTF-8 bytes, not characters", () => {
    const raw = submit(withNote("é".repeat(MAX_MESSAGE_BYTES / 2 + 1))); // 500,001 characters, 1,000,002 bytes
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: { reason: { kind: "tooLarge" }, changesetId: "c1" } });
  });

  it("accepts a message just under the limit", () => {
    const raw = submit(withNote("a".repeat(MAX_MESSAGE_BYTES - 500)));
    expect(utf8Length(raw)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(raw).ok).toBe(true);
  });

  it.each<[string, number]>([
    ["a", 1],
    ["é", 2],
    ["€", 3],
    ["😀", 4],
  ])("utf8Length(%s) is %i", (text, bytes) => {
    expect(utf8Length(text)).toBe(bytes);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/protocol test messages`
Expected: FAIL with `TypeError: … parseClientMessage is not a function` (and the same for `utf8Length`); the Task 6.1 tests still pass.

- [x] **Step 3: Implement.** Append to `packages/protocol/src/messages.ts`.

```ts
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
```

- [x] **Step 4: Run the test and see it pass**

Run: `pnpm --filter @fm/protocol test messages`
Expected: PASS, 42 tests.

- [x] **Step 5: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/protocol/src/messages.ts packages/protocol/test/messages.test.ts
git commit -m "protocol: parseClientMessage with UTF-8 size limit and changeset IDs on failure"
```

---

### Task 6.3: Protocol `parseServerMessage` and shared document parsers

**Files:** `packages/protocol/src/messages.ts`, `packages/protocol/test/messages.test.ts`

The phase 7 WebSocket adapter parses every server message with `parseServerMessage`. The JSON repository reuses `parseProjectMeta`, `parseStoredDocument` and `parseVersionMap` to read project files without casts.

- [x] **Step 1: Write the failing test.** Append to `packages/protocol/test/messages.test.ts`.

Add `parseServerMessage` and `type ServerMessage` to the imports from `../src/messages`:

```ts
describe("parseServerMessage", () => {
  const stored = { joints: { j1: { id: "j1", x: 0, y: 0 } }, walls: {}, zoneLabels: {} };
  const versions = { joints: { j1: "c1" }, walls: { w9: "c2" }, zoneLabels: {} };
  const target = { projectId: "p1", generation: "g1" };
  const valid: ServerMessage[] = [
    { type: "welcome", clientId: "tab-1", color: "#e5484d" },
    { type: "projects", requestId: "r1", items: [{ id: "p1", name: "Apartment" }] },
    { type: "projectCreated", requestId: "r2", meta: { id: "p1", name: "Apartment" } },
    { type: "error", requestId: null, message: "Message is not JSON" },
    { type: "snapshot", ...target, meta: { id: "p1", name: "Apartment" }, doc: stored, versions, seq: 3 },
    { type: "openFailed", ...target, message: "Unknown project" },
    { type: "changes", ...target, seq: 4, changeset: base, clientId: "tab-2" },
    { type: "ack", ...target, changesetId: "c1", seq: 4 },
    { type: "rejected", ...target, changesetId: "c1", reason: { kind: "conflict", entities: [{ table: "joints", id: "j1" }] } },
    { type: "rejected", ...target, changesetId: "c1", reason: { kind: "invalid", violations: ["I5: walls cross"] } },
    { type: "rejected", ...target, changesetId: "c1", reason: { kind: "malformed", message: "duplicate put joints/j1" } },
    { type: "rejected", ...target, changesetId: "c1", reason: { kind: "tooLarge" } },
    { type: "rejected", ...target, changesetId: "c1", reason: { kind: "unknownProject" } },
    { type: "presence", ...target, clientId: "tab-2", name: "Bob", color: "#0090ff", cursor: { x: 1, y: 2 }, selection: [] },
    { type: "presenceLeft", ...target, clientId: "tab-2" },
  ];

  it.each(valid)("round-trips $type", (msg) => {
    expect(parseServerMessage(JSON.stringify(msg))).toEqual({ ok: true, value: msg });
  });

  it.each<[string, unknown]>([
    ["a snapshot whose entity id differs from its key", { type: "snapshot", ...target, meta: { id: "p1", name: "A" }, doc: { joints: { j1: { id: "j2", x: 0, y: 0 } }, walls: {}, zoneLabels: {} }, versions, seq: 0 }],
    ["a snapshot missing a table", { type: "snapshot", ...target, meta: { id: "p1", name: "A" }, doc: { joints: {}, walls: {} }, versions, seq: 0 }],
    ["a version that is not an id", { type: "snapshot", ...target, meta: { id: "p1", name: "A" }, doc: stored, versions: { joints: { j1: 3 }, walls: {}, zoneLabels: {} }, seq: 0 }],
    ["an openFailed without a generation", { type: "openFailed", projectId: "p1", message: "Unknown project" }],
    ["a negative seq", { type: "ack", ...target, changesetId: "c1", seq: -1 }],
    ["an unknown reason", { type: "rejected", ...target, changesetId: "c1", reason: { kind: "nope" } }],
    ["a bad colour", { type: "welcome", clientId: "t1", color: "red" }],
    ["a client message type", { type: "hello", clientId: "t1", name: "A" }],
  ])("rejects %s", (_name, value) => {
    expect(parseServerMessage(JSON.stringify(value)).ok).toBe(false);
  });

  it("rejects non-JSON", () => {
    expect(parseServerMessage("{nope")).toEqual({ ok: false, error: "Message is not JSON" });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/protocol test messages`
Expected: FAIL with `… parseServerMessage is not a function`.

- [x] **Step 3: Implement.** First, change the value import from `./patch` at the top of `packages/protocol/src/messages.ts` to:

```ts
import { emptyStored, emptyVersions, isTableName, keyOf, TABLE_NAMES } from "./patch";
```

Then append:

```ts
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
      if (!entity || entity.id !== id) return null;
      out[table][id] = entity;
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
```

Both switches in `messages.ts` run over `unknown` values, not over a union, so they end in `default` rather than `assertNever`.

- [x] **Step 4: Run the test and see it pass**

Run: `pnpm --filter @fm/protocol test messages`
Expected: PASS, 66 tests.

- [x] **Step 5: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/protocol/src/messages.ts packages/protocol/test/messages.test.ts
git commit -m "protocol: parseServerMessage and stored-document parsers"
```

---

### Task 6.4: Server package, ports and `KeyedQueue`

**Files:** `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/app/ports.ts`, `packages/server/src/app/queue.ts`, `packages/server/test/queue.test.ts`

The per-project queue is the only thing that orders project work (spec §7.2, "Serialized per project"). Everything that reads or writes a project's state goes through it: open/snapshot, submit, save and broadcast.

- [x] **Step 1: Create the package**

`packages/server/package.json`:

```json
{
  "name": "@fm/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "start": "tsx src/main.ts",
    "dev": "sh scripts/dev-server.sh"
  },
  "dependencies": {}
}
```

`packages/server/tsconfig.json`. There is one program: the server may use Node, so tests need no separate program:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["node"] },
  "include": ["src", "test", "scripts"]
}
```

Run:

```bash
mkdir -p packages/server/src/app packages/server/src/adapters packages/server/test packages/server/scripts
pnpm --filter @fm/server add ws "@fm/protocol@workspace:*" "@fm/domain@workspace:*"
pnpm --filter @fm/server add -D @types/node @types/ws
```

Expected: `Done`; `packages/server/package.json` now lists `ws`, `@fm/protocol` and `@fm/domain` under `dependencies`, and `@types/node` and `@types/ws` under `devDependencies`. `vitest`, `tsc` and `tsx` resolve from the root (phase 1).

- [x] **Step 2: Write the ports** `packages/server/src/app/ports.ts` (spec §7.1)

```ts
import type { ProjectMeta, StoredDocument, VersionMap } from "@fm/protocol";

/** Floor-plan validity behind a port: the server app never imports @fm/domain (spec §7.1). */
export interface ChangesetValidator {
  validate(docAfter: StoredDocument): { ok: true } | { ok: false; violations: string[] };
}

export type Receipt = { seq: number; fingerprint: string };

/** Everything about one project, stored as one JSON file. There is no change log (spec §7.1). */
export type ProjectState = {
  meta: ProjectMeta;
  seq: number;
  doc: StoredDocument;
  versions: VersionMap; // includes deleted IDs (tombstones)
  receipts: Record<string, Receipt>; // every accepted changeset ID; never expire
};

export interface ProjectRepository {
  list(): Promise<ProjectMeta[]>; // sorted with byNameThenId
  create(name: string): Promise<ProjectState>;
  load(id: string): Promise<ProjectState | null>;
  /** Atomic. Resolves only after the repository's persistence completion for its host (spec §7.2). */
  save(state: ProjectState): Promise<void>;
}

/** The order every repository lists projects in. */
export function byNameThenId(a: ProjectMeta, b: ProjectMeta): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
```

- [x] **Step 3: Write the failing test** `packages/server/test/queue.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { KeyedQueue } from "../src/app/queue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("KeyedQueue", () => {
  it("runs the tasks of one key strictly one at a time, in order", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const first = deferred();
    const a = queue.run("p1", async () => {
      log.push("a start");
      await first.promise;
      log.push("a end");
      return "a";
    });
    const b = queue.run("p1", async () => {
      log.push("b start");
      return "b";
    });
    await tick();
    expect(log).toEqual(["a start"]);
    first.resolve();
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(log).toEqual(["a start", "a end", "b start"]);
  });

  it("runs different keys independently", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const hold = deferred();
    const a = queue.run("p1", async () => {
      log.push("p1");
      await hold.promise;
    });
    await queue.run("p2", async () => {
      log.push("p2");
    });
    expect(log).toEqual(["p1", "p2"]); // p2 finished while p1 is still waiting
    hold.resolve();
    await a;
  });

  it("rejects the caller of a failed task and still runs the next one", async () => {
    const queue = new KeyedQueue();
    const failed = queue.run("p1", async () => {
      throw new Error("boom");
    });
    const next = queue.run("p1", async () => "next");
    await expect(failed).rejects.toThrow("boom");
    expect(await next).toBe("next");
  });

  it("idle waits for every task, including tasks queued meanwhile", async () => {
    const queue = new KeyedQueue();
    const done: string[] = [];
    void queue.run("p1", async () => {
      await tick();
      done.push("a");
      void queue.run("p2", async () => {
        await tick();
        done.push("b");
      });
    });
    await queue.idle();
    expect(done).toEqual(["a", "b"]);
  });
});
```

- [x] **Step 4: Run it and see it fail**

Run: `pnpm install && pnpm --filter @fm/server test queue`
Expected: FAIL. Vitest cannot resolve `../src/app/queue`.

- [x] **Step 5: Implement** `packages/server/src/app/queue.ts`

```ts
/**
 * One promise chain per key: a task starts only after the previous task of the same key has settled.
 * Different keys run independently. This is the only ordering mechanism for project work (spec §7.2).
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => task());
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Resolves when no task is queued or running under any key. */
  async idle(): Promise<void> {
    while (this.tails.size > 0) await Promise.all(this.tails.values());
  }
}
```

- [x] **Step 6: Run the test and see it pass**

Run: `pnpm --filter @fm/server test queue`
Expected: PASS, 4 tests.

- [x] **Step 7: Recheck core typings now that `@types/node` is installed** (revised at review: phase 1 gate risk, P2)

Create a temporary file `packages/domain/src/leak.ts`:

```ts
export const env = process.env["NODE_ENV"];
```

Run: `pnpm --filter @fm/domain typecheck`
Expected: FAIL, `src/leak.ts(1,20): error TS2591: Cannot find name 'process'. …` (the `src`-only program still has `types: []`).

Run: `rm packages/domain/src/leak.ts && pnpm --filter @fm/domain typecheck`
Expected: exit code 0. If the first run passed instead, Node typings leak into core sources: stop, log it, and fix the core tsconfigs before continuing.

- [x] **Step 8: Check and commit**

Run: `pnpm check`
Expected: all green. The server has one typecheck program, and `depcruise` now scans `packages/server` with no violations.

```bash
git add packages/server pnpm-lock.yaml
git commit -m "server: package skeleton, ports and per-key task queue"
```

---

### Task 6.5: In-memory repository for tests

**Files:** `packages/server/src/app/testing.ts`, `packages/server/test/testing.test.ts`

It lives in `src/app`, not `test/`, so the phase 7 `sync-tests` package can import it. `failNextSave(error, { afterWrite })` simulates both crash cases of spec §7.2:

- **before the write:** the disk keeps the old state;
- **after the write:** the disk has the new state, but the server never learns that it succeeded.

A new app over the same repository object is a restart. The map is the "disk".

- [x] **Step 1: Write the failing test** `packages/server/test/testing.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryRepository } from "../src/app/testing";

describe("in-memory repository", () => {
  it("creates projects, lists them by name, and hands out copies", async () => {
    const repo = createInMemoryRepository();
    const kitchen = await repo.create("Kitchen");
    const apartment = await repo.create("Apartment");
    expect(kitchen).toMatchObject({ meta: { name: "Kitchen" }, seq: 0, receipts: {} });
    expect(await repo.list()).toEqual([apartment.meta, kitchen.meta]);
    kitchen.seq = 99;
    expect((await repo.load(kitchen.meta.id))?.seq).toBe(0);
    expect(await repo.load("missing")).toBeNull();
  });

  it("failNextSave before the write leaves the disk unchanged, once", async () => {
    const repo = createInMemoryRepository();
    const state = await repo.create("A");
    repo.failNextSave(new Error("disk full"));
    await expect(repo.save({ ...state, seq: 1 })).rejects.toThrow("disk full");
    expect((await repo.load(state.meta.id))?.seq).toBe(0);
    await repo.save({ ...state, seq: 2 });
    expect((await repo.load(state.meta.id))?.seq).toBe(2);
  });

  it("failNextSave after the write keeps the new state on disk", async () => {
    const repo = createInMemoryRepository();
    const state = await repo.create("A");
    repo.failNextSave(new Error("fsync failed"), { afterWrite: true });
    await expect(repo.save({ ...state, seq: 1 })).rejects.toThrow("fsync failed");
    expect((await repo.load(state.meta.id))?.seq).toBe(1);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/server test testing`
Expected: FAIL. Vitest cannot resolve `../src/app/testing`.

- [x] **Step 3: Implement** `packages/server/src/app/testing.ts`

```ts
import { emptyStored, emptyVersions } from "@fm/protocol";
import type { ProjectMeta } from "@fm/protocol";
import { byNameThenId } from "./ports";
import type { ProjectRepository, ProjectState } from "./ports";

export type InMemoryRepository = ProjectRepository & {
  /** The next save throws `error`: before writing (disk unchanged) or, with afterWrite, after writing. */
  failNextSave(error: Error, opts?: { afterWrite?: boolean }): void;
};

/** A repository whose "disk" is a Map. A new server app over the same object simulates a restart. */
export function createInMemoryRepository(): InMemoryRepository {
  const disk = new Map<string, ProjectState>();
  let nextId = 1;
  let failure: { error: Error; afterWrite: boolean } | null = null;

  async function save(state: ProjectState): Promise<void> {
    const pending = failure;
    failure = null;
    if (pending && !pending.afterWrite) throw pending.error;
    disk.set(state.meta.id, structuredClone(state));
    if (pending) throw pending.error;
  }

  return {
    async list(): Promise<ProjectMeta[]> {
      return [...disk.values()].map((s) => ({ ...s.meta })).sort(byNameThenId);
    },
    async create(name: string): Promise<ProjectState> {
      const state: ProjectState = { meta: { id: `p${nextId++}`, name }, seq: 0, doc: emptyStored(), versions: emptyVersions(), receipts: {} };
      await save(state);
      return structuredClone(state);
    },
    async load(id: string): Promise<ProjectState | null> {
      const state = disk.get(id);
      return state ? structuredClone(state) : null;
    },
    save,
    failNextSave(error: Error, opts: { afterWrite?: boolean } = {}): void {
      failure = { error, afterWrite: opts.afterWrite ?? false };
    },
  };
}
```

- [x] **Step 4: Run the test and see it pass**

Run: `pnpm --filter @fm/server test testing`
Expected: PASS, 3 tests.

- [x] **Step 5: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/server/src/app/testing.ts packages/server/test/testing.test.ts
git commit -m "server: in-memory repository with failNextSave for crash tests"
```

---

### Task 6.6: `decideSubmit`, a pure decision

**Files:** `packages/server/src/app/decide-submit.ts`, `packages/server/test/helpers.ts`, `packages/server/test/decide-submit.test.ts`

This is the heart of spec §7.3, as one pure function. The order is fixed:

1. A receipt with a different fingerprint → `malformed`.
2. A matching receipt → `duplicate` (ack only).
3. Failed expectations → `conflict`, naming the entities.
4. Apply tentatively, then validate; violations → `invalid`.
5. Otherwise accept: `seq + 1`, stamp versions (tombstones included), add the receipt.

The input state is never mutated.

- [x] **Step 1: Create the shared test fixtures** `packages/server/test/helpers.ts`

```ts
import type { Changeset, StoredDocument } from "@fm/protocol";
import type { ChangesetValidator } from "../src/app/ports";

export const acceptAll: ChangesetValidator = { validate: () => ({ ok: true }) };

/** Stands in for "walls cross": any joint at x = 99 makes the document invalid. */
export const rejectX99: ChangesetValidator = {
  validate: (doc: StoredDocument) =>
    Object.values(doc.joints).some((joint) => joint.x === 99) ? { ok: false, violations: ["I5: walls cross"] } : { ok: true },
};

export function putJoint(id: string, jointId: string, x: number, lastCs: string | null = null): Changeset {
  return {
    id,
    patch: { puts: [{ table: "joints", entity: { id: jointId, x, y: 0 } }], deletes: [] },
    expect: [{ table: "joints", id: jointId, lastCs }],
  };
}

export function deleteJoint(id: string, jointId: string, lastCs: string): Changeset {
  return {
    id,
    patch: { puts: [], deletes: [{ table: "joints", id: jointId }] },
    expect: [{ table: "joints", id: jointId, lastCs }],
  };
}
```

- [x] **Step 2: Write the failing test** `packages/server/test/decide-submit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyStored, emptyVersions } from "@fm/protocol";
import type { Changeset } from "@fm/protocol";
import { decideSubmit, fingerprintOf } from "../src/app/decide-submit";
import type { ProjectState } from "../src/app/ports";
import { acceptAll, deleteJoint, putJoint, rejectX99 } from "./helpers";

const fresh = (): ProjectState => ({ meta: { id: "p1", name: "Apartment" }, seq: 0, doc: emptyStored(), versions: emptyVersions(), receipts: {} });

function accept(state: ProjectState, cs: Changeset): ProjectState {
  const decision = decideSubmit(state, cs, acceptAll);
  if (decision.kind !== "accept") throw new Error(`expected accept, got ${JSON.stringify(decision)}`);
  return decision.next;
}

describe("decideSubmit", () => {
  it("accepts: next seq, applied doc, stamped versions, receipt; input untouched", () => {
    const start = fresh();
    const c1 = putJoint("c1", "j1", 1);
    const decision = decideSubmit(start, c1, acceptAll);
    expect(decision).toEqual({
      kind: "accept",
      seq: 1,
      next: {
        meta: start.meta,
        seq: 1,
        doc: { joints: { j1: { id: "j1", x: 1, y: 0 } }, walls: {}, zoneLabels: {} },
        versions: { joints: { j1: "c1" }, walls: {}, zoneLabels: {} },
        receipts: { c1: { seq: 1, fingerprint: fingerprintOf(c1) } },
      },
    });
    expect(start).toEqual(fresh());
  });

  it("answers a matching resend with its original seq (duplicate)", () => {
    const c1 = putJoint("c1", "j1", 1);
    expect(decideSubmit(accept(fresh(), c1), c1, acceptAll)).toEqual({ kind: "duplicate", seq: 1 });
  });

  it("rejects a reused ID with a different payload as malformed", () => {
    const state = accept(fresh(), putJoint("c1", "j1", 1));
    expect(decideSubmit(state, putJoint("c1", "j1", 2), acceptAll)).toEqual({
      kind: "reject",
      reason: { kind: "malformed", message: "Changeset ID reused with a different payload" },
    });
  });

  it("rejects failed expectations as a conflict naming the entities (first writer wins)", () => {
    const state = accept(fresh(), putJoint("c1", "j1", 1));
    expect(decideSubmit(state, putJoint("c2", "j1", 2, null), acceptAll)).toEqual({
      kind: "reject",
      reason: { kind: "conflict", entities: [{ table: "joints", id: "j1" }] },
    });
  });

  it("rejects an invalid result with the validator's violations", () => {
    expect(decideSubmit(fresh(), putJoint("c1", "j1", 99), rejectX99)).toEqual({
      kind: "reject",
      reason: { kind: "invalid", violations: ["I5: walls cross"] },
    });
  });

  it("delete, recreate, delete: an expectation for the first deletion fails against the second tombstone", () => {
    const created = accept(fresh(), putJoint("c1", "j1", 0));
    const deleted = accept(created, deleteJoint("c2", "j1", "c1"));
    expect(deleted.doc.joints).toEqual({});
    expect(deleted.versions.joints).toEqual({ j1: "c2" }); // tombstone
    const recreated = accept(deleted, putJoint("c3", "j1", 5, "c2")); // recreating needs the deletion version
    const deletedAgain = accept(recreated, deleteJoint("c4", "j1", "c3"));
    expect(decideSubmit(deletedAgain, putJoint("c5", "j1", 9, "c2"), acceptAll)).toMatchObject({ kind: "reject", reason: { kind: "conflict" } });
    // Only a never-used ID has a null version.
    expect(decideSubmit(deletedAgain, putJoint("c6", "j1", 9, null), acceptAll)).toMatchObject({ kind: "reject", reason: { kind: "conflict" } });
    expect(decideSubmit(deletedAgain, putJoint("c7", "j2", 9, null), acceptAll).kind).toBe("accept");
  });

  it("a retry after 1,000 other accepted changes gets its original seq", () => {
    const c0 = putJoint("c0", "j0", 0);
    let state = accept(fresh(), c0);
    for (let i = 1; i <= 1000; i++) state = accept(state, putJoint(`c${i}`, `j${i}`, i));
    expect(state.seq).toBe(1001);
    expect(decideSubmit(state, c0, acceptAll)).toEqual({ kind: "duplicate", seq: 1 });
  });

  it("fingerprints ignore object key order but not payload changes", () => {
    const c1 = putJoint("c1", "j1", 1);
    const reordered: Changeset = {
      expect: [{ lastCs: null, id: "j1", table: "joints" }],
      patch: { deletes: [], puts: [{ entity: { y: 0, x: 1, id: "j1" }, table: "joints" }] },
      id: "c1",
    };
    expect(fingerprintOf(reordered)).toBe(fingerprintOf(c1));
    expect(fingerprintOf(putJoint("c1", "j1", 2))).not.toBe(fingerprintOf(c1));
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/server test decide-submit`
Expected: FAIL. Vitest cannot resolve `../src/app/decide-submit`.

- [x] **Step 4: Implement** `packages/server/src/app/decide-submit.ts`

```ts
import { createHash } from "node:crypto";
import { applyStoredPatch, canonicalJson, failedExpectations, stampVersions } from "@fm/protocol";
import type { Changeset, RejectReason } from "@fm/protocol";
import type { ChangesetValidator, ProjectState } from "./ports";

export type SubmitDecision =
  | { kind: "reject"; reason: RejectReason }
  | { kind: "duplicate"; seq: number }
  | { kind: "accept"; next: ProjectState; seq: number };

/** Receipt fingerprint over the canonical submission payload, expectations included (spec §7.2). */
export function fingerprintOf(cs: Changeset): string {
  return createHash("sha256").update(canonicalJson({ patch: cs.patch, expect: cs.expect })).digest("hex");
}

/**
 * Spec §7.3 as a pure function. The changeset is already structurally valid (protocol parser).
 * Order: receipt (idempotency) → expectations (compare-and-set) → validation of the result → accept.
 */
export function decideSubmit(state: ProjectState, cs: Changeset, validator: ChangesetValidator): SubmitDecision {
  const fingerprint = fingerprintOf(cs);
  const receipt = state.receipts[cs.id];
  if (receipt) {
    return receipt.fingerprint === fingerprint
      ? { kind: "duplicate", seq: receipt.seq }
      : { kind: "reject", reason: { kind: "malformed", message: "Changeset ID reused with a different payload" } };
  }

  const failed = failedExpectations(state.versions, cs.expect);
  if (failed.length > 0) return { kind: "reject", reason: { kind: "conflict", entities: failed } };

  const doc = applyStoredPatch(state.doc, cs.patch);
  const verdict = validator.validate(doc);
  if (!verdict.ok) return { kind: "reject", reason: { kind: "invalid", violations: verdict.violations } };

  const seq = state.seq + 1;
  return {
    kind: "accept",
    seq,
    next: {
      meta: state.meta,
      seq,
      doc,
      versions: stampVersions(state.versions, cs.patch, cs.id),
      receipts: { ...state.receipts, [cs.id]: { seq, fingerprint } },
    },
  };
}
```

- [x] **Step 5: Run the test and see it pass**

Run: `pnpm --filter @fm/server test decide-submit`
Expected: PASS, 8 tests. The 1,000-change test finishes well under a second.

- [x] **Step 6: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/server/src/app/decide-submit.ts packages/server/test/helpers.ts packages/server/test/decide-submit.test.ts
git commit -m "server: pure submit decision with receipts, expectations and tombstones"
```

---

### Task 6.7: Server app (sessions, workspace, open, submit, presence, crash-only)

**Files:** `packages/server/src/app/server-app.ts`, `packages/server/test/helpers.ts`, `packages/server/test/server-app.test.ts`, `docs/design-memory/collaboration.md`

The rules below are the simplest reading of spec §7.2 and §7.2.1. Record them in design memory in Step 6.

- **Hello first.** The first message must be `hello`; anything else closes the connection. `welcome` assigns a colour by join order.
- **Workspace operations.** `listProjects` and `createProject` run in one workspace queue key and echo the request ID.
- **Opening.** Opening first leaves the previous subscription at once, outside the queue: the others get `presenceLeft`, and the session receives no further changes under the old generation. Then it records `{ projectId, generation }` and enqueues a task in the project queue. The task loads the project, sends the full snapshot with that generation, then subscribes. Changes accepted earlier in the queue are therefore inside the snapshot, and later ones follow it in `seq` order (spec §7.2.1). An unknown project answers `openFailed { projectId, generation, message: "Unknown project" }` with the request's `projectId` and `generation`, so the client can tell it from a reply to a newer open (revised 2026-09-28: an uncorrelated `error` could cancel the client's next open).
- **Submitting.** A submit for a project the session has not opened is rejected with `unknownProject`. A submit with a stale generation is ignored: the client has already moved on, and its same-ID resend follows the new snapshot. Otherwise the project queue runs `decideSubmit`:
  - on `accept`, it awaits `repository.save(next)`, publishes the state in memory, sends `changes` to every subscriber (each tagged with its own generation, the sender included), then sends `ack` to the sender;
  - on `duplicate`, it sends `ack` only;
  - on `reject`, it sends `rejected` to the sender only.
- **Crash-only (P13).** Any error in a queued task, including a repository error, calls `onFatal(error)` once. After that the app sends nothing more; `main.ts` exits the process.
- **Malformed messages** (the parser failed). If a changeset ID was readable and the session has a project open, the answer is `rejected` against the session's current project and generation. Otherwise it is `error { requestId: null }`, which never ends a pending open on the client. Before `hello`, the connection closes.
- **Presence** bypasses the queue: it is ephemeral and needs no ordering. It is relayed to the other subscribers with the sender's name and colour. It is not replayed to a client that joins later; cursors appear on the next move.

- [x] **Step 1: Extend the test fixtures.** Append to `packages/server/test/helpers.ts`.

Merge these imports into the existing import lines at the top of the file:

```ts
import type { Changeset, ClientMessage, ServerMessage, StoredDocument } from "@fm/protocol";
import type { ChangesetValidator, ProjectRepository } from "../src/app/ports";
import { createServerApp } from "../src/app/server-app";
import type { Connection } from "../src/app/server-app";
import { createInMemoryRepository } from "../src/app/testing";
```

Then append:

```ts
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class FakeConnection implements Connection {
  messages: ServerMessage[] = [];
  closed = false;

  send(msg: ServerMessage): void {
    this.messages.push(msg);
  }

  close(): void {
    this.closed = true;
  }

  types(): string[] {
    return this.messages.map((m) => m.type);
  }

  /** Returns and clears the messages received so far. */
  take(): ServerMessage[] {
    const taken = this.messages;
    this.messages = [];
    return taken;
  }
}

export function setup(opts: { repository?: ProjectRepository; validator?: ChangesetValidator } = {}) {
  const repository = opts.repository ?? createInMemoryRepository();
  const fatal: unknown[] = [];
  const app = createServerApp({ repository, validator: opts.validator ?? acceptAll, onFatal: (error) => void fatal.push(error) });

  function join(clientId: string, name: string = clientId) {
    const conn = new FakeConnection();
    const session = app.connect(conn);
    const send = (msg: ClientMessage): void => session.receive(JSON.stringify(msg));
    send({ type: "hello", clientId, name });
    const welcome = conn.messages[0];
    if (welcome?.type !== "welcome") throw new Error("expected welcome");
    return { conn, session, send, color: welcome.color };
  }

  return { app, repository, fatal, join };
}

export type Ctx = ReturnType<typeof setup>;
export type TestClient = ReturnType<Ctx["join"]>;

let requests = 0;

export async function createProject(ctx: Ctx, client: TestClient, name = "Apartment"): Promise<string> {
  const requestId = `req${++requests}`;
  client.send({ type: "createProject", requestId, name });
  await ctx.app.idle();
  for (const m of client.conn.messages) if (m.type === "projectCreated" && m.requestId === requestId) return m.meta.id;
  throw new Error("projectCreated not received");
}

export async function openProject(ctx: Ctx, client: TestClient, projectId: string, generation: string): Promise<Extract<ServerMessage, { type: "snapshot" }>> {
  client.send({ type: "openProject", projectId, generation });
  await ctx.app.idle();
  for (const m of [...client.conn.messages].reverse()) if (m.type === "snapshot" && m.generation === generation) return m;
  throw new Error("snapshot not received");
}

/** Alice and Bob both have one project open (generations "ga" and "gb"); message logs cleared. */
export async function room(ctx: Ctx): Promise<{ alice: TestClient; bob: TestClient; projectId: string }> {
  const alice = ctx.join("alice", "Alice");
  const bob = ctx.join("bob", "Bob");
  const projectId = await createProject(ctx, alice);
  await openProject(ctx, alice, projectId, "ga");
  await openProject(ctx, bob, projectId, "gb");
  alice.conn.take();
  bob.conn.take();
  return { alice, bob, projectId };
}

/** Saves wait while held, so tests can observe what is (not) sent before persistence completes. */
export function gatedRepository(): { repository: ProjectRepository; hold(): void; release(): void } {
  const inner = createInMemoryRepository();
  let gate: Promise<void> | null = null;
  let open: () => void = () => undefined;
  return {
    repository: {
      list: () => inner.list(),
      create: (name) => inner.create(name),
      load: (id) => inner.load(id),
      save: async (state) => {
        if (gate) await gate;
        await inner.save(state);
      },
    },
    hold() {
      gate = new Promise((resolve) => {
        open = resolve;
      });
    },
    release() {
      gate = null;
      open();
    },
  };
}
```

`Changeset` and `StoredDocument` are already used by the Task 6.6 fixtures.

- [x] **Step 2: Write the failing test** `packages/server/test/server-app.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES } from "@fm/protocol";
import { createInMemoryRepository } from "../src/app/testing";
import { FakeConnection, createProject, gatedRepository, openProject, putJoint, rejectX99, room, setup, tick } from "./helpers";

describe("server app: sessions and workspace", () => {
  it("answers hello with welcome and gives each client its own colour", () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    const bob = ctx.join("bob");
    expect(alice.conn.messages).toEqual([{ type: "welcome", clientId: "alice", color: alice.color }]);
    expect(bob.conn.messages).toEqual([{ type: "welcome", clientId: "bob", color: bob.color }]);
    expect(alice.color).not.toBe(bob.color);
  });

  it("closes a connection whose first message is not hello", () => {
    const ctx = setup();
    const conn = new FakeConnection();
    ctx.app.connect(conn).receive(JSON.stringify({ type: "listProjects", requestId: "r1" }));
    expect(conn.closed).toBe(true);
    expect(conn.messages).toEqual([]);
  });

  it("creates and lists projects, echoing request IDs", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "createProject", requestId: "r1", name: "Apartment" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "projectCreated", requestId: "r1", meta: { id: expect.any(String), name: "Apartment" } }]);
    alice.send({ type: "listProjects", requestId: "r2" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "projects", requestId: "r2", items: [{ id: expect.any(String), name: "Apartment" }] }]);
  });

  it("answers an unparseable message with an error and keeps the session", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.session.receive("{not json");
    expect(alice.conn.take()).toEqual([{ type: "error", requestId: null, message: "Message is not JSON" }]);
    alice.send({ type: "listProjects", requestId: "r1" });
    await ctx.app.idle();
    expect(alice.conn.types()).toEqual(["projects"]);
  });
});

describe("server app: opening projects", () => {
  it("sends a full snapshot tagged with the session's generation", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    const projectId = await createProject(ctx, alice);
    expect(await openProject(ctx, alice, projectId, "g1")).toEqual({
      type: "snapshot",
      projectId,
      generation: "g1",
      meta: { id: projectId, name: "Apartment" },
      doc: { joints: {}, walls: {}, zoneLabels: {} },
      versions: { joints: {}, walls: {}, zoneLabels: {} },
      seq: 0,
    });
  });

  it("reports an unknown project", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "openProject", projectId: "missing", generation: "g1" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "openFailed", projectId: "missing", generation: "g1", message: "Unknown project" }]);
  });

  it("opening during a submission delivers the snapshot, then only later changes", async () => {
    const gated = gatedRepository();
    const ctx = setup({ repository: gated.repository });
    const alice = ctx.join("alice");
    const bob = ctx.join("bob");
    const projectId = await createProject(ctx, alice);
    await openProject(ctx, alice, projectId, "ga");
    bob.conn.take();

    gated.hold();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    bob.send({ type: "openProject", projectId, generation: "gb" });
    await tick();
    expect(bob.conn.messages).toEqual([]); // the open waits behind the submission in the project queue
    gated.release();
    await ctx.app.idle();
    const [snapshot, ...rest] = bob.conn.take();
    expect(snapshot).toMatchObject({ type: "snapshot", generation: "gb", seq: 1 });
    expect(rest).toEqual([]); // c1 is inside the snapshot, not sent again as changes

    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c2", "j2", 2) });
    await ctx.app.idle();
    expect(bob.conn.take()).toEqual([expect.objectContaining({ type: "changes", generation: "gb", seq: 2 })]);
  });

  it("re-opening with a new generation replaces the subscription", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    await openProject(ctx, alice, projectId, "ga2");
    expect(bob.conn.take()).toEqual([{ type: "presenceLeft", projectId, generation: "gb", clientId: "alice" }]);
    alice.conn.take();
    bob.send({ type: "submit", projectId, generation: "gb", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([expect.objectContaining({ type: "changes", generation: "ga2", seq: 1 })]);
  });
});

describe("server app: submissions", () => {
  it("saves, then broadcasts changes to every subscriber, then acks the sender", async () => {
    const gated = gatedRepository();
    const ctx = setup({ repository: gated.repository });
    const { alice, bob, projectId } = await room(ctx);
    const c1 = putJoint("c1", "j1", 1);
    gated.hold();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await tick();
    expect(alice.conn.messages).toEqual([]); // nothing before persistence completes
    expect(bob.conn.messages).toEqual([]);
    gated.release();
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "changes", projectId, generation: "ga", seq: 1, changeset: c1, clientId: "alice" },
      { type: "ack", projectId, generation: "ga", changesetId: "c1", seq: 1 },
    ]);
    expect(bob.conn.take()).toEqual([{ type: "changes", projectId, generation: "gb", seq: 1, changeset: c1, clientId: "alice" }]);
    expect((await gated.repository.load(projectId))?.seq).toBe(1);
  });

  it("acks a duplicate resend with its original seq and does not broadcast it again", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    const c1 = putJoint("c1", "j1", 1);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await ctx.app.idle();
    alice.conn.take();
    bob.conn.take();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "ack", projectId, generation: "ga", changesetId: "c1", seq: 1 }]);
    expect(bob.conn.take()).toEqual([]);
  });

  it("serializes concurrent submissions: the second is checked against the first", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    bob.send({ type: "submit", projectId, generation: "gb", changeset: putJoint("c2", "j1", 2) });
    await ctx.app.idle();
    expect(alice.conn.types()).toEqual(["changes", "ack"]);
    expect(bob.conn.take()).toEqual([
      expect.objectContaining({ type: "changes", seq: 1, clientId: "alice" }),
      { type: "rejected", projectId, generation: "gb", changesetId: "c2", reason: { kind: "conflict", entities: [{ table: "joints", id: "j1" }] } },
    ]);
  });

  it("rejects an invalid result to the sender only", async () => {
    const ctx = setup({ validator: rejectX99 });
    const { alice, bob, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 99) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId, generation: "ga", changesetId: "c1", reason: { kind: "invalid", violations: ["I5: walls cross"] } },
    ]);
    expect(bob.conn.take()).toEqual([]);
  });

  it("rejects a reused ID with a different payload as malformed", async () => {
    const ctx = setup();
    const { alice, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    alice.conn.take();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j2", 5) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId, generation: "ga", changesetId: "c1", reason: { kind: "malformed", message: "Changeset ID reused with a different payload" } },
    ]);
  });

  it("rejects structural errors as malformed and oversized messages as tooLarge, naming the changeset", async () => {
    const ctx = setup();
    const { alice, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: { ...putJoint("c1", "j1", 1), expect: [] } });
    const huge = { ...putJoint("c2", "j2", 2), patch: { puts: [{ table: "joints", entity: { id: "j2", x: 2, y: 0, pad: "x".repeat(MAX_MESSAGE_BYTES) } }], deletes: [] } };
    alice.session.receive(JSON.stringify({ type: "submit", projectId, generation: "ga", changeset: huge }));
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId, generation: "ga", changesetId: "c1", reason: { kind: "malformed", message: "missing expectation for joints/j1" } },
      { type: "rejected", projectId, generation: "ga", changesetId: "c2", reason: { kind: "tooLarge" } },
    ]);
  });

  it("ignores a submission from a stale generation", async () => {
    const ctx = setup();
    const { alice, projectId } = await room(ctx);
    await openProject(ctx, alice, projectId, "ga2");
    alice.conn.take();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([]);
  });

  it("rejects a submission for a project the session has not opened", async () => {
    const ctx = setup();
    const { alice } = await room(ctx);
    alice.send({ type: "submit", projectId: "other", generation: "g9", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId: "other", generation: "g9", changesetId: "c1", reason: { kind: "unknownProject" } },
    ]);
  });
});

describe("server app: presence", () => {
  it("relays presence to the other subscribers with name and colour", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    alice.send({ type: "presence", projectId, generation: "ga", cursor: { x: 1, y: 2 }, selection: [{ table: "walls", id: "w1" }] });
    expect(bob.conn.take()).toEqual([
      { type: "presence", projectId, generation: "gb", clientId: "alice", name: "Alice", color: alice.color, cursor: { x: 1, y: 2 }, selection: [{ table: "walls", id: "w1" }] },
    ]);
    expect(alice.conn.take()).toEqual([]);
  });

  it("ignores presence from a stale generation", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    await openProject(ctx, alice, projectId, "ga2");
    bob.conn.take();
    alice.send({ type: "presence", projectId, generation: "ga", cursor: null, selection: [] });
    expect(bob.conn.take()).toEqual([]);
  });

  it("announces presenceLeft when a client disconnects", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    alice.session.close();
    expect(bob.conn.take()).toEqual([{ type: "presenceLeft", projectId, generation: "gb", clientId: "alice" }]);
  });
});

describe("server app: repository errors are fatal (spec §7.2)", () => {
  it("calls onFatal once, sends no ack, rejection or changes, and stays silent afterwards", async () => {
    const repository = createInMemoryRepository();
    const ctx = setup({ repository });
    const { alice, bob, projectId } = await room(ctx);
    repository.failNextSave(new Error("disk full"));
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(ctx.fatal).toEqual([new Error("disk full")]);
    expect(alice.conn.take()).toEqual([]);
    expect(bob.conn.take()).toEqual([]);

    bob.send({ type: "listProjects", requestId: "r9" });
    await ctx.app.idle();
    expect(bob.conn.take()).toEqual([]);
    expect(ctx.fatal).toHaveLength(1);
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/server test server-app`
Expected: FAIL. Vitest cannot resolve `../src/app/server-app`, imported by `helpers.ts`.

- [x] **Step 4: Implement** `packages/server/src/app/server-app.ts`

```ts
import { assertNever, parseClientMessage } from "@fm/protocol";
import type { ClientMessage, ParseFailure, RejectReason, ServerMessage } from "@fm/protocol";
import { decideSubmit } from "./decide-submit";
import type { ChangesetValidator, ProjectRepository, ProjectState } from "./ports";
import { KeyedQueue } from "./queue";

export type Connection = { send(msg: ServerMessage): void; close(): void };
export type Session = { receive(raw: string): void; close(): void };
export type ServerApp = { connect(conn: Connection): Session; idle(): Promise<void> };
export type ServerAppDeps = { repository: ProjectRepository; validator: ChangesetValidator; onFatal(error: unknown): void };

export const PRESENCE_COLORS: readonly string[] = ["#e5484d", "#0090ff", "#30a46c", "#f76b15", "#8e4ec6", "#12a594"];

/** Queue key for list/create; project IDs never start with "#". */
const WORKSPACE_QUEUE = "#workspace";

type Identity = { clientId: string; name: string; color: string };
type Client = {
  conn: Connection;
  identity: Identity | null; // null until hello
  project: { projectId: string; generation: string } | null; // what the session asked for last
  closed: boolean;
};
/** Published state plus subscribers, each with the generation of its subscription. */
type LiveProject = { state: ProjectState; subscribers: Map<Client, string> };
type Submit = Extract<ClientMessage, { type: "submit" }>;
type Presence = Extract<ClientMessage, { type: "presence" }>;

export function createServerApp(deps: ServerAppDeps): ServerApp {
  const queue = new KeyedQueue();
  const live = new Map<string, LiveProject>();
  let joined = 0;
  let dead = false; // after onFatal the process is exiting: send nothing more

  function send(c: Client, msg: ServerMessage): void {
    if (!dead && !c.closed) c.conn.send(msg);
  }

  function fatal(error: unknown): void {
    if (dead) return;
    dead = true;
    deps.onFatal(error);
  }

  /** Every task that touches a project runs here. Any error is fatal (crash-only, spec §7.2). */
  function enqueue(key: string, task: () => Promise<void>): void {
    void queue
      .run(key, async () => {
        if (!dead) await task();
      })
      .catch(fatal);
  }

  function colorFor(n: number): string {
    return PRESENCE_COLORS[n % PRESENCE_COLORS.length] ?? "#e5484d";
  }

  async function loadLive(projectId: string): Promise<LiveProject | null> {
    const cached = live.get(projectId);
    if (cached) return cached;
    const state = await deps.repository.load(projectId);
    if (!state) return null;
    const project: LiveProject = { state, subscribers: new Map() };
    live.set(projectId, project);
    return project;
  }

  /** Drop the session's subscription at once; the others see presenceLeft. */
  function leave(c: Client): void {
    const current = c.project;
    const identity = c.identity;
    if (current === null || identity === null) return;
    const project = live.get(current.projectId);
    if (!project || !project.subscribers.delete(c)) return;
    for (const [other, generation] of project.subscribers) {
      send(other, { type: "presenceLeft", projectId: current.projectId, generation, clientId: identity.clientId });
    }
  }

  function open(c: Client, projectId: string, generation: string): void {
    leave(c);
    c.project = { projectId, generation };
    enqueue(projectId, async () => {
      const project = await loadLive(projectId);
      const current = c.project;
      if (c.closed || current === null || current.projectId !== projectId || current.generation !== generation) return; // superseded
      if (project === null) {
        c.project = null;
        send(c, { type: "openFailed", projectId, generation, message: "Unknown project" });
        return;
      }
      const { state } = project;
      send(c, { type: "snapshot", projectId, generation, meta: state.meta, doc: state.doc, versions: state.versions, seq: state.seq });
      project.subscribers.set(c, generation); // after the snapshot, before the next queued submission (spec §7.2.1)
    });
  }

  function submit(c: Client, identity: Identity, msg: Submit): void {
    const { projectId, generation, changeset } = msg;
    const reject = (reason: RejectReason): void =>
      send(c, { type: "rejected", projectId, generation, changesetId: changeset.id, reason });
    if (c.project === null || c.project.projectId !== projectId) {
      reject({ kind: "unknownProject" });
      return;
    }
    if (c.project.generation !== generation) return; // stale generation: the client has moved on (spec §7.2.1)

    enqueue(projectId, async () => {
      const project = live.get(projectId);
      if (!project) {
        reject({ kind: "unknownProject" });
        return;
      }
      const decision = decideSubmit(project.state, changeset, deps.validator);
      switch (decision.kind) {
        case "reject":
          reject(decision.reason);
          return;
        case "duplicate":
          send(c, { type: "ack", projectId, generation, changesetId: changeset.id, seq: decision.seq });
          return;
        case "accept":
          try {
            await deps.repository.save(decision.next);
          } catch (error) {
            fatal(error); // no ack, no rejection, nothing published (spec §7.2, §7.3)
            return;
          }
          project.state = decision.next;
          for (const [subscriber, subscriberGeneration] of project.subscribers) {
            send(subscriber, { type: "changes", projectId, generation: subscriberGeneration, seq: decision.seq, changeset, clientId: identity.clientId });
          }
          send(c, { type: "ack", projectId, generation, changesetId: changeset.id, seq: decision.seq });
          return;
        default:
          assertNever(decision);
      }
    });
  }

  function presence(c: Client, identity: Identity, msg: Presence): void {
    const { projectId, generation, cursor, selection } = msg;
    const current = c.project;
    if (current === null || current.projectId !== projectId || current.generation !== generation) return;
    const project = live.get(projectId);
    if (!project || !project.subscribers.has(c)) return;
    for (const [other, otherGeneration] of project.subscribers) {
      if (other === c) continue;
      send(other, { type: "presence", projectId, generation: otherGeneration, clientId: identity.clientId, name: identity.name, color: identity.color, cursor, selection });
    }
  }

  function handle(c: Client, identity: Identity, msg: ClientMessage): void {
    switch (msg.type) {
      case "hello":
        return; // the identity is fixed by the first hello
      case "listProjects": {
        const { requestId } = msg;
        enqueue(WORKSPACE_QUEUE, async () => {
          const items = await deps.repository.list();
          send(c, { type: "projects", requestId, items });
        });
        return;
      }
      case "createProject": {
        const { requestId, name } = msg;
        enqueue(WORKSPACE_QUEUE, async () => {
          const state = await deps.repository.create(name);
          live.set(state.meta.id, { state, subscribers: new Map() });
          send(c, { type: "projectCreated", requestId, meta: state.meta });
        });
        return;
      }
      case "openProject":
        return open(c, msg.projectId, msg.generation);
      case "submit":
        return submit(c, identity, msg);
      case "presence":
        return presence(c, identity, msg);
      default:
        return assertNever(msg);
    }
  }

  function reasonText(reason: RejectReason): string {
    switch (reason.kind) {
      case "malformed":
        return reason.message;
      case "tooLarge":
        return "Message too large";
      case "unknownProject":
        return "Unknown project";
      case "conflict":
        return "Conflict";
      case "invalid":
        return reason.violations.join("; ");
      default:
        return assertNever(reason);
    }
  }

  function closeConnection(c: Client): void {
    c.closed = true;
    c.conn.close();
  }

  function rejectUnparsed(c: Client, failure: ParseFailure): void {
    if (c.identity === null) return closeConnection(c);
    if (failure.changesetId !== null && c.project !== null) {
      send(c, { type: "rejected", projectId: c.project.projectId, generation: c.project.generation, changesetId: failure.changesetId, reason: failure.reason });
      return;
    }
    send(c, { type: "error", requestId: null, message: reasonText(failure.reason) });
  }

  function connect(conn: Connection): Session {
    const c: Client = { conn, identity: null, project: null, closed: false };
    return {
      receive(raw: string): void {
        if (c.closed || dead) return;
        const parsed = parseClientMessage(raw);
        if (!parsed.ok) return rejectUnparsed(c, parsed.error);
        const msg = parsed.value;
        if (c.identity !== null) return handle(c, c.identity, msg);
        if (msg.type !== "hello") return closeConnection(c);
        c.identity = { clientId: msg.clientId, name: msg.name, color: colorFor(joined++) };
        send(c, { type: "welcome", clientId: msg.clientId, color: c.identity.color });
      },
      close(): void {
        leave(c);
        c.closed = true;
      },
    };
  }

  return { connect, idle: () => queue.idle() };
}
```

- [x] **Step 5: Run the test and see it pass**

Run: `pnpm --filter @fm/server test server-app`
Expected: PASS, 20 tests.

- [x] **Step 6: Record the session rules in design memory**

The server session rules were drafted into `collaboration.md` while planning (row "Server session rules (planning, …)"); replace that draft row with these rows, using today's date and adjusted to what was implemented, so no duplicate remains:

```markdown
| Server sessions: `hello` first, else the connection closes; `welcome` assigns a colour by join order; a submit for a project the session has not opened → `rejected{unknownProject}`; a submit or presence with a stale generation is ignored; a malformed submit is rejected against the session's current project and generation, otherwise answered with `error` (<date>) | One simple rule per case; a stale generation is the client's own past, and its same-ID resend follows the new snapshot | §7.2, §7.2.1 |
| Opening leaves the previous subscription at once, outside the queue; snapshot and new subscription happen inside the project queue; an unknown project gets `openFailed` with the request's `projectId` and `generation`. Presence bypasses the queue and is not replayed to joiners (<date>) | Snapshot then consecutive changes per generation, with no extra state | §7.2.1 |
| Crash-only covers any error inside a queued server task, not only repository errors; after `onFatal` the app sends nothing (<date>) | One recovery path: restart, snapshot, same-ID resend | §7.2 |
```

Add a row to the `## Sprint log` below (kind: decision), and update the Collaboration line and the date in `docs/design-memory/INDEX.md`.

- [x] **Step 7: Check and commit**

Run: `pnpm check`
Expected: all green. ESLint's no-assertion rule covers `server/src/app`, and the code has no `as` or `!`.

```bash
git add packages/server/src/app/server-app.ts packages/server/test/helpers.ts packages/server/test/server-app.test.ts docs/design-memory/collaboration.md docs/design-memory/INDEX.md docs/plans/flatmate/phase-6-server.md
git commit -m "server: app with per-project queue, persistence before ack, presence and crash-only errors"
```

---

### Task 6.8: JSON file repository

**Files:** `packages/server/src/adapters/json-file-repository.ts`, `packages/server/test/json-file-repository.test.ts`, `docs/design-memory/implementation.md`

Each project is one file, `<dir>/<id>.json`, holding the whole `ProjectState`. There is no change log (spec §7.1).

A save does five things, in order:

1. write `<id>.json.tmp`;
2. `FileHandle.sync()` it;
3. close it;
4. `rename` it over `<id>.json`;
5. sync the directory, where the platform allows it.

Loading ignores `*.tmp` files, because only `*.json` files are read. Project IDs must match `^[A-Za-z0-9_-]{1,128}$`. Wire IDs allow `/` and `.`, so without this check an `openProject` could name a path outside the data directory. Any read or parse error propagates: the app treats it as fatal (crash-only).

- [x] **Step 1: Write the failing test** `packages/server/test/json-file-repository.test.ts`

```ts
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fm-repo-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JSON file repository", () => {
  it("creates the data directory, then creates, lists and loads projects", async () => {
    const repo = createJsonFileRepository(join(dir, "nested", "data"));
    const state = await repo.create("Apartment");
    expect(state).toMatchObject({ meta: { name: "Apartment" }, seq: 0, receipts: {} });
    expect(await repo.list()).toEqual([state.meta]);
    expect(await repo.load(state.meta.id)).toEqual(state);
    expect(await readdir(join(dir, "nested", "data"))).toEqual([`${state.meta.id}.json`]);
  });

  it("save replaces the file and leaves no temporary file", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    const next = { ...state, seq: 1, receipts: { c1: { seq: 1, fingerprint: "abc" } } };
    await repo.save(next);
    expect(await repo.load(state.meta.id)).toEqual(next);
    expect(await readdir(dir)).toEqual([`${state.meta.id}.json`]);
  });

  it("ignores a temporary file left by an interrupted write", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    await writeFile(join(dir, `${state.meta.id}.json.tmp`), "{ half-written");
    expect(await repo.list()).toEqual([state.meta]);
    expect(await repo.load(state.meta.id)).toEqual(state);
  });

  it("a new repository over the same directory reloads state and receipts (restart)", async () => {
    const before = createJsonFileRepository(dir);
    const state = await before.create("Apartment");
    const saved = {
      ...state,
      seq: 1,
      doc: { joints: { j1: { id: "j1", x: 1, y: 0 } }, walls: {}, zoneLabels: {} },
      versions: { joints: { j1: "c1" }, walls: { w9: "c0" }, zoneLabels: {} },
      receipts: { c1: { seq: 1, fingerprint: "abc" } },
    };
    await before.save(saved);
    expect(await createJsonFileRepository(dir).load(state.meta.id)).toEqual(saved);
  });

  it("lists projects sorted by name", async () => {
    const repo = createJsonFileRepository(dir);
    const kitchen = await repo.create("Kitchen");
    const apartment = await repo.create("Apartment");
    expect(await repo.list()).toEqual([apartment.meta, kitchen.meta]);
  });

  it("returns null for unknown or unsafe IDs", async () => {
    const repo = createJsonFileRepository(dir);
    expect(await repo.load("missing")).toBeNull();
    expect(await repo.load("../etc/passwd")).toBeNull();
    expect(await repo.load("a/b")).toBeNull();
  });

  it("rejects a corrupt project file", async () => {
    const repo = createJsonFileRepository(dir);
    await writeFile(join(dir, "bad.json"), "{}");
    await expect(repo.load("bad")).rejects.toThrow(/invalid project file/);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/server test json-file-repository`
Expected: FAIL. Vitest cannot resolve `../src/adapters/json-file-repository`.

- [x] **Step 3: Implement** `packages/server/src/adapters/json-file-repository.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { emptyStored, emptyVersions, isRecord, parseProjectMeta, parseStoredDocument, parseVersionMap } from "@fm/protocol";
import type { ProjectMeta } from "@fm/protocol";
import { byNameThenId } from "../app/ports";
import type { ProjectRepository, ProjectState, Receipt } from "../app/ports";

/** Server-made UUIDs. Never "/", "." or "..", so an ID cannot leave the data directory. */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * One `<dir>/<id>.json` per project holding the whole ProjectState (spec §7.1).
 * Save = write tmp → sync → close → rename → sync directory where supported (spec §7.2).
 * Completion means these calls returned; no power-loss guarantee is claimed beyond what the OS gives.
 */
export function createJsonFileRepository(dir: string): ProjectRepository {
  const fileOf = (id: string): string => join(dir, `${id}.json`);

  async function save(state: ProjectState): Promise<void> {
    await mkdir(dir, { recursive: true });
    const target = fileOf(state.meta.id);
    const tmp = `${target}.tmp`;
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
    await syncDirectory(dir);
  }

  async function read(file: string): Promise<ProjectState> {
    return parseProjectState(JSON.parse(await readFile(file, "utf8")), file);
  }

  return {
    async list(): Promise<ProjectMeta[]> {
      await mkdir(dir, { recursive: true });
      const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
      const metas: ProjectMeta[] = [];
      for (const name of names) metas.push((await read(join(dir, name))).meta);
      return metas.sort(byNameThenId);
    },
    async create(name: string): Promise<ProjectState> {
      const state: ProjectState = { meta: { id: randomUUID(), name }, seq: 0, doc: emptyStored(), versions: emptyVersions(), receipts: {} };
      await save(state);
      return state;
    },
    async load(id: string): Promise<ProjectState | null> {
      if (!PROJECT_ID.test(id)) return null;
      try {
        return await read(fileOf(id));
      } catch (error) {
        if (hasCode(error, "ENOENT")) return null;
        throw error;
      }
    },
    save,
  };
}

async function syncDirectory(dir: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dir, "r");
    await handle.sync();
  } catch (error) {
    if (!hasCode(error, "EISDIR", "EPERM", "EINVAL", "ENOTSUP")) throw error; // platforms that cannot sync a directory
  } finally {
    await handle?.close();
  }
}

function hasCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

function parseProjectState(json: unknown, file: string): ProjectState {
  if (!isRecord(json)) throw new Error(`${file}: invalid project file`);
  const meta = parseProjectMeta(json.meta);
  const doc = parseStoredDocument(json.doc);
  const versions = parseVersionMap(json.versions);
  const receipts = parseReceipts(json.receipts);
  const { seq } = json;
  if (!meta || !doc || !versions || !receipts || typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) {
    throw new Error(`${file}: invalid project file`);
  }
  return { meta, seq, doc, versions, receipts };
}

function parseReceipts(v: unknown): Record<string, Receipt> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, Receipt> = {};
  for (const [id, receipt] of Object.entries(v)) {
    if (!isRecord(receipt)) return null;
    const { seq, fingerprint } = receipt;
    if (typeof seq !== "number" || !Number.isInteger(seq) || typeof fingerprint !== "string") return null;
    out[id] = { seq, fingerprint };
  }
  return out;
}
```

Both repositories import `byNameThenId` from `app/ports.ts`, so they list projects in the same order.

- [x] **Step 4: Run the test and see it pass**

Run: `pnpm --filter @fm/server test json-file-repository`
Expected: PASS, 7 tests.

- [x] **Step 5: Record the finding.** Add a bullet under `## Tooling notes` in `docs/design-memory/implementation.md`, with today's date (revised at review: name the section):

> JSON repository: project files are `<DATA_DIR>/<id>.json` holding the whole `ProjectState`; saves go through tmp → `FileHandle.sync()` → rename → directory sync where supported; `*.tmp` files are ignored on load; only IDs matching `^[A-Za-z0-9_-]{1,128}$` are loaded, because wire IDs allow `/` and `.`. What `FileHandle.sync()` guarantees on macOS is answered at gate 6 (do not claim power-loss durability).

Add a Sprint log row.

- [x] **Step 6: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/server/src/adapters/json-file-repository.ts packages/server/test/json-file-repository.test.ts docs/design-memory/implementation.md docs/plans/flatmate/phase-6-server.md
git commit -m "server: JSON file repository with atomic replace and safe project IDs"
```

---

### Task 6.9: Domain validator adapter

**Files:** `packages/server/src/adapters/domain-validator.ts`, `packages/server/test/domain-validator.test.ts`

This is the only server file that imports `@fm/domain` (spec §2.4, dependency rule `only-domain-validator-imports-domain`). It checks entity shapes with `fromStored`, then runs the invariants with `validateDocument` (spec §3.3). Violations become strings for `rejected{invalid}`.

- [x] **Step 1: Write the failing test** `packages/server/test/domain-validator.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, toStored } from "@fm/domain";
import { emptyStored, unwrap } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";

describe("domainValidator", () => {
  it("accepts a valid room built through the domain API", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    expect(domainValidator.validate(toStored(doc))).toEqual({ ok: true });
  });

  it("reports crossing walls as I5 violations", () => {
    const doc = emptyStored();
    doc.joints = {
      j1: { id: "j1", x: 0, y: 0 },
      j2: { id: "j2", x: 2, y: 2 },
      j3: { id: "j3", x: 0, y: 2 },
      j4: { id: "j4", x: 2, y: 0 },
    };
    doc.walls = { w1: { id: "w1", a: "j1", b: "j2" }, w2: { id: "w2", a: "j3", b: "j4" } };
    const result = domainValidator.validate(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.startsWith("I5"))).toBe(true);
  });

  it("reports malformed entities", () => {
    const doc = emptyStored();
    doc.joints = { j1: { id: "j1", x: "zero", y: 0 } };
    expect(domainValidator.validate(doc).ok).toBe(false);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/server test domain-validator`
Expected: FAIL. Vitest cannot resolve `../src/adapters/domain-validator`.

- [x] **Step 3: Implement** `packages/server/src/adapters/domain-validator.ts`

```ts
import { fromStored, validateDocument } from "@fm/domain";
import type { StoredDocument } from "@fm/protocol";
import type { ChangesetValidator } from "../app/ports";

/** The server app's only view of floor-plan rules (spec §7.1): shape check, then invariants I1–I8. */
export const domainValidator: ChangesetValidator = {
  validate(docAfter: StoredDocument) {
    const parsed = fromStored(docAfter);
    if (!parsed.ok) {
      return { ok: false, violations: [parsed.error.message, ...parsed.error.violations.map((v) => `${v.invariant}: ${v.message}`)] };
    }
    const result = validateDocument(parsed.value);
    if (!result.ok) return { ok: false, violations: result.error.map((v) => `${v.invariant}: ${v.message}`) };
    return { ok: true };
  },
};
```

- [x] **Step 4: Run the test and see it pass**

Run: `pnpm --filter @fm/server test domain-validator`
Expected: PASS, 3 tests.

- [x] **Step 5: Check and commit**

Run: `pnpm check`
Expected: all green; `depcruise` reports no violations, so only this adapter imports `@fm/domain`.

```bash
git add packages/server/src/adapters/domain-validator.ts packages/server/test/domain-validator.test.ts
git commit -m "server: domain validator adapter behind the ChangesetValidator port"
```

---

### Task 6.10: WebSocket transport, composition root and restart loop

**Files:** `packages/server/src/adapters/ws-transport.ts`, `packages/server/src/main.ts`, `packages/server/scripts/dev-server.sh`, `packages/server/scripts/smoke.ts`, `packages/server/test/ws-transport.test.ts`, `package.json` (root), `docs/design-memory/implementation.md`

`startWsTransport` is **async**, because the real port (for `port: 0` in tests) is known only after `listening`. `ws` closes a socket whose frame exceeds `maxPayload`. With `maxPayload` at 16 × `MAX_MESSAGE_BYTES`, anything between 1 MB and 16 MB still receives a `tooLarge` answer from the app.

- [x] **Step 1: Write the failing test** `packages/server/test/ws-transport.test.ts`

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDocument, execute } from "@fm/domain";
import { buildExpectations, emptyVersions, MAX_MESSAGE_BYTES, parseServerMessage, patchWrites, unwrap } from "@fm/protocol";
import type { Changeset, ClientMessage, ServerMessage } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { startWsTransport } from "../src/adapters/ws-transport";
import type { WsTransport } from "../src/adapters/ws-transport";
import { createServerApp } from "../src/app/server-app";

/** A test client that parses every server message and hands them out in order. */
class WsClient {
  private readonly inbox: ServerMessage[] = [];
  private waiting: ((m: ServerMessage) => void) | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const parsed = parseServerMessage(data.toString());
      if (!parsed.ok) throw new Error(`server sent an invalid message: ${parsed.error}`);
      const waiting = this.waiting;
      this.waiting = null;
      if (waiting) waiting(parsed.value);
      else this.inbox.push(parsed.value);
    });
  }

  static connect(url: string): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once("open", () => resolve(new WsClient(socket)));
      socket.once("error", reject);
    });
  }

  send(msg: ClientMessage): void {
    this.socket.send(JSON.stringify(msg));
  }

  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  next(): Promise<ServerMessage> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  async receive<T extends ServerMessage["type"]>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const m = await this.next();
    if (!isType(m, type)) throw new Error(`expected ${type}, got ${JSON.stringify(m)}`);
    return m;
  }

  close(): void {
    this.socket.close();
  }
}

function isType<T extends ServerMessage["type"]>(m: ServerMessage, type: T): m is Extract<ServerMessage, { type: T }> {
  return m.type === type;
}

/** The first wall of a project, built by the real domain as the editor will (spec §7.9 c–d). */
function firstWall(id: string): Changeset {
  const { patch } = unwrap(execute(emptyDocument(), { type: "addWall", opId: "op1", from: { at: { x: 0, y: 0 } }, to: { at: { x: 4, y: 0 } } }));
  return {
    id,
    patch: { puts: patch.puts, deletes: patch.deletes },
    expect: buildExpectations(emptyVersions(), [...patchWrites(patch), ...patch.dependencies]),
  };
}

describe("WebSocket transport (real sockets, JSON files, domain validator)", () => {
  let dir = "";
  let transport: WsTransport | null = null;
  let fatal: unknown[] = [];
  const clients: WsClient[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fm-ws-"));
    fatal = [];
    const app = createServerApp({ repository: createJsonFileRepository(dir), validator: domainValidator, onFatal: (e) => void fatal.push(e) });
    transport = await startWsTransport(app, { port: 0 });
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await transport?.close();
    await rm(dir, { recursive: true, force: true });
    expect(fatal).toEqual([]);
  });

  async function connect(clientId: string, name: string): Promise<WsClient> {
    if (!transport) throw new Error("transport not started");
    const client = await WsClient.connect(`ws://127.0.0.1:${transport.port}`);
    clients.push(client);
    client.send({ type: "hello", clientId, name });
    await client.receive("welcome");
    return client;
  }

  it("creates, opens and submits; a second client sees the accepted wall", async () => {
    const alice = await connect("alice", "Alice");
    alice.send({ type: "createProject", requestId: "r1", name: "Apartment" });
    const { meta } = await alice.receive("projectCreated");
    alice.send({ type: "openProject", projectId: meta.id, generation: "g1" });
    expect((await alice.receive("snapshot")).seq).toBe(0);

    alice.send({ type: "submit", projectId: meta.id, generation: "g1", changeset: firstWall("c1") });
    expect(await alice.receive("changes")).toMatchObject({ seq: 1, clientId: "alice", changeset: { id: "c1" } });
    expect(await alice.receive("ack")).toMatchObject({ changesetId: "c1", seq: 1 });

    const bob = await connect("bob", "Bob");
    bob.send({ type: "openProject", projectId: meta.id, generation: "g7" });
    const snapshot = await bob.receive("snapshot");
    expect(snapshot.seq).toBe(1);
    expect(Object.keys(snapshot.doc.walls)).toEqual(["op1/w0"]);
    expect(snapshot.versions.walls).toEqual({ "op1/w0": "c1" });
  });

  it("answers a submission over 1 MB with tooLarge", async () => {
    const alice = await connect("alice", "Alice");
    alice.send({ type: "createProject", requestId: "r1", name: "Apartment" });
    const { meta } = await alice.receive("projectCreated");
    alice.send({ type: "openProject", projectId: meta.id, generation: "g1" });
    await alice.receive("snapshot");
    const wall = firstWall("c2");
    const padded = { ...wall, patch: { ...wall.patch, puts: wall.patch.puts.map((p) => ({ ...p, entity: { ...p.entity, pad: "x".repeat(MAX_MESSAGE_BYTES) } })) } };
    alice.sendRaw(JSON.stringify({ type: "submit", projectId: meta.id, generation: "g1", changeset: padded }));
    expect(await alice.receive("rejected")).toMatchObject({ changesetId: "c2", reason: { kind: "tooLarge" } });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/server test ws-transport`
Expected: FAIL. Vitest cannot resolve `../src/adapters/ws-transport`.

- [x] **Step 3: Implement** `packages/server/src/adapters/ws-transport.ts`

```ts
import WebSocket, { WebSocketServer } from "ws";
import type { RawData } from "ws";
import { MAX_MESSAGE_BYTES } from "@fm/protocol";
import type { ServerApp } from "../app/server-app";

export type WsTransport = { port: number; close(): Promise<void> };

/**
 * Text frames in, JSON out; one app session per socket. The app does all parsing and validation.
 * Frames above maxPayload close the socket; below it, the app answers oversized messages with tooLarge (spec §7.2).
 */
export async function startWsTransport(app: ServerApp, opts: { port: number }): Promise<WsTransport> {
  const wss = new WebSocketServer({ port: opts.port, maxPayload: 16 * MAX_MESSAGE_BYTES });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });

  wss.on("connection", (socket: WebSocket) => {
    const session = app.connect({
      send: (msg) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
      },
      close: () => socket.close(1008, "protocol violation"),
    });
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        socket.close(1003, "text frames only");
        return;
      }
      session.receive(toText(data));
    });
    socket.on("error", () => socket.terminate());
    socket.on("close", () => session.close());
  });

  const address = wss.address();
  const port = typeof address === "object" && address !== null ? address.port : opts.port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
```

- [x] **Step 4: Run the test and see it pass**

Run: `pnpm --filter @fm/server test ws-transport`
Expected: PASS, 2 tests.

- [x] **Step 5: Write the composition root** `packages/server/src/main.ts`

```ts
import { domainValidator } from "./adapters/domain-validator";
import { createJsonFileRepository } from "./adapters/json-file-repository";
import { startWsTransport } from "./adapters/ws-transport";
import { createServerApp } from "./app/server-app";

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? "./data";

const app = createServerApp({
  repository: createJsonFileRepository(dataDir),
  validator: domainValidator,
  onFatal(error) {
    // Crash-only (spec §7.2): no ack, no rejection. The restart loop reloads the project files.
    console.error("[fm-server] fatal error; exiting so the restart loop reloads from disk", error);
    process.exit(1);
  },
});

const transport = await startWsTransport(app, { port });
console.log(`[fm-server] listening on ws://localhost:${transport.port} (data: ${dataDir})`);
```

- [x] **Step 6: Write the restart loop** `packages/server/scripts/dev-server.sh`

```sh
#!/bin/sh
# Crash-only server (spec §7.2): after every exit, wait 1 s and start again, reloading project files from disk.
# Ctrl+C stops the loop.
trap 'exit 130' INT TERM
cd "$(dirname "$0")/.." || exit 1
while true; do
  pnpm exec tsx src/main.ts
  echo "[fm-server] exited with status $?; restarting in 1 s" >&2
  sleep 1
done
```

In the root `package.json` `scripts`, add:

```json
"dev:server": "pnpm --filter @fm/server dev"
```

- [x] **Step 7: Write the manual smoke client** `packages/server/scripts/smoke.ts`

```ts
// Manual check for gate 6: pnpm --filter @fm/server exec tsx scripts/smoke.ts [ws://localhost:8787]
import WebSocket from "ws";

const url = process.argv[2] ?? "ws://localhost:8787";
const socket = new WebSocket(url);
socket.on("open", () => {
  socket.send(JSON.stringify({ type: "hello", clientId: "smoke", name: "Smoke" }));
  socket.send(JSON.stringify({ type: "createProject", requestId: "r1", name: `Smoke ${new Date().toISOString()}` }));
  socket.send(JSON.stringify({ type: "listProjects", requestId: "r2" }));
});
socket.on("message", (data) => console.log(data.toString()));
socket.on("close", (code) => {
  console.log(`closed ${code}`);
  process.exit(0);
});
socket.on("error", (error) => console.error(error.message));
setTimeout(() => socket.close(), 2000);
```

- [x] **Step 8: Run the server by hand**

Terminal 1, run: `pnpm dev:server`
Expected: `[fm-server] listening on ws://localhost:8787 (data: ./data)`.

Terminal 2, run: `pnpm --filter @fm/server exec tsx scripts/smoke.ts`
Expected: a `welcome` line, a `projectCreated` line and a `projects` line listing the new project, then `closed 1005`. The file `packages/server/data/<id>.json` exists and is git-ignored (`data/` in `.gitignore`).

Stop terminal 1 with Ctrl+C. Expected: the loop exits, with no restart message after the interrupt.

- [x] **Step 9: Record the finding.** Add to `docs/design-memory/implementation.md` with today's date. The `PORT`/`DATA_DIR` names already have a row from planning; keep that row (update it only if the names changed) and add the rest as a bullet under `## Tooling notes` (revised at review: no duplicate rows, section named):

> `startWsTransport` is async: the port is known only after `listening`, which tests need for `port: 0`. `ws` `maxPayload` is 16 × `MAX_MESSAGE_BYTES`, so 1–16 MB messages get `tooLarge` from the app; larger frames close the socket. `main.ts` reads `PORT` (default 8787) and `DATA_DIR` (default `./data`, relative to `packages/server` under `pnpm dev:server`).

Add a Sprint log row.

- [x] **Step 10: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/server/src/adapters/ws-transport.ts packages/server/src/main.ts packages/server/scripts packages/server/test/ws-transport.test.ts package.json docs/design-memory/implementation.md docs/plans/flatmate/phase-6-server.md
git commit -m "server: WebSocket transport, composition root and crash-only restart loop"
```

---

### Task 6.11: Crash-only restart tests

> **Trimmed (revised: lean mode, 2026-09-29).** Write only the test that a same-ID resend after a restart is acknowledged from the receipt (in-memory repository); skip the rest.

**Files:** `packages/server/test/crash-restart.test.ts`

This pins the acceptance scenario of spec §9: "After a server crash during a save, the same-ID resend is acknowledged from the receipt if the write reached disk, and processed normally otherwise". It also pins the server integration row, "restart reloads state and receipts (idempotency survives restart)". A restart is a new app over the same repository: the in-memory "disk", or the same directory.

These tests check behaviour that Tasks 6.5–6.8 already built, so they are expected to pass at once. If one fails, treat it as a bug: fix it, then record it in the Sprint log.

- [x] **Step 1: Write the test** `packages/server/test/crash-restart.test.ts`

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { createInMemoryRepository } from "../src/app/testing";
import { openProject, putJoint, room, setup } from "./helpers";

describe("crash-only restart (spec §7.2, §8, §9)", () => {
  it("save failed before reaching disk: no reply; after restart the same-ID resend is processed normally", async () => {
    const repository = createInMemoryRepository();
    const before = setup({ repository });
    const { alice, bob, projectId } = await room(before);
    const c1 = putJoint("c1", "j1", 1);
    repository.failNextSave(new Error("disk full"));
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await before.app.idle();
    expect(before.fatal).toHaveLength(1);
    expect([...alice.conn.take(), ...bob.conn.take()]).toEqual([]); // a crash is never a rejection

    const after = setup({ repository }); // restart: a new process over the same disk
    const alice2 = after.join("alice", "Alice");
    const snapshot = await openProject(after, alice2, projectId, "ga2");
    expect(snapshot.seq).toBe(0);
    expect(snapshot.doc.joints).toEqual({});
    alice2.conn.take();
    alice2.send({ type: "submit", projectId, generation: "ga2", changeset: c1 });
    await after.app.idle();
    expect(alice2.conn.take()).toEqual([
      { type: "changes", projectId, generation: "ga2", seq: 1, changeset: c1, clientId: "alice" },
      { type: "ack", projectId, generation: "ga2", changesetId: "c1", seq: 1 },
    ]);
  });

  it("save failed after the write reached disk: after restart the resend is acked from the receipt", async () => {
    const repository = createInMemoryRepository();
    const before = setup({ repository });
    const { alice, bob, projectId } = await room(before);
    const c1 = putJoint("c1", "j1", 1);
    repository.failNextSave(new Error("fsync failed"), { afterWrite: true });
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await before.app.idle();
    expect(before.fatal).toHaveLength(1);
    expect([...alice.conn.take(), ...bob.conn.take()]).toEqual([]);

    const after = setup({ repository });
    const alice2 = after.join("alice", "Alice");
    const snapshot = await openProject(after, alice2, projectId, "ga2");
    expect(snapshot.seq).toBe(1); // the disk decides: the write happened
    expect(snapshot.doc.joints).toEqual({ j1: { id: "j1", x: 1, y: 0 } });
    alice2.conn.take();
    alice2.send({ type: "submit", projectId, generation: "ga2", changeset: c1 });
    await after.app.idle();
    expect(alice2.conn.take()).toEqual([{ type: "ack", projectId, generation: "ga2", changesetId: "c1", seq: 1 }]); // no reapply, no broadcast
  });

  it("receipts in JSON files survive a restart (idempotency)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fm-crash-"));
    try {
      const before = setup({ repository: createJsonFileRepository(dir) });
      const { alice, projectId } = await room(before);
      const c1 = putJoint("c1", "j1", 1);
      alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
      await before.app.idle();
      expect(alice.conn.types()).toEqual(["changes", "ack"]);

      const after = setup({ repository: createJsonFileRepository(dir) });
      const alice2 = after.join("alice", "Alice");
      expect((await openProject(after, alice2, projectId, "ga2")).seq).toBe(1);
      alice2.conn.take();
      alice2.send({ type: "submit", projectId, generation: "ga2", changeset: c1 });
      alice2.send({ type: "submit", projectId, generation: "ga2", changeset: putJoint("c1", "j9", 9) });
      await after.app.idle();
      expect(alice2.conn.take()).toEqual([
        { type: "ack", projectId, generation: "ga2", changesetId: "c1", seq: 1 },
        { type: "rejected", projectId, generation: "ga2", changesetId: "c1", reason: { kind: "malformed", message: "Changeset ID reused with a different payload" } },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/server test crash-restart`
Expected: PASS, 3 tests.

- [x] **Step 3: Check and commit**

Run: `pnpm check`
Expected: all green.

```bash
git add packages/server/test/crash-restart.test.ts
git commit -m "server: restart tests settle crashed saves through receipts and same-ID resend"
```

---

### Task 6.12: Persistent-failure check (gate preparation)

> **Cut (revised: lean mode, 2026-09-29).** Skip; the gate notes the restart loop was seen working once by hand.

**Files:** none changed, unless the check reveals a bug. This task produces evidence for the gate report.

- [ ] **Step 1: Observe a normal crash and restart**

Terminal 1, run: `pnpm dev:server`
Terminal 2, run: `pnpm --filter @fm/server exec tsx scripts/smoke.ts`, then `pkill -f "tsx src/main.ts"`.
Expected in terminal 1: `[fm-server] exited with status …; restarting in 1 s`, then `listening` again. Running the smoke client again lists the projects created before the kill.

- [ ] **Step 2: Observe a persistent failure**

```bash
mkdir -p /tmp/fm-ro && chmod 555 /tmp/fm-ro
DATA_DIR=/tmp/fm-ro/data pnpm dev:server              # terminal 1
pnpm --filter @fm/server exec tsx scripts/smoke.ts    # terminal 2, run it twice
```

Expected:

- `hello` still gets `welcome`.
- `createProject` fails in `mkdir` with `EACCES`; terminal 1 logs `[fm-server] fatal error …`, then the restart message, then `listening` again.
- The smoke client sees its socket close with code 1006.

Each request that touches the repository crashes the server again. Nothing is acknowledged or rejected wrongly. Record this behaviour in the gate report (Gate 6, question 4), then clean up with `chmod 755 /tmp/fm-ro && rm -r /tmp/fm-ro`.

- [ ] **Step 3: Note the results** in the Sprint log (kind: evidence).

---

## Completion criteria

- [x] `parseClientMessage` enforces every structural rule of spec §4.1 and §7.9 j, and reports it as `malformed` naming the changeset when its ID is readable. Unknown message types and tables → `malformed`. Messages over 1 MB, measured in UTF-8 bytes → `tooLarge` (spec §7.2, §9 server row).
- [x] `parseServerMessage` round-trips every server message type; the phase 7 adapter can rely on it.
- [x] `decideSubmit` runs in the order of spec §7.3:
  - receipt mismatch → `malformed`;
  - matching receipt → `duplicate`;
  - failed expectations → `conflict` with the entities;
  - validator violations → `invalid`;
  - otherwise accept with `seq + 1`, stamped versions (tombstones included) and a receipt.
- [x] Acceptance scenarios (spec §9) pass:
  - delete, recreate, delete: an expectation for the first deletion fails;
  - only a never-used ID has a null version;
  - a retry after 1,000 other accepted changes gets its original `seq`, with no broadcast;
  - the same ID with a different payload is `malformed`.
- [x] The per-project queue serializes submissions: concurrent submits on one entity give first-writer-wins. Opening during a submission delivers the snapshot, then only consecutive changes.
- [x] The ack is sent only after `repository.save` resolves. `changes` goes to every subscriber, the sender included and each with its own generation, before the sender's `ack`.
- [x] Any repository error calls `onFatal` once. No `ack`, `rejected` or `changes` is sent, nothing is published, and the app stays silent afterwards (spec §7.2, §8).
- [x] Restart reloads state and receipts from the JSON files. A same-ID resend is acked from the receipt if the write reached disk, and processed normally if it did not.
- [x] A leftover `*.tmp` file is ignored on load, and unsafe project IDs load as `null`.
- [x] `server/src/app` imports no `@fm/domain`; only `adapters/domain-validator.ts` does (`pnpm depcruise` clean).
- [x] With `@types/node` installed, core `src` still fails typecheck on `process` (Task 6.4 Step 7), and the domain's `isValidId` delegates to `isWireId` (Task 6.1 Step 5). (revised at review)
- [x] The real-socket test passes: create, open, submit, `changes` + `ack`, and a second client's snapshot.
- [x] `pnpm dev:server` restarts after an exit; the persistent-failure behaviour is observed and noted. (Restart seen once at the gate; the persistent-failure run was cut with Task 6.12.)
- [x] `pnpm check` passes.

## Gate 6

Follow the [gate protocol](README.md#gate-protocol). Phase-specific verification:

- `pnpm check`
- `pnpm --filter @fm/server test` (record the test count per file)
- `pnpm --filter @fm/protocol test messages`
- The manual runs from Tasks 6.10 (Step 8) and 6.12.

Demo status: no demo step is visible in a browser yet. The server side of steps 1, 7 and 8 exists; record it as "server ready, client in phase 7".

The report (`docs/reports/gate-6-server.md`) must answer:

1. **Ordering.** Is the per-project queue the only place that orders project work? List every path that reads or writes `LiveProject.state` or `subscribers`, and say whether it runs inside the queue.
   - Expected answers:
     - `leave` and `presence` run outside the queue, on purpose;
     - `createProject` sets `live` from the workspace queue, before anyone knows the ID;
     - everything else runs inside the project queue.
   - Confirm that no open/submit race remains.
2. **Durability on macOS.** What does "persistence completed" mean here? Check what `FileHandle.sync()` does on macOS for the Node version in `.nvmrc` (libuv's `uv_fs_fsync`: plain `fsync` or `F_FULLFSYNC`), and whether the directory sync works or falls into the ignored error codes. Word the conclusion without overclaiming (collaboration.md Don't: no universal power-loss durability), and record it in `implementation.md`.
3. **Message validation gaps.** What does the protocol parser still accept that the server later rejects or trusts? Examples:
   - entity field shapes, which are left to the domain validator;
   - expectations of entities unrelated to the patch;
   - presence selections naming entities that do not exist.
   Also cover what happens between 1 MB and the 16 MB `maxPayload`, and above it. Say whether any gap can put an invalid document into a project, which should be impossible because the validator sees the whole result.
4. **Persistent failure.** Describe how the restart loop behaved in Task 6.12, including what a client in phase 7 will experience (reconnect with backoff, then crash again on the next repository access). State whether that is acceptable for the demo, as spec §7.2 says it is.
5. **Risks for phase 7.** Protocol details the editor must respect:
   - generations must be unique per open;
   - resends go out only after the snapshot;
   - `openFailed` (with the request's project and generation) for an unknown project, and `error` never ends an open;
   - presence is not replayed on join.
   Also note any contract extension below that phase 7 must use.

## Contract extensions

- `@fm/protocol` also exports:
  - `MAX_NAME_CHARS` (200);
  - `isWireId(v): v is string`, the one ID pattern; the domain's `isValidId` delegates to it from Task 6.1 Step 5 (revised at review);
  - `utf8Length(s)`;
  - `parseProjectMeta`, `parseStoredDocument`, `parseVersionMap`.
- `Connection` has a required `close(): void`, used when the first message is not `hello`. Phase 7's in-memory connections must implement it.
- `startWsTransport(app, { port })` returns `Promise<WsTransport>` (`WsTransport = { port: number; close(): Promise<void> }`) instead of a plain object: the port is known only after `listening`.
- `InMemoryRepository` type: `failNextSave(error, opts?: { afterWrite?: boolean })` takes an optional second parameter. `createInMemoryRepository()` and the JSON repository both list projects sorted by name, then ID (`byNameThenId`, exported from `app/ports.ts`).
- `server-app.ts` also exports `ServerAppDeps` and `PRESENCE_COLORS`. `KeyedQueue` has `idle(): Promise<void>`.
- `packages/server/test/helpers.ts` provides `setup`, `room`, `FakeConnection`, `putJoint`, `deleteJoint`, `acceptAll`, `rejectX99`, `gatedRepository`, `createProject`, `openProject` and `tick`. They are test-only; phase 7's `sync-tests` should build its own on `createServerApp` and `createInMemoryRepository`.

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-29 | all | process | Lean mode: waves {6.1→6.3, 6.4} · {6.5→6.6, 6.9} · {6.7, 6.8} · {6.10→6.11}; reviews of parsers + decideSubmit and of server app + JSON repository | 3 fixes below | `process.md` |
| 2026-09-29 | 6.1–6.3 | bug (review) | The parser threw on `"table": {"toString": 1}` (`String()` on an untrusted object), and kept unchecked entity fields: an extra field was stored and broadcast, and a 200,000-level nested one overflowed the stack in the queued submit → crash, and again after every same-ID resend | Parsers never stringify untrusted values; entity values must be primitives or flat objects; domain `parse*` reject unknown keys (local files with extra entity fields are now refused) | `process.md` lesson 29, `domain-geometry.md` |
| 2026-09-29 | 6.8 | bug (review) | On case-insensitive file systems `load("ABC…")` read `abc….json`: a second live copy with its own queue could overwrite an acked change | `load` returns null unless the stored `meta.id` equals the requested ID | `process.md` lesson 29 |
| 2026-09-29 | 6.11 | trimmed | Only the two in-memory restart cases (save fails before / after the write) | Both passed at once | none |
| 2026-09-29 | 6.12 | cut | Persistent-failure check cut; restart loop observed once at the gate (`exited with status 143; restarting in 1 s`) | none | none |
