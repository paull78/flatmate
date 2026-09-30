import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDocument, execute } from "@fm/domain";
import { buildExpectations, emptyVersions, MAX_MESSAGE_BYTES, parseServerMessage, patchWrites, unwrap } from "@fm/protocol";
import type { Changeset, ClientMessage, ServerMessage } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { startWsTransport } from "../src/adapters/ws-transport";
import type { WsTransport } from "../src/adapters/ws-transport";
import { createServerApp } from "../src/app/server-app";

/** A test client that parses every server message and hands them out in order. */
class WsClient {
  private readonly inbox: ServerMessage[] = [];
  private waiting: ((m: ServerMessage) => void) | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const parsed = parseServerMessage(data.toString());
      if (!parsed.ok) throw new Error(`server sent an invalid message: ${parsed.error}`);
      const waiting = this.waiting;
      this.waiting = null;
      if (waiting) waiting(parsed.value);
      else this.inbox.push(parsed.value);
    });
  }

  static connect(url: string): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once("open", () => resolve(new WsClient(socket)));
      socket.once("error", reject);
    });
  }

  send(msg: ClientMessage): void {
    this.socket.send(JSON.stringify(msg));
  }

  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  next(): Promise<ServerMessage> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  async receive<T extends ServerMessage["type"]>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const m = await this.next();
    if (!isType(m, type)) throw new Error(`expected ${type}, got ${JSON.stringify(m)}`);
    return m;
  }

  close(): void {
    this.socket.close();
  }
}

function isType<T extends ServerMessage["type"]>(m: ServerMessage, type: T): m is Extract<ServerMessage, { type: T }> {
  return m.type === type;
}

/** The first wall of a project, built by the real domain as the editor will (spec §7.9 c–d). */
function firstWall(id: string): Changeset {
  const { patch } = unwrap(execute(emptyDocument(), { type: "addWall", opId: "op1", from: { at: { x: 0, y: 0 } }, to: { at: { x: 4, y: 0 } } }));
  return {
    id,
    patch: { puts: patch.puts, deletes: patch.deletes },
    expect: buildExpectations(emptyVersions(), [...patchWrites(patch), ...patch.dependencies]),
  };
}

describe("WebSocket transport (real sockets, JSON files, domain validator)", () => {
  let dir = "";
  let transport: WsTransport | null = null;
  let fatal: unknown[] = [];
  const clients: WsClient[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fm-ws-"));
    fatal = [];
    const app = createServerApp({ repository: createJsonFileRepository(dir), validator: domainValidator, onFatal: (e) => void fatal.push(e) });
    transport = await startWsTransport(app, { port: 0 });
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await transport?.close();
    await rm(dir, { recursive: true, force: true });
    expect(fatal).toEqual([]);
  });

  async function connect(clientId: string, name: string): Promise<WsClient> {
    if (!transport) throw new Error("transport not started");
    const client = await WsClient.connect(`ws://127.0.0.1:${transport.port}`);
    clients.push(client);
    client.send({ type: "hello", clientId, name });
    await client.receive("welcome");
    return client;
  }

  it("creates, opens and submits; a second client sees the accepted wall", async () => {
    const alice = await connect("alice", "Alice");
    alice.send({ type: "createProject", requestId: "r1", name: "Apartment" });
    const { meta } = await alice.receive("projectCreated");
    alice.send({ type: "openProject", projectId: meta.id, generation: "g1" });
    expect((await alice.receive("snapshot")).seq).toBe(0);

    alice.send({ type: "submit", projectId: meta.id, generation: "g1", changeset: firstWall("c1") });
    expect(await alice.receive("changes")).toMatchObject({ seq: 1, clientId: "alice", changeset: { id: "c1" } });
    expect(await alice.receive("ack")).toMatchObject({ changesetId: "c1", seq: 1 });

    const bob = await connect("bob", "Bob");
    bob.send({ type: "openProject", projectId: meta.id, generation: "g7" });
    const snapshot = await bob.receive("snapshot");
    expect(snapshot.seq).toBe(1);
    expect(Object.keys(snapshot.doc.walls)).toEqual(["op1/w0"]);
    expect(snapshot.versions.walls).toEqual({ "op1/w0": "c1" });
  });

  it("answers a submission over 1 MB with tooLarge", async () => {
    const alice = await connect("alice", "Alice");
    alice.send({ type: "createProject", requestId: "r1", name: "Apartment" });
    const { meta } = await alice.receive("projectCreated");
    alice.send({ type: "openProject", projectId: meta.id, generation: "g1" });
    await alice.receive("snapshot");
    const wall = firstWall("c2");
    const padded = { ...wall, patch: { ...wall.patch, puts: wall.patch.puts.map((p) => ({ ...p, entity: { ...p.entity, pad: "x".repeat(MAX_MESSAGE_BYTES) } })) } };
    alice.sendRaw(JSON.stringify({ type: "submit", projectId: meta.id, generation: "g1", changeset: padded }));
    expect(await alice.receive("rejected")).toMatchObject({ changesetId: "c2", reason: { kind: "tooLarge" } });
  });
});
