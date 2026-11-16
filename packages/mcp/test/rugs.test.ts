import { afterEach, describe, expect, it } from "vitest";
import type { Listing as DrawingSummary } from "./harness";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Rugs in Claude's tools (catalog.15, .24): place_object and move_object land a piece on a rug and a rug under a piece
// through the same fit as the editor; a rug still lies inside a room and off the walls.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** Claude on a project with a 5 × 6 room at (0, 0): inner faces at x 0.1 and 4.9, y 0.1 and 5.9. */
async function room(): Promise<DrawingTools> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Living" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 5, depth: 6 }));
  return tools;
}

describe("rugs over MCP (catalog.15, .24)", () => {
  it("place_object a sofa on a rug lands on the floor, and the same sofa on a box of the rug's size is refused", async () => {
    const tools = await room();
    const rug = summary(await tools.placeObject({ layout: "s0", kind: "rug", centre: { x: 2.5, y: 3 }, preset: "300 × 200" })).result.object ?? "";
    const sofa = summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2.5, y: 3 } }));
    expect(sofa.objects.find((o) => o.id === rug)?.sizes.standard).toEqual({ width: 3, depth: 2, height: 0.01, elevation: 0 });

    const other = await room();
    const box = summary(await other.placeObject({ layout: "s0", kind: "block", centre: { x: 2.5, y: 3 } })).result.object ?? "";
    summary(await other.setSize({ object: box, width: 3, depth: 2, height: 0.01 }));
    expect((await other.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2.5, y: 3 } })).isError).toBe(true);
  });

  it("a rug takes no free floor and blocks no use zone", async () => {
    const tools = await room();
    const area = summary(await tools.getDrawing()).rooms[0]?.area;
    summary(await tools.placeObject({ layout: "s0", kind: "rug", centre: { x: 2.5, y: 2 } }));
    const after = summary(await tools.getDrawing());
    expect(after.rooms[0]?.freeFloor?.["s0"]).toBe(area);
    const wardrobe = summary(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: { x: 2.5, y: 3.3 } })); // its front zone over the rug
    expect(wardrobe.layouts.find((s) => s.id === "s0")?.blocked).toEqual([]);
    const box = await room();
    summary(await box.placeObject({ layout: "s0", kind: "block", centre: { x: 2.5, y: 2.4 } }));
    const blocked = summary(await box.placeObject({ layout: "s0", kind: "wardrobe", centre: { x: 2.5, y: 3.3 } }));
    expect(blocked.layouts.find((s) => s.id === "s0")?.blocked.length).toBeGreaterThan(0);
  });

  it("a rug crossing a wall, or outside the room, is refused", async () => {
    const tools = await room();
    expect((await tools.placeObject({ layout: "s0", kind: "rug", centre: { x: 0, y: 3 } })).isError).toBe(true);
    expect((await tools.placeObject({ layout: "s0", kind: "rug", centre: { x: 20, y: 3 } })).isError).toBe(true);
  });

  it("a rug on a platform moved to the floor over a sofa lands on the floor (the flag in landsOn)", async () => {
    const tools = await room();
    const deck = summary(await tools.addDeck({ preset: "platform", centre: { x: 1.2, y: 1.2 }, width: 2.2, depth: 2 })).result.deck ?? "";
    const rug = summary(await tools.placeObject({ layout: "s0", kind: "rug", centre: { x: 1.2, y: 1.2 }, on: deck })).result.object ?? "";
    summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2.5, y: 4 } }));
    const moved = summary(await tools.moveObject({ layout: "s0", object: rug, centre: { x: 2.5, y: 4 } }));
    const placed = moved.objects.find((o) => o.id === rug)?.placements["s0"];
    expect(placed?.centre).toEqual([2.5, 4]);
    expect(placed?.on).toBe("floor");
  });
});
