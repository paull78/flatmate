import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNodeHost } from "./node-host";
import { createMcpServer } from "./server";
import { EditorSession } from "./session";
import { createTools } from "./tools";
import { wsConnect } from "./ws-link";

// Composition root. stdout carries the MCP protocol: log to stderr only.

const url = process.env.FM_SERVER_URL ?? "ws://localhost:8787";
const name = process.env.FM_NAME ?? "Claude";

const host = createNodeHost();
const session = new EditorSession({ clientId: host.newId(), name, host, connect: wsConnect(url) });
const server = createMcpServer(createTools(session));

// The client closing stdin ends the session; the reconnect timer would otherwise keep the process alive.
process.stdin.on("end", () => {
  session.close();
  void server.close().finally(() => process.exit(0));
});

await server.connect(new StdioServerTransport());
console.error(`[fm-mcp] ready on stdio as "${name}"; collaboration server ${url}`);
