import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The whole path as Claude Code runs it: the MCP server as a child process over stdio, connected to a real
// collaboration server process (packages/server/src/main.ts) on a random port with a temporary data directory.

const MCP_DIR = fileURLToPath(new URL("..", import.meta.url));
const SERVER_DIR = fileURLToPath(new URL("../../server", import.meta.url));

let server: ChildProcess | null = null;
let dataDir = "";
let url = "";

/** Starts the collaboration server on port 0 and reads the port it prints. */
function startServer(): Promise<string> {
  dataDir = mkdtempSync(join(tmpdir(), "fm-mcp-e2e-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: "0", DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server = child;
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const m = /listening on (ws:\/\/[\w.:]+:\d+)/.exec(out);
      if (m?.[1]) resolve(m[1]);
    });
    child.once("exit", (code) => reject(new Error(`server exited with ${code}: ${out}`)));
  });
}

beforeAll(async () => {
  url = await startServer();
}); // the shared 30 s hook limit (snags.20)

afterAll(() => {
  server?.kill();
  if (dataDir !== "") rmSync(dataDir, { recursive: true, force: true });
});

describe("the MCP server over stdio against a real server process", () => {
  it("creates a project, draws a room and reads it back", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/main.ts"],
      cwd: MCP_DIR,
      env: { ...getDefaultEnvironment(), FM_SERVER_URL: url },
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    try {
      // Inside the try so that close() still kills the child when the handshake fails.
      await client.connect(transport);
      expect((await client.callTool({ name: "create_project", arguments: { name: "E2E" } })).isError).toBe(false);
      expect((await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } })).isError).toBe(false);
      const r = await client.callTool({ name: "get_drawing", arguments: {} });
      const content = Array.isArray(r.content) ? r.content : [];
      const first: unknown = content[0];
      const text = typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
      expect(JSON.parse(text)).toMatchObject({ project: { name: "E2E", status: "saved" }, rooms: [{ area: 10.64 }] });
      // A size of Claude's own (sizing step 05, AC-15), through the real process.
      const placed = await client.callTool({ name: "place_object", arguments: { layout: "s0", kind: "wardrobe", centre: { x: 2, y: 1.5 }, width: 0.83, depth: 0.55 } });
      expect(placed.isError).toBe(false);
      const after = await client.callTool({ name: "get_drawing", arguments: {} });
      const afterContent: unknown = Array.isArray(after.content) ? after.content[0] : null;
      const afterText = typeof afterContent === "object" && afterContent !== null && "text" in afterContent && typeof afterContent.text === "string" ? afterContent.text : "";
      expect(JSON.parse(afterText)).toMatchObject({ objects: [{ kind: "wardrobe", sizes: { standard: { width: 0.83, depth: 0.55 } } }] });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("add_sheet over stdio reaches a second client through the real server, and read_report reads what set_sheet wrote", async () => {
    const start = async (): Promise<Client> => {
      const client = new Client({ name: "e2e", version: "0.0.0" });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/main.ts"], cwd: MCP_DIR, env: { ...getDefaultEnvironment(), FM_SERVER_URL: url }, stderr: "pipe" }));
      return client;
    };
    const json = (r: Awaited<ReturnType<Client["callTool"]>>): { project: { id: string }; result: { sheet: string }; sheets: { id: string; kind: string; title: string }[]; text: string } => {
      const first: unknown = Array.isArray(r.content) ? r.content[0] : undefined;
      expect(r.isError).toBe(false);
      return JSON.parse(typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "");
    };
    const claude = await start();
    const other = await start();
    try {
      const { project } = json(await claude.callTool({ name: "create_project", arguments: { name: "E2E sheets" } }));
      await claude.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } });
      const { result } = json(await claude.callTool({ name: "add_sheet", arguments: { kind: "report", title: "Project report", text: "# Draft" } }));
      await claude.callTool({ name: "set_sheet", arguments: { sheet: result.sheet, text: "# Studio\n\nThe words." } });
      await claude.callTool({ name: "set_project_field", arguments: { key: "north", value: "30" } });
      const seen = json(await other.callTool({ name: "open_project", arguments: { id: project.id } }));
      expect(seen.sheets.map((s) => [s.kind, s.title])).toEqual([["plan", "Layout"], ["report", "Project report"]]);
      expect(seen).toMatchObject({ fields: { north: "30" } });
      expect(json(await other.callTool({ name: "read_report", arguments: { sheet: result.sheet } })).text).toBe("# Studio\n\nThe words.");
    } finally {
      await claude.close();
      await other.close();
    }
  }, 30_000);

  it("add_section, look at it and delete it, over stdio against the real server", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/main.ts"],
      cwd: MCP_DIR,
      env: { ...getDefaultEnvironment(), FM_SERVER_URL: url },
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    const reply = (r: Awaited<ReturnType<Client["callTool"]>>): { result?: { section: string }; sections?: { id: string; side: string }[] } => {
      const first: unknown = Array.isArray(r.content) ? r.content[0] : undefined;
      expect(r.isError).toBe(false);
      return JSON.parse(typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "");
    };
    try {
      await client.connect(transport);
      reply(await client.callTool({ name: "create_project", arguments: { name: "E2E section" } }));
      reply(await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } }));
      const added = reply(await client.callTool({ name: "add_section", arguments: { a: { x: -1, y: 1 }, b: { x: 5, y: 1 }, side: "left" } }));
      expect(added.result).toEqual({ section: "A" });
      expect(reply(await client.callTool({ name: "get_drawing", arguments: {} })).sections).toEqual([{ id: "A", a: [-1, 1], b: [5, 1], side: "left", depth: null }]);
      const look = await client.callTool({ name: "look", arguments: { view: "section", section: "A" } });
      const content = Array.isArray(look.content) ? look.content : [];
      expect(content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
      expect(content[1]).toMatchObject({ type: "text", text: expect.stringContaining("A–A") });
      expect(reply(await client.callTool({ name: "delete", arguments: { ids: ["A"] } })).sections).toBeUndefined();
    } finally {
      await client.close();
    }
  }, 30_000);

  it("look returns an image over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/main.ts"],
      cwd: MCP_DIR,
      env: { ...getDefaultEnvironment(), FM_SERVER_URL: url },
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      expect((await client.callTool({ name: "create_project", arguments: { name: "E2E look" } })).isError).toBe(false);
      expect((await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } })).isError).toBe(false);
      const r = await client.callTool({ name: "look", arguments: {} });
      const content = Array.isArray(r.content) ? r.content : [];
      // The native resvg module loaded in the child process, under tsx, as Claude Code runs it.
      expect(content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    } finally {
      await client.close();
    }
  }, 30_000);
});
