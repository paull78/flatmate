import { parseServerMessage, type ServerMessage, type StoredDocument } from "@fm/protocol";
import { SERVER } from "./server";

// The project as the collaboration server stores it, read over a raw WebSocket: the server's data directory is a
// per-run temp dir the tests can't find. The server closes a socket whose first message isn't a hello.


let peeks = 0;

type Peek = { send(msg: Record<string, unknown>): void; next(match: (m: ServerMessage) => boolean): Promise<ServerMessage>; close(): void };

async function connect(): Promise<Peek> {
  const ws = new WebSocket(SERVER);
  const inbox: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener("message", (e) => {
    const parsed = parseServerMessage(typeof e.data === "string" ? e.data : "");
    if (parsed.ok) inbox.push(parsed.value);
    for (const wake of waiters.splice(0)) wake();
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error(`no server at ${SERVER}`)));
  });
  const id = `peek-${++peeks}`;
  ws.send(JSON.stringify({ type: "hello", clientId: id, name: "Peek" }));
  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    async next(match) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const i = inbox.findIndex(match);
        const found = i >= 0 ? inbox.splice(i, 1)[0] : undefined;
        if (found !== undefined) return found;
        if (Date.now() > deadline) throw new Error("no reply from the server");
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 200);
        });
      }
    },
    close: () => ws.close(),
  };
}

async function projectIds(peek: Peek, name: string): Promise<string[]> {
  const requestId = `list-${++peeks}`;
  peek.send({ type: "listProjects", requestId });
  const reply = await peek.next((m) => m.type === "projects" && m.requestId === requestId);
  return reply.type === "projects" ? reply.items.filter((p) => p.name === name).map((p) => p.id) : [];
}

/** The stored document of the project with this name, as a fresh client's snapshot gets it. */
export async function storedDocument(projectName: string): Promise<StoredDocument> {
  const peek = await connect();
  try {
    const [projectId] = await projectIds(peek, projectName);
    if (projectId === undefined) throw new Error(`no project ${projectName}`);
    peek.send({ type: "openProject", projectId, generation: "peek" });
    const reply = await peek.next((m) => m.type === "snapshot" && m.projectId === projectId);
    if (reply.type !== "snapshot") throw new Error("no snapshot");
    return reply.doc;
  } finally {
    peek.close();
  }
}

export type StoredUnderlay = {
  pictureId: string;
  mime: string;
  data: string;
  width: number;
  height: number;
  at: { x: number; y: number };
  metresPerPixel: number;
  scaled: boolean;
};

/** The project's one underlay row (under its fixed id "underlay"), or null when it has none. */
export async function storedUnderlay(projectName: string): Promise<StoredUnderlay | null> {
  const row = (await storedDocument(projectName)).underlays["underlay"];
  if (row === undefined) return null;
  const { pictureId, mime, data, width, height, at, metresPerPixel, scaled } = row;
  if (
    typeof pictureId !== "string" ||
    typeof mime !== "string" ||
    typeof data !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof metresPerPixel !== "number" ||
    typeof scaled !== "boolean" ||
    typeof at !== "object" ||
    at === null ||
    !("x" in at) ||
    !("y" in at) ||
    typeof at.x !== "number" ||
    typeof at.y !== "number"
  ) {
    throw new Error("malformed underlay row");
  }
  return { pictureId, mime, data, width, height, at: { x: at.x, y: at.y }, metresPerPixel, scaled };
}

/** Deletes every project with one of these names, waiting for each deletion's reply. */
export async function deleteProjects(names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  const peek = await connect();
  try {
    for (const name of names) {
      for (const projectId of await projectIds(peek, name)) {
        const requestId = `delete-${++peeks}`;
        peek.send({ type: "deleteProject", requestId, projectId });
        await peek.next((m) => (m.type === "projects" || m.type === "error") && m.requestId === requestId);
      }
    }
  } finally {
    peek.close();
  }
}
