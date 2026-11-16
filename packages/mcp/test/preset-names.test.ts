import { afterEach, describe, expect, it } from "vitest";
import { OBJECT_KINDS } from "@fm/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { presetNamesOf } from "../src/preset-names";
import { createMcpServer } from "../src/server";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";

// Preset names (mcp step 06, AC-08): a word name where the preset has one, else its whole first size in cm; a bare
// width is refused by the schema, a name of another kind by the handler with the kind's names.

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function room(): Promise<Client> {
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
  await call(client, "create_project", { name: "Presets" });
  await call(client, "draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const r = await client.callTool({ name, arguments: args });
  const first: unknown = Array.isArray(r.content) ? r.content[0] : undefined;
  return { text: typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "", isError: r.isError === true };
}

async function sizeOf(client: Client, object: string): Promise<unknown> {
  const listing = JSON.parse((await call(client, "get_drawing", {})).text);
  return listing.objects.find((o: { id: string }) => o.id === object)?.sizes.standard;
}

describe("preset names (AC-08)", () => {
  it("a bathtub's 170 × 70 and 170 × 75 place those sizes", async () => {
    const client = await room();
    const a = JSON.parse((await call(client, "place_object", { layout: "s0", kind: "bathtub", preset: "170 × 70", centre: { x: 1.5, y: 0.5 } })).text).result.object;
    const b = JSON.parse((await call(client, "place_object", { layout: "s0", kind: "bathtub", preset: "170 × 75", centre: { x: 1.5, y: 3.4 } })).text).result.object;
    expect(await sizeOf(client, a)).toMatchObject({ width: 1.7, depth: 0.7 });
    expect(await sizeOf(client, b)).toMatchObject({ width: 1.7, depth: 0.75 });
  });

  it("a bare width is refused by the schema", async () => {
    const client = await room();
    const r = await call(client, "place_object", { layout: "s0", kind: "bathtub", preset: "170", centre: { x: 1.5, y: 0.5 } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Input validation error");
  });

  it("a sofa refuses King, naming the sofa's presets", async () => {
    const client = await room();
    const r = await call(client, "place_object", { layout: "s0", kind: "sofa", preset: "King", centre: { x: 3, y: 2 } });
    expect(r).toEqual({ text: "Sofa has the presets 2 seats, 3 seats, 4 seats", isError: true });
  });

  it("set_size takes the same names", async () => {
    const client = await room();
    const sink = JSON.parse((await call(client, "place_object", { layout: "s0", kind: "sinkUnit", centre: { x: 3, y: 0.5 } })).text).result.object;
    expect((await call(client, "set_size", { object: sink, preset: "120 × 60" })).isError).toBe(false);
    expect(await sizeOf(client, sink)).toMatchObject({ width: 1.2, depth: 0.6 });
  });

  it("every kind's preset names are unique within the kind, and a word-named preset keeps its word", () => {
    for (const kind of OBJECT_KINDS) {
      const names = presetNamesOf(kind.id);
      expect(new Set(names).size, kind.id).toBe(names.length);
      for (const n of names) expect(n, kind.id).not.toMatch(/^\d+$/);
    }
    expect(presetNamesOf("bed")).toContain("King");
    expect(presetNamesOf("fridge")).toContain("Tall");
    expect(presetNamesOf("bathtub")).toEqual(["150 × 70", "160 × 70", "170 × 70", "170 × 75", "180 × 80", "190 × 90"]);
  });
});
