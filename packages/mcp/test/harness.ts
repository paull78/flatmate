import { parseServerMessage, type ClientMessage, type ServerMessage } from "@fm/protocol";
import { createInMemoryRepository, createServerApp, domainValidator, type ServerApp, type Session } from "@fm/server";
import { createNodeHost } from "../src/node-host";
import { EditorSession, type LinkHandlers, type ServerLink } from "../src/session";

/**
 * An in-memory connection to the real server app. Messages go through JSON and the protocol parser in both directions
 * and arrive asynchronously, like a socket. `hold()` keeps server messages back until `release()` (latency).
 */
export class MemoryLink implements ServerLink {
  private session: Session | null;
  private holding = false;
  private held: ServerMessage[] = [];
  private readonly handlers: LinkHandlers;

  constructor(app: ServerApp, handlers: LinkHandlers) {
    this.handlers = handlers;
    this.session = app.connect({ send: (m) => this.arrive(m), close: () => this.drop() });
    queueMicrotask(() => {
      if (this.session !== null) handlers.open();
    });
  }

  send(msg: ClientMessage): void {
    this.session?.receive(JSON.stringify(msg));
  }

  close(): void {
    this.drop();
  }

  hold(): void {
    this.holding = true;
  }

  release(): void {
    this.holding = false;
    for (const m of this.held.splice(0)) this.handlers.message(m);
  }

  /** The connection drops: held and queued messages are lost. */
  drop(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.held = [];
    session.close();
    this.handlers.close();
  }

  private arrive(m: ServerMessage): void {
    const parsed = parseServerMessage(JSON.stringify(m));
    if (!parsed.ok) throw new Error(`server sent an unparsable message: ${parsed.error}`);
    queueMicrotask(() => {
      if (this.session === null) return;
      if (this.holding) this.held.push(parsed.value);
      else this.handlers.message(parsed.value);
    });
  }
}

/** The real server app (in-memory repository, domain validator) and the sessions connected to it. */
export class TestServer {
  readonly app: ServerApp;
  readonly fatal: unknown[] = [];

  constructor() {
    this.app = createServerApp({ repository: createInMemoryRepository(), validator: domainValidator, onFatal: (e) => void this.fatal.push(e) });
  }

  /** A headless editor session named `name`, as the MCP server runs it, over a memory link. */
  join(name: string, timeoutMs = 2000): { session: EditorSession; link: MemoryLink } {
    const links: MemoryLink[] = [];
    const session = new EditorSession({
      clientId: name.toLowerCase(),
      name,
      host: createNodeHost(),
      timeoutMs,
      connect: (handlers) => {
        const link = new MemoryLink(this.app, handlers);
        links.push(link);
        return link;
      },
    });
    const link = links[0];
    if (link === undefined) throw new Error("connect was not called");
    return { session, link };
  }

  /** Lets the server finish queued work and every link deliver. */
  async settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await this.app.idle();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
