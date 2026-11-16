import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES, anchorAtMm, execute, underlayRect, type Command } from "@fm/domain";
import type { DrawingOverview } from "../src/drawing";
import type { Listing as DrawingSummary } from "./harness";
import { NO_DRAWING, type EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";
import { QUADRANTS, quadrantJpeg } from "./pictures";

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function summary(r: Reply): DrawingSummary {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function setup(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession; claude: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Apartment" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  return { server, tools, alice, claude };
}

describe("tool handlers against the real server app (spec: mcp)", () => {
  it("needs an open project before reading or editing", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = withListings(createTools(claude));
    expect(await tools.getDrawing()).toEqual({ text: NO_DRAWING, isError: true });
    expect(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 })).toEqual({ text: NO_DRAWING, isError: true });
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
    const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
    expect(s.walls).toHaveLength(4);
    expect(s.rooms.map((r) => r.area)).toEqual([10.64]);
    await server.settle();
    expect(Object.keys(alice.drawing()?.walls ?? {})).toHaveLength(4);
  });

  it("draw_room against an existing wall submits nothing and says why", async () => {
    const { tools } = await setup();
    await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 });
    const r = await tools.drawRoom({ corner: { x: 4, y: 0 }, width: 2, depth: 3 });
    expect(r).toEqual({ text: `${MESSAGES.overlap}: nothing was drawn`, isError: true });
    expect(summary(await tools.getDrawing()).walls).toHaveLength(4);
  });

  it("parallel draw_room calls: the second is checked after the first room, so it draws nothing (Review B)", async () => {
    const { tools } = await setup();
    const [a, b] = await Promise.all([
      tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }),
      tools.drawRoom({ corner: { x: 4, y: 0 }, width: 2, depth: 3 }),
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
      tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }),
      tools.addWall({ a: { x: -1, y: 2 }, b: { x: 1, y: 2 } }),
    ]);
    expect(room.isError, room.text).toBe(false);
    expect(wall).toEqual({ text: MESSAGES.crossing, isError: true });
    const s = summary(await tools.getDrawing());
    expect(s.walls).toHaveLength(4);
    expect(s.rooms).toHaveLength(1);
  });

  it("get_drawing's area reads as the room's tag: 3.045 m² is 3.05 (cleanup M3 review)", async () => {
    const { tools } = await setup();
    const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 3.7, depth: 1.07 })); // inside 3.50 × 0.87
    expect(s.rooms.map((r) => r.area)).toEqual([3.05]);
  });

  it("label_room outside every room says the point is in no room, in words for Claude (cleanup.09)", async () => {
    const { tools } = await setup();
    summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
    expect(await tools.labelRoom({ point: { x: 9, y: 9 }, name: "Garden" })).toEqual({ text: "The point is in no room", isError: true });
  });

  it("add_wall splits the room; label_room and rename name the new room", async () => {
    const { tools } = await setup();
    await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 });
    const split = summary(await tools.addWall({ a: { x: 2.5, y: 0 }, b: { x: 2.5, y: 3 } }));
    expect(split.rooms).toHaveLength(2);
    const labelled = summary(await tools.labelRoom({ point: { x: 3.25, y: 1.5 }, name: "Bathroom" }));
    const label = labelled.rooms.flatMap((r) => r.labels).find((l) => l.name === "Bathroom");
    expect(label).toBeDefined();
    const renamed = summary(await tools.rename({ id: label?.id ?? "", name: "Bath" }));
    expect(renamed.rooms.flatMap((r) => r.labels.map((l) => l.name))).toEqual(["Bath"]);
  });

  it("set_wall_length keeps endpoint a; move_joint returns the refusal text for a crossing", async () => {
    const { tools } = await setup();
    const room = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
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

  it("delete removes a section by its letter", async () => {
    const { tools, alice, claude } = await setup();
    await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 });
    expect((await alice.edit({ type: "addSection", a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, side: 1 })).ok).toBe(true);
    expect(Object.keys(claude.drawing()?.sections ?? {})).toEqual(["A"]);
    expect((await tools.delete({ ids: ["A"] })).isError).toBe(false);
    expect(claude.drawing()?.sections).toEqual({});
  });

  it("delete removes walls by id and refuses an unknown id", async () => {
    const { tools } = await setup();
    const room = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
    const first = room.walls[0]?.id ?? "";
    expect(await tools.delete({ ids: ["nope"] })).toEqual({ text: "No wall, column, joint, room label, opening, dimension, deck, hole, piece, section, named area or layout has the id nope", isError: true });
    const s = summary(await tools.delete({ ids: [first] }));
    expect(s.walls.map((w) => w.id)).not.toContain(first);
    expect(s.rooms).toEqual([]);
  });
});

describe("rooms with holes (holes, AC-10)", () => {
  it("draw_room inside a room cuts a hole: get_drawing lists it and the net area", async () => {
    const { tools } = await setup();
    await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 10, depth: 8 });
    const s = summary(await tools.drawRoom({ corner: { x: 3.5, y: 2.5 }, width: 3, depth: 3 }));
    expect(s.rooms.map((r) => r.area ?? -1).sort((a, b) => a - b)).toEqual([7.84, 66.2]);
    expect(s.rooms.filter((r) => r.holes?.length === 1)).toHaveLength(1);
    expect(summary(await tools.getDrawing())).toEqual(expect.objectContaining({ rooms: s.rooms, walls: s.walls }));
  });
});

describe("wall thickness (layout-states.27)", () => {
  it("set_wall_thickness on a wall changes it and the reply names the wall and the new value; on a missing id the reply is an error", async () => {
    const { server, tools, alice } = await setup();
    const room = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
    const wall = room.walls[0]?.id ?? "";
    const r = summary(await tools.setWallThickness({ wall, thickness: 0.1 }));
    expect(r.walls.find((w) => w.id === wall)?.thickness).toBe(0.1);
    expect(r.walls.filter((w) => w.thickness !== undefined)).toHaveLength(1);
    await server.settle();
    expect(alice.drawing()?.walls[wall]?.thickness).toBe(0.1);
    expect(alice.collaborators().find((c) => c.name === "Claude")?.at).toEqual({ x: 2, y: 0 }); // the wall's midpoint
    const missing = await tools.setWallThickness({ wall: "nope", thickness: 0.1 });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("Wall not found");
  });

  it("draw_room with thickness 0.1 stores four 0.10 walls", async () => {
    const { tools } = await setup();
    const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3, thickness: 0.1 }));
    expect(s.walls.map((w) => w.thickness)).toEqual([0.1, 0.1, 0.1, 0.1]);
    expect(s.rooms.map((r) => r.area)).toEqual([11.31]); // (4 - 0.1) x (3 - 0.1)
  });

  it("add_wall and add_walls take a thickness per wall; without one a wall is 0.20", async () => {
    const { tools } = await setup();
    summary(await tools.addWall({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.3 }));
    const s = summary(
      await tools.addWalls({ walls: [{ a: { x: 0, y: 1 }, b: { x: 4, y: 1 }, thickness: 0.05 }, { a: { x: 0, y: 2 }, b: { x: 4, y: 2 } }] }),
    );
    expect(s.walls.map((w) => [w.from[1], w.thickness]).sort((p, q) => Number(p[0]) - Number(q[0]))).toEqual([[0, 0.3], [1, 0.05], [2, undefined]]);
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

describe("large drawings (spec: mcp)", () => {
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
  }, 30_000); // hundreds of edits: the default 5 s fails under load (furnish.28)
});

describe("add_walls (spec: mcp)", () => {
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

describe("presence (spec: collaboration)", () => {
  it("add_walls leaves Claude's cursor at the middle of the last wall", async () => {
    const { server, tools, alice } = await setup();
    summary(await tools.addWalls({ walls: MAZE }));
    await server.settle();
    const claude = alice.collaborators().find((c) => c.name === "Claude");
    expect(claude?.at?.x).toBe(2);
    expect(claude?.at?.y).toBe(2);
  });

  it("shows Claude's cursor to the other client where the last edit happened", async () => {
    const { server, tools, alice } = await setup();
    await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 });
    await server.settle();
    const claude = alice.collaborators().find((c) => c.name === "Claude");
    expect(claude?.at?.x).toBe(2);
    expect(claude?.at?.y).toBe(1.5);
    await tools.moveJoint({ joint: summary(await tools.getDrawing()).joints[0]?.id ?? "", to: { x: -0.5, y: 0 } });
    await server.settle();
    expect(alice.collaborators().find((c) => c.name === "Claude")?.at?.x).toBe(-0.5);
  });
});

// Layout states (spec: layouts, AC-07). A 4 × 5 room at (0, 0): inner faces at x 0.1 and 3.9, y 0.1 and 4.9.
// Positions are footprint centres; a configuration change keeps the back edge where it is.
//  y
//  5  ┌──────────────┐
//     │ ▄▄▄▄▄▄       │   murphy bed, folded, back against the top wall
//     │              │
//  3  │  ▭▭▭▭        │   folding table
//     │              │
//  0  └──────────────┘
//     0              4  x
type LayoutReply = DrawingSummary & { result: { object?: string; layout?: { id: string; name: string } } };

function layoutReply(r: Reply): LayoutReply {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

const objectIn = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id);

describe("layout tools (spec: layouts, AC-07)", () => {
  async function room(): Promise<Awaited<ReturnType<typeof setup>>> {
    const ctx = await setup();
    summary(await ctx.tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
    return ctx;
  }

  it("place_object in the Layout state creates an object; the reply gives the object id; a placement over a wall replies with the fit message as an error", async () => {
    const { server, tools, alice } = await room();
    const r = layoutReply(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 2.5 } }));
    const id = r.result.object ?? "";
    expect(r.result.layout).toEqual({ id: "s0", name: "Layout" });
    expect(objectIn(r, id)).toMatchObject({ kind: "bed", name: "Bed", placements: { s0: { centre: [2, 2.5], rotation: 0, config: "standard" } } });
    await server.settle();
    expect(alice.drawing()?.objects[id]?.kind).toBe("bed");
    expect(alice.collaborators().find((c) => c.name === "Claude")?.at).toEqual({ x: 2, y: 2.5 }); // the footprint's centre
    const over = await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 0.5 }, name: "Guest bed" });
    expect(over).toEqual({ text: "Guest bed (0.00–1.00) overlaps a wall in Layout", isError: true });
    expect(summary(await tools.getDrawing()).objects).toHaveLength(1);
  });

  it("place_object takes the centre at any rotation; move_object with a rotation only turns it in place", async () => {
    const { tools } = await room();
    const placed = layoutReply(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 2 }, rotation: 450 }));
    const id = placed.result.object ?? "";
    expect(objectIn(placed, id)?.placements["s0"]).toEqual({ centre: [2, 2], rotation: 90, config: "standard", on: "floor", sides: ["front"], zones: { front: { depth: 0.8, start: 0.25, end: 0.25 } } });
    const turned = layoutReply(await tools.moveObject({ layout: "s0", object: id, rotation: -45 }));
    expect(objectIn(turned, id)?.placements["s0"]).toEqual({ centre: [2, 2], rotation: 315, config: "standard", on: "floor", sides: ["front"], zones: { front: { depth: 0.8, start: 0.25, end: 0.25 } } });
    const moved = layoutReply(await tools.moveObject({ layout: "s0", object: id, centre: { x: 3, y: 1 } }));
    expect(objectIn(moved, id)?.placements["s0"]).toEqual({ centre: [3, 1], rotation: 315, config: "standard", on: "floor", sides: ["front"], zones: { front: { depth: 0.8, start: 0.25, end: 0.25 } } });
  });

  it("place_object and move_object store the anchor to the millimetre, as the Object tool does (spec: layouts, mcp, arch-review R-02)", async () => {
    const { server, tools, alice } = await room();
    const centre = { x: 1.2345, y: 2.3456 };
    const desk = layoutReply(await tools.placeObject({ layout: "s0", kind: "desk", centre: centre, rotation: 30 })).result.object ?? "";
    await server.settle();
    const placed = Object.values(alice.drawing()?.placements ?? {}).find((p) => p.object === desk);
    expect(placed?.at).toEqual(anchorAtMm(centre, 0.6, 30));
    await tools.moveObject({ layout: "s0", object: desk, centre: { x: 2.0001, y: 2.9999 } });
    await server.settle();
    const moved = Object.values(alice.drawing()?.placements ?? {}).find((p) => p.object === desk);
    expect(moved?.at).toEqual(anchorAtMm({ x: 2.0001, y: 2.9999 }, 0.6, 30));
    const before = moved?.at;
    await tools.moveObject({ layout: "s0", object: desk }); // neither moved nor turned: the stored anchor stays exactly
    await server.settle();
    expect(Object.values(alice.drawing()?.placements ?? {}).find((p) => p.object === desk)?.at).toEqual(before);
  });

  it("copy_state then set_configuration \"down\" in the new state changes the copy only", async () => {
    const { tools } = await room();
    const bed = layoutReply(await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 2, y: 4.6 } })).result.object ?? "";
    const copied = layoutReply(await tools.copyLayout({ from: "s0", name: "Night" }));
    const night = copied.result.layout?.id ?? "";
    expect(copied.layouts).toEqual([{ id: "s0", name: "Layout", blocked: [] }, { id: night, name: "Night", blocked: [] }]);
    expect(objectIn(copied, bed)?.placements[night]).toEqual({ centre: [2, 4.6], rotation: 0, config: "folded", on: "floor", sides: ["front"], zones: { front: null } });
    const down = layoutReply(await tools.setConfiguration({ layout: night, object: bed, config: "down" }));
    expect(down.result.layout).toEqual({ id: night, name: "Night" });
    // The back edge stays against the wall (y 4.8); the bed unfolds into the room.
    expect(objectIn(down, bed)?.placements).toEqual({
      s0: { centre: [2, 4.6], rotation: 0, config: "folded", on: "floor", sides: ["front"], zones: { front: null } },
      [night]: { centre: [2, 3.75], rotation: 0, config: "down", on: "floor", sides: ["front"], zones: { front: { depth: 0.6, start: 0.1, end: 0.1 } } },
    });
    const bad = await tools.setConfiguration({ layout: night, object: bed, config: "open" });
    expect(bad).toEqual({ text: "Murphy bed has the configurations folded, down", isError: true });
  });

  it("move_object in a state where the object is absent replies with a clear error", async () => {
    const { tools } = await room();
    const bed = layoutReply(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 2.5 } })).result.object ?? "";
    layoutReply(await tools.moveObject({ layout: "s0", object: bed, everyLayout: false })); // an exception, so a new layout has none (review.07)
    const empty = layoutReply(await tools.addLayout({ name: "Empty" }));
    const state = empty.result.layout?.id ?? "";
    expect(objectIn(empty, bed)?.placements).toEqual({ s0: { centre: [2, 2.5], rotation: 0, config: "standard", on: "floor", sides: ["left", "right"], zones: { left: { depth: 0.6, start: 0.45, end: 0 }, right: { depth: 0.6, start: 0.45, end: 0 } } }, [state]: null });
    expect(await tools.moveObject({ layout: state, object: bed, centre: { x: 2, y: 2 } })).toEqual({
      text: `Bed (${bed}) is not in the layout Empty (${state}): it has no placement there`,
      isError: true,
    });
    expect(await tools.moveObject({ layout: "nope", object: bed, centre: { x: 2, y: 2 } })).toEqual({ text: "No layout has the id nope", isError: true });
    expect(await tools.moveObject({ layout: state, object: "nope", centre: { x: 2, y: 2 } })).toEqual({ text: "No object has the id nope", isError: true });
  });

  it("set_size sets the width of every configuration and one configuration's depth, in every state; a kind with two configurations needs config", async () => {
    const { tools } = await room();
    const bed = layoutReply(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 2.5 } })).result.object ?? "";
    const resized = layoutReply(await tools.setSize({ object: bed, width: 1.4, depth: 1.9 }));
    expect(objectIn(resized, bed)?.sizes).toEqual({ standard: { width: 1.4, depth: 1.9, height: 1, elevation: 0 } });
    const murphy = layoutReply(await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 2, y: 4.6 } })).result.object ?? "";
    const ambiguous = await tools.setSize({ object: murphy, width: 1.4, depth: 0.3 });
    expect(ambiguous).toEqual({ text: "Murphy bed has the configurations folded, down: pass config", isError: true });
    const folded = layoutReply(await tools.setSize({ object: murphy, config: "folded", width: 1.4, depth: 0.3 }));
    expect(objectIn(folded, murphy)?.sizes).toEqual({ folded: { width: 1.4, depth: 0.3, height: 2.24, elevation: 0 }, down: { width: 1.4, depth: 2.1, height: 2.24, elevation: 0 } });
    const tooBig = await tools.setSize({ object: bed, width: 1.4, depth: 6 });
    expect(tooBig).toEqual({ text: "Bed (0.00–1.00) overlaps a wall in Layout", isError: true });
  });

  it("add a state, fold the bed down, move the table: get_drawing and another client show the result", async () => {
    const { server, tools, alice } = await room();
    const bed = layoutReply(await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 1, y: 4.6 } })).result.object ?? "";
    const table = layoutReply(await tools.placeObject({ layout: "s0", kind: "foldingTable", centre: { x: 1, y: 3 }, name: "Table" })).result.object ?? "";
    // Opening keeps the folded table's back edge (y 3.075): it now spans y 2.275 to 3.075.
    layoutReply(await tools.setConfiguration({ layout: "s0", object: table, config: "open" }));
    const night = layoutReply(await tools.copyLayout({ from: "s0", name: "Night" })).result.layout?.id ?? "";
    const blocked = await tools.setConfiguration({ layout: night, object: bed, config: "down" });
    expect(blocked.isError).toBe(true);
    expect(["Murphy bed (0.00–2.24) and Table (0.00–0.75) overlap in Night", "Table (0.00–0.75) and Murphy bed (0.00–2.24) overlap in Night"]).toContain(blocked.text); // named in ID order
    layoutReply(await tools.moveObject({ layout: night, object: table, centre: { x: 3, y: 1 }, rotation: 90, everyLayout: false })); // Night's own place (review.07)
    layoutReply(await tools.setConfiguration({ layout: night, object: bed, config: "down" }));
    const s = summary(await tools.getDrawing());
    expect(s.layouts.map((st) => st.name)).toEqual(["Layout", "Night"]);
    expect(objectIn(s, bed)?.placements).toEqual({
      s0: { centre: [1, 4.6], rotation: 0, config: "folded", on: "floor", sides: ["front"], zones: { front: null } },
      [night]: { centre: [1, 3.75], rotation: 0, config: "down", on: "floor", sides: ["front"], zones: { front: { depth: 0.6, start: 0.1, end: 0.1 } } },
    });
    expect(objectIn(s, table)?.placements).toEqual({
      s0: { centre: [1, 2.675], rotation: 0, config: "open", on: "floor", sides: ["front"], zones: { front: { depth: 0.6, start: 0, end: 0 } } },
      [night]: { centre: [3, 1], rotation: 90, config: "open", on: "floor", sides: ["front"], zones: { front: { depth: 0.6, start: 0, end: 0 } } },
    });
    // 3.8 × 4.8 = 18.24 m² clear; Layout uses 0.64 + 0.96, Night 3.36 + 0.96.
    expect(s.rooms[0]?.freeFloor).toEqual({ s0: 16.64, [night]: 13.92 });
    await server.settle();
    expect(Object.values(alice.drawing()?.states ?? {}).map((st) => st.name).sort()).toEqual(["Layout", "Night"]);
    expect(Object.values(alice.drawing()?.placements ?? {}).find((p) => p.object === bed && p.state === night)?.config).toBe("down");
  });
});

// Smart objects (AC-10): a 4 × 5 room (inner faces x 0.1–3.9, y 0.1–4.9) with a door on the bottom wall, a wardrobe
// against the top wall and a US Queen bed; Night moves the bed down by the door.
//
//  4.9 ┌───────────────────────┐
//      │ wardrobe   ░ zone 3.7–4.3   Layout: the bed (y up to 3.765) is in the wardrobe's front zone
//      │ ▒▒▒▒▒▒                │
//      │      ┌──bed──┐        │   Night: the bed at x 0.19–1.81, y 0.835–2.965 is in the door's swing
//      │      │       │        │   (x 1.2–2.0, y 0.1–0.9), and its left zone (x −0.41–0.19) is in the
//      │      └───────┘        │   left wall
//  0.1 └────[door]─────────────┘
type SmartReply = DrawingSummary & { result: { object?: string; layout?: { id: string; name: string } } };
type Blocked = { zone: string; by: string };
const byZone = (list: readonly Blocked[] | undefined): Blocked[] =>
  [...(list ?? [])].sort((a, b) => (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : a.by < b.by ? -1 : a.by > b.by ? 1 : 0));

describe("smart objects (AC-10)", () => {
  async function scene(): Promise<Awaited<ReturnType<typeof setup>> & { door: string; wardrobe: string; bed: string; night: string }> {
    const ctx = await setup();
    const { tools } = ctx;
    const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
    const bottom = s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id ?? "";
    const door = sceneReply(await tools.addDoor({ wall: bottom, offset: 1.2 })).result.opening ?? "";
    const wardrobe = sceneReply(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: { x: 1, y: 4.6 } })).result.object ?? "";
    const bed = sceneReply(await tools.placeObject({ layout: "s0", kind: "bed", preset: "US Queen", centre: { x: 2, y: 2.7 } })).result.object ?? "";
    const night = sceneReply(await tools.copyLayout({ from: "s0", name: "Night" })).result.layout?.id ?? "";
    sceneReply(await tools.moveObject({ layout: night, object: bed, centre: { x: 1, y: 1.9 }, everyLayout: false })); // Night's own place (review.07)
    return { ...ctx, door, wardrobe, bed, night };
  }
  type SceneReply = SmartReply & { result: { opening?: string } };
  const sceneReply = (r: Reply): SceneReply => {
    expect(r.isError, r.text).toBe(false);
    return JSON.parse(r.text);
  };
  const blockedIn = (s: DrawingSummary, state: string): Blocked[] => byZone(s.layouts.find((st) => st.id === state)?.blocked);

  it("place_object with preset US Queen places a 1.62 × 2.13 bed; get_drawing lists blocked zones and swings per layout with ids", async () => {
    const { tools, door, wardrobe, bed, night } = await scene();
    const s = summary(await tools.getDrawing());
    expect(objectIn(s, bed)?.sizes).toEqual({ standard: { width: 1.62, depth: 2.13, height: 1, elevation: 0 } });
    expect(objectIn(s, bed)?.placements["s0"]?.centre).toEqual([2, 2.7]);
    expect(blockedIn(s, "s0")).toEqual([{ zone: `Wardrobe (${wardrobe}) front zone`, by: `Bed (${bed})` }]);
    expect(blockedIn(s, night)).toEqual(byZone([
      { zone: `Door ${door} swing`, by: `Bed (${bed})` },
      { zone: `Bed (${bed}) left zone`, by: "wall" },
    ]));
  });

  it("get_drawing's legend through the real session", async () => {
    const { tools } = await scene();
    expect("classes" in summary(await tools.getDrawing())).toBe(false); // left the listing (mcp.01)
  });

  it("place_object with seatedDining and preset 6 seats places a 2.60 × 2.10 piece, 0.90 tall, a TABLE (AC-04)", async () => {
    const { tools } = await setup();
    summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
    const set = sceneReply(await tools.placeObject({ layout: "s0", kind: "seatedDining", preset: "6 seats", centre: { x: 2, y: 2.5 } })).result.object ?? "";
    const s = summary(await tools.getDrawing());
    expect(objectIn(s, set)?.sizes).toEqual({ standard: { width: 2.6, depth: 2.1, height: 0.9, elevation: 0 } });
    const round = await tools.placeObject({ layout: "s0", kind: "seatedRound", preset: "8 seats", centre: { x: 2, y: 4.3 } });
    expect(round.isError, round.text).toBe(true); // 2.76 across: into the wall
  });

  it("place_object refuses a preset of another kind", async () => {
    const { tools } = await scene();
    const before = summary(await tools.getDrawing()).objects.length;
    expect(await tools.placeObject({ layout: "s0", kind: "wardrobe", preset: "King", centre: { x: 3, y: 4.6 } })).toEqual({
      text: "Wardrobe has the presets 50 × 60, 100 × 60, 120 × 60, 150 × 60, 200 × 60, 250 × 60, 300 × 60",
      isError: true,
    });
    expect(summary(await tools.getDrawing()).objects).toHaveLength(before);
  });

  it("set_size takes a preset or width and depth, never both", async () => {
    const { tools } = await layoutRoom();
    const bed = smart(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 2.5 } })).result.object ?? "";
    // US Queen's depth differs from the default, and Super king's from US Queen's, so each preset's depth must reach the object.
    expect(objectIn(smart(await tools.setSize({ object: bed, preset: "US Queen" })), bed)?.sizes).toEqual({ standard: { width: 1.62, depth: 2.13, height: 1, elevation: 0 } });
    expect(objectIn(smart(await tools.setSize({ object: bed, preset: "Super king" })), bed)?.sizes).toEqual({ standard: { width: 1.9, depth: 2.1, height: 1, elevation: 0 } });
    expect(await tools.setSize({ object: bed, preset: "Super king", width: 1 })).toEqual({ text: "Pass either a preset, or a size (width, depth, height, elevation, config, arms), not both", isError: true });
    expect(await tools.setSize({ object: bed, preset: "Super king", config: "standard" })).toEqual({ text: "Pass either a preset, or a size (width, depth, height, elevation, config, arms), not both", isError: true });
    expect(await tools.setSize({ object: bed })).toEqual({ text: "Pass a preset, or width and depth, or a height, elevation or arm", isError: true });
    expect(await tools.setSize({ object: bed, width: 1.8 })).toEqual({ text: "Pass both width and depth", isError: true });
    expect(await tools.setSize({ object: bed, preset: "2 seats" })).toEqual({ text: "Bed has the presets Small single, Narrow single, Single, Small double, Double, King, Super king, US Queen, US King", isError: true });
    // A sofa bed against the top wall, placed as a sofa (y 3.9–4.8), clear of the bed (y 1.45–3.55).
    const sofaBed = smart(await tools.placeObject({ layout: "s0", kind: "sofaBed", centre: { x: 2, y: 4.35 } })).result.object ?? "";
    expect(objectIn(smart(await tools.setSize({ object: sofaBed, preset: "2 seats" })), sofaBed)?.sizes).toEqual({
      sofa: { width: 1.5, depth: 0.9, height: 0.9, elevation: 0 },
      bed: { width: 1.5, depth: 1.6, height: 0.9, elevation: 0 },
    });
    expect(objectIn(smart(await tools.setSize({ object: sofaBed, config: "bed", width: 1.8, depth: 1.7 })), sofaBed)?.sizes).toEqual({
      sofa: { width: 1.8, depth: 0.9, height: 0.9, elevation: 0 },
      bed: { width: 1.8, depth: 1.7, height: 0.9, elevation: 0 },
    });
    const murphy = smart(await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 2, y: 0.3 }, rotation: 180 })).result.object ?? "";
    expect(await tools.setSize({ object: murphy, width: 1.4, depth: 0.3 })).toEqual({ text: "Murphy bed has the configurations folded, down: pass config", isError: true });
  });

  it("place_object places every bathroom kind; a preset sizes the shower tray; a single-size kind refuses a preset", async () => {
    // The 4 × 5 room's inner faces are x 0.1–3.9, y 0.1–4.9; positions are footprint centres, rotation 0.
    const { tools } = await layoutRoom();
    const pieces: [kind: string, x: number, y: number, w: number, d: number][] = [
      ["bathtub", 1.0, 4.5, 1.7, 0.7], // x 0.15–1.85, y 4.15–4.85
      ["showerTray", 3.4, 4.45, 0.8, 0.8], // y 4.05–4.85
      ["cornerShower", 3.4, 3.5, 0.8, 0.8], // y 3.1–3.9
      ["toilet", 0.4, 3.5, 0.36, 0.54],
      ["bidet", 1.0, 3.5, 0.36, 0.54],
      ["washbasin", 1.8, 3.5, 0.6, 0.45],
      ["cornerBasin", 2.5, 3.5, 0.45, 0.45],
      ["washingMachine", 0.5, 2.3, 0.6, 0.6],
    ];
    const ids: string[] = [];
    for (const [kind, x, y] of pieces) ids.push(smart(await tools.placeObject({ layout: "s0", kind, centre: { x, y } })).result.object ?? "");
    const s = summary(await tools.getDrawing());
    expect(s.objects).toHaveLength(8);
    pieces.forEach(([kind, , , w, d], i) => expect(objectIn(s, ids[i] ?? ""), kind).toMatchObject({ kind, sizes: { standard: { width: w, depth: d } } }));
    const tray = smart(await tools.placeObject({ layout: "s0", kind: "showerTray", preset: "Rectangular", centre: { x: 2, y: 1.2 } })).result.object ?? "";
    expect(objectIn(summary(await tools.getDrawing()), tray)?.sizes).toEqual({ standard: { width: 0.8, depth: 1.2, height: 2, elevation: 0 } });
    expect(await tools.placeObject({ layout: "s0", kind: "bidet", preset: "60 × 60", centre: { x: 2, y: 2.5 } })).toEqual({ text: "Bidet has no presets", isError: true });
  });

  it("place_object places every new kind; a preset sizes the sink and the bed; a single-size kind has no presets", async () => {
    // The 4 × 5 room's inner faces are x 0.1–3.9, y 0.1–4.9; positions are footprint centres, rotation 0.
    const { tools } = await layoutRoom();
    const pieces: [kind: string, x: number, y: number, w: number, d: number][] = [
      ["fridge", 0.45, 4.45, 0.6, 0.65], // a kitchen run along the top: x 0.15–0.75
      ["ovenColumn", 1.1, 4.45, 0.6, 0.6], // x 0.8–1.4
      ["hobUnit", 1.75, 4.45, 0.6, 0.6], // x 1.45–2.05
      ["sinkUnit", 2.55, 4.45, 0.8, 0.6], // x 2.15–2.95
      ["dishwasher", 3.3, 4.45, 0.6, 0.6], // x 3.0–3.6
      ["counter", 0.45, 3.4, 0.6, 0.6],
      ["roundTable", 2.0, 2.6, 0.9, 0.9], // x 1.55–2.45, y 2.15–3.05
      ["armchair", 0.6, 1.5, 0.8, 0.8],
      ["coffeeTable", 2.0, 1.2, 1, 0.5], // y 0.95–1.45
      ["tvUnit", 2.0, 0.4, 1.2, 0.4], // y 0.2–0.6
      ["nightstand", 3.5, 2.8, 0.45, 0.4],
    ];
    const ids: string[] = [];
    for (const [kind, x, y] of pieces) ids.push(smart(await tools.placeObject({ layout: "s0", kind, centre: { x, y } })).result.object ?? "");
    const s = summary(await tools.getDrawing());
    expect(s.objects).toHaveLength(11);
    pieces.forEach(([kind, , , w, d], i) => expect(objectIn(s, ids[i] ?? ""), kind).toMatchObject({ kind, sizes: { standard: { width: w, depth: d } } }));
    const sink = smart(await tools.placeObject({ layout: "s0", kind: "sinkUnit", preset: "120 × 60", centre: { x: 2.0, y: 3.6 } })).result.object ?? "";
    expect(objectIn(summary(await tools.getDrawing()), sink)?.sizes).toEqual({ standard: { width: 1.2, depth: 0.6, height: 0.9, elevation: 0 } });
    const bed = smart(await tools.placeObject({ layout: "s0", kind: "bed", preset: "Small single", centre: { x: 3.4, y: 1.5 } })).result.object ?? "";
    expect(objectIn(summary(await tools.getDrawing()), bed)?.sizes).toEqual({ standard: { width: 0.85, depth: 1.95, height: 1, elevation: 0 } });
    expect(await tools.placeObject({ layout: "s0", kind: "ovenColumn", centre: { x: 3, y: 4 }, preset: "60 × 60" })).toEqual({ text: "Oven column has no presets", isError: true });
  });

  it("set_zones changes one layout's sides (AC-05)", async () => {
    const { tools, door, bed, night } = await scene();
    const s = summary(await tools.setZones({ layout: night, object: bed, left: false }));
    expect(objectIn(s, bed)?.placements[night]?.sides).toEqual(["right"]);
    expect(objectIn(s, bed)?.placements["s0"]?.sides).toEqual(["left", "right"]);
    expect(blockedIn(s, night)).toEqual([{ zone: `Door ${door} swing`, by: `Bed (${bed})` }]);
    const chair = sceneReply(await tools.placeObject({ layout: night, kind: "chair", centre: { x: 3, y: 3 } })).result.object ?? "";
    expect(await tools.setZones({ layout: night, object: chair, front: true })).toEqual({ text: `Chair (${chair}) has no use zone`, isError: true });
    expect(await tools.setZones({ layout: "nope", object: bed, left: true })).toEqual({ text: "No layout has the id nope", isError: true });
    // A built-in unit has no zone folded but one opened, so its sides can be set.
    const unit = sceneReply(await tools.placeObject({ layout: "s0", kind: "builtInTable", centre: { x: 2.8, y: 4.725 } })).result.object ?? "";
    expect(objectIn(summary(await tools.setZones({ layout: "s0", object: unit, front: false })), unit)?.placements["s0"]?.sides).toEqual([]);
  });

  it("set_zones sets a side's depth and insets in one layout; get_drawing lists them (AC-21)", async () => {
    const { server, tools, alice, bed, night } = await scene();
    const BED = { depth: 0.6, start: 0.45, end: 0 };
    const narrowed = summary(await tools.setZones({ layout: night, object: bed, left: { depth: 0.4 } }));
    expect(objectIn(narrowed, bed)?.placements[night]?.zones.left).toEqual({ depth: 0.4, start: 0.45, end: 0 }); // insets left out keep theirs
    expect(objectIn(narrowed, bed)?.placements["s0"]?.zones.left).toEqual(BED);
    const front = summary(await tools.setZones({ layout: night, object: bed, front: { depth: 0.5, start: 0.2, end: 0.2 } }));
    expect(objectIn(front, bed)?.placements[night]?.sides).toEqual(["front", "left", "right"]); // numbers turn a side on
    expect(objectIn(front, bed)?.placements[night]?.zones.front).toEqual({ depth: 0.5, start: 0.2, end: 0.2 });
    sceneReply(await tools.setZones({ layout: night, object: bed, right: { depth: 0.3 } }));
    const reset = summary(await tools.setZones({ layout: night, object: bed, right: "default" }));
    expect(objectIn(reset, bed)?.placements[night]?.zones.right).toEqual(BED);
    // The back is 1.62 long; the sides command is checked with the extent, so back stays off.
    expect(await tools.setZones({ layout: night, object: bed, back: { depth: 0.5, start: 1, end: 1 } })).toEqual({ text: "A use zone is at least 0.10 m long", isError: true });
    expect(objectIn(summary(await tools.getDrawing()), bed)?.placements[night]?.sides).not.toContain("back");
    await server.settle();
    const seen = Object.values(alice.drawing()?.placements ?? {}).find((p) => p.object === bed && p.state === night);
    expect(seen?.zones).toMatchObject({ leftDepth: 0.4, leftStart: 0.45, leftEnd: 0 });
  });

  it("set_zones on a configuration with no zone needs all three numbers", async () => {
    const { tools, night } = await scene();
    // Folded: x 2.2–3.4, y 4.55–4.9; down it spans y 3.75–4.9, clear of Night's bed and the wardrobe.
    const unit = sceneReply(await tools.placeObject({ layout: night, kind: "builtInTable", centre: { x: 2.8, y: 4.725 } })).result.object ?? "";
    expect(await tools.setZones({ layout: night, object: unit, front: { depth: 0.8 } })).toEqual({
      text: `Built-in table (${unit}) has no use zone in this configuration: pass depth, start and end`,
      isError: true,
    });
    const set = summary(await tools.setZones({ layout: night, object: unit, front: { depth: 0.8, start: 0.1, end: 0.1 } }));
    expect(objectIn(set, unit)?.placements[night]?.zones).toEqual({ front: null });
    const down = summary(await tools.setConfiguration({ layout: night, object: unit, config: "down" }));
    expect(objectIn(down, unit)?.placements[night]?.zones).toEqual({ front: { depth: 0.8, start: 0.1, end: 0.1 } });
    const chair = sceneReply(await tools.placeObject({ layout: night, kind: "chair", centre: { x: 3, y: 3 } })).result.object ?? "";
    expect(await tools.setZones({ layout: night, object: chair, front: { depth: 0.5 } })).toEqual({ text: `Chair (${chair}) has no use zone`, isError: true });
  });

  it("set_opens_into switches a built-in unit within its family", async () => {
    const { tools, wardrobe } = await scene();
    const unit = sceneReply(await tools.placeObject({ layout: "s0", kind: "builtInTable", centre: { x: 2.8, y: 4.725 } })).result.object ?? "";
    const sizes = { folded: { width: 1.2, depth: 0.35 }, down: { width: 1.2, depth: 1.15 } };
    const bed = objectIn(summary(await tools.setOpensInto({ object: unit, into: "bed" })), unit);
    expect(bed).toMatchObject({ kind: "murphyBed", sizes });
    expect(objectIn(summary(await tools.setOpensInto({ object: unit, into: "table" })), unit)).toMatchObject({ kind: "builtInTable", sizes });
    expect(await tools.setOpensInto({ object: wardrobe, into: "desk" })).toEqual({ text: `Wardrobe (${wardrobe}) is not a built-in unit`, isError: true });
  });
});

// Fit by shape (shapefit.01, AC-03): a 0.90 round table centred at (2, 2.5) in the 4 × 5 room; its square is
// x 1.55–2.45, y 2.05–2.95, its circle radius 0.45. A 0.45 chair at 45° on a diagonal, its front corner `gap` from
// the table's centre, has its centre (gap + 0.225) / √2 out on both axes: at gap 0.47 the corner is 0.332 in on both
// axes, inside the square but clear of the circle; at gap 0.42 it is on the circle.
describe("place_object fits shaped pieces by their shape (shapefit.01, AC-03)", () => {
  const T = { x: 2, y: 2.5 };
  const out = (gap: number): number => (gap + 0.225) * Math.SQRT1_2;

  it("puts two chairs at 45° in a round table's empty corners and refuses one on the circle", async () => {
    const { tools } = await layoutRoom();
    smart(await tools.placeObject({ layout: "s0", kind: "roundTable", centre: T }));
    const left = smart(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: T.x - out(0.47), y: T.y + out(0.47) }, rotation: 45 })).result.object ?? "";
    const right = smart(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: T.x + out(0.47), y: T.y + out(0.47) }, rotation: 315 })).result.object ?? "";
    const s = summary(await tools.getDrawing());
    expect(s.objects.map((o) => o.kind).sort()).toEqual(["chair", "chair", "roundTable"]);
    expect(objectIn(s, left)?.placements["s0"]?.rotation).toBe(45);
    expect(objectIn(s, right)?.placements["s0"]?.rotation).toBe(315);
    const onCircle = await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: T.x + out(0.42), y: T.y - out(0.42) }, rotation: 135 });
    expect(onCircle.isError).toBe(true);
    expect(["Chair (0.00–0.90) and Round table (0.00–0.75) overlap in Layout", "Round table (0.00–0.75) and Chair (0.00–0.90) overlap in Layout"]).toContain(onCircle.text); // named in ID order
    expect(summary(await tools.getDrawing()).objects).toHaveLength(3);
  });
});

// Retired kinds (furnish.19, AC-16): place_object never makes one, but a stored one is edited like any piece.
describe("retired kinds through MCP (furnish.19, AC-16)", () => {
  it("place_object refuses a retired kind in the handler too", async () => {
    const { tools } = await layoutRoom();
    expect(await tools.placeObject({ layout: "s0", kind: "kitchenBlock", centre: { x: 2, y: 2.5 } })).toEqual({
      text: "Kitchen block (kitchenBlock) is retired: stored ones stay, new ones can't be placed",
      isError: true,
    });
    expect(summary(await tools.getDrawing()).objects).toHaveLength(0);
  });

  it("a stored kitchen block still moves and resizes through MCP, and get_drawing names its class", async () => {
    // A 4 × 5 room (inner faces 0.1 / 3.9 and 0.1 / 4.9); Alice's block at x 0.8–3.2, y 4.3–4.9.
    const { server, tools, alice } = await layoutRoom();
    expect((await alice.edit({ type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "kitchenBlock" }, at: { x: 2, y: 4.9 } })).ok).toBe(true);
    await server.settle();
    const moved = await tools.moveObject({ layout: "s0", object: "k/o0", centre: { x: 2, y: 2 } });
    expect(moved.isError, moved.text).toBe(false);
    expect(objectIn(summary(await tools.getDrawing()), "k/o0")?.placements["s0"]?.centre).toEqual([2, 2]);
    const resized = await tools.setSize({ object: "k/o0", width: 2, depth: 0.6 });
    expect(resized.isError, resized.text).toBe(false);
  });
});

async function layoutRoom(): Promise<Awaited<ReturnType<typeof setup>>> {
  const ctx = await setup();
  summary(await ctx.tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  return ctx;
}

function smart(r: Reply): SmartReply {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

// Openings (spec: openings, AC-20): a 4 × 3 room; an offset is metres from the wall's joint a to the opening's start.
type OpeningReply = DrawingSummary & { result: { opening?: string; wall?: string } };

function openingReply(r: Reply): OpeningReply {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

describe("opening tools (spec: openings, AC-20)", () => {
  async function room(): Promise<Awaited<ReturnType<typeof setup>> & { bottom: string; right: string }> {
    const ctx = await setup();
    const s = summary(await ctx.tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
    const bottom = s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id ?? "";
    const right = s.walls.find((w) => w.from[0] === 4 && w.to[0] === 4)?.id ?? "";
    return { ...ctx, bottom, right };
  }

  it("add_door on a wall replies with the door id; a second door over the same span replies with the I12 error", async () => {
    const { server, tools, alice, bottom } = await room();
    const r = openingReply(await tools.addDoor({ wall: bottom, offset: 1.2 }));
    const door = r.result.opening ?? "";
    expect(r.result).toEqual({ opening: door, wall: bottom });
    expect(r.walls.find((w) => w.id === bottom)?.openings).toEqual([{ id: door, kind: "swing", name: "Swing door", offset: 1.2, width: 0.8, side: "left", hinge: "a", glazed: false, height: 2.1 }]);
    expect(r.rooms.map((x) => x.area)).toEqual([10.64]); // openings change no room
    await server.settle();
    expect(alice.drawing()?.openings[door]?.wall).toBe(bottom);
    const cursor = alice.collaborators().find((c) => c.name === "Claude")?.at;
    expect(cursor?.x).toBeCloseTo(1.6); // the door's centre
    expect(cursor?.y).toBeCloseTo(0);
    const second = await tools.addDoor({ wall: bottom, offset: 1.5, kind: "sliding" });
    expect(second.isError).toBe(true);
    expect(second.text).toMatch(/^Door \S+ overlaps door \S+ on wall /);
    expect(second.text).toContain(door);
    expect(second.text).toContain(`on wall ${bottom}`);
    const off = await tools.addDoor({ wall: bottom, offset: 3.5 });
    expect(off.isError).toBe(true);
    expect(off.text).toMatch(/^Door \S+ doesn't fit on wall /);
    expect(await tools.addDoor({ wall: "nope", offset: 1 })).toEqual({ text: "No wall has the id nope", isError: true });
    expect(summary(await tools.getDrawing()).counts.openings).toBe(1);
  });

  it("add_door passes kind, width, side, hinge and glazed", async () => {
    const { tools, bottom } = await room();
    const r = openingReply(await tools.addDoor({ wall: bottom, offset: 0.5, width: 0.9, kind: "sliding", side: "right", hinge: "b", glazed: true }));
    expect(r.walls.find((w) => w.id === bottom)?.openings).toEqual([
      { id: r.result.opening, kind: "sliding", name: "Sliding door", offset: 0.5, width: 0.9, side: "right", hinge: "b", glazed: true, height: 2.1 },
    ]);
  });

  it("add_door and add_window take the new kinds; get_drawing names each by its label, with the fields its kind uses (AC-10)", async () => {
    const { tools, bottom, right } = await room();
    const curtain = openingReply(await tools.addDoor({ wall: bottom, offset: 0.5, kind: "curtain", side: "right" })).result.opening ?? "";
    const casement = openingReply(await tools.addWindow({ wall: right, offset: 1, kind: "casement", side: "right", hinge: "b" })).result.opening ?? "";
    const s = summary(await tools.getDrawing());
    expect(s.walls.find((w) => w.id === bottom)?.openings).toEqual([{ id: curtain, kind: "curtain", name: "Curtain", offset: 0.5, width: 0.8, side: "right", height: 2.1 }]);
    expect(s.walls.find((w) => w.id === right)?.openings).toEqual([{ id: casement, kind: "casement", name: "Casement window", offset: 1, width: 0.6, side: "right", hinge: "b", sill: 0.9, height: 1.2 }]);
    const narrow = await tools.addDoor({ wall: bottom, offset: 2, kind: "double", width: 0.6 });
    expect(narrow).toEqual({ text: "Double door width must be between 0.80 and 2.40 m", isError: true });
  });

  it("add_window then get_drawing lists the window under its wall with offset and width", async () => {
    const { tools, right } = await room();
    const r = openingReply(await tools.addWindow({ wall: right, offset: 1, width: 1.2 }));
    const window = r.result.opening ?? "";
    expect(r.result).toEqual({ opening: window, wall: right });
    const s = summary(await tools.getDrawing());
    expect(s.walls.find((w) => w.id === right)?.openings).toEqual([{ id: window, kind: "window", name: "Fixed window", offset: 1, width: 1.2, sill: 0.9, height: 1.2 }]);
    expect(s.walls.filter((w) => w.openings !== undefined)).toHaveLength(1);
    const over = await tools.addDoor({ wall: right, offset: 1.5 });
    expect(over.isError).toBe(true);
    expect(over.text).toContain(`window ${window} on wall ${right}`);
  });

  it("delete removes a door by id; deleting its wall takes a window with it", async () => {
    const { tools, bottom, right } = await room();
    const door = openingReply(await tools.addDoor({ wall: bottom, offset: 1 })).result.opening ?? "";
    openingReply(await tools.addWindow({ wall: right, offset: 1 }));
    const s = summary(await tools.delete({ ids: [door] }));
    expect(s.walls.find((w) => w.id === bottom)).not.toHaveProperty("openings");
    expect(s.walls).toHaveLength(4);
    const after = summary(await tools.delete({ ids: [right] }));
    expect(after.walls.filter((w) => w.openings !== undefined)).toEqual([]);
    expect(after.counts.openings).toBe(0);
  });
});

describe("created ids come from the patch (cleanup step 09)", () => {
  it("add_door, add_state, copy_state and place_object reply with the ids get_drawing then lists", async () => {
    const { tools } = await setup();
    const room = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
    const wall = room.walls[0]?.id ?? "";
    const door: { result: { opening?: string }; walls: { id: string; openings?: { id: string }[] }[] } = JSON.parse((await tools.addDoor({ wall, offset: 1 })).text);
    expect(door.walls.flatMap((w) => (w.openings ?? []).map((o) => o.id))).toEqual([door.result.opening]);
    const added = layoutReply(await tools.addLayout({ name: "Night" }));
    const copied = layoutReply(await tools.copyLayout({ from: "s0", name: "Day" }));
    expect(added.layouts.map((s) => s.id)).toContain(added.result.layout?.id);
    expect(copied.layouts.map((s) => s.id)).toContain(copied.result.layout?.id);
    expect(copied.result.layout).toMatchObject({ name: "Day" });
    const placed = layoutReply(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 3 } }));
    expect(placed.objects.map((o) => o.id)).toEqual([placed.result.object]);
  });
});

describe("delete a piece (cleanup.08, AC-08)", () => {
  async function room(): Promise<Awaited<ReturnType<typeof setup>>> {
    const ctx = await setup();
    summary(await ctx.tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
    return ctx;
  }
  /** A desk placed in Layout and copied into Night: one object with a placement in each. */
  async function deskInTwo() {
    const { tools, server, alice } = await room();
    const desk = layoutReply(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 3 } })).result.object ?? "";
    layoutReply(await tools.moveObject({ layout: "s0", object: desk, everyLayout: false })); // an exception: each layout its own (review.07)
    const night = layoutReply(await tools.copyLayout({ from: "s0", name: "Night" })).result.layout?.id ?? "";
    return { tools, server, alice, desk, night };
  }

  it("removes a piece the same in every layout from every layout (review.05)", async () => {
    const { tools } = await room();
    const desk = layoutReply(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 3 } })).result.object ?? "";
    layoutReply(await tools.copyLayout({ from: "s0", name: "Night" }));
    const s = layoutReply(await tools.delete({ ids: [desk], layout: "s0" }));
    expect(objectIn(s, desk)).toBeUndefined();
  });

  it("removes the piece from the given layout only", async () => {
    const { tools, desk, night } = await deskInTwo();
    const s = layoutReply(await tools.delete({ ids: [desk], layout: "s0" }));
    expect(objectIn(s, desk)?.placements["s0"]).toBeNull();
    expect(objectIn(s, desk)?.placements[night]).toMatchObject({ centre: [2, 3] });
  });

  it("a piece with its last placement gone is gone, for every client", async () => {
    const { tools, server, alice, desk, night } = await deskInTwo();
    layoutReply(await tools.delete({ ids: [desk], layout: "s0" }));
    const s = layoutReply(await tools.delete({ ids: [desk], layout: night }));
    expect(objectIn(s, desk)).toBeUndefined();
    await server.settle();
    expect(alice.drawing()?.objects[desk]).toBeUndefined();
  });

  it("a piece id without a state is refused with a reason; nothing changes", async () => {
    const { tools, desk } = await deskInTwo();
    const r = await tools.delete({ ids: [desk] });
    expect(r).toEqual({ text: `Desk (${desk}) is a piece: pass layout to say which one`, isError: true });
    expect(objectIn(layoutReply(await tools.getDrawing()), desk)?.placements["s0"]).not.toBeNull();
  });

  it("a piece not in that layout is refused with placementIn's reason", async () => {
    const { tools, desk, night } = await deskInTwo();
    layoutReply(await tools.delete({ ids: [desk], layout: night }));
    const r = await tools.delete({ ids: [desk], layout: night });
    expect(r.isError).toBe(true);
    expect(r.text).toBe(`Desk (${desk}) is not in the layout Night (${night}): it has no placement there`);
  });

  it("a deck and the only piece standing on it go in one call", async () => {
    const { tools } = await room();
    const added: { result: { deck?: string } } = JSON.parse((await tools.addDeck({ centre: { x: 2, y: 2.5 }, width: 2, depth: 2 })).text);
    const deck = added.result.deck ?? "";
    const chair = layoutReply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 2, y: 2.5 }, on: deck })).result.object ?? "";
    expect((await tools.delete({ ids: [deck] })).isError).toBe(true); // carried: refused alone
    const s = layoutReply(await tools.delete({ ids: [deck, chair], layout: "s0" }));
    expect(objectIn(s, chair)).toBeUndefined();
    expect(s.decks.find((d) => d.id === deck)).toBeUndefined();
  });
});

describe("project fields through MCP (sheet.06, AC-08)", () => {
  it("get_drawing lists set fields by key and leaves out empty ones", async () => {
    const { tools } = await setup();
    expect(summary(await tools.getDrawing()).fields).toEqual({});
    const s = summary(await tools.setProjectField({ key: "client", value: "Rossi" }));
    expect(s.fields).toEqual({ client: "Rossi" });
  });

  it("set_project_field sets a field the other collaborator sees, and \"\" clears it", async () => {
    const { tools, alice } = await setup();
    summary(await tools.setProjectField({ key: "client", value: "Rossi" }));
    await expect.poll(() => alice.drawing()?.projectFields.client?.value).toBe("Rossi");
    expect(summary(await tools.setProjectField({ key: "client", value: "" })).fields).toEqual({});
  });

  it("set_project_field to outside changes look's PNG, and its caption names Outside; empty gives today's picture back (surroundings AC-05)", async () => {
    const { tools } = await setup();
    summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
    const look3d = async (): Promise<{ png: Uint8Array; text: string }> => {
      const r = await tools.look({ view: "3d" });
      if (!("png" in r)) throw new Error(r.text);
      return r;
    };
    const none = await look3d();
    expect(none.text).not.toMatch(/Outside/);
    summary(await tools.setProjectField({ key: "surroundings", value: "outside" }));
    const outside = await look3d();
    expect(Buffer.from(outside.png).equals(Buffer.from(none.png))).toBe(false);
    expect(outside.text).toMatch(/Outside/);
    summary(await tools.setProjectField({ key: "surroundings", value: "" }));
    const back = await look3d();
    expect([Buffer.from(back.png).equals(Buffer.from(none.png)), back.text]).toEqual([true, none.text]);
  });

  it("returns the domain's reason for a value too long for its field (an unknown key stops at the schema, sheet.32)", async () => {
    const { tools } = await setup();
    expect(await tools.setProjectField({ key: "client", value: "x".repeat(81) })).toEqual({ text: "Client is longer than 80 characters", isError: true });
  });
});

// Dimensions (dims, AC-15): a triangle (0,0) → (5,0) → (0,2) of 0.20 m walls; its floor corner (0.1, 1.852297) sits at
// the joint (0, 2). Millimetre rounding keeps a listed corner within the domain's 1 mm anchor tolerance.
type DimensionReply = DrawingSummary & { result: { dimension?: string } };

function dimensionReply(r: Reply): DimensionReply {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

describe("dimension tools (dims, AC-15)", () => {
  const triangle = [
    { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } },
    { a: { x: 5, y: 0 }, b: { x: 0, y: 2 } },
    { a: { x: 0, y: 2 }, b: { x: 0, y: 0 } },
  ];

  it("add_dimension from a room's floor corner anchors that end; get_drawing lists it; delete removes it", async () => {
    const { server, tools, alice } = await setup();
    const drawn = summary(await tools.addWalls({ walls: triangle }));
    expect(drawn.rooms[0]?.floor).toContainEqual([0.1, 1.852]);
    const top = drawn.joints.find((j) => j.at[0] === 0 && j.at[1] === 2)?.id ?? "";
    const r = dimensionReply(await tools.addDimension({ from: { x: 0.1, y: 1.852 }, to: { x: 0.1, y: 1 }, offset: -0.5 }));
    await server.settle();
    const ids = Object.keys(alice.drawing()?.dimensions ?? {});
    expect(ids).toHaveLength(1);
    const id = ids[0] ?? "";
    expect(r.result).toEqual({ dimension: id });
    expect(r.dimensions).toEqual([{ id, from: [0.1, 1.852], to: [0.1, 1], offset: -0.5, length: 0.852 }]);
    const cursor = alice.collaborators().find((c) => c.name === "Claude")?.at;
    expect(cursor?.x).toBeCloseTo(0.1); // the middle of from and to
    expect(cursor?.y).toBeCloseTo(1.426);
    const row = alice.drawing()?.dimensions[id];
    expect(row?.a).toMatchObject({ joint: top });
    expect(row?.b).toEqual({ x: 0.1, y: 1 });
    // The corner follows the joint to y = 2.338197; a free end at (0.1, 1.852) would have stayed put.
    const moved = summary(await tools.moveJoint({ joint: top, to: { x: 0, y: 2.5 } }));
    expect(moved.dimensions).toEqual([{ id, from: [0.1, 2.338], to: [0.1, 1], offset: -0.5, length: 1.338 }]);
    const gone = summary(await tools.delete({ ids: [id] }));
    expect(gone).not.toHaveProperty("dimensions");
    expect(gone.counts.dimensions).toBe(0);
    expect(await tools.delete({ ids: ["nope"] })).toEqual({ text: "No wall, column, joint, room label, opening, dimension, deck, hole, piece, section, named area or layout has the id nope", isError: true });
  });

  it("add_dimension shorter than 1 cm replies with the domain's reason", async () => {
    const { tools } = await setup();
    const r = await tools.addDimension({ from: { x: 1, y: 1 }, to: { x: 1.005, y: 1 }, offset: 0.5 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Dimension too short");
    expect(summary(await tools.getDrawing()).counts.dimensions).toBe(0);
  });
});

describe("the underlay through MCP (import.08, .13; AC-09, AC-10)", () => {
  const data = Buffer.from(quadrantJpeg(400, 300, QUADRANTS, 90)).toString("base64");
  const place: Command = { type: "placeUnderlay", pictureId: "picture-1", data, width: 400, height: 300, at: { x: -2.37, y: 5.81 } };

  /** The Apartment with Alice's picture, at 0.01 m/px, as Claude sees it. */
  async function withPicture(): Promise<Awaited<ReturnType<typeof setup>>> {
    const s = await setup();
    expect((await s.alice.edit(place)).ok).toBe(true);
    await s.server.settle();
    expect(s.claude.drawing()?.underlays["underlay"]).toBeDefined();
    return s;
  }

  it("scale_underlay doubles metres per pixel about a and sets scaled (AC-09)", async () => {
    const { server, tools, alice, claude } = await withPicture();
    const a = { x: -1.12, y: 4.93 };
    const b = { x: 1.88, y: 8.93 }; // 5 m from a
    const before = claude.drawing();
    if (before === null) throw new Error("no drawing");
    const s = summary(await tools.scaleUnderlay({ a, b, distance: 10 }));
    const block = s.underlay;
    if (!block) throw new Error("no underlay block");
    expect(block.scaled).toBe(true);
    expect(block.metresPerPixel).toBeCloseTo(0.02, 12);
    const expected = { min: [-3.62, 0.69], max: [4.38, 6.69] };
    for (const corner of ["min", "max"] as const) {
      for (const i of [0, 1]) expect(block.bounds[corner][i]).toBeCloseTo(expected[corner][i] ?? NaN, 3);
    }
    const same = execute(before, { type: "scaleUnderlay", a, b, distance: 10 });
    if (!same.ok) throw new Error(same.error.message);
    const row = claude.drawing()?.underlays["underlay"];
    expect(row).toEqual(same.value.doc.underlays["underlay"]);
    await server.settle();
    expect(alice.drawing()?.underlays["underlay"]).toEqual(row);
    const rect = underlayRect(alice.drawing() ?? before);
    expect([rect?.minX, rect?.minY, rect?.maxX, rect?.maxY].map((v) => Number(v?.toFixed(3)))).toEqual([-3.62, 0.69, 4.38, 6.69]);
  });

  it("scale_underlay refusals give the domain's reason; nothing changes (AC-09)", async () => {
    const { tools, claude } = await withPicture();
    const a = { x: -1.12, y: 4.93 };
    const cases = [
      { a, b: { x: 1.88, y: 8.93 }, distance: 0 },
      { a, b: { x: 1.88, y: 8.93 }, distance: -2 },
      { a, b: a, distance: 3 },
    ];
    for (const args of cases) {
      const doc = claude.drawing();
      if (doc === null) throw new Error("no drawing");
      const row = doc.underlays["underlay"];
      const refused = execute(doc, { type: "scaleUnderlay", ...args });
      if (refused.ok) throw new Error("expected a refusal");
      expect(await tools.scaleUnderlay(args)).toEqual({ text: refused.error.message, isError: true });
      expect(claude.drawing()?.underlays["underlay"]).toBe(row);
    }
    const fresh = await setup();
    const doc = fresh.claude.drawing();
    if (doc === null) throw new Error("no drawing");
    const args = { a, b: { x: 1.88, y: 8.93 }, distance: 10 };
    const refused = execute(doc, { type: "scaleUnderlay", ...args });
    if (refused.ok) throw new Error("expected a refusal");
    expect(await fresh.tools.scaleUnderlay(args)).toEqual({ text: refused.error.message, isError: true });
    expect(fresh.claude.drawing()?.underlays).toEqual({});
  });

  it("no reply text carries the underlay's bytes (AC-10)", async () => {
    const { server, tools, alice } = await withPicture();
    const marker = data.slice(1000, 1064);
    expect(marker).toHaveLength(64);
    const texts: string[] = [];
    const refusals: boolean[] = [];
    const collect = (r: Reply): void => {
      texts.push(r.text);
      refusals.push(r.isError);
    };
    collect(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
    collect(await tools.getDrawing());
    collect(await tools.getDrawing({ region: { min: { x: -1, y: -1 }, max: { x: 2, y: 2 } } }));
    const id = JSON.parse(texts[0] ?? "{}").project.id;
    collect(await tools.openProject({ id }));
    collect(await tools.listProjects());
    collect(await tools.openProject({ id }));
    collect(await tools.addWall({ a: { x: 5, y: 0 }, b: { x: 6, y: 1 } }));
    collect(await tools.addWall({ a: { x: -1, y: 1 }, b: { x: 1, y: 1 } })); // crosses the room's left wall
    collect(await tools.delete({ ids: ["nope"] }));
    collect(await tools.delete({ ids: ["underlay"] }));
    collect(await tools.scaleUnderlay({ a: { x: -1.12, y: 4.93 }, b: { x: 1.88, y: 8.93 }, distance: 10 }));
    collect(await tools.scaleUnderlay({ a: { x: -1.12, y: 4.93 }, b: { x: 1.88, y: 8.93 }, distance: 0 }));
    const look = await tools.look({});
    collect(look);
    if ("png" in look) texts.push(Buffer.from(look.png).toString("base64"));
    collect(await tools.look({ region: { min: { x: 1, y: 1 }, max: { x: 1, y: 2 } } }));
    // A scale racing Alice's: either may lose, and the loser's reply must not carry the row either.
    const before = alice.drawing()?.underlays["underlay"]?.metresPerPixel ?? 0;
    const theirs = alice.edit({ type: "scaleUnderlay", a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, distance: 6 });
    const mine = await tools.scaleUnderlay({ a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, distance: 7 });
    collect(mine);
    const r = await theirs;
    expect(refusals).toContain(true);
    // The pair raced: at least one side lost, and the stored row is one winner's scale (a and b are 5 m apart).
    expect([mine.isError, !r.ok]).toContain(true);
    await server.settle();
    const row = alice.drawing()?.underlays["underlay"];
    expect(row?.scaled).toBe(true);
    const winners = [6, 7].map((d) => (before * d) / 5);
    expect(winners.some((m) => Math.abs((row?.metresPerPixel ?? 0) - m) < 1e-12), `${row?.metresPerPixel}`).toBe(true);
    for (const text of texts) expect(text.includes(marker)).toBe(false);
  });
});
