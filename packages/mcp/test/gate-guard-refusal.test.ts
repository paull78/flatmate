import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";

// The final gate's AC-09 gap: a guard no choice offers is refused by the MCP server itself, and the refusal says why: it
// names the field and the three values. Through a real MCP client, in memory, on a session of the real server app.

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function connect(): Promise<Client> {
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
  return client;
}

function textOf(r: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = Array.isArray(r.content) ? r.content : [];
  const first: unknown = content[0];
  return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
}

describe("a refused guard over MCP (AC-09)", () => {
  it("set_deck and add_deck name the field and the three values, and change nothing", async () => {
    const client = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Cabin" } });
    await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } });
    const added = JSON.parse(textOf(await client.callTool({ name: "add_deck", arguments: { preset: "loft", centre: { x: 1.1, y: 1.5 }, width: 2, depth: 2.8 } })));
    const deck: string = added.result.deck;
    const refused: { name: string; args: Record<string, unknown> }[] = [
      { name: "set_deck", args: { deck, guard: "wood" } },
      { name: "add_deck", args: { preset: "platform", centre: { x: 3, y: 1.5 }, width: 1, depth: 1, guard: "Railing" } },
    ];
    for (const { name, args } of refused) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
      const text = textOf(r);
      expect(text, name).toContain(name);
      expect(text, name).toMatch(/\bguard\b/);
      for (const value of ["railing", "glass", "none"]) expect(text, `${name}: ${value}`).toContain(`"${value}"`);
    }
    const drawing = JSON.parse(textOf(await client.callTool({ name: "get_drawing", arguments: {} })));
    expect(drawing.decks.map((d: { id: string; guards: { upper: { kind: string } } }) => [d.id, d.guards.upper.kind])).toEqual([[deck, "railing"]]);
  });
});
