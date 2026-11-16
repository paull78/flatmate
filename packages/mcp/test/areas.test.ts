import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Named areas in Claude's tools (areas step 04, AC-11): add_area and set_area run the domain's commands, delete takes an
// area's id, get_drawing lists each area under its room with its m², refusals are the domain's words.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { area?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** Claude on a 6 × 4 open room labelled Great room (clear floor 0.1–5.9 × 0.1–3.9). */
async function greatRoom(): Promise<DrawingTools> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Open plan" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  summary(await tools.labelRoom({ point: { x: 3, y: 2 }, name: "Great room" }));
  return tools;
}

describe("add_area and get_drawing (AC-11)", () => {
  it("adds an area that get_drawing lists under its room with its m²", async () => {
    const tools = await greatRoom();
    const s = summary(await tools.addArea({ name: "Kitchen", centre: { x: 1.1, y: 2 }, width: 2, depth: 3.8 }));
    expect(s.result.area).toMatch(/\/a0$/);
    expect(s.rooms[0]?.areas).toEqual([{ id: s.result.area, name: "Kitchen", centre: [1.1, 2], width: 2, depth: 3.8, area: 7.6 }]);
  });

  it("set_area renames and resizes it", async () => {
    const tools = await greatRoom();
    const id = summary(await tools.addArea({ name: "Kitchen", centre: { x: 1.1, y: 2 }, width: 2, depth: 3.8 })).result.area ?? "";
    const s = summary(await tools.setArea({ area: id, name: "Dining", width: 1.5 }));
    expect(s.rooms[0]?.areas).toEqual([{ id, name: "Dining", centre: [1.1, 2], width: 1.5, depth: 3.8, area: 5.7 }]);
  });

  it("an overlapping add_area returns Overlaps and the other's name, and nothing changes", async () => {
    const tools = await greatRoom();
    summary(await tools.addArea({ name: "Kitchen", centre: { x: 1.1, y: 2 }, width: 2, depth: 3.8 }));
    expect(await tools.addArea({ name: "Living", centre: { x: 2.5, y: 2 }, width: 2, depth: 2 })).toMatchObject({ isError: true, text: expect.stringContaining("Overlaps Kitchen") });
    const s = summary(await tools.getDrawing({}));
    expect(s.rooms[0]?.areas?.map((a) => a.name)).toEqual(["Kitchen"]);
  });

  it("add_area outside every room returns Draw an area inside a room", async () => {
    const tools = await greatRoom();
    expect(await tools.addArea({ name: "Porch", centre: { x: 8, y: 2 }, width: 1, depth: 1 })).toMatchObject({ isError: true, text: expect.stringContaining("Draw an area inside a room") });
  });

  it("delete removes an area", async () => {
    const tools = await greatRoom();
    const id = summary(await tools.addArea({ name: "Kitchen", centre: { x: 1.1, y: 2 }, width: 2, depth: 3.8 })).result.area ?? "";
    const s = summary(await tools.delete({ ids: [id] }));
    expect(s.rooms[0]?.areas).toBeUndefined();
  });
});
