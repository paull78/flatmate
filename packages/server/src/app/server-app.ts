import { assertNever, parseClientMessage } from "@fm/protocol";
import type { ClientMessage, ParseFailure, RejectReason, ServerMessage } from "@fm/protocol";
import { decideSubmit } from "./decide-submit";
import type { ChangesetValidator, ProjectRepository, ProjectState } from "./ports";
import { KeyedQueue } from "./queue";

export type Connection = { send(msg: ServerMessage): void; close(): void };
export type Session = { receive(raw: string): void; close(): void };
export type ServerApp = { connect(conn: Connection): Session; idle(): Promise<void> };
export type ServerAppDeps = { repository: ProjectRepository; validator: ChangesetValidator; onFatal(error: unknown): void };

export const PRESENCE_COLORS: readonly string[] = ["#e5484d", "#0090ff", "#30a46c", "#f76b15", "#8e4ec6", "#12a594"];

/** Queue key for list/create; project IDs never start with "#". */
const WORKSPACE_QUEUE = "#workspace";

type Identity = { clientId: string; name: string; color: string };
type Client = {
  conn: Connection;
  identity: Identity | null; // null until hello
  project: { projectId: string; generation: string } | null; // what the session asked for last
  closed: boolean;
};
/** Published state plus subscribers, each with the generation of its subscription. */
type LiveProject = { state: ProjectState; subscribers: Map<Client, string> };
type Submit = Extract<ClientMessage, { type: "submit" }>;
type Presence = Extract<ClientMessage, { type: "presence" }>;

export function createServerApp(deps: ServerAppDeps): ServerApp {
  const queue = new KeyedQueue();
  const live = new Map<string, LiveProject>();
  let joined = 0;
  let dead = false; // after onFatal the process is exiting: send nothing more

  function send(c: Client, msg: ServerMessage): void {
    if (!dead && !c.closed) c.conn.send(msg);
  }

  function fatal(error: unknown): void {
    if (dead) return;
    dead = true;
    deps.onFatal(error);
  }

  /** Every task that touches a project runs here. Any error is fatal (crash-only, spec §7.2). */
  function enqueue(key: string, task: () => Promise<void>): void {
    void queue
      .run(key, async () => {
        if (!dead) await task();
      })
      .catch(fatal);
  }

  function colorFor(n: number): string {
    return PRESENCE_COLORS[n % PRESENCE_COLORS.length] ?? "#e5484d";
  }

  async function loadLive(projectId: string): Promise<LiveProject | null> {
    const cached = live.get(projectId);
    if (cached) return cached;
    const state = await deps.repository.load(projectId);
    if (!state) return null;
    const project: LiveProject = { state, subscribers: new Map() };
    live.set(projectId, project);
    return project;
  }

  /** Drop the session's subscription at once; the others see presenceLeft. */
  function leave(c: Client): void {
    const current = c.project;
    const identity = c.identity;
    if (current === null || identity === null) return;
    const project = live.get(current.projectId);
    if (!project || !project.subscribers.delete(c)) return;
    for (const [other, generation] of project.subscribers) {
      send(other, { type: "presenceLeft", projectId: current.projectId, generation, clientId: identity.clientId });
    }
  }

  function open(c: Client, projectId: string, generation: string): void {
    leave(c);
    c.project = { projectId, generation };
    enqueue(projectId, async () => {
      const project = await loadLive(projectId);
      const current = c.project;
      if (c.closed || current === null || current.projectId !== projectId || current.generation !== generation) return; // superseded
      if (project === null) {
        c.project = null;
        send(c, { type: "openFailed", projectId, generation, message: "Unknown project" });
        return;
      }
      const { state } = project;
      send(c, { type: "snapshot", projectId, generation, meta: state.meta, doc: state.doc, versions: state.versions, seq: state.seq });
      project.subscribers.set(c, generation); // after the snapshot, before the next queued submission (spec §7.2.1)
    });
  }

  function submit(c: Client, identity: Identity, msg: Submit): void {
    const { projectId, generation, changeset } = msg;
    const reject = (reason: RejectReason): void =>
      send(c, { type: "rejected", projectId, generation, changesetId: changeset.id, reason });
    if (c.project === null || c.project.projectId !== projectId) {
      reject({ kind: "unknownProject" });
      return;
    }
    if (c.project.generation !== generation) return; // stale generation: the client has moved on (spec §7.2.1)

    enqueue(projectId, async () => {
      const project = live.get(projectId);
      if (!project) {
        reject({ kind: "unknownProject" });
        return;
      }
      const decision = decideSubmit(project.state, changeset, deps.validator);
      switch (decision.kind) {
        case "reject":
          reject(decision.reason);
          return;
        case "duplicate":
          send(c, { type: "ack", projectId, generation, changesetId: changeset.id, seq: decision.seq });
          return;
        case "accept":
          try {
            await deps.repository.save(decision.next);
          } catch (error) {
            fatal(error); // no ack, no rejection, nothing published (spec §7.2, §7.3)
            return;
          }
          project.state = decision.next;
          for (const [subscriber, subscriberGeneration] of project.subscribers) {
            send(subscriber, { type: "changes", projectId, generation: subscriberGeneration, seq: decision.seq, changeset, clientId: identity.clientId });
          }
          send(c, { type: "ack", projectId, generation, changesetId: changeset.id, seq: decision.seq });
          return;
        default:
          assertNever(decision);
      }
    });
  }

  /**
   * In the project's queue: after a save in progress, before every later submit or open (spec §7.2.1).
   * Later submits find no live project and are rejected as unknownProject; presence is ignored.
   */
  function remove(c: Client, requestId: string, projectId: string): void {
    enqueue(projectId, async () => {
      const project = await loadLive(projectId);
      if (project === null) {
        send(c, { type: "error", requestId, message: "Unknown project" });
        return;
      }
      await deps.repository.remove(projectId);
      live.delete(projectId);
      for (const [subscriber, generation] of project.subscribers) {
        send(subscriber, { type: "projectDeleted", projectId, generation });
      }
      send(c, { type: "projects", requestId, items: await deps.repository.list() });
    });
  }

  function presence(c: Client, identity: Identity, msg: Presence): void {
    const { projectId, generation, cursor, selection } = msg;
    const current = c.project;
    if (current === null || current.projectId !== projectId || current.generation !== generation) return;
    const project = live.get(projectId);
    if (!project || !project.subscribers.has(c)) return;
    for (const [other, otherGeneration] of project.subscribers) {
      if (other === c) continue;
      send(other, { type: "presence", projectId, generation: otherGeneration, clientId: identity.clientId, name: identity.name, color: identity.color, cursor, selection });
    }
  }

  function handle(c: Client, identity: Identity, msg: ClientMessage): void {
    switch (msg.type) {
      case "hello":
        return; // the identity is fixed by the first hello
      case "listProjects": {
        const { requestId } = msg;
        enqueue(WORKSPACE_QUEUE, async () => {
          const items = await deps.repository.list();
          send(c, { type: "projects", requestId, items });
        });
        return;
      }
      case "createProject": {
        const { requestId, name } = msg;
        enqueue(WORKSPACE_QUEUE, async () => {
          const state = await deps.repository.create(name);
          live.set(state.meta.id, { state, subscribers: new Map() });
          send(c, { type: "projectCreated", requestId, meta: state.meta });
        });
        return;
      }
      case "deleteProject":
        return remove(c, msg.requestId, msg.projectId);
      case "openProject":
        return open(c, msg.projectId, msg.generation);
      case "submit":
        return submit(c, identity, msg);
      case "presence":
        return presence(c, identity, msg);
      default:
        return assertNever(msg);
    }
  }

  function reasonText(reason: RejectReason): string {
    switch (reason.kind) {
      case "malformed":
        return reason.message;
      case "tooLarge":
        return "Message too large";
      case "unknownProject":
        return "Unknown project";
      case "conflict":
        return "Conflict";
      case "invalid":
        return reason.violations.join("; ");
      default:
        return assertNever(reason);
    }
  }

  function closeConnection(c: Client): void {
    c.closed = true;
    c.conn.close();
  }

  function rejectUnparsed(c: Client, failure: ParseFailure): void {
    if (c.identity === null) return closeConnection(c);
    if (failure.changesetId !== null && c.project !== null) {
      send(c, { type: "rejected", projectId: c.project.projectId, generation: c.project.generation, changesetId: failure.changesetId, reason: failure.reason });
      return;
    }
    send(c, { type: "error", requestId: null, message: reasonText(failure.reason) });
  }

  function connect(conn: Connection): Session {
    const c: Client = { conn, identity: null, project: null, closed: false };
    return {
      receive(raw: string): void {
        if (c.closed || dead) return;
        const parsed = parseClientMessage(raw);
        if (!parsed.ok) return rejectUnparsed(c, parsed.error);
        const msg = parsed.value;
        if (c.identity !== null) return handle(c, c.identity, msg);
        if (msg.type !== "hello") return closeConnection(c);
        c.identity = { clientId: msg.clientId, name: msg.name, color: colorFor(joined++) };
        send(c, { type: "welcome", clientId: msg.clientId, color: c.identity.color });
      },
      close(): void {
        leave(c);
        c.closed = true;
      },
    };
  }

  return { connect, idle: () => queue.idle() };
}
