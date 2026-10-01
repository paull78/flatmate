import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES, rectangleRoom, type Command } from "@fm/domain";
import { PROJECT_DELETED } from "@fm/editor";
import type { ServerMessage } from "@fm/protocol";
import { createNodeHost } from "../src/node-host";
import { CONNECTION_DROPPED, EditorSession, NO_ANSWER, NO_DRAWING, type LinkHandlers } from "../src/session";
import { MemoryLink, TestServer } from "./harness";

const wall = (opId: string, from: { x: number; y: number }, to: { x: number; y: number }): Command =>
  ({ type: "addWall", opId, from: { at: from }, to: { at: to } });

function wallCount(s: EditorSession): number {
  return Object.keys(s.drawing()?.walls ?? {}).length;
}

function cornerId(s: EditorSession, x: number, y: number): string {
  const j = Object.values(s.drawing()?.joints ?? {}).find((p) => p.x === x && p.y === y);
  if (!j) throw new Error(`no joint at ${x},${y}`);
  return j.id;
}

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function join(server: TestServer, name: string, timeoutMs?: number) {
  const r = server.join(name, timeoutMs);
  sessions.push(r.session);
  return r;
}

describe("EditorSession against the real server app (spec §12)", () => {
  it("lists, creates and opens projects; listing leaves the drawing", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    expect(await session.listProjects()).toEqual({ ok: true, value: [] });
    const created = await session.createProject("Apartment");
    expect(created).toMatchObject({ ok: true, value: { name: "Apartment", status: "saved" } });
    expect(session.drawing()).toEqual({ joints: {}, walls: {}, zoneLabels: {} });
    const listed = await session.listProjects();
    expect(listed.ok && listed.value.map((p) => p.name)).toEqual(["Apartment"]);
    expect(session.drawing()).toBeNull();
    const id = created.ok ? created.value.id : "";
    expect(await session.openProject(id)).toMatchObject({ ok: true, value: { id, name: "Apartment" } });
  });

  it("refuses an edit with no project open", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    expect(await session.edit(wall("w", { x: 0, y: 0 }, { x: 1, y: 0 }))).toEqual({ ok: false, error: NO_DRAWING });
  });

  it("reports an unknown project with the server's openFailed message", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    expect(await session.openProject("no-such-project")).toEqual({ ok: false, error: "Unknown project" });
  });

  it("resolves an accepted edit after the server's ack; another client sees it", async () => {
    const server = new TestServer();
    const claude = join(server, "Claude").session;
    const alice = join(server, "Alice").session;
    const created = await claude.createProject("Apartment");
    if (!created.ok) throw new Error(created.error);
    expect((await alice.openProject(created.value.id)).ok).toBe(true);
    expect(await claude.edit(wall("w", { x: 0, y: 0 }, { x: 4, y: 0 }))).toEqual({ ok: true, value: null });
    expect(claude.project()?.status).toBe("saved");
    await server.settle();
    expect(wallCount(alice)).toBe(1);
  });

  it("returns the editor's refusal text and submits nothing", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    await session.createProject("Apartment");
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 3, "room")) expect((await session.edit(cmd)).ok).toBe(true);
    const r = await session.edit(wall("x", { x: 2, y: -1 }, { x: 2, y: 1 }));
    expect(r).toEqual({ ok: false, error: MESSAGES.crossing });
    expect(wallCount(session)).toBe(4);
  });

  it("returns the server's rejection text when another client changed the joint first", async () => {
    const server = new TestServer();
    const claude = join(server, "Claude");
    const alice = join(server, "Alice").session;
    const created = await claude.session.createProject("Apartment");
    if (!created.ok) throw new Error(created.error);
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 3, "room")) await claude.session.edit(cmd);
    await alice.openProject(created.value.id);
    const corner = cornerId(claude.session, 4, 3);
    claude.link.hold(); // Claude does not see Alice's move before its own
    expect((await alice.edit({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 4, y: 3.5 } }] })).ok).toBe(true);
    const pending = claude.session.edit({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 4.5, y: 3 } }] });
    await server.settle();
    claude.link.release();
    expect(await pending).toEqual({ ok: false, error: "Someone else changed this first" });
  });

  it("runs parallel calls one at a time, each after the previous settled", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    await session.createProject("Apartment");
    const results = await Promise.all(rectangleRoom({ x: 0, y: 0 }, 4, 3, "room").map((cmd) => session.edit(cmd)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(wallCount(session)).toBe(4);
  });

  it("returns CONNECTION_DROPPED when the connection drops before the answer", async () => {
    const server = new TestServer();
    const { session, link } = join(server, "Claude");
    await session.createProject("Apartment");
    link.hold();
    const pending = session.edit(wall("w", { x: 0, y: 0 }, { x: 4, y: 0 }));
    await server.settle();
    link.drop();
    expect(await pending).toEqual({ ok: false, error: CONNECTION_DROPPED });
  });

  it("returns NO_ANSWER when the server does not answer in time", async () => {
    const server = new TestServer();
    const { session, link } = join(server, "Claude", 100);
    await session.createProject("Apartment");
    link.hold();
    expect(await session.edit(wall("w", { x: 0, y: 0 }, { x: 4, y: 0 }))).toEqual({ ok: false, error: NO_ANSWER });
  });

  it("ends an edit waiting on the server with the delete toast when the project is deleted; the next edit has no drawing", async () => {
    const server = new TestServer();
    // A session whose link also lets the test deliver a server message and see the generation it opened.
    const wire: { handlers: LinkHandlers | null; link: MemoryLink | null; generation: string } = { handlers: null, link: null, generation: "" };
    const session = new EditorSession({
      clientId: "claude", name: "Claude", host: createNodeHost(), timeoutMs: 2000,
      connect: (h) => {
        const memory = new MemoryLink(server.app, h);
        wire.handlers = h;
        wire.link = memory;
        return {
          send: (msg) => {
            if (msg.type === "openProject") wire.generation = msg.generation;
            memory.send(msg);
          },
          close: () => memory.close(),
        };
      },
    });
    sessions.push(session);
    const created = await session.createProject("Apartment");
    if (!created.ok) throw new Error(created.error);
    const deliver = (msg: ServerMessage): void => wire.handlers?.message(msg);
    wire.link?.hold();
    const pending = session.edit(wall("w", { x: 0, y: 0 }, { x: 4, y: 0 }));
    await server.settle();
    deliver({ type: "projectDeleted", projectId: created.value.id, generation: wire.generation });
    expect(await pending).toEqual({ ok: false, error: PROJECT_DELETED });
    expect(session.drawing()).toBeNull();
    expect(await session.edit(wall("v", { x: 0, y: 0 }, { x: 0, y: 3 }))).toEqual({ ok: false, error: NO_DRAWING });
  });
});
