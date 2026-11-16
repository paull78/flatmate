import { parseServerMessage, type ClientMessage, type ServerMessage } from "@fm/protocol";
import { createInMemoryRepository, createServerApp, domainValidator, type ProjectRepository, type ServerApp, type Session } from "@fm/server";
import { createNodeHost } from "../src/node-host";
import { EditorSession, type LinkHandlers, type ServerLink } from "../src/session";
import type { DrawingSummary } from "../src/drawing";
import type { DrawingTools, Reply } from "../src/tool-types";

type Listed = DrawingSummary["objects"][number];
type Place = NonNullable<Listed["placement"]>;
/** A listed piece with a place per layout, as every listing gave it before mcp.12. */
export type ListedObject = Omit<Listed, "placement" | "placements"> & { placements: Record<string, Place | null> };
export type Listing = Omit<DrawingSummary, "objects"> & { objects: ListedObject[] };

/**
 * A listing with every piece's place given per layout: a piece listed once (`placement`, the same in every layout,
 * mcp.12) gets that place under each layout. For tests about fit and moves, not about the listing's shape
 * (listing.test.ts).
 */
export function perLayout<T>(listing: T): T {
  if (typeof listing !== "object" || listing === null || !("objects" in listing) || !("layouts" in listing)) return listing;
  const { objects, layouts: states } = listing;
  if (!Array.isArray(objects) || !Array.isArray(states)) return listing;
  const ids: unknown[] = states.map((s: unknown) => (typeof s === "object" && s !== null && "id" in s ? s.id : null));
  const expanded = objects.map((o: unknown) => {
    if (typeof o !== "object" || o === null || !("placement" in o)) return o;
    const { placement, ...rest } = o;
    return { ...rest, placements: Object.fromEntries(ids.map((id) => [id, placement])) };
  });
  return { ...listing, objects: expanded };
}

/**
 * The tools with each accepted edit's reply followed by the listing, as Claude reads it with get_drawing after an
 * edit (mcp.01), and every listing per layout (perLayout): for tests about what an edit did to the drawing, not about
 * the reply's or the listing's shape (edit-replies.test.ts, listing.test.ts).
 */
export function withListings(tools: DrawingTools): DrawingTools {
  const read = async (r: Reply): Promise<Reply> => {
    if (r.isError || !r.text.startsWith("{")) return r;
    const reply: unknown = JSON.parse(r.text);
    if (typeof reply !== "object" || reply === null) return r;
    if (!("changed" in reply)) return { text: JSON.stringify(perLayout(reply)), isError: false };
    const listing: unknown = JSON.parse((await tools.getDrawing({})).text);
    return { text: JSON.stringify(perLayout({ ...reply, ...(typeof listing === "object" ? listing : {}) })), isError: false };
  };
  const wrapped: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(tools)) {
    wrapped[name] = typeof fn === "function" ? async (...args: unknown[]) => {
      const r: unknown = await Reflect.apply(fn, tools, args);
      return typeof r === "object" && r !== null && "text" in r && !("png" in r) ? read(r as Reply) : r;
    } : fn;
  }
  return wrapped as DrawingTools;
}

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

  constructor(repository: ProjectRepository = createInMemoryRepository()) {
    this.app = createServerApp({ repository, validator: domainValidator, onFatal: (e) => void this.fatal.push(e) });
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
