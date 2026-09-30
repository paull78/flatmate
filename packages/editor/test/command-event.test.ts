import { describe, expect, it } from "vitest";
import { MESSAGES, type Command } from "@fm/domain";
import { update } from "../src/update";
import { jointAt, pointOf, roomDoc, serverState } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { pending, shared } from "./shared-builders";

// Spec §12: a shell without pointer input (the MCP server) sends domain commands as one event, and they take the
// tools' commit path: blocking, execute, commit, history, notices and toasts.

const wall: Command = { type: "addWall", opId: "mcp1", from: { at: { x: 0, y: 0 } }, to: { at: { x: 2, y: 0 } } };

function sharedShell(d = shared()): FakeShell {
  const host = new FakeHost();
  return new FakeShell({ ...serverState(host), document: d }, host);
}

describe("the command event (spec §12)", () => {
  it("commits to a local document with a usable history entry, then renders", () => {
    const s = FakeShell.local();
    const effects = s.send({ type: "command", command: wall });
    expect(Object.keys(s.doc().walls)).toEqual(["mcp1/w0"]);
    expect(s.state.undo.past.map((e) => e.status)).toEqual(["usable"]);
    expect(effects.at(-1)?.type).toBe("render");
    s.ui({ type: "undo" });
    expect(Object.keys(s.doc().walls)).toEqual([]);
  });

  it("shows a domain error as a toast and changes nothing", () => {
    const s = FakeShell.withDocument(roomDoc());
    const before = s.doc();
    const crossing: Command = { type: "addWall", opId: "x", from: { at: { x: 3, y: -1 } }, to: { at: { x: 3, y: 1 } } };
    const effects = s.send({ type: "command", command: crossing });
    expect(s.doc()).toBe(before);
    expect(s.view().toast).toBe(MESSAGES.crossing);
    expect(effects.map((e) => e.type)).toEqual(["startTimer", "render"]);
    expect(s.state.undo.past).toEqual([]);
  });

  it("submits one changeset to a shared document and waits for the server", () => {
    const s = sharedShell();
    const corner = jointAt(s.doc(), { x: 6, y: 4 });
    s.send({ type: "command", command: { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4.5 } }] } });
    const submits = s.effectsOf("submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]?.changeset.id).toBe("id1"); // the commit ID comes from the host, as for a tool
    expect(pointOf(s.doc(), corner)).toEqual({ x: 6, y: 4.5 }); // optimistic
    expect(s.view().project?.status).toBe("waiting for server");
    expect(s.state.undo.past.map((e) => e.status)).toEqual(["pending"]);
  });

  it("is refused while an edit is outstanding: toast, no second submit, no queue", () => {
    const s = sharedShell(pending());
    const before = s.doc();
    s.send({ type: "command", command: { type: "renameZone", id: "nope", name: "Kitchen" } });
    expect(s.effectsOf("submit")).toEqual([]);
    expect(s.doc()).toBe(before);
    expect(s.view().toast).toBe("Waiting for server");
  });

  it("does nothing without an open document, and nothing for a command that changes nothing", () => {
    const host = new FakeHost();
    const r = update(serverState(host), { type: "command", command: wall }, host);
    expect(r.effects.map((e) => e.type)).toEqual(["render"]);
    const s = FakeShell.withDocument(roomDoc());
    const corner = jointAt(s.doc(), { x: 6, y: 4 });
    const effects = s.send({ type: "command", command: { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4 } }] } });
    expect(effects.map((e) => e.type)).toEqual(["render"]);
    expect(s.state.undo.past).toEqual([]);
  });
});
