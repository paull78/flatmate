import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DrawingSummary } from "../src/drawing";
import { createMcpServer } from "../src/server";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// An L keeps one handrail value through Claude's tools (AC-13, guards.33): set_stair's handrail on either flight sets
// both. An 8 × 6 room under a 3.05 ceiling with a loft over x 0.1–2.1, y 1.5–4.5, top 2.15; the L's upper flight has
// its back on the loft's right edge at (2.1, 3).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string; objects?: string[]; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function withEll(): Promise<{ tools: DrawingTools; flights: string[] }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Loft" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 8, depth: 6 }));
  summary(await tools.setCeiling({ height: 3.05 }));
  const loft = summary(await tools.addDeck({ preset: "loft", centre: { x: 1.1, y: 3 }, width: 2, depth: 3 })).result.deck ?? "";
  const placed = summary(await tools.addStair({ layout: "s0", kind: "stair", deck: loft, at: { x: 2.1, y: 3 }, shape: "l-right" }));
  return { tools, flights: placed.result.objects ?? [] };
}
/** Each flight's rails when both its sides agree (edges.06), else both. */
const handrails = (s: DrawingSummary, ids: string[]): unknown[] => ids.map((id) => {
  const sides = s.objects.find((o) => o.id === id)?.stair?.handrails;
  return sides === undefined ? undefined : sides.left === sides.right ? sides.left : sides;
});

describe("set_stair's handrail on an L (AC-13)", () => {
  it.each([0, 1])("set on flight %i, get_drawing lists it on both", async (i) => {
    const { tools, flights } = await withEll();
    expect(flights).toHaveLength(2);
    expect(handrails(summary(await tools.getDrawing()), flights)).toEqual(["railing", "railing"]);
    const set = summary(await tools.setStair({ object: flights[i] ?? "", handrail: "glass" }));
    expect(handrails(set, flights)).toEqual(["glass", "glass"]);
  });

  it("set_stair's description says an L's flights share it", async () => {
    const session = new TestServer().join("Claude").session;
    sessions.push(session);
    const mcp = createMcpServer(withListings(createTools(session)));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
    const { tools } = await client.listTools();
    await client.close();
    await mcp.close();
    expect(tools.find((t) => t.name === "set_stair")?.description).toContain("shared by both flights of an L");
  });
});
