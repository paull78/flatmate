import { describe, expect, it } from "vitest";
import { REMOTE_REDO, REMOTE_UNDO } from "../src/history/history";
import { jointAt, pointOf, roomDoc, wallBetween } from "./builders";
import { FakeRemote } from "./fake-remote";

/** The room open on a shared document, with the corner dragged to (6, 4.6) and accepted. */
function moved(): { r: FakeRemote; corner: string } {
  const r = FakeRemote.open(roomDoc());
  const corner = jointAt(r.doc, { x: 6, y: 4 });
  r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
  r.accept();
  return { r, corner };
}

describe("undo on a shared document (spec: collaboration)", () => {
  it("waits for the ordinary pending edit", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(r.shell.view().canUndo).toBe(false);
    r.shell.key("z", { meta: true });
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.shell.view().canUndo).toBe(true);
  });

  it("moves the entry between stacks only when the server accepts the undo", () => {
    const { r, corner } = moved();
    r.shell.key("z", { meta: true });
    expect(r.submits()).toHaveLength(2);
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4 }); // shown at once
    expect([r.shell.state.undo.past.length, r.shell.state.undo.future.length]).toEqual([1, 0]);
    expect(r.shell.state.undo.pending?.direction).toBe("undo");
    expect([r.shell.view().canUndo, r.shell.view().canRedo]).toEqual([false, false]);
    r.accept();
    expect([r.shell.state.undo.past.length, r.shell.state.undo.future.length]).toEqual([0, 1]);
    expect(r.shell.view().canRedo).toBe(true);
  });

  it("discards the entry when the server rejects the undo", () => {
    const { r, corner } = moved();
    r.shell.key("z", { meta: true });
    r.reject();
    expect(r.shell.state.undo).toEqual({ past: [], future: [], pending: null });
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(r.shell.view().toast).toBe("Someone else changed this first");
  });

  it("two moves, two undos and two redos through the server restore each state", () => {
    const r = FakeRemote.open(roomDoc());
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    const at = () => pointOf(r.shell.doc(), corner);
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    r.accept();
    r.shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5.2 });
    r.accept();
    for (const [mods, expected] of [
      [{ meta: true }, { x: 6, y: 4.6 }],
      [{ meta: true }, { x: 6, y: 4 }],
      [{ meta: true, shift: true }, { x: 6, y: 4.6 }],
      [{ meta: true, shift: true }, { x: 6, y: 5.2 }],
    ] as const) {
      r.shell.key("z", mods);
      r.accept();
      expect(at()).toEqual(expected);
    }
    expect(r.submits()).toHaveLength(6);
  });

  it("a remote write invalidates the entry even if a later remote move restores the values", () => {
    const { r, corner } = moved();
    r.remote({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 5 } }] });
    r.remote({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4.6 } }] });
    expect(r.shell.view().canUndo).toBe(false); // nothing usable is left: unavailable, as Try it step 8 says
    r.shell.key("z", { meta: true });
    expect(r.shell.view().toast).toBe(REMOTE_UNDO);
    expect(r.submits()).toHaveLength(1);
  });

  it("an unrelated remote move keeps history usable", () => {
    const { r } = moved();
    r.remote({ type: "moveJoints", moves: [{ jointId: jointAt(r.doc, { x: 0, y: 0 }), to: { x: -0.4, y: 0 } }] });
    r.shell.key("z", { meta: true });
    expect(r.submits()).toHaveLength(2);
  });

  it("a remote topology change invalidates all history, and a reconnect snapshot clears it", () => {
    const { r } = moved();
    r.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
    r.accept();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } });
    expect(r.shell.state.undo.past.map((e) => e.status)).toEqual(["invalid", "invalid"]);
    r.disconnect();
    r.reconnect();
    expect(r.shell.state.undo).toEqual({ past: [], future: [], pending: null });
  });

  // Carried over from phase 3 wave 3: recordCommit throws if a commit is recorded while a request is pending.
  describe("moving on past an entry that can't apply (fixes AC-03)", () => {
    /** Two accepted edits on far corners, so a remote edit of one leaves the other's entry usable. */
    function twoMoves() {
      const r = FakeRemote.open(roomDoc());
      const first = jointAt(r.doc, { x: 6, y: 4 });
      const second = jointAt(r.doc, { x: 0, y: 0 });
      r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
      r.accept();
      r.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
      r.accept();
      return { r, first, second };
    }
    const undo = (r: FakeRemote) => r.shell.key("z", { meta: true });

    it("a refused undo says why and drops that entry, and the next undo reaches the older one", () => {
      const { r, first, second } = twoMoves();
      r.remote({ type: "moveJoints", moves: [{ jointId: second, to: { x: -0.8, y: 0 } }] });
      expect(r.shell.view().canUndo).toBe(true); // a mouse user can move on too
      undo(r);
      expect(r.shell.view().toast).toBe(REMOTE_UNDO);
      expect(r.shell.state.undo.past).toHaveLength(1);
      expect(r.submits()).toHaveLength(2); // nothing was sent
      undo(r);
      expect(pointOf(r.shell.doc(), first)).toEqual({ x: 6, y: 4 });
      expect(pointOf(r.shell.doc(), second)).toEqual({ x: -0.8, y: 0 });
    });

    it("one press clears every unusable entry on top, so it says so once", () => {
      const { r } = twoMoves();
      r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } });
      undo(r);
      expect(r.shell.view().toast).toBe(REMOTE_UNDO);
      expect(r.shell.state.undo.past).toEqual([]);
      expect(r.shell.view().canUndo).toBe(false);
    });

    it("redo drops the same way", () => {
      const { r, first, second } = twoMoves();
      undo(r);
      r.accept();
      undo(r);
      r.accept();
      expect(r.shell.state.undo.future).toHaveLength(2);
      r.remote({ type: "moveJoints", moves: [{ jointId: first, to: { x: 6, y: 5 } }] });
      expect(r.shell.view().canRedo).toBe(true);
      r.shell.key("z", { meta: true, shift: true });
      expect(r.shell.view().toast).toBe(REMOTE_REDO);
      expect(r.shell.state.undo.future).toHaveLength(1);
      r.shell.key("z", { meta: true, shift: true });
      expect(pointOf(r.shell.doc(), second)).toEqual({ x: -0.4, y: 0 });
    });

    it("a pending entry is never dropped", () => {
      const r = FakeRemote.open(roomDoc());
      r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
      undo(r);
      expect(r.shell.view().toast).toBe("Waiting for server");
      expect(r.shell.state.undo.past).toHaveLength(1);
      expect(r.shell.view().canUndo).toBe(false);
    });
  });

  it("refuses an ordinary edit while the undo request is pending", () => {
    const { r } = moved();
    r.shell.key("z", { meta: true });
    expect(r.submits()).toHaveLength(2);
    const bottom = wallBetween(r.shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    r.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 }); // no drag starts while edits are blocked
    r.shell.click({ x: 3, y: 0 });
    expect(r.shell.state.selection).toEqual([{ table: "walls", id: bottom }]);
    r.shell.key("Delete");
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(r.submits()).toHaveLength(2);
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(4);
    r.accept();
    expect(r.shell.state.undo.past).toEqual([]);
    expect(r.shell.state.undo.future).toHaveLength(1);
    expect(r.shell.state.undo.pending).toBeNull();
  });
});
