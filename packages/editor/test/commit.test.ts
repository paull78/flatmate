import { describe, expect, it } from "vitest";
import { MESSAGES, execute, unwrap } from "@fm/domain";
import { runCommand, runHistory } from "../src/commit";
import { createLocalDocument } from "../src/document/local-document";
import { visibleDoc } from "../src/document/open-document";
import { recordCommit } from "../src/history/history";
import { applyNotices, rejectMessage } from "../src/notices";
import type { EditorState } from "../src/state";
import { jointAt, localState, roomDoc, serverState, wallBetween, wallDoc } from "./builders";
import { FakeHost } from "./fake-shell";

const addWall = { type: "addWall", opId: "w", from: { at: { x: 0, y: 0 } }, to: { at: { x: 2, y: 0 } } } as const;

/** A FakeHost that logs the IDs it hands out. */
class IdLog extends FakeHost {
  issued: string[] = [];
  override newId(): string {
    const id = super.newId();
    this.issued.push(id);
    return id;
  }
}

function doc(s: EditorState) {
  if (!s.document) throw new Error("no document");
  return visibleDoc(s.document);
}

describe("runCommand", () => {
  it("commits a valid command and records a usable history entry", () => {
    const host = new FakeHost();
    const out = runCommand(localState(host), addWall, host);
    expect(out.committed).not.toBeNull();
    expect(Object.keys(doc(out.state).walls)).toHaveLength(1);
    expect(out.state.undo.past.map((e) => [e.id, e.status])).toEqual([[out.committed, "usable"]]);
    expect(out.state.document?.kind === "local" && out.state.document.revision).toBe(1);
  });

  it("shows the domain error as a toast and changes nothing else", () => {
    const host = new FakeHost();
    const s = localState(host);
    const zero = { ...addWall, to: { at: { x: 0, y: 0 } } };
    const out = runCommand(s, zero, host);
    expect(out.committed).toBeNull();
    expect(out.state.document).toBe(s.document);
    expect(out.state.undo).toBe(s.undo);
    expect(out.state.toast?.text).toBe(MESSAGES.tooShort);
    expect(out.effects).toEqual([{ type: "startTimer", timerId: "toast", ms: 3000 }]);
  });

  it("skips a command that changes nothing", () => {
    const host = new FakeHost();
    const s = localState(host, roomDoc());
    const corner = jointAt(doc(s), { x: 6, y: 4 });
    const out = runCommand(s, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4 } }] }, host);
    expect(out.committed).toBeNull();
    expect(out.state).toBe(s);
  });

  it("does nothing without an open document", () => {
    const host = new FakeHost();
    const s = serverState(host);
    expect(runCommand(s, addWall, host)).toEqual({ state: s, effects: [], committed: null });
  });

  it("drops deleted entities from the selection", () => {
    const host = new FakeHost();
    const base = localState(host, roomDoc());
    const bottom = wallBetween(doc(base), { x: 0, y: 0 }, { x: 6, y: 0 });
    const s: EditorState = { ...base, selection: [{ table: "walls", id: bottom }] };
    const out = runCommand(s, { type: "deleteEntities", ids: s.selection }, host);
    expect(out.state.selection).toEqual([]);
  });
});

describe("runHistory", () => {
  it("undoes and redoes a local edit at once", () => {
    const host = new FakeHost();
    const drawn = runCommand(localState(host), addWall, host).state;
    const undone = runHistory(drawn, "undo", host).state;
    expect(doc(undone).walls).toEqual({});
    expect([undone.undo.past.length, undone.undo.future.length, undone.undo.pending]).toEqual([0, 1, null]);
    const redone = runHistory(undone, "redo", host).state;
    expect(doc(redone)).toEqual(doc(drawn));
    expect([redone.undo.past.length, redone.undo.future.length]).toEqual([1, 0]);
  });

  it("commits each undo and redo under a fresh ID from the host, never the entry's (§7.5 step 3)", () => {
    const host = new IdLog();
    const drawn = runCommand(localState(host), addWall, host);
    host.issued = [];
    const undone = runHistory(drawn.state, "undo", host).state;
    runHistory(undone, "redo", host);
    // With a shared document, reusing the entry's ID would let the server's receipt for it ack the request unapplied.
    expect(host.issued).toHaveLength(2);
    expect(host.issued).not.toContain(drawn.committed);
  });

  it("refuses an undo that would make the drawing invalid", () => {
    const host = new FakeHost();
    const start = unwrap(execute(wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 }), { type: "addWall", opId: "v", from: { at: { x: 1, y: 1 } }, to: { at: { x: 1, y: 3 } } })).doc;
    const end = jointAt(start, { x: 2, y: 0 });
    const moved = runCommand(localState(host, start), { type: "moveJoints", moves: [{ jointId: end, to: { x: 2, y: -2 } }] }, host).state;
    // A change outside this history (in phase 7, a remote move sharing no dependency): the vertical wall now reaches y = -0.5.
    const foot = jointAt(doc(moved), { x: 1, y: 1 });
    const other = unwrap(execute(doc(moved), { type: "moveJoints", moves: [{ jointId: foot, to: { x: 1, y: -0.5 } }] })).doc;
    const s: EditorState = { ...moved, document: createLocalDocument({ id: "local", name: "Untitled" }, "open1", other) };
    const out = runHistory(s, "undo", host); // would put the joint back at (2, 0), across the vertical wall
    expect(out.state.toast?.text).toBe(MESSAGES.crossing);
    expect(out.state.document).toBe(s.document);
    expect(out.state.undo).toBe(s.undo);
  });

  it("explains an empty history", () => {
    const host = new FakeHost();
    expect(runHistory(localState(host), "undo", host).state.toast?.text).toBe("Nothing to undo");
  });
});

describe("notices", () => {
  it("a rejection removes the pending entry and explains why", () => {
    const host = new FakeHost();
    const base = localState(host);
    const patch = { puts: [], deletes: [], before: [], dependencies: [] };
    const s: EditorState = { ...base, undo: recordCommit(base.undo, "c1", patch) };
    const reason = { kind: "conflict" as const, entities: [] }; // not `as const` on the object: a readonly [] is not an EntityKey[]
    const out = applyNotices(s, [{ type: "rejected", id: "c1", reason }], host);
    expect(out.state.undo.past).toEqual([]);
    expect(out.state.toast?.text).toBe(rejectMessage(reason));
  });

  it("an invalid rejection explains the broken invariant from the server's violation strings (§8)", () => {
    expect(rejectMessage({ kind: "invalid", violations: ["I5: walls cross"] })).toBe(MESSAGES.crossing);
    expect(rejectMessage({ kind: "invalid", violations: ["I9: whatever", " I2 : too short"] })).toBe(MESSAGES.tooShort);
    expect(rejectMessage({ kind: "invalid", violations: ["I9: whatever"] })).toBe("Rejected: the drawing would become invalid");
    expect(rejectMessage({ kind: "invalid", violations: [] })).toBe("Rejected: the drawing would become invalid");
  });
});
