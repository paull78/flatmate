import { describe, expect, it } from "vitest";
import { MESSAGES, emptyDocument, type Document } from "@fm/domain";
import { CHAIN_ENDED, CONNECTION_LOST } from "../src/gestures";
import { COLORS } from "../src/view/colors";
import { jointAt, pointOf, wallDoc } from "./builders";
import { FakeRemote } from "./fake-remote";
import type { FakeShell } from "./fake-shell";

function wall(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "wall") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

/** Wall tool, first point (0, 0), first segment to (2, 0) submitted: the chain is paused. */
function pausedChain(doc: Document = emptyDocument()): FakeRemote {
  const r = FakeRemote.open(doc);
  r.shell.key("w");
  r.shell.click({ x: 0, y: 0 });
  r.shell.click({ x: 2, y: 0 });
  return r;
}

describe("wall chain on a shared document (spec §5.5 pause and resume)", () => {
  it("pauses after each submitted segment and ignores input without queueing it", () => {
    const r = pausedChain();
    expect(wall(r.shell)).toEqual({ kind: "paused", origin: { x: 2, y: 0 }, chainStart: { x: 0, y: 0 }, segment: r.last().id });
    expect(r.shell.view().commandBar.prompt).toBe("Waiting for server");
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(1); // shown at once
    r.shell.click({ x: 2, y: 2 });
    r.shell.type("3");
    r.shell.key("Enter");
    r.shell.key(" ");
    expect(r.submits()).toHaveLength(1);
    expect(wall(r.shell).kind).toBe("paused");
  });

  it("acceptance resumes drawing from the segment's end with a fresh preview and the same chainStart", () => {
    const r = pausedChain();
    r.shell.moveTo({ x: 2, y: 1.6 });
    r.accept();
    const t = wall(r.shell);
    expect(t).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, chainStart: { x: 0, y: 0 }, value: "" });
    expect(t.kind === "drawing" && t.preview?.ok).toBe(true);
    expect(r.shell.view().project?.status).toBe("saved");
  });

  it("closes a paused-and-resumed chain by clicking its first joint", () => {
    const r = pausedChain();
    r.accept();
    r.shell.click({ x: 2, y: 2 });
    r.accept();
    r.shell.click({ x: 0, y: 2 });
    r.accept();
    r.shell.click({ x: 0, y: 0 });
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    r.accept();
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(4);
    expect(Object.keys(r.shell.doc().joints)).toHaveLength(4);
    expect(r.submits()).toHaveLength(4);
  });

  it("a rejection ends the chain, removes the wall and explains why", () => {
    const r = pausedChain();
    r.reject();
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.doc().walls).toEqual({});
    expect(r.shell.view().toast).toBe("Someone else changed this first");
    expect(r.shell.state.undo.past).toEqual([]);
  });

  it("a remote topology change ends the paused chain at once; the pending segment still settles", () => {
    const r = pausedChain();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 5, y: 5 } }, to: { at: { x: 7, y: 5 } } });
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(CHAIN_ENDED);
    r.accept();
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(2);
    expect(r.shell.view().project?.status).toBe("saved");
  });

  it("an unrelated move keeps the paused chain; it resumes with a red preview and a click there is refused", () => {
    const r = pausedChain(wallDoc({ x: 5, y: 1 }, { x: 5, y: 3 }));
    r.shell.moveTo({ x: 2, y: 2 });
    const a = jointAt(r.doc, { x: 5, y: 1 });
    const b = jointAt(r.doc, { x: 5, y: 3 });
    r.remote({ type: "moveJoints", moves: [{ jointId: a, to: { x: 1, y: 1 } }, { jointId: b, to: { x: 3, y: 1 } }] });
    expect(wall(r.shell).kind).toBe("paused");
    r.accept();
    const t = wall(r.shell);
    expect(t.kind === "drawing" && t.preview?.ok).toBe(false); // Bob's wall now crosses the path (2,0)→(2,2)
    const overlays = r.shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    expect(overlays.some((p) => p.kind === "segment" && p.color === COLORS.invalid)).toBe(true);
    r.shell.click({ x: 2, y: 2 });
    expect(r.submits()).toHaveLength(1);
    expect(r.shell.view().toast).toBe(MESSAGES.crossing);
    expect(wall(r.shell).kind).toBe("drawing");
  });

  it("Esc while paused returns to idle; the submitted wall still settles", () => {
    const r = pausedChain();
    r.shell.key("Escape");
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    r.accept();
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(1);
    expect(r.shell.view().project?.status).toBe("saved");
  });

  it("a dropped connection ends the paused chain and blocks editing", () => {
    const r = pausedChain();
    r.disconnect();
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(CONNECTION_LOST);
    expect(r.shell.view().project).toMatchObject({ status: "offline", canEdit: false });
  });

  it("draws the demo room with typed lengths against a server that answers later", () => {
    const r = FakeRemote.open();
    const s = r.shell;
    const shift = { shift: true };
    s.key("w");
    s.click({ x: 0, y: 0 }, shift);
    const legs: [{ x: number; y: number }, string][] = [[{ x: 3, y: 0.2 }, "6"], [{ x: 6.2, y: 2 }, "4"], [{ x: 3, y: 4.2 }, "6"]];
    for (const [p, length] of legs) {
      s.moveTo(p, shift);
      s.type(length);
      s.key("Enter");
      expect(wall(s).kind).toBe("paused");
      s.type("9"); // swallowed while paused
      r.accept();
    }
    s.click({ x: 0.02, y: 0.02 }, shift);
    r.accept();
    expect([Object.keys(s.doc().walls).length, Object.keys(s.doc().joints).length]).toEqual([4, 4]);
    expect(pointOf(s.doc(), jointAt(s.doc(), { x: 6, y: 4 }))).toEqual({ x: 6, y: 4 });
    expect(r.submits()).toHaveLength(4);
  });

  // Carried over from phase 3 wave 6: a refused undo keeps the gesture; an applied one drops it.
  it("Cmd+Z while the segment is pending shows Waiting for server and keeps the chain paused", () => {
    const r = pausedChain();
    r.shell.key("z", { meta: true });
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(wall(r.shell).kind).toBe("paused");
    expect(r.submits()).toHaveLength(1);
  });

  it("a submitted undo mid-chain (after the paused chain resumes) drops the chain", () => {
    const r = pausedChain();
    r.shell.moveTo({ x: 2, y: 1.6 });
    r.accept();
    expect(wall(r.shell).kind).toBe("drawing");
    r.shell.key("z", { meta: true });
    expect(r.submits()).toHaveLength(2);
    expect(r.shell.state.undo.pending?.direction).toBe("undo");
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.doc().walls).toEqual({}); // shown at once
    r.accept();
    expect(r.shell.state.undo.future).toHaveLength(1);
    expect(wall(r.shell)).toEqual({ kind: "idle" });
  });
});
