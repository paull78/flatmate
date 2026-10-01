import type { Changeset, ClientMessage, ServerMessage, StoredDocument } from "@fm/protocol";
import type { ChangesetValidator, ProjectRepository } from "../src/app/ports";
import { createServerApp } from "../src/app/server-app";
import type { Connection } from "../src/app/server-app";
import { createInMemoryRepository } from "../src/app/testing";

export const acceptAll: ChangesetValidator = { validate: () => ({ ok: true }) };

/** Stands in for "walls cross": any joint at x = 99 makes the document invalid. */
export const rejectX99: ChangesetValidator = {
  validate: (doc: StoredDocument) =>
    Object.values(doc.joints).some((joint) => joint.x === 99) ? { ok: false, violations: ["I5: walls cross"] } : { ok: true },
};

export function putJoint(id: string, jointId: string, x: number, lastCs: string | null = null): Changeset {
  return {
    id,
    patch: { puts: [{ table: "joints", entity: { id: jointId, x, y: 0 } }], deletes: [] },
    expect: [{ table: "joints", id: jointId, lastCs }],
  };
}

export function deleteJoint(id: string, jointId: string, lastCs: string): Changeset {
  return {
    id,
    patch: { puts: [], deletes: [{ table: "joints", id: jointId }] },
    expect: [{ table: "joints", id: jointId, lastCs }],
  };
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class FakeConnection implements Connection {
  messages: ServerMessage[] = [];
  closed = false;

  send(msg: ServerMessage): void {
    this.messages.push(msg);
  }

  close(): void {
    this.closed = true;
  }

  types(): string[] {
    return this.messages.map((m) => m.type);
  }

  /** Returns and clears the messages received so far. */
  take(): ServerMessage[] {
    const taken = this.messages;
    this.messages = [];
    return taken;
  }
}

export function setup(opts: { repository?: ProjectRepository; validator?: ChangesetValidator } = {}) {
  const repository = opts.repository ?? createInMemoryRepository();
  const fatal: unknown[] = [];
  const app = createServerApp({ repository, validator: opts.validator ?? acceptAll, onFatal: (error) => void fatal.push(error) });

  function join(clientId: string, name: string = clientId) {
    const conn = new FakeConnection();
    const session = app.connect(conn);
    const send = (msg: ClientMessage): void => session.receive(JSON.stringify(msg));
    send({ type: "hello", clientId, name });
    const welcome = conn.messages[0];
    if (welcome?.type !== "welcome") throw new Error("expected welcome");
    return { conn, session, send, color: welcome.color };
  }

  return { app, repository, fatal, join };
}

export type Ctx = ReturnType<typeof setup>;
export type TestClient = ReturnType<Ctx["join"]>;

let requests = 0;

export async function createProject(ctx: Ctx, client: TestClient, name = "Apartment"): Promise<string> {
  const requestId = `req${++requests}`;
  client.send({ type: "createProject", requestId, name });
  await ctx.app.idle();
  for (const m of client.conn.messages) if (m.type === "projectCreated" && m.requestId === requestId) return m.meta.id;
  throw new Error("projectCreated not received");
}

export async function openProject(ctx: Ctx, client: TestClient, projectId: string, generation: string): Promise<Extract<ServerMessage, { type: "snapshot" }>> {
  client.send({ type: "openProject", projectId, generation });
  await ctx.app.idle();
  for (const m of [...client.conn.messages].reverse()) if (m.type === "snapshot" && m.generation === generation) return m;
  throw new Error("snapshot not received");
}

/** Alice and Bob both have one project open (generations "ga" and "gb"); message logs cleared. */
export async function room(ctx: Ctx): Promise<{ alice: TestClient; bob: TestClient; projectId: string }> {
  const alice = ctx.join("alice", "Alice");
  const bob = ctx.join("bob", "Bob");
  const projectId = await createProject(ctx, alice);
  await openProject(ctx, alice, projectId, "ga");
  await openProject(ctx, bob, projectId, "gb");
  alice.conn.take();
  bob.conn.take();
  return { alice, bob, projectId };
}

/** Saves wait while held, so tests can observe what is (not) sent before persistence completes. */
export function gatedRepository(): { repository: ProjectRepository; hold(): void; release(): void } {
  const inner = createInMemoryRepository();
  let gate: Promise<void> | null = null;
  let open: () => void = () => undefined;
  return {
    repository: {
      list: () => inner.list(),
      create: (name) => inner.create(name),
      load: (id) => inner.load(id),
      remove: (id) => inner.remove(id),
      save: async (state) => {
        if (gate) await gate;
        await inner.save(state);
      },
    },
    hold() {
      gate = new Promise((resolve) => {
        open = resolve;
      });
    },
    release() {
      gate = null;
      open();
    },
  };
}
