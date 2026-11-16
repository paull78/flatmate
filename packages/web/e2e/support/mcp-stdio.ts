import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

// The MCP server as Claude Code runs it: a child process speaking JSON-RPC over stdio (one JSON message per line),
// connected to the collaboration server. Handwritten client: the web package does not depend on the MCP SDK.

const MCP_DIR = fileURLToPath(new URL("../../../mcp", import.meta.url));

export type McpContent = { type: string; text?: string; data?: string; mimeType?: string };
/** `call` parses the first content item's text as JSON; `content` returns the items as sent (`look` sends an image first). */
export type McpClient = {
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;
  content(tool: string, args?: Record<string, unknown>): Promise<McpContent[]>;
  close(): void;
};

export async function startMcp(serverUrl: string): Promise<McpClient> {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: MCP_DIR,
    env: { ...process.env, FM_SERVER_URL: serverUrl },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map<number, (msg: Record<string, unknown>) => void>();
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (line === "") continue;
      const msg: unknown = JSON.parse(line);
      if (typeof msg === "object" && msg !== null && "id" in msg && typeof msg.id === "number") waiting.get(msg.id)?.({ ...msg });
    }
  });
  let next = 1;
  const request = (method: string, params: unknown): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const items = async (tool: string, args: Record<string, unknown>): Promise<McpContent[]> => {
    const reply = await request("tools/call", { name: tool, arguments: args });
    const result = reply.result;
    const content: unknown[] = typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content) ? result.content : [];
    const out = content.map((c): McpContent => {
      const field = (key: string): string | undefined => {
        const v: unknown = typeof c === "object" && c !== null ? Reflect.get(c, key) : undefined;
        return typeof v === "string" ? v : undefined;
      };
      const text = field("text");
      const data = field("data");
      const mimeType = field("mimeType");
      return { type: field("type") ?? "", ...(text === undefined ? {} : { text }), ...(data === undefined ? {} : { data }), ...(mimeType === undefined ? {} : { mimeType }) };
    });
    const isError = typeof result === "object" && result !== null && "isError" in result && result.isError === true;
    if (isError) throw new Error(`${tool}: ${out[0]?.text ?? ""}`);
    return out;
  };
  return {
    async call(tool, args = {}) {
      return JSON.parse((await items(tool, args))[0]?.text ?? "");
    },
    content: (tool, args = {}) => items(tool, args),
    close() {
      child.kill();
    },
  };
}
