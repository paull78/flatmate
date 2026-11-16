import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Claude's heights (sills step 04, AC-09; sills.08): add_door takes a height, add_window a sill and a height, a new
// set_opening changes a placed opening and keeps its id, and get_drawing lists each opening's sill and height (a door
// its height only).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { opening?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** A 4 × 5 room at (0, 0) under a 3.05 ceiling; `bottom` runs along y 0. */
async function room(): Promise<{ tools: DrawingTools; bottom: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Studio" }));
  const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  summary(await tools.setCeiling({ height: 3.05 }));
  return { tools, bottom: s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id ?? "" };
}
const openingsOf = (s: DrawingSummary, wall: string) => s.walls.find((w) => w.id === wall)?.openings ?? [];

describe("heights through MCP (sills step 04, AC-09)", () => {
  it("add_window stacks a window 2.40 to 2.90 over a door, and get_drawing lists both with their heights", async () => {
    const { tools, bottom } = await room();
    summary(await tools.addDoor({ wall: bottom, offset: 1 }));
    const win = summary(await tools.addWindow({ wall: bottom, offset: 1, width: 0.8, sill: 2.4, height: 0.5 }));
    expect(win.result.opening).toBeDefined();
    expect(openingsOf(summary(await tools.getDrawing()), bottom).map((o) => [o.kind, o.sill, o.height]).sort()).toEqual([["swing", undefined, 2.1], ["window", 2.4, 0.5]]);
  });

  it("add_door takes a height", async () => {
    const { tools, bottom } = await room();
    summary(await tools.addDoor({ wall: bottom, offset: 1, height: 1.8 }));
    expect(openingsOf(summary(await tools.getDrawing()), bottom)[0]).toMatchObject({ kind: "swing", height: 1.8 });
  });

  it("set_opening changes the height and the kind and keeps the id; one that doesn't fit is refused and changes nothing", async () => {
    const { tools, bottom } = await room();
    summary(await tools.addDoor({ wall: bottom, offset: 1 }));
    const id = summary(await tools.addWindow({ wall: bottom, offset: 1, width: 0.8, sill: 2.4, height: 0.5 })).result.opening ?? "";
    const set = summary(await tools.setOpening({ opening: id, height: 0.4, kind: "casement" }));
    expect(openingsOf(set, bottom).find((o) => o.id === id)).toMatchObject({ kind: "casement", sill: 2.4, height: 0.4 });
    const refused = await tools.setOpening({ opening: id, height: 0.7 });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/head at 3\.10 m is less than 0\.10 m under wall \S+'s top at 3\.05 m$/);
    expect(openingsOf(summary(await tools.getDrawing()), bottom).find((o) => o.id === id)).toMatchObject({ sill: 2.4, height: 0.4 });
  });

  it("set_opening on a door changes its height from the floor, and an unknown id is refused", async () => {
    const { tools, bottom } = await room();
    const id = summary(await tools.addDoor({ wall: bottom, offset: 1 })).result.opening ?? "";
    expect(openingsOf(summary(await tools.setOpening({ opening: id, height: 1.9, width: 0.9 })), bottom)[0]).toMatchObject({ height: 1.9, width: 0.9 });
    expect(await tools.setOpening({ opening: "nope", height: 2 })).toEqual({ text: "No opening has the id nope", isError: true });
  });
});
