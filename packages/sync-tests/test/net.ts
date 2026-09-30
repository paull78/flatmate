import { clientMessageFor, initialState, serverMessageEvent, type Effect, type ServerEffect } from "@fm/editor";
import { FakeHost, FakeShell } from "@fm/editor/testing";
import type { Point, ServerMessage } from "@fm/protocol";
import { createInMemoryRepository, createServerApp, domainValidator, type InMemoryRepository, type ServerApp, type Session } from "@fm/server";

function isServerEffect(e: Effect): e is ServerEffect {
  return e.type === "workspace" || e.type === "submit" || e.type === "presence";
}

/** One editor connected to the server app, with a controllable message queue in each direction. */
export class Client {
  readonly shell: FakeShell;
  readonly clientId: string;
  readonly name: string;
  /** Server → client messages not yet delivered. */
  inbox: ServerMessage[] = [];
  /** While true, deliver() leaves the inbox alone (latency). */
  holding = false;
  /** Loses the next inbound message this predicate matches (a missed `changes`). */
  drop: ((m: ServerMessage) => boolean) | null = null;
  private readonly net: Net;
  private session: Session | null = null;
  private forwarded = 0;

  constructor(net: Net, clientId: string, name: string) {
    this.net = net;
    this.clientId = clientId;
    this.name = name;
    const host = new FakeHost(`${clientId}-`);
    const state = initialState({ mode: "server", me: { clientId, name }, viewport: { width: 1200, height: 800 }, dpr: 1 }, host);
    this.shell = new FakeShell(state, host);
    this.connect();
  }

  /** Like the WebSocket adapter: hello first, then tell the editor the connection is open. */
  connect(): void {
    const session = this.net.app.connect({ send: (m) => void this.inbox.push(m), close: () => this.disconnect() });
    this.session = session;
    session.receive(JSON.stringify({ type: "hello", clientId: this.clientId, name: this.name }));
    this.shell.send({ type: "serverEvent", event: { type: "connection", state: "open" } });
  }

  /** The connection drops: queued messages are lost and the editor goes offline. */
  disconnect(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.inbox = [];
    session.close();
    this.shell.send({ type: "serverEvent", event: { type: "connection", state: "closed" } });
  }

  /** Client → server: the editor's new workspace, submit and presence effects, in order. */
  pump(): number {
    const effects = this.shell.effects;
    const fresh = effects.slice(this.forwarded);
    this.forwarded = effects.length;
    let sent = 0;
    for (const e of fresh) {
      if (!isServerEffect(e) || this.session === null) continue; // offline: lost, like a closed socket
      this.session.receive(JSON.stringify(clientMessageFor(e)));
      sent += 1;
    }
    return sent;
  }

  /** Server → client: queued messages to the editor, in order, unless held. */
  deliver(): number {
    if (this.holding) return 0;
    let delivered = 0;
    for (let m = this.inbox.shift(); m !== undefined; m = this.inbox.shift()) {
      if (this.drop?.(m)) {
        this.drop = null;
        continue;
      }
      this.shell.send(serverMessageEvent(m));
      delivered += 1;
    }
    return delivered;
  }
}

/** The real server app (in-memory repository, domain validator) and the clients connected to it. */
export class Net {
  readonly repository: InMemoryRepository;
  app: ServerApp;
  readonly fatal: unknown[] = [];
  readonly clients: Client[] = [];

  constructor(repository: InMemoryRepository = createInMemoryRepository()) {
    this.repository = repository;
    this.app = this.start();
  }

  join(name: string): Client {
    const client = new Client(this, name.toLowerCase(), name);
    this.clients.push(client);
    return client;
  }

  /** Crash-only restart (spec §7.2): every connection drops; a new app reloads the same repository. */
  restart(): void {
    for (const c of this.clients) c.disconnect();
    this.app = this.start();
  }

  /** Forward effects, let the server finish, deliver replies; repeat until nothing moves. */
  async settle(): Promise<void> {
    for (let round = 0; round < 100; round += 1) {
      let moved = 0;
      for (const c of this.clients) moved += c.pump();
      await this.app.idle();
      for (const c of this.clients) moved += c.deliver();
      if (moved === 0) return;
    }
    throw new Error("the network did not settle in 100 rounds");
  }

  private start(): ServerApp {
    return createServerApp({ repository: this.repository, validator: domainValidator, onFatal: (error) => void this.fatal.push(error) });
  }
}

export function projectIdOf(c: Client): string {
  const d = c.shell.state.document;
  if (!d) throw new Error(`${c.name} has no drawing open`);
  return d.project.id;
}

export function seqOf(c: Client): number {
  const d = c.shell.state.document;
  if (!d || d.kind !== "shared") throw new Error(`${c.name} has no shared drawing open`);
  return d.confirmed.seq;
}

export function submitIds(c: Client): string[] {
  return c.shell.effectsOf("submit").map((e) => e.changeset.id);
}

/**
 * Demo step 2 on a shared drawing, as the editor's demo-steps.ts draws it (W, Shift held, type 6 / 4 / 6, click the
 * first joint), except that each segment waits for the server before the next (spec §5.5).
 */
export async function drawRoom(net: Net, c: Client): Promise<void> {
  const s = c.shell;
  const shift = { shift: true };
  s.key("w");
  s.click({ x: 0, y: 0 }, shift);
  const legs: [Point, string][] = [[{ x: 3, y: 0.2 }, "6"], [{ x: 6.2, y: 2 }, "4"], [{ x: 3, y: 4.2 }, "6"]];
  for (const [p, length] of legs) {
    s.moveTo(p, shift);
    s.type(length, shift);
    s.key("Enter", shift);
    await net.settle();
  }
  s.click({ x: 0.02, y: 0.02 }, shift); // the first joint closes the chain
  await net.settle();
}

/** Demo step 3: with Shift held, the divider between the two wall midpoints, then finish the chain. */
export async function drawDivider(net: Net, c: Client): Promise<void> {
  const s = c.shell;
  const shift = { shift: true };
  s.key("w");
  s.click({ x: 3.04, y: 0.03 }, shift); // midpoint snap → (3, 0)
  s.click({ x: 3.1, y: 3.97 }, shift); // vertical axis + midpoint snap → (3, 4)
  await net.settle();
  s.key("Enter");
}

/** Alice creates "Apartment" and draws the room; Bob opens it. */
export async function sharedRoom(net: Net): Promise<{ alice: Client; bob: Client; projectId: string }> {
  const alice = net.join("Alice");
  const bob = net.join("Bob");
  await net.settle();
  alice.shell.ui({ type: "createProject", name: "Apartment" });
  await net.settle();
  const projectId = projectIdOf(alice);
  await drawRoom(net, alice);
  bob.shell.ui({ type: "openProject", id: projectId });
  await net.settle();
  return { alice, bob, projectId };
}
