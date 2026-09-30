import { execute, type Command, type Document } from "@fm/domain";
import {
  buildViewModel, clientMessageFor, hasPendingEdit, initialState, NO_MODS, serverMessageEvent, update, visibleDoc,
  worldToScreen, type DocumentStatus, type EditorState, type Effect, type Event, type Host, type ServerEffect,
} from "@fm/editor";
import { err, ok, type ClientMessage, type Point, type ProjectMeta, type Result, type ServerMessage } from "@fm/protocol";

// The MCP shell's editor session (spec §12): one headless editor connected to the collaboration server as a
// normal client. State changes only through `update`; server effects go to the link, server messages come back as
// events. Each operation waits for the outcome the editor reports, so a tool call returns a settled result.

/** Handlers are never called synchronously from `connect`. */
export type LinkHandlers = { open(): void; message(msg: ServerMessage): void; close(): void };
/** `send` drops messages while the link is closed, like a closed socket; the editor resyncs after reconnecting. */
export type ServerLink = { send(msg: ClientMessage): void; close(): void };
export type Connect = (handlers: LinkHandlers) => ServerLink;

export type SessionOptions = { clientId: string; name: string; host: Host; connect: Connect; timeoutMs?: number };
export type OpenProject = { id: string; name: string; status: DocumentStatus };

export const DEFAULT_TIMEOUT_MS = 10_000;
export const NOT_CONNECTED = "Not connected to the Flatmate server: start it with `pnpm dev:server`";
export const NO_DRAWING = "No project is open: call open_project or create_project first";
export const CONNECTION_DROPPED =
  "The connection to the server dropped before it answered. A submitted edit settles after reconnecting; call get_drawing to check";
export const NO_ANSWER = "The server did not answer in time. A submitted edit settles when it does; call get_drawing to check";

const VIEWPORT = { width: 1200, height: 800 };

/**
 * Why `editAll` stopped: `done` commands went through; `refused` means the pre-check refused the command at index
 * `at`, so none was submitted (`at` is -1 otherwise).
 */
export type EditAllError = { error: string; done: number; refused: boolean; at: number };

type Probe<T> = (msg: ServerMessage | null) => T | null;
type SubmitEffect = Extract<Effect, { type: "submit" }>;

/** The first domain error the commands would raise on `doc`, run in order, and the index of its command; or null. */
function firstError(doc: Document, commands: Command[]): { at: number; message: string } | null {
  let d = doc;
  for (const [at, command] of commands.entries()) {
    const r = execute(d, command);
    if (!r.ok) return { at, message: r.error.message };
    d = r.value.doc;
  }
  return null;
}

function isServerEffect(e: Effect): e is ServerEffect {
  return e.type === "workspace" || e.type === "submit" || e.type === "presence";
}

function isSubmit(e: Effect): e is SubmitEffect {
  return e.type === "submit";
}

export class EditorSession {
  private state: EditorState;
  private readonly host: Host;
  private readonly clientId: string;
  private readonly name: string;
  private readonly timeoutMs: number;
  private readonly link: ServerLink;
  private connected = false;
  private readonly waiters = new Set<(msg: ServerMessage | null) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: SessionOptions) {
    this.host = opts.host;
    this.clientId = opts.clientId;
    this.name = opts.name;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.state = initialState({ mode: "server", me: { clientId: opts.clientId, name: opts.name }, viewport: VIEWPORT, dpr: 1 }, opts.host);
    this.link = opts.connect({
      open: () => this.onOpen(),
      message: (msg) => this.dispatch(serverMessageEvent(msg), msg),
      close: () => this.onClose(),
    });
  }

  newId(): string {
    return this.host.newId();
  }

  /** The drawing as the editor shows it (confirmed plus any pending edit), or null with no project open. */
  drawing(): Document | null {
    return this.state.document ? visibleDoc(this.state.document) : null;
  }

  project(): OpenProject | null {
    const d = this.state.document;
    const view = buildViewModel(this.state, this.host).project;
    return d && view ? { id: d.project.id, name: d.project.name, status: view.status } : null;
  }

  /** Goes to the project list, like the web app's project list button: leaves the open drawing. */
  listProjects(): Promise<Result<ProjectMeta[], string>> {
    return this.serial(async () => {
      if (!(await this.ready())) return err(NOT_CONNECTED);
      const refused = this.toastOf(() => this.dispatch({ type: "ui", action: { type: "showProjectList" } }, null));
      if (refused !== null) return err(refused);
      return this.waitFor<Result<ProjectMeta[], string>>(() => {
        const w = this.state.workspace;
        if (w.loading) return this.connected ? null : err(NOT_CONNECTED);
        return w.error !== null ? err(w.error) : ok(w.projects);
      }, err(NO_ANSWER));
    });
  }

  /** Creates a project and opens it. */
  createProject(name: string): Promise<Result<OpenProject, string>> {
    return this.serial(async () => {
      if (!(await this.ready())) return err(NOT_CONNECTED);
      let effects: Effect[] = [];
      const refused = this.toastOf(() => {
        effects = this.dispatch({ type: "ui", action: { type: "createProject", name } }, null);
      });
      if (refused !== null) return err(refused);
      const requestId = effects.flatMap((e) => (e.type === "workspace" && e.op.type === "create" ? [e.op.requestId] : []))[0];
      if (requestId === undefined) return err("The editor did not ask the server to create the project");
      const created = await this.waitFor<Result<ProjectMeta, string>>((msg) => {
        if (msg?.type === "projectCreated" && msg.requestId === requestId) return ok(msg.meta);
        if (msg?.type === "error" && msg.requestId === requestId) return err(msg.message);
        return this.connected ? null : err(CONNECTION_DROPPED);
      }, err(NO_ANSWER));
      return created.ok ? this.openNow(created.value.id) : created;
    });
  }

  openProject(projectId: string): Promise<Result<OpenProject, string>> {
    return this.serial(async () => {
      if (!(await this.ready())) return err(NOT_CONNECTED);
      return this.openNow(projectId);
    });
  }

  /**
   * One domain command through the editor's commit path. Resolves when the outcome is known: accepted by the
   * server (or nothing to change), refused by the editor (the toast text), or rejected by the server (the toast
   * text); or when the connection drops or the server does not answer in time.
   */
  edit(command: Command): Promise<Result<null, string>> {
    return this.serial(() => this.editNow(command));
  }

  /**
   * Several commands in one serial slot, so no other tool call runs between them. They are first run together with
   * `execute` on the current drawing: if the rules refuse any, nothing is submitted (`refused`, `at`). Then each goes
   * through `edit`'s path in turn; a remote edit in between, a dropped connection or no answer can stop them after
   * `done` of them.
   */
  editAll(commands: Command[]): Promise<Result<null, EditAllError>> {
    return this.serial(async () => {
      const doc = this.drawing();
      if (doc === null) return err({ error: NO_DRAWING, done: 0, refused: false, at: -1 });
      const refusal = firstError(doc, commands);
      if (refusal !== null) return err({ error: refusal.message, done: 0, refused: true, at: refusal.at });
      for (const [done, command] of commands.entries()) {
        const r = await this.editNow(command);
        if (!r.ok) return err({ error: r.error, done, refused: false, at: -1 });
      }
      return ok(null);
    });
  }

  /** Moves this client's cursor to a world point, so other windows show it there (presence, spec §7.6). */
  pointAt(p: Point): void {
    if (this.state.document === null) return;
    this.dispatch({ type: "pointerMove", screen: worldToScreen(this.state.camera, p), mods: NO_MODS, button: 0 }, null);
  }

  /** The other clients in the open project and where their cursors are. */
  collaborators(): { name: string; at: Point | null }[] {
    return buildViewModel(this.state, this.host).presence.map((p) => ({ name: p.name, at: p.at }));
  }

  close(): void {
    this.link.close();
  }

  private onOpen(): void {
    this.connected = true;
    this.link.send({ type: "hello", clientId: this.clientId, name: this.name });
    this.dispatch({ type: "serverEvent", event: { type: "connection", state: "open" } }, null);
  }

  private onClose(): void {
    this.connected = false;
    this.dispatch({ type: "serverEvent", event: { type: "connection", state: "closed" } }, null);
  }

  /** The only place the session changes editor state (spec §5.1). */
  private dispatch(event: Event, cause: ServerMessage | null): Effect[] {
    const r = update(this.state, event, this.host);
    this.state = r.state;
    for (const e of r.effects) if (isServerEffect(e)) this.link.send(clientMessageFor(e));
    for (const w of [...this.waiters]) w(cause);
    return r.effects;
  }

  /** Runs `act`; returns the text of a toast it raised (a refusal or an error), or null. */
  private toastOf(act: () => void): string | null {
    const before = this.state.toast;
    act();
    const after = this.state.toast;
    return after !== null && after !== before ? after.text : null;
  }

  private async editNow(command: Command): Promise<Result<null, string>> {
    if (this.state.document === null) return err(NO_DRAWING);
    let effects: Effect[] = [];
    const refused = this.toastOf(() => {
      effects = this.dispatch({ type: "command", command }, null);
    });
    const submit = effects.find(isSubmit);
    if (submit === undefined) return refused === null ? ok(null) : err(refused);
    const id = submit.changeset.id;
    return this.waitFor<Result<null, string>>((msg) => {
      const d = this.state.document;
      if (d !== null && hasPendingEdit(d)) return this.connected ? null : err(CONNECTION_DROPPED);
      if (msg?.type === "rejected" && msg.changesetId === id) return err(this.state.toast?.text ?? "The server rejected the edit");
      return ok(null);
    }, err(NO_ANSWER));
  }

  private async openNow(projectId: string): Promise<Result<OpenProject, string>> {
    const current = this.project();
    if (current !== null && current.id === projectId && this.state.workspace.opening === null) return ok(current); // open and live
    if (this.state.workspace.opening?.projectId !== projectId) {
      const refused = this.toastOf(() => this.dispatch({ type: "ui", action: { type: "openProject", id: projectId } }, null));
      if (refused !== null) return err(refused);
    }
    const generation = this.state.workspace.opening?.generation;
    if (generation === undefined) return err("The editor did not start opening the project");
    return this.waitFor<Result<OpenProject, string>>((msg) => {
      const project = this.project();
      if (project !== null && project.id === projectId && this.state.workspace.opening === null) return ok(project);
      if (msg?.type === "openFailed" && msg.generation === generation) return err(msg.message);
      return this.connected ? null : err(CONNECTION_DROPPED);
    }, err(NO_ANSWER));
  }

  /** Waits for the connection: at startup the socket may still be opening. */
  private ready(): Promise<boolean> {
    return this.waitFor<boolean>(() => (this.connected ? true : null), false);
  }

  /** Resolves with the first non-null probe result, checked now and after every dispatch; `onTimeout` after the timeout. */
  private waitFor<T>(probe: Probe<T>, onTimeout: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const finish = (value: T): void => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(value);
      };
      const check = (msg: ServerMessage | null): void => {
        const value = probe(msg);
        if (value !== null) finish(value);
      };
      const timer = setTimeout(() => finish(onTimeout), this.timeoutMs);
      this.waiters.add(check);
      check(null);
    });
  }

  /** Tool calls run one at a time, in arrival order: each sees the settled outcome of the one before. */
  private serial<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
