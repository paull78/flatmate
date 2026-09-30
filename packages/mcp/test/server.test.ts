import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, TOOL_NAMES } from "../src/server";
import type { EditorSession } from "../src/session";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** An MCP client connected in memory to the MCP server of a session on the real server app. */
async function connect(): Promise<{ client: Client; session: EditorSession }> {
  const session = new TestServer().join("Claude").session;
  const mcp = createMcpServer(createTools(session));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
    session.close();
  });
  return { client, session };
}

function textOf(r: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = Array.isArray(r.content) ? r.content : [];
  const first: unknown = content[0];
  return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
}

describe("the MCP server (in memory, no stdio)", () => {
  it("lists the twelve tools with their input schemas", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toHaveLength(12);
    expect(tools.find((t) => t.name === "add_walls")?.inputSchema.required).toEqual(["walls"]);
    const drawRoom = tools.find((t) => t.name === "draw_room");
    expect(Object.keys(drawRoom?.inputSchema.properties ?? {})).toEqual(["x", "y", "width", "height"]);
  });

  it("calls a tool end to end: create_project, then draw_room", async () => {
    const { client } = await connect();
    expect((await client.callTool({ name: "create_project", arguments: { name: "Apartment" } })).isError).toBe(false);
    const r = await client.callTool({ name: "draw_room", arguments: { x: 0, y: 0, width: 4, height: 3 } });
    expect(r.isError).toBe(false);
    expect(JSON.parse(textOf(r)).rooms[0].area).toBe(10.64);
  });

  it("refuses invalid input before the handler runs", async () => {
    const { client, session } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const r = await client.callTool({ name: "draw_room", arguments: { x: 0, y: 0, width: -4, height: 3 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("width");
    expect(Object.keys(session.drawing()?.walls ?? {})).toEqual([]);
  });

  it("refuses add_walls with no walls before the handler runs", async () => {
    const { client, session } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const r = await client.callTool({ name: "add_walls", arguments: { walls: [] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("walls");
    expect(textOf(r)).toContain("Input validation error");
    expect(Object.keys(session.drawing()?.walls ?? {})).toEqual([]);
  });
});
