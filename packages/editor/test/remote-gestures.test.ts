import { describe, expect, it } from "vitest";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import { jointAt, pointOf, roomDoc, wallBetween } from "./builders";
import { FakeRemote } from "./fake-remote";
import type { FakeShell } from "./fake-shell";

function selectKind(shell: FakeShell): string {
  const t = shell.state.tool;
  return t.name === "select" ? t.state.kind : t.name;
}

/** Press the room's top-right corner and move past the threshold: a drag in progress. */
function dragging(): FakeRemote {
  const r = FakeRemote.open(roomDoc());
  r.shell.moveTo({ x: 6, y: 4 });
  r.shell.down({ x: 6, y: 4 });
  r.shell.moveTo({ x: 6, y: 4.4 });
  return r;
}

describe("gestures and remote changes (spec §5.7)", () => {
  it("a remote write to the dragged joint cancels the drag; releasing commits nothing", () => {
    const r = dragging();
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    expect(selectKind(r.shell)).toBe("moving");
    r.remote({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4.2 } }] });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.up({ x: 6, y: 4.4 });
    expect(r.submits()).toEqual([]);
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.2 });
  });

  it("an unrelated remote move reruns the drag on the new document", () => {
    const r = dragging();
    const origin = jointAt(r.doc, { x: 0, y: 0 });
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    r.remote({ type: "moveJoints", moves: [{ jointId: origin, to: { x: -0.4, y: 0 } }] });
    const t = r.shell.state.tool;
    expect(t.name === "select" && t.state.kind === "moving" && pointOf(t.state.baseDoc, origin)).toEqual({ x: -0.4, y: 0 });
    // The rerun preview is computed on the new document from the same cursor.
    expect(t.name === "select" && t.state.kind === "moving" && pointOf(t.state.attempt.doc, origin)).toEqual({ x: -0.4, y: 0 });
    expect(t.name === "select" && t.state.kind === "moving" && pointOf(t.state.attempt.doc, corner)).toEqual({ x: 6, y: 4.4 });
    r.shell.moveTo({ x: 6, y: 4.6 });
    r.shell.up({ x: 6, y: 4.6 });
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(pointOf(r.shell.doc(), origin)).toEqual({ x: -0.4, y: 0 });
  });

  it("any remote topology change cancels the drag", () => {
    const r = dragging();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a snapshot cancels the drag", () => {
    const r = dragging();
    r.snapshot();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a dropped connection cancels the drag, and no new drag starts while offline", () => {
    const r = dragging();
    r.disconnect();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(CONNECTION_LOST);
    r.shell.moveTo({ x: 6, y: 4 });
    r.shell.down({ x: 6, y: 4 });
    r.shell.moveTo({ x: 6, y: 4.6 });
    expect(selectKind(r.shell)).not.toBe("moving");
    r.shell.up({ x: 6, y: 4.6 });
    expect(r.submits()).toEqual([]);
  });

  it("a resize being typed is cancelled when its wall's fixed endpoint changes remotely", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const fixed = jointAt(r.doc, { x: 6, y: 0 });
    // Phase 5 enters this state from the helper dimension; set it directly to test the §5.7 rule on its own.
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.remote({ type: "moveJoints", moves: [{ jointId: fixed, to: { x: 6.4, y: 0 } }] });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a resize being typed survives a remote move that does not touch its wall", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const farCorner = jointAt(r.doc, { x: 0, y: 4 });
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.remote({ type: "moveJoints", moves: [{ jointId: farCorner, to: { x: -0.4, y: 4 } }] });
    expect(selectKind(r.shell)).toBe("editingHelper");
  });

  it("a snapshot cancels a resize being typed", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.snapshot();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });
});
