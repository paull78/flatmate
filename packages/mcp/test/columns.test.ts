import { afterEach, describe, expect, it } from "vitest";
import { columnOf } from "@fm/domain";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Columns in Claude's tools (spec "MCP", pillars.15, .19, .34; AC-17, free part): add_column and set_column run the
// domain's column commands, delete takes a column's ID, get_drawing lists columns on their own and keeps their rows,
// joints and holes out of walls, joints and rooms, and the wall tools given a column get the domain's lock.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { column?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** Claude and Alice on one project with a 4 × 5 room at (0, 0): inner faces at x 0.1 and 3.9, y 0.1 and 4.9 (18.24 m²). */
async function room(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession; left: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const left = s.walls.find((w) => w.from[0] === 0 && w.to[0] === 0)?.id ?? "";
  return { server, tools, alice, left };
}

/** A free 0.30 × 0.30 column in the middle of the room. */
const PILLAR = { centre: { x: 2, y: 2.5 }, width: 0.3, depth: 0.3 } as const;

async function withPillar(): Promise<Awaited<ReturnType<typeof room>> & { id: string; added: Edited }> {
  const r = await room();
  const added = summary(await r.tools.addColumn(PILLAR));
  return { ...r, id: added.result.column ?? "", added };
}

describe("add_column (free)", () => {
  it("returns its ID; get_drawing lists it under columns, not under walls, joints or the room's holes, and the room loses its area", async () => {
    const { server, alice, id, added } = await withPillar();
    expect(id).toMatch(/\/w0$/);
    expect(added.columns).toEqual([
      { id, centre: [2, 2.5], width: 0.3, depth: 0.3, rotation: 0, range: { bottom: 0, top: 2.5 }, inLineOf: null },
    ]);
    expect(added.walls.map((w) => w.id)).not.toContain(id);
    expect(added.walls).toHaveLength(4);
    expect(added.joints).toHaveLength(4);
    expect(JSON.stringify(added.walls)).not.toContain(id.replace(/\/w0$/, ""));
    expect(JSON.stringify(added.joints)).not.toContain(id.replace(/\/w0$/, ""));
    expect(added.counts).toMatchObject({ walls: 4, joints: 4, columns: 1 });
    const [r] = added.rooms;
    expect(r).not.toHaveProperty("holes");
    expect(r?.area).toBe(18.15); // 18.24 less 0.30 × 0.30
    await server.settle();
    const doc = alice.drawing();
    expect(doc && columnOf(doc, id)?.width).toBeCloseTo(0.3, 9);
  });

  it("takes a rotation in degrees and lists it", async () => {
    const { tools } = await room();
    const s = summary(await tools.addColumn({ ...PILLAR, width: 0.6, rotation: 30 }));
    expect(s.columns?.[0]).toMatchObject({ width: 0.6, depth: 0.3, rotation: 30 });
  });

  it("refuses a size out of the column limits with the range, and a column outside every room", async () => {
    const { tools } = await room();
    const wide = await tools.addColumn({ ...PILLAR, width: 2.01 });
    expect(wide.isError).toBe(true);
    expect(wide.text).toContain("2.01 m is outside 0.10–2.00 m");
    expect(await tools.addColumn({ ...PILLAR, centre: { x: 9, y: 9 } })).toEqual({ text: "A column stands inside a room", isError: true });
    expect(summary(await tools.getDrawing())).not.toHaveProperty("columns");
  });

  it("a drawing without columns has no columns field; a region away from a column leaves it out", async () => {
    const { tools } = await room();
    expect(summary(await tools.getDrawing())).not.toHaveProperty("columns");
    summary(await tools.addColumn(PILLAR));
    const away = summary(await tools.getDrawing({ region: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } } }));
    expect(away).not.toHaveProperty("columns");
    const near = summary(await tools.getDrawing({ region: { min: { x: 2.1, y: 2.6 }, max: { x: 3, y: 3 } } }));
    expect(near.columns).toHaveLength(1);
  });
});

describe("set_column (free)", () => {
  it("moves, resizes and turns it", async () => {
    const { tools, id } = await withPillar();
    const s = summary(await tools.setColumn({ column: id, centre: { x: 1, y: 1 }, width: 0.4, depth: 0.2, rotation: 90 }));
    expect(s.columns).toEqual([{ id, centre: [1, 1], width: 0.4, depth: 0.2, rotation: 90, range: { bottom: 0, top: 2.5 }, inLineOf: null }]);
    expect(s.rooms[0]?.area).toBe(18.16); // 18.24 less 0.40 × 0.20
    const deeper = summary(await tools.setColumn({ column: id, depth: 0.5 }));
    expect(deeper.columns?.[0]).toMatchObject({ centre: [1, 1], width: 0.4, depth: 0.5, rotation: 90 });
  });

  it("is refused into a wall with the domain's reason, and nothing changes", async () => {
    const { tools, id, left } = await withPillar();
    expect(await tools.setColumn({ column: id, centre: { x: 0.2, y: 2.5 } })).toEqual({ text: `Column ${id} touches wall ${left}`, isError: true });
    expect(summary(await tools.getDrawing()).columns?.[0]?.centre).toEqual([2, 2.5]);
  });

  it("refuses an ID that is not a column", async () => {
    const { tools, left } = await withPillar();
    const r = await tools.setColumn({ column: left, width: 0.4 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain(left);
    const none = await tools.setColumn({ column: "nope/w0", width: 0.4 });
    expect(none).toEqual({ text: "No column has the id nope/w0", isError: true });
  });
});

describe("delete and the wall tools on a column", () => {
  it("delete with its ID removes it and gives the room its area back", async () => {
    const { tools, id } = await withPillar();
    const s = summary(await tools.delete({ ids: [id] }));
    expect(s).not.toHaveProperty("columns");
    expect(s.counts).toMatchObject({ walls: 4, joints: 4, columns: 0 });
    expect(s.rooms[0]?.area).toBe(18.24);
  });

  it("set_wall_thickness, set_wall_length, set_wall_top and move_joint on a column are refused naming it", async () => {
    const { tools, id, server } = await withPillar();
    const locked = { text: `Column ${id} can't be edited as a wall; edit its position, width and depth`, isError: true };
    expect(await tools.setWallThickness({ wall: id, thickness: 0.3 })).toEqual(locked);
    expect(await tools.setWallLength({ wall: id, length: 0.5 })).toEqual(locked);
    expect(await tools.setWallTop({ wall: id, top: 1 })).toEqual(locked);
    const joint = id.replace(/\/w0$/, "/j0");
    expect(await tools.moveJoint({ joint, to: { x: 1, y: 1 } })).toEqual(locked);
    await server.settle();
    expect(summary(await tools.getDrawing()).columns?.[0]).toMatchObject({ centre: [2, 2.5], width: 0.3, depth: 0.3 });
  });
});

// AC-17 (in line, pillars.42, .43, .36): a centre on a wall's centreline puts the column in the wall's line, splitting it;
// set_column slides it, delete heals the wall. The halves' a and b name the column's joints, which get_drawing doesn't
// list (by design), so move_joint can only reach them by a raw ID, and is then refused with the lock.

/** A 0.30 × 0.40 column on the left wall (x 0) at y 2.5: 0.30 × 0.10 stands proud into the room. */
const IN_LINE = { centre: { x: 0, y: 2.5 }, width: 0.3, depth: 0.4 } as const;

async function inLine(): Promise<Awaited<ReturnType<typeof room>> & { id: string; added: Edited }> {
  const r = await room();
  const added = summary(await r.tools.addColumn(IN_LINE));
  return { ...r, id: added.result.column ?? "", added };
}

describe("add_column on a wall (in its line)", () => {
  it("splits the wall: listed under columns with inLineOf naming the two halves, its row and joints under neither walls nor joints", async () => {
    const { id, left, added } = await inLine();
    expect(id).toMatch(/\/w0$/);
    const [column] = added.columns ?? [];
    expect(column).toMatchObject({ id, centre: [0, 2.5], width: 0.3, depth: 0.4, range: { bottom: 0, top: 2.5 } });
    expect([90, 270]).toContain(column?.rotation); // turned to the wall, whichever way it runs
    const halves = column?.inLineOf ?? [];
    expect(halves).toHaveLength(2);
    expect(halves).toContain(left);
    const listed = added.walls.map((w) => w.id);
    for (const half of halves) expect(listed).toContain(half);
    expect(listed).not.toContain(id);
    expect(added.walls).toHaveLength(5);
    expect(added.joints).toHaveLength(4);
    expect(added.counts).toMatchObject({ walls: 5, joints: 4, columns: 1 });
    // Each half runs from a listed corner to one of the column's joints, which are not listed (pillars.36).
    const jointIds = added.joints.map((j) => j.id);
    for (const half of halves) {
      const w = added.walls.find((x) => x.id === half);
      expect([w?.a, w?.b].filter((j) => j !== undefined && jointIds.includes(j))).toHaveLength(1);
    }
    expect(added.rooms[0]?.area).toBe(18.21); // 18.24 less the 0.30 × 0.10 standing proud
    expect(added.rooms[0]).not.toHaveProperty("holes");
  });

  it("set_column slides it along the wall, its centre kept on the line and its rotation the wall's", async () => {
    const { tools, id, added } = await inLine();
    const rotation = added.columns?.[0]?.rotation;
    const slid = summary(await tools.setColumn({ column: id, centre: { x: 0, y: 3 } }));
    expect(slid.columns?.[0]).toMatchObject({ centre: [0, 3], rotation });
    const across = summary(await tools.setColumn({ column: id, centre: { x: 0.6, y: 2 } }));
    expect(across.columns?.[0]).toMatchObject({ centre: [0, 2], rotation });
    expect(across.walls).toHaveLength(5);
    expect(across.rooms[0]?.area).toBe(18.21);
    expect(await tools.setColumn({ column: id, rotation: 0 })).toEqual({ text: "A column in a wall's line turns with its wall", isError: true });
  });

  it("delete with its ID heals the wall: one wall again, the room's area back", async () => {
    const { tools, id, left } = await inLine();
    const s = summary(await tools.delete({ ids: [id] }));
    expect(s).not.toHaveProperty("columns");
    expect(s.counts).toMatchObject({ walls: 4, joints: 4, columns: 0 });
    const healed = s.walls.find((w) => w.id === left);
    expect([healed?.from, healed?.to]).toEqual(expect.arrayContaining([[0, 0], [0, 5]]));
    expect(s.rooms[0]?.area).toBe(18.24);
  });

  it("move_joint moves a half's far joint; a column's joint given by its raw ID is refused with the lock", async () => {
    const { tools, id, alice, server, added } = await inLine();
    await server.settle();
    const row = alice.drawing()?.walls[id];
    expect(row).toBeDefined();
    const locked = { text: `Column ${id} can't be edited as a wall; edit its position, width and depth`, isError: true };
    for (const joint of [row?.a ?? "", row?.b ?? ""]) {
      expect(added.joints.map((j) => j.id)).not.toContain(joint);
      expect(await tools.moveJoint({ joint, to: { x: 0, y: 2.6 } })).toEqual(locked);
    }
    const corner = added.joints.find((j) => j.at[0] === 0 && j.at[1] === 0)?.id ?? "";
    const moved = summary(await tools.moveJoint({ joint: corner, to: { x: 0, y: -0.5 } }));
    expect(moved.joints.find((j) => j.id === corner)?.at).toEqual([0, -0.5]);
    expect(moved.columns?.[0]).toMatchObject({ centre: [0, 2.5], inLineOf: added.columns?.[0]?.inLineOf });
  });
});
