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
      const m = /listening on (ws:\/\/localhost:\d+)/.exec(out);
      if (m?.[1]) resolve(m[1]);
    });
    child.once("exit", (code) => reject(new Error(`server exited with ${code}: ${out}`)));
  });
}

beforeAll(async () => {
  url = await startServer();
}, 20_000);

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
      expect((await client.callTool({ name: "draw_room", arguments: { x: 0, y: 0, width: 4, height: 3 } })).isError).toBe(false);
      const r = await client.callTool({ name: "get_drawing", arguments: {} });
      const content = Array.isArray(r.content) ? r.content : [];
      const first: unknown = content[0];
      const text = typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
      expect(JSON.parse(text)).toMatchObject({ project: { name: "E2E", status: "saved" }, rooms: [{ area: 10.64 }] });
    } finally {
      await client.close();
    }
  }, 30_000);
});
