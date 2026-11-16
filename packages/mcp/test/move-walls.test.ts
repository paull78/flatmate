import { afterEach, describe, expect, it } from "vitest";
import { FakeShell } from "@fm/editor/testing";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// move_walls (straight.14, step 09): the walls named move by one delta, as one moveWalls; the same command a wall drag
// sends, so the same drawing for the same walls and delta.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}

async function room(): Promise<{ tools: DrawingTools; claude: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Walls" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  return { tools, claude };
}

const listing = async (tools: DrawingTools): Promise<DrawingSummary> => JSON.parse(ok(await tools.getDrawing({})));
const rightWall = (s: DrawingSummary) => s.walls.find((w) => w.from[0] === 6 && w.to[0] === 6);

describe("move_walls", () => {
  it("moves a wall; the walls at its ends stretch; the reply lists what changed", async () => {
    const { tools } = await room();
    const right = rightWall(await listing(tools));
    if (!right) throw new Error("no right wall");
    const reply = JSON.parse(ok(await tools.moveWalls({ walls: [right.id], by: { x: 0.5, y: 0 } })));
    expect(JSON.stringify(reply.changed)).toContain(right.a);
    expect(rightWall(await listing(tools))).toBeUndefined(); // no wall at x 6 any more
    const moved = (await listing(tools)).walls.find((w) => w.id === right.id);
    expect(moved?.from[0]).toBe(6.5);
    expect(moved?.to[0]).toBe(6.5);
  });

  it("refuses a move that crosses a wall, changing nothing", async () => {
    const { tools } = await room();
    const before = await listing(tools);
    const right = rightWall(before);
    const r = await tools.moveWalls({ walls: [right?.id ?? ""], by: { x: -6, y: 0 } }); // onto the left wall
    expect(r.isError).toBe(true);
    expect((await listing(tools)).walls).toEqual(before.walls);
  });

  it("leaves the drawing a wall drag by the same delta leaves", async () => {
    const { tools, claude } = await room();
    const start = claude.drawing();
    const right = rightWall(await listing(tools));
    if (!start || !right) throw new Error("no drawing");
    const shell = FakeShell.withDocument(start);
    shell.drag({ x: 6, y: 2 }, { x: 6.4, y: 2 }); // across, by the 0.2 m grid: 0.40
    ok(await tools.moveWalls({ walls: [right.id], by: { x: 0.4, y: 0 } }));
    expect(claude.drawing()?.joints).toEqual(shell.doc().joints);
    expect(claude.drawing()?.walls).toEqual(shell.doc().walls);
  });

  it("carries pieces with the walls, by the same amount; needs layout; names what blocks", async () => {
    const { tools } = await room();
    const s0 = await listing(tools);
    const layout = s0.layouts[0]?.id ?? "";
    const placed = JSON.parse(ok(await tools.placeObject({ layout, kind: "chair", centre: { x: 5.5, y: 2 } })));
    const chair: string = placed.result.object;
    const right = rightWall(s0);
    if (!right) throw new Error("no right wall");
    expect((await tools.moveWalls({ walls: [right.id], by: { x: -1, y: 0 } })).isError).toBe(true); // the chair is in the wall's way
    expect((await tools.moveWalls({ walls: [right.id], by: { x: -1, y: 0 }, objects: [chair] })).text).toMatch(/need layout/);
    ok(await tools.moveWalls({ walls: [right.id], by: { x: -1, y: 0 }, objects: [chair], layout }));
    const after = await listing(tools);
    expect(after.walls.find((w) => w.id === right.id)?.from[0]).toBe(5);
    expect(JSON.stringify(after.objects.find((o) => o.id === chair))).toContain("[4.5,2]");
  });
});
