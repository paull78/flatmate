import { describe, expect, it } from "vitest";
import { toStored } from "@fm/domain";
import type { ServerEvent, WorkspaceEvent } from "../src/ports/events";
import { LEAVE_BLOCKED, NAME_REQUIRED, OFFLINE_LIST } from "../src/session";
import { jointAt, pointOf, roomDoc, serverState } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeHost, FakeShell } from "./fake-shell";
import { PROJECT, versionsFor } from "./shared-builders";

function serverShell(): FakeShell {
  const host = new FakeHost();
  return new FakeShell(serverState(host), host);
}

const server = (shell: FakeShell, event: ServerEvent): void => void shell.send({ type: "serverEvent", event });
const workspace = (shell: FakeShell, event: WorkspaceEvent): void => void shell.send({ type: "workspaceEvent", event });

function lastOpen(shell: FakeShell): { type: "open"; projectId: string; generation: string } {
  const opens = shell.effectsOf("workspace").flatMap((e) => (e.op.type === "open" ? [e.op] : []));
  const last = opens[opens.length - 1];
  if (!last) throw new Error("no open effect");
  return last;
}

function snapshotFor(open: { projectId: string; generation: string }, name = "Apartment"): ServerEvent {
  const doc = roomDoc();
  return {
    type: "snapshot", projectId: open.projectId, generation: open.generation, meta: { id: open.projectId, name },
    doc: toStored(doc), versions: versionsFor(doc, "c0"), seq: 0,
  };
}

function openFailedFor(open: { projectId: string; generation: string }): ServerEvent {
  return { type: "openFailed", projectId: open.projectId, generation: open.generation, message: "Unknown project" };
}

function presenceOf(r: FakeRemote, clientId: string, generation = r.generation()): ServerEvent {
  return { type: "presence", projectId: "p1", generation, clientId, name: clientId === "bob" ? "Bob" : clientId, color: "#30a46c", cursor: { x: 1, y: 2 }, selection: [] };
}

describe("session: project list and opening (spec §7.2.1)", () => {
  it("asks for the project list when the connection opens", () => {
    const shell = serverShell();
    expect(shell.view().projectList).toEqual({ items: [], loading: true, error: null });
    server(shell, { type: "connection", state: "open" });
    expect(shell.effectsOf("workspace")).toEqual([{ type: "workspace", op: { type: "list", requestId: "id1" } }]);
  });

  it("shows the projects the server lists", () => {
    const shell = serverShell();
    workspace(shell, { type: "projects", requestId: "id1", items: [PROJECT] });
    expect(shell.view().projectList).toEqual({ items: [PROJECT], loading: false, error: null });
    expect(shell.view().project).toBeNull();
  });

  it("creates a project by name and opens it as soon as it is created", () => {
    const shell = serverShell();
    shell.ui({ type: "createProject", name: "  Apartment " });
    expect(shell.effectsOf("workspace")).toEqual([{ type: "workspace", op: { type: "create", requestId: "id1", name: "Apartment" } }]);
    workspace(shell, { type: "created", requestId: "id1", meta: PROJECT });
    expect(lastOpen(shell)).toEqual({ type: "open", projectId: "p1", generation: "id2" });
    expect(shell.state.workspace.opening).toEqual({ projectId: "p1", generation: "id2" });
    expect(shell.view().projectList).toEqual({ items: [PROJECT], loading: true, error: null });
  });

  it("a late 'created' only lists the project when another open has started since", () => {
    const shell = serverShell();
    shell.ui({ type: "createProject", name: "Apartment" });
    shell.ui({ type: "openProject", id: "p2" });
    const p2 = lastOpen(shell);
    workspace(shell, { type: "created", requestId: "id1", meta: PROJECT });
    expect(lastOpen(shell)).toEqual(p2);
    expect(shell.state.workspace.opening).toEqual({ projectId: p2.projectId, generation: p2.generation });
    server(shell, snapshotFor(p2, "Kitchen"));
    workspace(shell, { type: "created", requestId: "id9", meta: { id: "p3", name: "Late" } });
    expect(shell.view().project?.name).toBe("Kitchen");
    expect(shell.state.workspace.projects.map((m) => m.id)).toContain("p3");
  });

  it("refuses an empty project name", () => {
    const shell = serverShell();
    shell.ui({ type: "createProject", name: "   " });
    expect(shell.effectsOf("workspace")).toEqual([]);
    expect(shell.view().toast).toBe(NAME_REQUIRED);
  });

  it("opens the drawing when the snapshot for its generation arrives", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    server(shell, snapshotFor(lastOpen(shell)));
    expect(shell.state.document?.kind).toBe("shared");
    expect(shell.view().projectList).toBeNull();
    expect(shell.view().project).toEqual({ name: "Apartment", status: "saved", dirty: false, canEdit: true });
    expect(shell.state.workspace.opening).toBeNull();
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
  });

  it("ignores a snapshot that does not answer the current open", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    const first = lastOpen(shell);
    shell.ui({ type: "openProject", id: "p2" });
    server(shell, snapshotFor(first));
    expect(shell.state.document).toBeNull();
    server(shell, snapshotFor(lastOpen(shell), "Kitchen"));
    expect(shell.view().project?.name).toBe("Kitchen");
  });

  it("shows a failed open in the list", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "missing" });
    server(shell, openFailedFor(lastOpen(shell)));
    expect(shell.view().projectList).toEqual({ items: [], loading: false, error: "Unknown project" });
    expect(shell.state.workspace.opening).toBeNull();
  });

  it("ignores a failed open that does not answer the current open", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "missing" });
    const first = lastOpen(shell);
    shell.ui({ type: "openProject", id: "p2" });
    const second = lastOpen(shell);
    server(shell, openFailedFor(first));
    expect(shell.state.workspace.opening).toEqual({ projectId: "p2", generation: second.generation });
    expect(shell.view().projectList?.error).toBeNull();
    server(shell, snapshotFor(second, "Kitchen"));
    expect(shell.view().project?.name).toBe("Kitchen");
  });

  it("keeps a pending open when an unrelated error arrives", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    const open = lastOpen(shell);
    workspace(shell, { type: "failed", requestId: null, message: "Message is not JSON" });
    expect(shell.view().projectList?.error).toBe("Message is not JSON");
    expect(shell.state.workspace.opening).toEqual({ projectId: "p1", generation: open.generation });
    server(shell, snapshotFor(open));
    expect(shell.view().project?.name).toBe("Apartment");
  });

  it("has no project list in local mode", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "showProjectList" });
    shell.ui({ type: "createProject", name: "Apartment" });
    expect(shell.state.document?.kind).toBe("local");
    expect(shell.effectsOf("workspace")).toEqual([]);
  });
});

describe("session: an open shared drawing", () => {
  it("FakeRemote: a drag is shown at once and saved when the server accepts it", () => {
    const r = FakeRemote.open(roomDoc());
    const corner = jointAt(r.shell.doc(), { x: 6, y: 4 });
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(r.shell.view().project?.status).toBe("waiting for server");
    r.accept();
    expect(r.shell.view().project?.status).toBe("saved");
    expect(r.shell.state.undo.past.map((e) => e.status)).toEqual(["usable"]);
  });

  it("does not leave the drawing while an edit is outstanding; leaving clears its history", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    r.shell.ui({ type: "showProjectList" });
    expect(r.shell.view().toast).toBe(LEAVE_BLOCKED);
    r.shell.ui({ type: "openProject", id: "p2" });
    expect(r.shell.state.document?.kind).toBe("shared");
    r.accept();
    r.shell.ui({ type: "showProjectList" });
    expect(r.shell.state.document).toBeNull();
    expect(r.shell.state.undo).toEqual({ past: [], future: [], pending: null });
    expect(r.shell.effectsOf("workspace").at(-1)?.op.type).toBe("list");
  });

  it("Cmd+Z on a paused wall chain waits for the segment and keeps the chain (carried over from phase 3)", () => {
    const r = FakeRemote.open();
    r.shell.key("w");
    r.shell.click({ x: 0, y: 0 });
    r.shell.click({ x: 2, y: 0 });
    expect(r.shell.state.tool.state.kind).toBe("paused");
    r.shell.key("z", { meta: true });
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(r.shell.state.tool.state.kind).toBe("paused");
    expect(r.submits()).toHaveLength(1);
  });

  it("takes its colour from the server's welcome", () => {
    const shell = serverShell();
    server(shell, { type: "welcome", clientId: "tab1", color: "#0090ff" });
    expect(shell.state.me.color).toBe("#0090ff");
  });

  it("tracks the other clients' cursors for the open project only", () => {
    const r = FakeRemote.open(roomDoc());
    r.event(presenceOf(r, "bob"));
    r.event(presenceOf(r, "tab1")); // my own echo
    r.event(presenceOf(r, "carol", "an-older-open"));
    expect(r.shell.view().presence).toEqual([{ clientId: "bob", name: "Bob", color: "#30a46c", at: { x: 1, y: 2 } }]);
    r.event({ type: "presenceLeft", projectId: "p1", generation: r.generation(), clientId: "bob" });
    expect(r.shell.view().presence).toEqual([]);
  });

  it("sends presence on pointer moves while connected, and never in local mode", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.moveTo({ x: 1, y: 1 });
    expect(r.shell.effectsOf("presence").at(-1)).toEqual({
      type: "presence", projectId: "p1", generation: r.generation(), cursor: { x: 1, y: 1 }, selection: [],
    });
    const sent = r.shell.effectsOf("presence").length;
    r.disconnect();
    r.shell.moveTo({ x: 2, y: 2 });
    expect(r.shell.effectsOf("presence")).toHaveLength(sent);
    const local = FakeShell.local();
    local.moveTo({ x: 1, y: 1 });
    expect(local.effectsOf("presence")).toEqual([]);
  });
});

describe("session: connection changes", () => {
  it("shows the list as offline; on reconnect it refreshes the list and repeats a pending open", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    const before = lastOpen(shell);
    server(shell, { type: "connection", state: "closed" });
    expect(shell.view().projectList?.error).toBe(OFFLINE_LIST);
    server(shell, { type: "connection", state: "open" });
    const after = lastOpen(shell);
    expect(after.projectId).toBe("p1");
    expect(after.generation).not.toBe(before.generation);
    expect(shell.state.workspace.opening).toEqual({ projectId: "p1", generation: after.generation });
    expect(shell.effectsOf("workspace").some((e) => e.op.type === "list")).toBe(true);
    expect(shell.view().projectList?.error).toBeNull();
  });

  it("reopens an open drawing after a reconnect and forgets the others' cursors", () => {
    const r = FakeRemote.open(roomDoc());
    r.event(presenceOf(r, "bob"));
    const generation = r.generation();
    r.disconnect();
    expect(r.shell.view().project?.status).toBe("offline");
    expect(r.shell.view().presence).toEqual([]);
    r.event({ type: "connection", state: "open" });
    expect(r.generation()).not.toBe(generation);
    expect(r.shell.view().project?.status).toBe("waiting for server");
    r.snapshot();
    expect(r.shell.view().project?.status).toBe("saved");
  });
});
