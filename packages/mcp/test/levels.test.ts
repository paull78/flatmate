import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DrawingOverview } from "../src/drawing";
import type { Listing as DrawingSummary } from "./harness";
import { createMcpServer } from "../src/server";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Levels in Claude's tools (spec "MCP"; levels.14, .17, .38; AC-12): get_drawing lists the levels, Claude's
// place_object and move_object without `on` land by the floor level's rule, `on` still picks any deck, 36 tools.

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

type Edited = DrawingSummary & { result: { object?: string; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** The loft over the top of a 4 × 5 room, flush with three inner faces: x 0.1 to 3.9, y 2.8 to 4.9. */
const LOFT = { preset: "loft", centre: { x: 2, y: 3.85 }, width: 3.8, depth: 2.1 } as const;
/** A platform at the bottom of the room: a deck below the floor's cut, so part of the floor level. */
const PLATFORM = { preset: "platform", centre: { x: 2, y: 0.8 }, width: 2.4, depth: 1.4 } as const;

/** A studio through the tools: a 4 × 5 room, ceiling 3.20 (so a default bed fits on the loft), a platform and a loft. */
async function studio(): Promise<{ tools: DrawingTools; loft: string; platform: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  cleanups.push(() => claude.close());
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Studio" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  summary(await tools.setCeiling({ height: 3.2 }));
  const platform = summary(await tools.addDeck(PLATFORM)).result.deck ?? "";
  const loft = summary(await tools.addDeck(LOFT)).result.deck ?? "";
  return { tools, loft, platform };
}

/** Validation's refusal of the bed on the floor over the desk; the pair comes in either order (by placement ID). */
const OVERLAP = /^(Desk \(0\.00–0\.75\) and Bed \(0\.00–1\.00\)|Bed \(0\.00–1\.00\) and Desk \(0\.00–0\.75\)) overlap in Layout$/;


const placementOf = (s: DrawingSummary, object: string) => s.objects.find((o) => o.id === object)?.placements["s0"];

describe("get_drawing's levels", () => {
  it("get_drawing lists Floor (cut 1.20) and +2.15 Loft with its deck id and cut", async () => {
    const { tools, loft, platform } = await studio();
    const s = summary(await tools.getDrawing());
    // The platform (0.45) is below the floor's cut: a deck of the floor level, not a level. The loft's cut is
    // 2.15 + half of the 1.05 m left under the ceiling.
    expect(s.levels).toEqual([
      { height: 0, name: "Floor", decks: [], cut: 1.2 },
      { height: 2.15, name: "Loft", decks: [loft], cut: 2.675 },
    ]);
    expect(s.decks.map((d) => d.id).sort()).toEqual([loft, platform].sort());
    // A region away from the loft still lists every level.
    const region = summary(await tools.getDrawing({ region: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } } }));
    expect(region.levels).toEqual(s.levels);
  });

  it("a drawing without decks lists the floor alone", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    cleanups.push(() => claude.close());
    const tools = withListings(createTools(claude));
    summary(await tools.createProject({ name: "Empty" }));
    expect(summary(await tools.getDrawing()).levels).toEqual([{ height: 0, name: "Floor", decks: [], cut: 1.2 }]);
  });

  it("the overview of a large drawing lists the levels too", async () => {
    const { tools, loft } = await studio();
    // 76 rooms of four walls each, apart: 304 walls, over the 300 listed.
    for (let i = 0; i < 76; i += 1) summary(await tools.drawRoom({ corner: { x: 10 + (i % 10) * 3, y: (i - (i % 10)) * 0.3 }, width: 2, depth: 2 }));
    const s: DrawingOverview = JSON.parse((await tools.getDrawing()).text);
    expect(s.hint).toContain("region");
    expect(s.levels).toEqual([
      { height: 0, name: "Floor", decks: [], cut: 1.2 },
      { height: 2.15, name: "Loft", decks: [loft], cut: 2.675 },
    ]);
  }); // 2.8 s alone, 15 s and more under load: the shared 30 s default covers it (stairs.27, snags.20)
});

describe("Claude's edits land at the floor level (AC-12)", () => {
  it("place_object of a bed over the loft where a desk blocks the floor, without on, is refused with validation's text", async () => {
    const { tools } = await studio();
    const desk = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.5 } }));
    expect(placementOf(desk, desk.result.object ?? "")?.on).toBe("floor");
    // At the floor only decks below the floor's cut are candidates: the loft is not, so the bed tries the floor.
    expect(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 3.85 } })).toEqual({ text: expect.stringMatching(OVERLAP), isError: true });
    expect(summary(await tools.getDrawing()).counts.objects).toBe(1);
  });

  it("with on: <loft id> it stands on the loft", async () => {
    const { tools, loft } = await studio();
    summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.5 } }));
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 3.85 }, on: loft }));
    expect(placementOf(placed, placed.result.object ?? "")).toMatchObject({ centre: [2, 3.85], on: loft });
  });

  it("move_object of a bed over the loft without on is refused the same way; with on it moves onto the loft", async () => {
    const { tools, loft } = await studio();
    summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.5 } }));
    const bed = summary(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 2.4 }, rotation: 90 })).result.object ?? "";
    expect(await tools.moveObject({ layout: "s0", object: bed, centre: { x: 2, y: 3.85 }, rotation: 0 })).toEqual({ text: expect.stringMatching(OVERLAP), isError: true });
    const moved = summary(await tools.moveObject({ layout: "s0", object: bed, centre: { x: 2, y: 3.85 }, rotation: 0, on: loft }));
    expect(placementOf(moved, bed)).toMatchObject({ centre: [2, 3.85], rotation: 0, on: loft });
    // Nudged without on, it stays on the loft: its current surface fits, at any level.
    const nudged = summary(await tools.moveObject({ layout: "s0", object: bed, centre: { x: 2.1, y: 3.85 } }));
    expect(placementOf(nudged, bed)).toMatchObject({ centre: [2.1, 3.85], on: loft });
  });
});

describe("the MCP surface", () => {
  async function connect(): Promise<Client> {
    const session = new TestServer().join("Claude").session;
    const mcp = createMcpServer(withListings(createTools(session)));
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

  it("tools/list has 54 tools (add_sheet, set_sheet, delete_sheet, move_sheet and read_report, sheetset; add_column and set_column, pillars.15; add_hole and set_hole, stairwell.10; set_finish, finishes.14; set_desk, seating.12; set_chairs, library.10; add_area and set_area, areas.13); look takes no level", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(54);
    expect(Object.keys(tools.find((t) => t.name === "look")?.inputSchema.properties ?? {})).toEqual(["region", "view", "yaw", "tilt", "layout", "section", "roof"]);
  });

  it("the instructions explain levels and the floor level's landing rule; no text keeps the old rule (levels.38)", async () => {
    const client = await connect();
    const text = client.getInstructions() ?? "";
    const start = text.indexOf("Levels:");
    const end = text.indexOf("Tracing a plan picture");
    expect(start).toBeGreaterThan(text.indexOf("Decks:"));
    expect(end).toBeGreaterThan(start);
    // The whole text fits Claude Code's cut: server.test.ts checks it (cleanup.03).
    const paragraph = text.slice(start, end);
    for (const part of ["view one level at a time", "get_drawing's levels lists them", "You work at the floor: look draws the floor level"]) {
      expect(paragraph, part).toContain(part);
    }
    expect(paragraph).toContain(
      "without on, place_object and move_object follow the floor level's landing rule: a piece keeps its current " +
        "surface if it fits there (a loft included), else lands on the floor or on a deck below the floor's cut (a " +
        "platform), never on a loft, even where the floor under it is taken (the edit is then refused); to put a piece " +
        "on a loft, pass on with its deck id.",
    );
    const { tools } = await client.listTools();
    const all = [text, ...tools.map((t) => JSON.stringify(t))];
    for (const t of all) {
      expect(t).not.toContain("deck under its centre");
      expect(t).not.toMatch(/\blands?( it)? on a loft/);
    }
    const tool = (name: string) => tools.find((t) => t.name === name);
    for (const name of ["place_object", "move_object"]) {
      expect(tool(name)?.description, name).toContain("below the floor's cut (a platform) under its centre; putting it on a loft needs `on`");
    }
    expect(JSON.stringify(tool("place_object")?.inputSchema)).toContain("a deck below the floor's cut under its centre; putting it on a loft needs on");
    const drawing = tool("get_drawing")?.description ?? "";
    expect(drawing).toContain("levels (the floor, then each deck top at or above its cut: height, name, deck ids, cut)");
    expect(drawing).toContain("overview (counts, layouts, bounds of the walls, underlay, levels)");
  });
});
