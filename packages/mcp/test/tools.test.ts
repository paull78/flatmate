import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import type { DrawingOverview, DrawingSummary } from "../src/drawing";
import { NO_DRAWING, type EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function summary(r: Reply): DrawingSummary {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function setup(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = createTools(claude);
  const created = summary(await tools.createProject({ name: "Apartment" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  return { server, tools, alice };
}

describe("tool handlers against the real server app (spec §12)", () => {
  it("needs an open project before reading or editing", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = createTools(claude);
    expect(await tools.getDrawing()).toEqual({ text: NO_DRAWING, isError: true });
    expect(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 })).toEqual({ text: NO_DRAWING, isError: true });
    expect(JSON.parse((await tools.listProjects()).text)).toEqual({ projects: [] });
  });

  it("create_project opens an empty drawing; list_projects lists it", async () => {
    const { tools } = await setup();
    const s = summary(await tools.getDrawing());
    expect(s).toMatchObject({ project: { name: "Apartment", status: "saved" }, walls: [], rooms: [] });
    expect(JSON.parse((await tools.listProjects()).text).projects.map((p: { name: string }) => p.name)).toEqual(["Apartment"]);
  });

  it("draw_room draws four walls as four accepted edits; another client sees the room", async () => {
    const { server, tools, alice } = await setup();
    const s = summary(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }));
    expect(s.walls).toHaveLength(4);
    expect(s.rooms.map((r) => r.area)).toEqual([10.64]);
    await server.settle();
    expect(Object.keys(alice.drawing()?.walls ?? {})).toHaveLength(4);
  });

  it("draw_room against an existing wall submits nothing and says why", async () => {
    const { tools } = await setup();
    await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 });
    const r = await tools.drawRoom({ x: 4, y: 0, width: 2, height: 3 });
    expect(r).toEqual({ text: `${MESSAGES.overlap}: nothing was drawn`, isError: true });
    expect(summary(await tools.getDrawing()).walls).toHaveLength(4);
  });

  it("parallel draw_room calls: the second is checked after the first room, so it draws nothing (Review B)", async () => {
    const { tools } = await setup();
    const [a, b] = await Promise.all([
      tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }),
      tools.drawRoom({ x: 4, y: 0, width: 2, height: 3 }),
    ]);
    expect(a.isError, a.text).toBe(false);
    expect(b).toEqual({ text: `${MESSAGES.overlap}: nothing was drawn`, isError: true });
    const s = summary(await tools.getDrawing());
    expect(s.walls).toHaveLength(4);
    expect(s.rooms).toHaveLength(1);
  });

  it("draw_room in parallel with a crossing add_wall: the room is drawn whole, the wall is refused (Review B)", async () => {
    const { tools } = await setup();
    const [room, wall] = await Promise.all([
      tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }),
      tools.addWall({ a: { x: -1, y: 2 }, b: { x: 1, y: 2 } }),
    ]);
    expect(room.isError, room.text).toBe(false);
    expect(wall).toEqual({ text: MESSAGES.crossing, isError: true });
    const s = summary(await tools.getDrawing());
    expect(s.walls).toHaveLength(4);
    expect(s.rooms).toHaveLength(1);
  });

  it("add_wall splits the room; label_room and rename_room name the new room", async () => {
    const { tools } = await setup();
    await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 });
    const split = summary(await tools.addWall({ a: { x: 2.5, y: 0 }, b: { x: 2.5, y: 3 } }));
    expect(split.rooms).toHaveLength(2);
    const labelled = summary(await tools.labelRoom({ point: { x: 3.25, y: 1.5 }, name: "Bathroom" }));
    const label = labelled.rooms.flatMap((r) => r.labels).find((l) => l.name === "Bathroom");
    expect(label).toBeDefined();
    const renamed = summary(await tools.renameRoom({ label: label?.id ?? "", name: "Bath" }));
    expect(renamed.rooms.flatMap((r) => r.labels.map((l) => l.name))).toEqual(["Bath"]);
  });

  it("set_wall_length keeps endpoint a; move_joint returns the refusal text for a crossing", async () => {
    const { tools } = await setup();
    const room = summary(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }));
    const right = room.walls.find((w) => w.from[0] === 4 && w.to[0] === 4);
    if (!right) throw new Error("no right wall");
    const resized = summary(await tools.setWallLength({ wall: right.id, length: 2.5 }));
    const after = resized.walls.find((w) => w.id === right.id);
    expect(after?.from).toEqual(right.from);
    expect(after?.length).toBe(2.5);
    const corner = resized.joints.find((j) => j.id === right.b);
    const r = await tools.moveJoint({ joint: corner?.id ?? "", to: { x: -1, y: 1.5 } });
    expect(r).toEqual({ text: MESSAGES.crossing, isError: true });
  });

  it("delete removes walls by id and refuses an unknown id", async () => {
    const { tools } = await setup();
    const room = summary(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }));
    const first = room.walls[0]?.id ?? "";
    expect(await tools.delete({ ids: ["nope"] })).toEqual({ text: "No wall, joint or room label has the id nope", isError: true });
    const s = summary(await tools.delete({ ids: [first] }));
    expect(s.walls.map((w) => w.id)).not.toContain(first);
    expect(s.rooms).toEqual([]);
  });
});

// A 3 × 3 m square and two inner walls, each ending on the square in a T-junction: a small maze.
//  y
//  3  ┌─────────┬────┐
//     │         │    │
//  2  │    ╷    │    │
//     │    │    │    │
//  1  │    │    ╵    │
//     │    │         │
//  0  └────┴─────────┘
//     0    1    2    3  x
const MAZE = [
  { a: { x: 0, y: 0 }, b: { x: 3, y: 0 } },
  { a: { x: 3, y: 0 }, b: { x: 3, y: 3 } },
  { a: { x: 3, y: 3 }, b: { x: 0, y: 3 } },
  { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
  { a: { x: 1, y: 0 }, b: { x: 1, y: 2 } },
  { a: { x: 2, y: 3 }, b: { x: 2, y: 1 } },
];

describe("large drawings (spec §12.4)", () => {
  it("over 300 walls, an edit replies with the overview; get_drawing lists a region", async () => {
    const { tools } = await setup();
    for (let batch = 0; batch < 7; batch++) {
      const walls = Array.from({ length: 50 }, (_, i) => ({ a: { x: batch * 50 + i, y: 0 }, b: { x: batch * 50 + i, y: 0.5 } }));
      expect((await tools.addWalls({ walls })).isError).toBe(false);
    }
    const whole: DrawingOverview = JSON.parse((await tools.getDrawing({})).text);
    expect(whole.counts.walls).toBe(350);
    expect(whole).not.toHaveProperty("walls");
    const near = summary(await tools.getDrawing({ region: { min: { x: -0.5, y: -1 }, max: { x: 1.5, y: 1 } } }));
    expect(near.walls).toHaveLength(2); // the walls at x = 0 and x = 1
    const first = near.walls[0]?.id ?? "";
    const after = await tools.delete({ ids: [first] });
    expect(after.isError).toBe(false);
    expect(after.text.length).toBeLessThan(2_000);
    expect(JSON.parse(after.text)).toMatchObject({ counts: { walls: 349 } });
  });
});

describe("add_walls (spec §12.5)", () => {
  it("draws a maze in one call; walls sharing an end connect; another client sees every wall", async () => {
    const { server, tools, alice } = await setup();
    const s = summary(await tools.addWalls({ walls: MAZE }));
    expect(s.walls).toHaveLength(8); // each inner wall splits a side of the square: 4 + 2 × 2
    expect(s.joints).toHaveLength(8); // the square's 4 corners are shared, plus 2 T-junctions and 2 free ends
    expect(s.rooms).toHaveLength(1);
    await server.settle();
    expect(Object.keys(alice.drawing()?.walls ?? {})).toHaveLength(8);
  });

  it("refuses the whole list when one wall breaks the rules, naming that wall; nothing is submitted", async () => {
    const { server, tools, alice } = await setup();
    const r = await tools.addWalls({
      walls: [
        { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
        { a: { x: 5, y: 1 }, b: { x: 5, y: 3 } },
        { a: { x: 2, y: -1 }, b: { x: 2, y: 1 } },
      ],
    });
    expect(r).toEqual({ text: `Wall 3 of 3: ${MESSAGES.crossing}: nothing was drawn`, isError: true });
    expect(summary(await tools.getDrawing()).walls).toEqual([]);
    await server.settle();
    expect(alice.drawing()?.walls).toEqual({});
  });

  it("in parallel with a crossing add_wall: never a partial list", async () => {
    const { tools } = await setup();
    const [list, single] = await Promise.all([
      tools.addWalls({ walls: MAZE }),
      tools.addWall({ a: { x: -1, y: 0.5 }, b: { x: 0.5, y: 0.5 } }), // crosses the square's left side
    ]);
    const s = summary(await tools.getDrawing());
    const outcome = { list: list.isError ? list.text : "drawn", single: single.isError ? single.text : "drawn", walls: s.walls.length };
    expect([
      { list: "drawn", single: MESSAGES.crossing, walls: 8 },
      { list: `Wall 4 of 6: ${MESSAGES.crossing}: nothing was drawn`, single: "drawn", walls: 1 },
    ]).toContainEqual(outcome);
  });
});

describe("presence (spec §7.6)", () => {
  it("add_walls leaves Claude's cursor at the middle of the last wall", async () => {
    const { server, tools, alice } = await setup();
    summary(await tools.addWalls({ walls: MAZE }));
    await server.settle();
    const claude = alice.collaborators().find((c) => c.name === "Claude");
    expect(claude?.at?.x).toBeCloseTo(2);
    expect(claude?.at?.y).toBeCloseTo(2);
  });

  it("shows Claude's cursor to the other client where the last edit happened", async () => {
    const { server, tools, alice } = await setup();
    await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 });
    await server.settle();
    const claude = alice.collaborators().find((c) => c.name === "Claude");
    expect(claude?.at?.x).toBeCloseTo(2);
    expect(claude?.at?.y).toBeCloseTo(1.5);
    await tools.moveJoint({ joint: summary(await tools.getDrawing()).joints[0]?.id ?? "", to: { x: -0.5, y: 0 } });
    await server.settle();
    expect(alice.collaborators().find((c) => c.name === "Claude")?.at?.x).toBeCloseTo(-0.5);
  });
});
