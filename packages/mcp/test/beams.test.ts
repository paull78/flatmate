import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server";
import type { EditorSession } from "../src/session";
import { createTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Beams over MCP (beams.03, .05; AC-08): place_object takes the kind and a preset; a beam stretched into both walls is
// accepted; get_drawing lists it in every layout with its "ceiling" elevation; the description says so.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});
type Placed = DrawingSummary & { result: { object?: string } };
const parsed = (r: Reply): Placed => {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
};

describe("a beam through place_object", () => {
  it("a Collar tie is placed, stretched into both walls, and listed in both layouts hung from the ceiling", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = withListings(createTools(claude));
    parsed(await tools.createProject({ name: "Beams" }));
    parsed(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 3, depth: 3 }));
    parsed(await tools.addLayout({ name: "Night" }));
    const placed = parsed(await tools.placeObject({ layout: "s0", kind: "beam", preset: "Collar tie", centre: { x: 1.5, y: 1.5 } }));
    const id = placed.result.object ?? "";
    // 3.20 m: from x −0.1 to 3.1, into both side walls.
    const sized = parsed(await tools.setSize({ object: id, width: 3.2, depth: 0.1 }));
    const beam = sized.objects.find((o) => o.id === id);
    expect(beam?.kind).toBe("beam");
    expect(beam?.sizes.standard).toEqual({ width: 3.2, depth: 0.1, height: 0.15, elevation: "ceiling" });
    expect(Object.values(beam?.placements ?? {}).filter((p) => p !== null)).toHaveLength(2);
  });

  it("place_object's description says a beam may run into walls and a ceiling-hung piece hangs from what is over it", async () => {
    const session = new TestServer().join("Claude").session;
    sessions.push(session);
    const mcp = createMcpServer(withListings(createTools(session)));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
    const { tools } = await client.listTools();
    await client.close();
    await mcp.close();
    const text = tools.find((t) => t.name === "place_object")?.description ?? "";
    expect(text).toContain("a beam's ends may run into walls");
    expect(text).toContain("hangs from what is over it: the ceiling, or a loft's underside");
  });
});
