import { describe, expect, it } from "vitest";
import { execute, toStored, unwrap } from "@fm/domain";
import { MAX_MESSAGE_BYTES, MAX_UNDERLAY_DATA_CHARS, utf8Length, type RejectReason } from "@fm/protocol";
import { runCommand } from "../src/commit";
import { createLocalDocument } from "../src/document/local-document";
import { canCommit, commit, hasPendingEdit, isDirty, sessionOf, status, visibleDoc } from "../src/document/open-document";
import { sharedCanCommit, sharedCommit, sharedFromSnapshot, sharedOnEvent, sharedStatus } from "../src/document/shared-document";
import { jointAt, localState, pointOf, roomDoc } from "./builders";
import { FakeHost } from "./fake-shell";
import { PROJECT, changesetFor, checkConsistent, ev, inFlightOf, moveInput, pending, shared, versionsFor } from "./shared-builders";

describe("SharedDocument: creation and commits (spec: collaboration)", () => {
  it("opens from a snapshot: connected, editable, visible = the snapshot's document", () => {
    const doc = roomDoc();
    const d = sharedFromSnapshot({
      type: "snapshot", projectId: PROJECT.id, generation: "g1", meta: PROJECT,
      doc: toStored(doc), versions: versionsFor(doc, "c0"), seq: 7,
    });
    expect(d).toMatchObject({ kind: "shared", project: PROJECT, generation: "g1", inFlight: null, connection: "connected" });
    expect(d.visible).toEqual(doc);
    expect(d.confirmed.seq).toBe(7);
    expect(sharedCanCommit(d)).toBe(true);
    expect(sharedStatus(d)).toBe("saved");
    checkConsistent(d);
  });

  it("a commit sets inFlight, shows the edit at once and submits it with expectations from the confirmed versions", () => {
    const d = shared();
    const corner = jointAt(d.visible, { x: 6, y: 4 });
    const r = sharedCommit(d, moveInput(d, { x: 6, y: 4.6 }, "c1"));
    expect(r.notices).toEqual([]);
    const submit = r.effects[0];
    if (r.effects.length !== 1 || submit?.type !== "submit") throw new Error("expected exactly one submit effect");
    expect(submit).toMatchObject({ projectId: "p1", generation: "g1", changeset: { id: "c1" } });
    // the moved joint and its two incident walls, each at the confirmed version
    expect(submit.changeset.expect).toHaveLength(3);
    expect(submit.changeset.expect).toContainEqual({ table: "joints", id: corner, lastCs: "c0" });
    expect(submit.changeset.expect.every((e) => e.lastCs === "c0")).toBe(true);
    expect(r.doc.inFlight).toEqual(submit.changeset);
    expect(r.doc).not.toBe(d); // undoRedo tells a submitted request from a refused one by a new object
    expect(pointOf(r.doc.visible, corner)).toEqual({ x: 6, y: 4.6 });
    expect(pointOf(r.doc.confirmed.doc, corner)).toEqual({ x: 6, y: 4 });
    expect(sharedCanCommit(r.doc)).toBe(false);
    expect(sharedStatus(r.doc)).toBe("waiting for server");
    checkConsistent(r.doc);
  });

  it("a commit whose message would exceed 1 MB is refused locally with the server's reason", () => {
    const d = shared();
    const name = "x".repeat(1_000_001);
    const r = sharedCommit(d, {
      id: "c9",
      patch: { puts: [{ table: "zoneLabels", entity: { id: "l1", at: { x: 1, y: 1 }, name, finish: null } }], deletes: [] },
      dependencies: [],
    });
    expect(r.doc).toBe(d);
    expect(r.effects).toEqual([]);
    expect(r.notices).toEqual([{ type: "rejected", id: "c9", reason: { kind: "tooLarge" } }]);
  });

  it("runCommand submits the value patch only, with the command's semantic dependencies as expectations", () => {
    const host = new FakeHost();
    const state = { ...localState(host, roomDoc()), mode: "server" as const, document: shared() };
    const r = runCommand(state, { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Room 1", finish: null }, host);
    const submit = r.effects.find((e) => e.type === "submit"); // finishCommit keeps the document's effects
    if (submit?.type !== "submit") throw new Error("expected a submit effect");
    expect(Object.keys(submit.changeset.patch).sort()).toEqual(["deletes", "puts"]);
    // the new label plus the room's four walls and four joints it depends on
    expect(submit.changeset.expect).toHaveLength(9);
    expect(submit.changeset.expect).toContainEqual({ table: "zoneLabels", id: "L1", lastCs: null });
    const corner = jointAt(roomDoc(), { x: 6, y: 4 });
    expect(submit.changeset.expect).toContainEqual({ table: "joints", id: corner, lastCs: "c0" });
    expect(submit.changeset.expect.filter((e) => e.table === "walls")).toHaveLength(4);
  });
});

describe("open-document with a shared document", () => {
  it("answers every query through the one kind switch", () => {
    const ready = shared();
    const waiting = pending();
    const syncing = shared({ connection: "syncing" });
    const offline = { ...pending(), connection: "offline" as const };
    const row = (d: typeof ready) => [canCommit(d), status(d), isDirty(d), hasPendingEdit(d)];
    expect(row(ready)).toEqual([true, "saved", false, false]);
    expect(row(waiting)).toEqual([false, "waiting for server", true, true]);
    expect(row(syncing)).toEqual([false, "waiting for server", false, false]);
    expect(row(offline)).toEqual([false, "offline", true, true]);
    expect(visibleDoc(waiting)).toBe(waiting.visible);
  });

  it("refuses a commit while the document cannot accept edits", () => {
    const input = moveInput(shared(), { x: 6, y: 5 }, "c2"); // built before the pending edit moved the corner
    expect(() => commit(pending(), input)).toThrow("cannot accept edits");
  });

  it("exposes the session a shared document belongs to, and none for a local one", () => {
    expect(sessionOf(shared())).toEqual({ projectId: "p1", generation: "g1", connected: true });
    expect(sessionOf(shared({ connection: "syncing" }))?.connected).toBe(false);
    expect(sessionOf(createLocalDocument({ id: "local", name: "Untitled" }, "open1"))).toBeNull();
  });
});

describe("SharedDocument: server events (spec: collaboration table)", () => {
  const host = () => new FakeHost();
  const cornerOf = (d: ReturnType<typeof shared>) => jointAt(d.confirmed.doc, { x: 6, y: 4 });
  const originOf = (d: ReturnType<typeof shared>) => jointAt(d.confirmed.doc, { x: 0, y: 0 });

  /** Bob's move of the room's (0,0) joint, built on d's confirmed versions. */
  function bobMovesOrigin(d: ReturnType<typeof shared>, id = "b1") {
    return changesetFor(d.confirmed.doc, d.confirmed.versions, { type: "moveJoints", moves: [{ jointId: originOf(d), to: { x: -0.4, y: 0 } }] }, id);
  }

  it("own consecutive changes: applied to confirmed, overlay gone, still in flight until ack, no notice", () => {
    const d = pending();
    const r = sharedOnEvent(d, ev.changes(d, inFlightOf(d), 43, "tab1"), host());
    expect([r.effects, r.notices]).toEqual([[], []]);
    expect(r.doc.confirmed.seq).toBe(43);
    expect(pointOf(r.doc.confirmed.doc, cornerOf(d))).toEqual({ x: 6, y: 4.6 });
    expect(r.doc.confirmed.versions.joints[cornerOf(d)]).toBe("c1");
    expect(r.doc.visible).toBe(r.doc.confirmed.doc);
    expect(r.doc.inFlight?.id).toBe("c1");
    expect(sharedCanCommit(r.doc)).toBe(false);
    checkConsistent(r.doc);
  });

  it("matching ack at or below confirmed seq: settles, accepted, editable again; values are not reapplied", () => {
    const d = pending();
    const echoed = sharedOnEvent(d, ev.changes(d, inFlightOf(d), 43, "tab1"), host()).doc;
    const r = sharedOnEvent(echoed, ev.ack(echoed, "c1", 43), host());
    expect(r.notices).toEqual([{ type: "accepted", id: "c1" }]);
    expect(r.doc.inFlight).toBeNull();
    expect(r.doc.confirmed).toBe(echoed.confirmed);
    expect(sharedCanCommit(r.doc)).toBe(true);
    expect(sharedStatus(r.doc)).toBe("saved");
  });

  it("remote consecutive changes: applied, remoteChange with the writes; a move is not a topology change", () => {
    const d = shared();
    const r = sharedOnEvent(d, ev.changes(d, bobMovesOrigin(d), 43), host());
    expect(r.notices).toEqual([{ type: "remoteChange", writes: [{ table: "joints", id: originOf(d) }], topology: false }]);
    expect(pointOf(r.doc.visible, originOf(d))).toEqual({ x: -0.4, y: 0 });
    expect(r.doc.confirmed.versions.joints[originOf(d)]).toBe("b1");
    checkConsistent(r.doc);
  });

  it("a remote addWall is a topology change", () => {
    const d = shared();
    const cs = changesetFor(d.confirmed.doc, d.confirmed.versions, { type: "addWall", opId: "bob", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } }, "b1");
    const r = sharedOnEvent(d, ev.changes(d, cs, 43), host());
    const notice = r.notices[0];
    expect(notice?.type === "remoteChange" && notice.topology).toBe(true);
    expect(notice?.type === "remoteChange" && notice.writes).toContainEqual({ table: "walls", id: "bob/w0" });
  });

  it("a remote change that breaks the overlay's expectations hides the edit but keeps it in flight", () => {
    const d = pending();
    const bob = changesetFor(d.confirmed.doc, d.confirmed.versions, { type: "moveJoints", moves: [{ jointId: cornerOf(d), to: { x: 6, y: 5 } }] }, "b1");
    const r = sharedOnEvent(d, ev.changes(d, bob, 43), host());
    expect(pointOf(r.doc.visible, cornerOf(d))).toEqual({ x: 6, y: 5 });
    expect(r.doc.visible).toBe(r.doc.confirmed.doc);
    expect(r.doc.inFlight?.id).toBe("c1");
    expect(r.notices.map((n) => n.type)).toEqual(["remoteChange"]);
  });

  it("duplicate changes are ignored", () => {
    const d = shared({ seq: 42 });
    expect(sharedOnEvent(d, ev.changes(d, bobMovesOrigin(d), 42), host()).doc).toBe(d);
  });

  it("a sequence gap requests a snapshot under a new generation and blocks editing", () => {
    const d = shared();
    const r = sharedOnEvent(d, ev.changes(d, bobMovesOrigin(d), 44), host());
    expect(r.doc).toMatchObject({ connection: "syncing", generation: "id1" });
    expect(r.doc.confirmed).toBe(d.confirmed);
    expect(r.effects).toEqual([{ type: "workspace", op: { type: "open", projectId: "p1", generation: "id1" } }]);
    expect(r.notices).toEqual([]);
    expect(sharedCanCommit(r.doc)).toBe(false);
  });

  it("a matching ack ahead of confirmed seq is ignored and requests one snapshot; the edit stays in flight", () => {
    const d = pending();
    const r1 = sharedOnEvent(d, ev.ack(d, "c1", 43), host());
    expect(r1.doc).toMatchObject({ connection: "syncing", generation: "id1" });
    expect(r1.doc.inFlight?.id).toBe("c1");
    expect(r1.notices).toEqual([]);
    expect(r1.effects).toEqual([{ type: "workspace", op: { type: "open", projectId: "p1", generation: "id1" } }]);
    const r2 = sharedOnEvent(r1.doc, ev.ack(r1.doc, "c1", 43), host());
    expect(r2.doc).toBe(r1.doc);
    expect(r2.effects).toEqual([]);
  });

  it("unrelated acks and rejections change nothing", () => {
    const d = pending();
    const conflict: RejectReason = { kind: "conflict", entities: [] };
    expect(sharedOnEvent(d, ev.ack(d, "c9", 42), host()).doc).toBe(d);
    expect(sharedOnEvent(d, ev.rejected(d, "c9", conflict), host()).doc).toBe(d);
    const idle = shared();
    expect(sharedOnEvent(idle, ev.ack(idle, "c1", 42), host()).doc).toBe(idle);
  });

  it("a matching rejection clears inFlight, removes the overlay and reports the reason", () => {
    const d = pending();
    const reason: RejectReason = { kind: "conflict", entities: [{ table: "joints", id: cornerOf(d) }] };
    const r = sharedOnEvent(d, ev.rejected(d, "c1", reason), host());
    expect(r.doc.inFlight).toBeNull();
    expect(r.doc.visible).toBe(r.doc.confirmed.doc);
    expect(r.notices).toEqual([{ type: "rejected", id: "c1", reason }]);
    expect(sharedCanCommit(r.doc)).toBe(true);
  });

  it("ignores events from an older generation or another project", () => {
    const d = pending();
    expect(sharedOnEvent(d, ev.ack(d, "c1", 42, "g0"), host()).doc).toBe(d);
    expect(sharedOnEvent(d, { ...ev.ack(d, "c1", 42), projectId: "p2" }, host()).doc).toBe(d);
    expect(sharedOnEvent(d, ev.snapshot(d, { generation: "g0" }), host()).doc).toBe(d);
  });

  it("a disconnect keeps the outstanding edit, blocks editing and cancels gestures once", () => {
    const d = pending();
    const r = sharedOnEvent(d, { type: "connection", state: "closed" }, host());
    expect(r.doc.connection).toBe("offline");
    expect(r.doc.inFlight?.id).toBe("c1");
    expect(r.notices).toEqual([{ type: "offline" }]);
    expect(sharedStatus(r.doc)).toBe("offline");
    expect(sharedOnEvent(r.doc, { type: "connection", state: "closed" }, host()).notices).toEqual([]);
  });

  it("a reconnect reopens the project under a new generation", () => {
    const offline = sharedOnEvent(pending(), { type: "connection", state: "closed" }, host()).doc;
    const r = sharedOnEvent(offline, { type: "connection", state: "open" }, host());
    expect(r.doc).toMatchObject({ connection: "syncing", generation: "id1" });
    expect(r.effects).toEqual([{ type: "workspace", op: { type: "open", projectId: "p1", generation: "id1" } }]);
  });

  it("a snapshot with an outstanding edit replaces confirmed, resyncs and resends it with the same ID", () => {
    const d = pending();
    const syncing = { ...d, connection: "syncing" as const, generation: "g2" };
    const r = sharedOnEvent(syncing, ev.snapshot(syncing, { seq: 50 }), host());
    expect(r.doc.confirmed.seq).toBe(50);
    expect(r.doc.connection).toBe("connected");
    expect(r.notices).toEqual([{ type: "resynced" }]);
    expect(r.effects).toEqual([{ type: "submit", projectId: "p1", generation: "g2", changeset: inFlightOf(d) }]);
    expect(pointOf(r.doc.visible, cornerOf(d))).toEqual({ x: 6, y: 4.6 }); // its expectations still hold: overlay shown
    expect(sharedCanCommit(r.doc)).toBe(false);
    checkConsistent(r.doc);
  });

  it("a snapshot without an outstanding edit makes the document editable", () => {
    const syncing = shared({ connection: "syncing" });
    const moved = unwrap(execute(syncing.confirmed.doc, { type: "moveJoints", moves: [{ jointId: originOf(syncing), to: { x: -0.4, y: 0 } }] })).doc;
    const r = sharedOnEvent(syncing, ev.snapshot(syncing, { doc: moved, seq: 60 }), host());
    expect(r.effects).toEqual([]);
    expect(r.notices).toEqual([{ type: "resynced" }]);
    expect(r.doc.visible).toEqual(moved);
    expect(sharedCanCommit(r.doc)).toBe(true);
  });

  it("identity, failed-open and presence events do not touch the document", () => {
    const d = shared();
    expect(sharedOnEvent(d, { type: "welcome", clientId: "tab1", color: "#e5484d" }, host()).doc).toBe(d);
    expect(sharedOnEvent(d, { type: "openFailed", projectId: "p1", generation: "g1", message: "Unknown project" }, host()).doc).toBe(d);
    expect(sharedOnEvent(d, { type: "presenceLeft", projectId: "p1", generation: "g1", clientId: "bob" }, host()).doc).toBe(d);
  });
});

describe("SharedDocument: the underlay at the size cap (import.14, AC-02)", () => {
  // The worst case the envelope headroom allows for: 128-char ids everywhere (ID_PATTERN's limit), a replace (so the
  // key has a 128-char lastCs) and 17-digit numbers.
  const long = "x".repeat(128);
  const before = unwrap(execute(roomDoc(), {
    type: "placeUnderlay", pictureId: "pic-1", data: "/9j/4AAQ", width: 1600, height: 900, at: { x: -3.25, y: 7.5 },
  })).doc;
  const d = { ...shared({ doc: before, versions: versionsFor(before, long), generation: long }), project: { id: long, name: "P" } };
  const replace = unwrap(execute(before, {
    type: "placeUnderlay", pictureId: long, data: "A".repeat(MAX_UNDERLAY_DATA_CHARS), width: 2000, height: 2000,
    at: { x: -1.2345678901234566e-7, y: -9876543.210987654 },
  })).patch;
  const input = { id: long, patch: { puts: replace.puts, deletes: replace.deletes }, dependencies: replace.dependencies };

  it("a replace put of an underlay at exactly MAX_UNDERLAY_DATA_CHARS with worst-case ids passes the submit check (AC-02)", () => {
    const r = sharedCommit(d, input);
    expect(r.notices).toEqual([]);
    const submit = r.effects[0];
    if (r.effects.length !== 1 || submit?.type !== "submit") throw new Error("expected exactly one submit effect");
    expect(submit.changeset.expect).toEqual([{ table: "underlays", id: "underlay", lastCs: long }]);
    const margin = MAX_MESSAGE_BYTES - utf8Length(JSON.stringify(submit));
    expect(margin).toBeGreaterThan(0); // 6,982 bytes when written: the envelope takes about 1 KB of the 8 KB headroom
  });

  it("the same commit with a MAX_MESSAGE_BYTES-char picture is refused tooLarge", () => {
    const puts = input.patch.puts.map((p) => ({ ...p, entity: { ...p.entity, data: "A".repeat(MAX_MESSAGE_BYTES) } }));
    const r = sharedCommit(d, { ...input, patch: { ...input.patch, puts } });
    expect(r.doc).toBe(d);
    expect(r.effects).toEqual([]);
    expect(r.notices).toEqual([{ type: "rejected", id: long, reason: { kind: "tooLarge" } }]);
  });
});
