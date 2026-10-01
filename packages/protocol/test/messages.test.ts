import { describe, expect, it } from "vitest";
import type { Changeset } from "../src/patch";
import { isWireId, MAX_MESSAGE_BYTES, parseClientMessage, parseServerMessage, utf8Length, validateChangeset } from "../src/messages";
import type { ClientMessage, ParseFailure, ServerMessage } from "../src/messages";

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

describe("isWireId", () => {
  it("accepts plain IDs and refuses Object.prototype member names", () => {
    expect(isWireId("p1/j0")).toBe(true);
    expect(isWireId("constructor")).toBe(false);
    expect(isWireId("__proto__")).toBe(false);
  });
});

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
    ["a non-string table", { ...base, patch: { puts: [{ table: { toString: 1 }, entity: { id: "j1" } }], deletes: [] } }, "unknown table"],
    [
      "an entity with a nested array field",
      { ...base, patch: { puts: [{ table: "joints", entity: { id: "j1", x: 0, y: 0, extra: [[1]] } }], deletes: [] } },
      "put entity fields must be primitives or flat objects",
    ],
    [
      "an entity with an object nested two levels",
      { ...base, patch: { puts: [{ table: "joints", entity: { id: "j1", x: 0, y: 0, extra: { a: { b: 1 } } } }], deletes: [] } },
      "put entity fields must be primitives or flat objects",
    ],
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
    { type: "deleteProject", requestId: "r3", projectId: "p1" },
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
      "a delete with a bad project id",
      JSON.stringify({ type: "deleteProject", requestId: "r3", projectId: "../p1 " }),
      { reason: { kind: "malformed", message: "Invalid deleteProject" }, changesetId: null },
    ],
    [
      "a delete without a request id",
      JSON.stringify({ type: "deleteProject", projectId: "p1" }),
      { reason: { kind: "malformed", message: "Invalid deleteProject" }, changesetId: null },
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

  it("rejects a non-string table without throwing", () => {
    const raw = submit({ ...base, patch: { puts: [{ table: { toString: 1 }, entity: { id: "j1" } }], deletes: [] } });
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: { reason: { kind: "malformed", message: "unknown table" }, changesetId: "c1" } });
  });

  it("rejects a deeply nested entity field without throwing", () => {
    const depth = 200_000;
    const deep = `${"[".repeat(depth)}${"]".repeat(depth)}`; // too deep for recursive canonicalJson
    const raw = submit(withNote("n")).replace('"note":"n"', `"note":${deep}`);
    expect(utf8Length(raw)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(raw)).toEqual({
      ok: false,
      error: { reason: { kind: "malformed", message: "put entity fields must be primitives or flat objects" }, changesetId: "c1" },
    });
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
    ["\u{1F600}", 4],
  ])("utf8Length(%s) is %i", (text, bytes) => {
    expect(utf8Length(text)).toBe(bytes);
  });
});

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
    { type: "projectDeleted", ...target },
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
    ["a projectDeleted without a generation", { type: "projectDeleted", projectId: "p1" }],
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
