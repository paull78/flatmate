import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";

// One vocabulary on the MCP surface (mcp steps 04 and 05): "layout", never "state" (AC-09, mcp.04).

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
  const items = Array.isArray(r.content) ? r.content : [];
  const first: unknown = items[0];
  return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const r = await client.callTool({ name, arguments: args });
  return { text: textOf(r), isError: r.isError === true };
}

/** Every key in a JSON value, at any depth. */
function keysOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keysOf);
  if (typeof v !== "object" || v === null) return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]);
}

/** Every property name and description in an input schema, at any depth. */
function schemaWords(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(schemaWords);
  if (typeof v !== "object" || v === null) return [];
  return Object.entries(v).flatMap(([k, x]) => {
    if (k === "description" && typeof x === "string") return [x];
    if (k === "properties" && typeof x === "object" && x !== null) return [...Object.keys(x), ...schemaWords(x)];
    return schemaWords(x);
  });
}

const STATE = /\bstates?\b/i;

describe('"layout", never "state" (AC-09)', () => {
  it("no tool name, parameter, description or instruction says state", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.name, t.name).not.toMatch(/state/i);
      expect(t.description ?? "", t.name).not.toMatch(STATE);
      for (const word of schemaWords(t.inputSchema)) expect(word, t.name).not.toMatch(STATE);
    }
    expect(client.getInstructions() ?? "").not.toMatch(STATE);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["add_layout", "copy_layout"]));
  });

  it("no key of a full listing or an edit's reply says state", async () => {
    const client = await connect();
    await call(client, "create_project", { name: "Words" });
    await call(client, "draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    const added = JSON.parse((await call(client, "add_layout", { name: "Night" })).text);
    expect(added.result.layout).toMatchObject({ name: "Night" });
    const placed = await call(client, "place_object", { layout: "s0", kind: "bed", centre: { x: 2, y: 2 } });
    expect(placed.isError, placed.text).toBe(false);
    for (const k of keysOf(JSON.parse(placed.text))) expect(k).not.toMatch(/state/i);
    const listing = JSON.parse((await call(client, "get_drawing")).text);
    for (const k of keysOf(listing)) expect(k).not.toMatch(/state/i);
    expect(listing.layouts.map((l: { name: string }) => l.name)).toEqual(["Layout", "Night"]);
  });

  it("the package's own refusals say layout", async () => {
    const client = await connect();
    await call(client, "create_project", { name: "Words" });
    await call(client, "draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    const r = await call(client, "place_object", { layout: "nope", kind: "bed", centre: { x: 2, y: 2 } });
    expect(r.isError).toBe(true);
    expect(r.text).toBe("No layout has the id nope");
  });
});

type Schema = { properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };

const isSchema = (v: unknown): v is Schema => typeof v === "object" && v !== null;

/** Every property name in an input schema, at any depth, with its schema. */
function propertiesOf(s: Schema | undefined): [string, Schema][] {
  if (s === undefined) return [];
  const own = Object.entries(s.properties ?? {});
  return [...own, ...own.flatMap(([, v]) => propertiesOf(v)), ...propertiesOf(s.items), ...(s.anyOf ?? []).flatMap(propertiesOf)];
}

async function inputs(client: Client): Promise<{ name: string; schema: Schema }[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({ name: t.name, schema: isSchema(t.inputSchema) ? t.inputSchema : {} }));
}

describe("one name for a centre, a corner and the plan's sides (AC-05, AC-10, AC-11)", () => {
  it("every centre is named centre and is an { x, y }; at is only add_stair's edge point; no tool takes a flat x and y", async () => {
    const client = await connect();
    const tools = await inputs(client);
    for (const t of tools) {
      const top = Object.keys(t.schema.properties ?? {});
      expect(top.includes("x") && top.includes("y"), t.name).toBe(false);
      if (top.includes("at")) expect(t.name).toBe("add_stair");
      for (const [name, schema] of propertiesOf(t.schema)) {
        if (name === "centre") expect(Object.keys(schema.properties ?? {}).sort(), t.name).toEqual(["x", "y"]);
      }
    }
    for (const name of ["place_object", "move_object", "place_set", "add_deck", "set_deck", "add_area", "add_column", "add_hole"]) {
      expect(Object.keys(tools.find((t) => t.name === name)?.schema.properties ?? {}), name).toContain("centre");
    }
  });

  it("draw_room takes a corner, a width and a depth: walls from (0, 0) to (5, 3); height is refused", async () => {
    const client = await connect();
    await call(client, "create_project", { name: "Room" });
    const drawn = await call(client, "draw_room", { corner: { x: 0, y: 0 }, width: 5, depth: 3 });
    expect(drawn.isError, drawn.text).toBe(false);
    const listing: { walls: { from: number[]; to: number[] }[] } = JSON.parse((await call(client, "get_drawing")).text);
    const xs = listing.walls.flatMap((w) => [w.from[0] ?? NaN, w.to[0] ?? NaN]);
    const ys = listing.walls.flatMap((w) => [w.from[1] ?? NaN, w.to[1] ?? NaN]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 5, 0, 3]);
    expect((await call(client, "draw_room", { corner: { x: 10, y: 0 }, width: 5, height: 3 })).isError).toBe(true);
    expect((await call(client, "draw_room", { x: 10, y: 0, width: 5, depth: 3 })).isError).toBe(true);
  });

  it("set_ceiling falls lower: a shed falling toward −y; bottom is refused", async () => {
    const client = await connect();
    await call(client, "create_project", { name: "Shed" });
    await call(client, "draw_room", { corner: { x: 0, y: 0 }, width: 5, depth: 3 });
    const r = await call(client, "set_ceiling", { shape: "shed", height: 2.4, pitch: 10, falls: "lower" });
    expect(r.isError, r.text).toBe(false);
    expect(JSON.parse((await call(client, "get_drawing")).text).roof).toMatchObject({ shape: "shed", falls: "lower" });
    expect((await call(client, "set_ceiling", { falls: "bottom" })).isError).toBe(true);
  });

  it("get_drawing lists a placement's and a deck's centre as centre", async () => {
    const client = await connect();
    await call(client, "create_project", { name: "Centres" });
    await call(client, "draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    expect((await call(client, "add_deck", { centre: { x: 4.5, y: 3 }, width: 2, depth: 1.6 })).isError).toBe(false);
    expect((await call(client, "place_object", { layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).isError).toBe(false);
    const listing = JSON.parse((await call(client, "get_drawing")).text);
    expect(listing.objects[0].placement.centre).toEqual([1, 1]);
    expect(listing.objects[0].placement).not.toHaveProperty("at");
    expect(listing.decks[0].centre).toEqual([4.5, 3]);
  });
});

describe("camelCase parameters and keys (AC-12)", () => {
  it("no parameter name or listing key has an underscore", async () => {
    const client = await connect();
    for (const t of await inputs(client)) for (const [name] of propertiesOf(t.schema)) expect(name, t.name).not.toContain("_");
    await call(client, "create_project", { name: "Keys" });
    await call(client, "draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
    await call(client, "add_layout", { name: "Night" });
    await call(client, "place_object", { layout: "s0", kind: "bed", centre: { x: 2, y: 2 } });
    await call(client, "set_ceiling", { shape: "gable", height: 2.3, pitch: 30 });
    for (const k of keysOf(JSON.parse((await call(client, "get_drawing")).text))) expect(k).not.toContain("_");
  });
});
