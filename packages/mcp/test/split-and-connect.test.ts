import { afterEach, describe, expect, it } from "vitest";
import { FakeShell, roomDoc } from "@fm/editor/testing";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";
import { KINKED_WALLS, kinkedPoint } from "./fixtures/kinked-house";

// Step 17 (straight.05, .14, .18): split_wall; move_joint connects where it lands; delete joins a straight joint and
// stitches; each sends the gesture's command, so the same input leaves the same drawing (AC-24).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const listing = async (tools: DrawingTools): Promise<DrawingSummary> => JSON.parse(ok(await tools.getDrawing({})));

async function project(): Promise<{ tools: DrawingTools; claude: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Straight" }));
  return { tools, claude };
}

async function room(): Promise<{ tools: DrawingTools; claude: EditorSession }> {
  const r = await project();
  ok(await r.tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  return r;
}

async function kinkedHouse(): Promise<{ tools: DrawingTools; claude: EditorSession; s: DrawingSummary }> {
  const r = await project();
  ok(await r.tools.addWalls({ walls: KINKED_WALLS }));
  return { ...r, s: await listing(r.tools) };
}

const near = (a: [number, number] | undefined, p: { x: number; y: number }): boolean => a !== undefined && Math.abs(a[0] - p.x) < 1e-6 && Math.abs(a[1] - p.y) < 1e-6;
const jointAt = (s: DrawingSummary, id: string) => s.joints.find((j) => near(j.at, kinkedPoint(id)));
const bottom = (s: DrawingSummary) => s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0);

describe("split_wall", () => {
  it("splits at the typed distance from the room face's start: two walls, the reply naming the wall", async () => {
    const { tools } = await room();
    const wall = bottom(await listing(tools));
    if (!wall) throw new Error("no bottom wall");
    const reply = JSON.parse(ok(await tools.splitWall({ wall: wall.id, offset: 1.2 })));
    expect(reply.result).toEqual({ wall: wall.id });
    const after = await listing(tools);
    expect(after.walls).toHaveLength(5);
    expect(after.joints.some((j) => near(j.at, { x: 1.3, y: 0 }))).toBe(true);
  });

  it("leaves the drawing the Split gesture leaves for the same wall and distance (AC-24)", async () => {
    const { tools, claude } = await room();
    const wall = bottom(await listing(tools));
    if (!wall) throw new Error("no bottom wall");
    ok(await tools.splitWall({ wall: wall.id, offset: 1.2 }));
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 3, y: 0 });
    shell.ui({ type: "split" });
    shell.moveTo({ x: 2, y: 0 });
    shell.type("1.2");
    shell.key("Enter");
    const points = (doc: { joints: Record<string, { x: number; y: number }> }) => Object.values(doc.joints).map((j) => `${j.x},${j.y}`).sort();
    const mine = claude.drawing();
    expect(mine && points(mine)).toEqual(points(shell.doc()));
    expect(Object.keys(mine?.walls ?? {})).toHaveLength(Object.keys(shell.doc().walls).length);
  });

  it("is refused inside a door", async () => {
    const { tools } = await room();
    const wall = bottom(await listing(tools));
    if (!wall) throw new Error("no bottom wall");
    ok(await tools.addDoor({ wall: wall.id, offset: 1 }));
    const r = await tools.splitWall({ wall: wall.id, offset: 1.2 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/can't be split inside/);
  });
});

describe("move_joint connects where it lands", () => {
  it("drops the kinked house's loose wall end onto the corner: that corner holds three walls (AC-13)", async () => {
    const { tools, s } = await kinkedHouse();
    const end = jointAt(s, "bde4");
    const corner = jointAt(s, "d03f");
    if (!end || !corner) throw new Error("joints not found");
    ok(await tools.moveJoint({ joint: end.id, to: kinkedPoint("d03f") }));
    const after = await listing(tools);
    expect(after.joints.find((j) => j.id === end.id)).toBeUndefined();
    expect(after.walls.filter((w) => w.a === corner.id || w.b === corner.id)).toHaveLength(3);
  });

  it("anywhere else moves the joint, as before", async () => {
    const { tools } = await room();
    const s = await listing(tools);
    const corner = s.joints.find((j) => near(j.at, { x: 6, y: 4 }));
    if (!corner) throw new Error("no corner");
    ok(await tools.moveJoint({ joint: corner.id, to: { x: 6.5, y: 4.5 } }));
    expect((await listing(tools)).joints.find((j) => j.id === corner.id)?.at).toEqual([6.5, 4.5]);
  });
});

describe("delete joins and stitches", () => {
  it("delete on a straight joint joins its walls", async () => {
    const { tools, s } = await kinkedHouse();
    const straight = jointAt(s, "a8cd"); // (13, 1.79), between two outside walls in line
    if (!straight) throw new Error("no straight joint");
    ok(await tools.delete({ ids: [straight.id] }));
    const after = await listing(tools);
    expect(after.joints.find((j) => j.id === straight.id)).toBeUndefined();
    expect(after.walls).toHaveLength(s.walls.length - 1);
  });

  it("delete on the 0.35° joint is refused with its angle (AC-11)", async () => {
    const { tools, s } = await kinkedHouse();
    const kink = jointAt(s, "372a");
    if (!kink) throw new Error("no kink joint");
    const r = await tools.delete({ ids: [kink.id] });
    expect(r).toEqual({ text: "These walls are 0.35° out of line: move one side to line them up", isError: true });
  });

  it("deleting a partition that T's into a wall stitches the pieces it leaves", async () => {
    const { tools } = await room();
    ok(await tools.addWall({ a: { x: 3, y: 0 }, b: { x: 3, y: 2 } }));
    const withT = await listing(tools);
    expect(withT.walls).toHaveLength(6);
    const partition = withT.walls.find((w) => w.from[0] === 3 && w.to[0] === 3);
    if (!partition) throw new Error("no partition");
    ok(await tools.delete({ ids: [partition.id] }));
    expect((await listing(tools)).walls).toHaveLength(4);
  });
});
