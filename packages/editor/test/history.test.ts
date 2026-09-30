import { describe, expect, it } from "vitest";
import { applyPatch, execute, unwrap, type Document } from "@fm/domain";
import { patchWrites, type EntityKey, type Point } from "@fm/protocol";
import {
  REMOTE_REDO, REMOTE_UNDO, applyHistoryNotice, canRedo, canUndo, emptyHistory, entryDependencies, prepareRedo, prepareUndo,
  recordCommit, startRequest, type HistoryState,
} from "../src/history/history";
import { jointAt, roomDoc } from "./builders";

const doc0 = roomDoc();
const corner = jointAt(doc0, { x: 6, y: 4 });
const origin = jointAt(doc0, { x: 0, y: 0 });

function move(doc: Document, jointId: string, to: Point) {
  return unwrap(execute(doc, { type: "moveJoints", moves: [{ jointId, to }] }));
}

const m1 = move(doc0, corner, { x: 6, y: 4.6 });
const accepted = (h: HistoryState, id: string) => applyHistoryNotice(h, { type: "accepted", id });

describe("history", () => {
  it("records a pending entry and clears redo", () => {
    const withRedo: HistoryState = { ...emptyHistory, future: [{ id: "old", patch: m1.patch, dependencies: [], status: "usable" }] };
    const h = recordCommit(withRedo, "c1", m1.patch);
    expect(h.past.map((e) => [e.id, e.status])).toEqual([["c1", "pending"]]);
    expect(h.future).toEqual([]);
    expect(canUndo(h)).toBe(false);
  });

  it("makes the entry usable on acceptance", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    expect(h.past[0]?.status).toBe("usable");
    expect(canUndo(h)).toBe(true);
  });

  it("prepares the inverse patch with the entry's dependencies", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const r = unwrap(prepareUndo(h, m1.doc));
    expect(unwrap(applyPatch(m1.doc, r.patch))).toEqual(doc0);
    expect(r.dependencies).toContainEqual({ table: "joints", id: corner });
  });

  it("refuses to undo when the written values changed", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const moved = move(m1.doc, corner, { x: 6, y: 5 }).doc;
    expect(prepareUndo(h, moved)).toEqual({ ok: false, error: REMOTE_UNDO });
  });

  it("moves the entry to redo only when the undo request is accepted", () => {
    const h1 = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const h2 = startRequest(h1, { direction: "undo", id: "u1" });
    expect([h2.past.map((e) => e.id), h2.future]).toEqual([["c1"], []]); // stays on its stack until acceptance (§7.5 step 4)
    expect(canUndo(h2)).toBe(false);
    expect(prepareUndo(h2, m1.doc).ok).toBe(false);
    const h3 = accepted(h2, "u1");
    expect(h3.past).toEqual([]);
    expect(h3.future.map((e) => e.id)).toEqual(["c1"]);
    expect(canRedo(h3)).toBe(true);
    const redo = unwrap(prepareRedo(h3, doc0));
    expect(redo.patch).toEqual({ puts: m1.patch.puts, deletes: m1.patch.deletes }); // no `before`/`dependencies` committed
    expect(redo.dependencies).toEqual(entryDependencies(m1.patch));
    expect(unwrap(applyPatch(doc0, redo.patch))).toEqual(m1.doc);
    expect(prepareRedo(h3, move(doc0, corner, { x: 6, y: 5 }).doc)).toEqual({ ok: false, error: REMOTE_REDO });
  });

  it("moves the entry back to undo only when the redo request is accepted, and discards it on rejection", () => {
    const undone = accepted(startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" }), "u1");
    const redoing = startRequest(undone, { direction: "redo", id: "r1" });
    expect([redoing.past, redoing.future.map((e) => e.id)]).toEqual([[], ["c1"]]);
    const redone = accepted(redoing, "r1");
    expect([redone.past.map((e) => [e.id, e.status]), redone.future, redone.pending]).toEqual([[["c1", "usable"]], [], null]);
    expect(canUndo(redone)).toBe(true);
    const reason = { kind: "conflict" as const, entities: [] };
    expect(applyHistoryNotice(redoing, { type: "rejected", id: "r1", reason })).toEqual({ past: [], future: [], pending: null });
  });

  it("waits for the server before undoing an unconfirmed edit", () => {
    expect(prepareUndo(recordCommit(emptyHistory, "c1", m1.patch), m1.doc)).toEqual({ ok: false, error: "Waiting for server" });
  });

  it("refuses redo while a request is pending or once the entry is invalid", () => {
    const undone = accepted(startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" }), "u1");
    expect(canRedo(undone)).toBe(true);
    const busy = startRequest(undone, { direction: "redo", id: "r1" });
    expect(canRedo(busy)).toBe(false);
    expect(prepareRedo(busy, doc0).ok).toBe(false);
    const invalid = applyHistoryNotice(undone, { type: "remoteChange", writes: [], topology: true });
    expect(canRedo(invalid)).toBe(false);
  });

  it("invalidates an entry when a remote change writes an entity the edit only read", () => {
    const add = unwrap(execute(doc0, { type: "addWall", opId: "w", from: { existing: corner }, to: { at: { x: 9, y: 4 } } }));
    const cornerKey: EntityKey = { table: "joints", id: corner };
    expect(add.patch.dependencies).toContainEqual(cornerKey);
    expect(patchWrites(add.patch)).not.toContainEqual(cornerKey); // only the semantic dependency links the entry to the corner
    const h = accepted(recordCommit(emptyHistory, "a1", add.patch), "a1");
    const after = applyHistoryNotice(h, { type: "remoteChange", writes: [cornerKey], topology: false });
    expect(after.past.map((e) => e.status)).toEqual(["invalid"]);
  });

  it("refuses to record a commit while a history request is pending", () => {
    const requested = startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" });
    const m2 = move(m1.doc, origin, { x: -0.4, y: 0 });
    expect(() => recordCommit(requested, "c2", m2.patch)).toThrow("commit while a history request is pending");
  });

  it("checks absence on undo and depends on the entities an edit created", () => {
    const add = unwrap(execute(doc0, { type: "addWall", opId: "w", from: { at: { x: 10, y: 0 } }, to: { at: { x: 12, y: 0 } } }));
    const wall = Object.keys(add.doc.walls).find((id) => !(id in doc0.walls)) ?? "";
    const del = unwrap(execute(add.doc, { type: "deleteEntities", ids: [{ table: "walls", id: wall }] }));
    const h = accepted(recordCommit(emptyHistory, "d1", del.patch), "d1");
    expect(prepareUndo(h, del.doc).ok).toBe(true);
    expect(prepareUndo(h, add.doc)).toEqual({ ok: false, error: REMOTE_UNDO });
    const created = accepted(recordCommit(emptyHistory, "a1", add.patch), "a1");
    const after = applyHistoryNotice(created, { type: "remoteChange", writes: [{ table: "walls", id: wall }], topology: false });
    expect(after.past.map((e) => e.status)).toEqual(["invalid"]);
  });

  it("invalidates redo entries too, and acceptance never revalidates an entry", () => {
    const h = startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" });
    const undone = applyHistoryNotice(accepted(h, "u1"), { type: "remoteChange", writes: [{ table: "joints", id: corner }], topology: false });
    expect(undone.future.map((e) => e.status)).toEqual(["invalid"]);
    expect(prepareRedo(undone, doc0)).toEqual({ ok: false, error: REMOTE_REDO });
    const invalidPending = applyHistoryNotice(recordCommit(emptyHistory, "c1", m1.patch), { type: "remoteChange", writes: [], topology: true });
    expect(accepted(invalidPending, "c1").past.map((e) => e.status)).toEqual(["invalid"]);
  });

  it("removes a rejected edit and discards a rejected history request", () => {
    const reason = { kind: "conflict" as const, entities: [] }; // not `as const` on the object: a readonly [] is not an EntityKey[]
    const pending = recordCommit(emptyHistory, "c1", m1.patch);
    expect(applyHistoryNotice(pending, { type: "rejected", id: "c1", reason }).past).toEqual([]);
    const requested = startRequest(accepted(pending, "c1"), { direction: "undo", id: "u1" });
    const after = applyHistoryNotice(requested, { type: "rejected", id: "u1", reason });
    expect(after).toEqual({ past: [], future: [], pending: null });
  });

  it("keeps a usable entry when a stray rejection names it", () => {
    const reason = { kind: "conflict" as const, entities: [] };
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    expect(applyHistoryNotice(h, { type: "rejected", id: "c1", reason })).toEqual(h);
    // The usual conflict: a remote write invalidates the unconfirmed edit, then the server rejects it.
    const invalidated = applyHistoryNotice(recordCommit(h, "c2", m1.patch), { type: "remoteChange", writes: [], topology: true });
    expect(applyHistoryNotice(invalidated, { type: "rejected", id: "c2", reason }).past.map((e) => e.id)).toEqual(["c1"]);
  });

  it("invalidates only entries whose dependencies overlap a remote write", () => {
    const m2 = move(m1.doc, origin, { x: -0.4, y: 0 });
    let h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    h = accepted(recordCommit(h, "c2", m2.patch), "c2");
    const after = applyHistoryNotice(h, { type: "remoteChange", writes: [{ table: "joints", id: corner }], topology: false });
    expect(after.past.map((e) => e.status)).toEqual(["invalid", "usable"]);
  });

  it("invalidates everything on a remote topology change and clears on resync", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const topo = applyHistoryNotice(h, { type: "remoteChange", writes: [], topology: true });
    expect(topo.past.map((e) => e.status)).toEqual(["invalid"]);
    expect(prepareUndo(topo, m1.doc)).toEqual({ ok: false, error: REMOTE_UNDO });
    expect(applyHistoryNotice(h, { type: "resynced" })).toEqual(emptyHistory);
    expect(applyHistoryNotice(h, { type: "offline" })).toBe(h);
  });

  it("drops an undone entry that was invalidated while its request was pending", () => {
    const h = startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" });
    const invalidated = applyHistoryNotice(h, { type: "remoteChange", writes: [], topology: true });
    expect(accepted(invalidated, "u1")).toEqual({ past: [], future: [], pending: null });
  });

  it("explains an empty stack", () => {
    expect(prepareUndo(emptyHistory, doc0)).toEqual({ ok: false, error: "Nothing to undo" });
    expect(prepareRedo(emptyHistory, doc0)).toEqual({ ok: false, error: "Nothing to redo" });
  });
});
