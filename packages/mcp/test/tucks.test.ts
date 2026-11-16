import { afterEach, describe, expect, it } from "vitest";
import type { Listing as DrawingSummary } from "./harness";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// The tuck rule through Claude's tools (spec "Seating: the tuck rule", AC-05, AC-06; seating.27): place_object and
// move_object land a tucked chair through the domain's landing call with the chair's tuck role, and get_drawing's free
// floor adds the overlap back once.
//
// A 4 × 5 room (inner faces x 0.1–3.9, y 0.1–4.9). On the floor, a desk (1.20 × 0.60) against the top wall: x 1.4–2.6,
// y 4.3–4.9, its front on y 4.3. On a platform along the bottom wall (x 0.8–3.2, y 0.1–1.5), a desk turned 180
// against the bottom wall: y 0.1–0.7, its front on y 0.7. A 0.45 chair facing a desk, tucked t, has its centre
// 0.225 − t from the desk's front edge, on the desk's side.
//
//  4.9 ┌─────[desk]─────┐
//      │       ▣        │  chair at rotation 180, tucked t: centre y 4.075 + t
//      │                │
//  1.5 │ ┌──platform──┐ │
//      │ │     ▣      │ │  chair at rotation 0, tucked t: centre y 0.925 − t
//  0.1 └─┴───[desk]───┴─┘

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function room(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  return { server, tools, alice };
}

const onFloor = (t: number) => ({ x: 2, y: 4.075 + t });
const onPlatform = (t: number) => ({ x: 2, y: 0.925 - t });
const placementOf = (s: DrawingSummary, object: string) => s.objects.find((o) => o.id === object)?.placements["s0"];

/** The room with a desk against its top wall, on the floor. */
async function floorDesk() {
  const r = await room();
  summary(await r.tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.6 } }));
  return r;
}

/** The room with a platform along its bottom wall and a desk on it, turned to face +y; the desk lands on the platform. */
async function platformDesk() {
  const r = await room();
  const deck = summary(await r.tools.addDeck({ preset: "platform", centre: { x: 2, y: 0.8 }, width: 2.4, depth: 1.4 })).result.deck ?? "";
  const desk = summary(await r.tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 0.4 }, rotation: 180 }));
  expect(placementOf(desk, desk.result.object ?? "")?.on).toBe(deck);
  return { ...r, deck };
}

describe("mcp tuck accepted at 0.35, refused at 0.36", () => {
  it("place_object on the floor: a chair facing the desk goes 0.35 m under it; 0.36 is refused with the overlap message", async () => {
    const { tools } = await floorDesk();
    const deeper = await tools.placeObject({ layout: "s0", kind: "chair", centre: onFloor(0.36), rotation: 180 });
    expect(deeper.isError).toBe(true);
    expect(["Chair (0.00–0.90) and Desk (0.00–0.75) overlap in Layout", "Desk (0.00–0.75) and Chair (0.00–0.90) overlap in Layout"]).toContain(deeper.text);
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: onFloor(0.35), rotation: 180 }));
    expect(placementOf(placed, placed.result.object ?? "")).toMatchObject({ centre: [2, 4.425], rotation: 180, on: "floor" });
  });

  it("place_object without on lands a chair tucked 0.35 m under a desk on a platform on the platform; 0.36 is refused", async () => {
    const { tools, deck } = await platformDesk();
    const deeper = await tools.placeObject({ layout: "s0", kind: "chair", centre: onPlatform(0.36), rotation: 0 });
    expect(deeper.isError).toBe(true);
    expect(deeper.text).toContain("overlap");
    expect(summary(await tools.getDrawing()).objects).toHaveLength(1);
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: onPlatform(0.35), rotation: 0 }));
    expect(placementOf(placed, placed.result.object ?? "")).toMatchObject({ centre: [2, 0.575], rotation: 0, on: deck });
  });

  it("move_object without on takes a chair from the floor to 0.35 m under the desk on the platform and refuses 0.36; nothing changes on a refusal", async () => {
    const { server, tools, alice, deck } = await platformDesk();
    const chair = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 2, y: 3 }, rotation: 0 })).result.object ?? "";
    const moved = summary(await tools.moveObject({ layout: "s0", object: chair, centre: onPlatform(0.35) }));
    expect(placementOf(moved, chair)).toMatchObject({ centre: [2, 0.575], on: deck });
    const deeper = await tools.moveObject({ layout: "s0", object: chair, centre: onPlatform(0.36) });
    expect(deeper.isError).toBe(true);
    expect(deeper.text).toContain("overlap");
    expect(placementOf(summary(await tools.getDrawing()), chair)).toMatchObject({ centre: [2, 0.575], on: deck });
    await server.settle();
    expect(Object.values(alice.drawing()?.placements ?? {}).find((p) => p.object === chair)?.deck).toBe(deck);
  });

  it("a chair turned so its backrest goes under is refused", async () => {
    const { tools } = await floorDesk();
    const backwards = await tools.placeObject({ layout: "s0", kind: "chair", centre: onFloor(0.2), rotation: 0 });
    expect(backwards.isError).toBe(true);
    expect(backwards.text).toContain("overlap");
  });
});

describe("mcp get_drawing free floor rises by the overlap", () => {
  it("tucking a chair 0.20 m under the desk raises the room's free floor by 0.45 × 0.20 = 0.09 m²", async () => {
    const { tools } = await floorDesk();
    const chair = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: onFloor(0), rotation: 180 })).result.object ?? "";
    const out = summary(await tools.getDrawing()).rooms[0]?.freeFloor?.["s0"] ?? 0;
    // 3.8 × 4.8 = 18.24 m² clear, less the desk's 0.72 and the chair's 0.2025.
    expect(out).toBeCloseTo(17.32, 2);
    const tucked = summary(await tools.moveObject({ layout: "s0", object: chair, centre: onFloor(0.2) }));
    expect(tucked.rooms[0]?.freeFloor?.["s0"]).toBeCloseTo(out + 0.09, 6);
  });
});
