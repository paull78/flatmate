import { afterEach, describe, expect, it } from "vitest";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// set_opening takes offset (mcp step 09, AC-15, mcp.07): a door or window moves along its wall and keeps its id; with
// other fields, every change applies or none does.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Opening = { id: string; offset: number; width: number };
type Wall = { id: string; length: number; openings?: Opening[] };

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
async function wallOf(tools: DrawingTools, id: string): Promise<Wall | undefined> {
  return (JSON.parse(ok(await tools.getDrawing({}))).walls as Wall[]).find((w) => w.id === id);
}

/** A 5 × 3 room with an 0.80 m door 0.50 m along its first wall (5 m long) and a window at 3.00 m. */
async function room(): Promise<{ tools: DrawingTools; wall: string; door: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Offsets" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 5, depth: 3 }));
  const wall = (JSON.parse(ok(await tools.getDrawing({}))).walls as Wall[]).find((w) => w.length === 5)?.id ?? "";
  const door = JSON.parse(ok(await tools.addDoor({ wall, offset: 0.5, width: 0.8 }))).result.opening;
  ok(await tools.addWindow({ wall, offset: 3, width: 1 }));
  return { tools, wall, door };
}

describe("set_opening's offset (AC-15)", () => {
  it("offset 1.2 puts the end nearer joint a 1.20 m along the wall, and the id stays", async () => {
    const { tools, wall, door } = await room();
    const r = JSON.parse(ok(await tools.setOpening({ opening: door, offset: 1.2 })));
    expect(r.result).toEqual({ opening: door, wall });
    expect((await wallOf(tools, wall))?.openings?.find((o) => o.id === door)).toMatchObject({ offset: 1.2, width: 0.8 });
  });

  it("an offset past the wall's end is refused and nothing changes", async () => {
    const { tools, wall, door } = await room();
    const before = await wallOf(tools, wall);
    expect((await tools.setOpening({ opening: door, offset: 4.5 })).isError).toBe(true);
    expect(await wallOf(tools, wall)).toEqual(before);
  });

  it("offset with width applies both", async () => {
    const { tools, wall, door } = await room();
    ok(await tools.setOpening({ opening: door, offset: 1.5, width: 1.2 }));
    expect((await wallOf(tools, wall))?.openings?.find((o) => o.id === door)).toMatchObject({ offset: 1.5, width: 1.2 });
  });

  it("a move that fits only once the door is narrower applies too: the order is found, not given", async () => {
    const { tools, wall, door } = await room();
    // Moved first, the 0.80 door at 2.40 would reach 3.20, into the window at 3.00; narrowed first to 0.50, it ends at 2.90.
    expect((await tools.setOpening({ opening: door, offset: 2.4 })).isError).toBe(true);
    ok(await tools.setOpening({ opening: door, offset: 2.4, width: 0.5 }));
    expect((await wallOf(tools, wall))?.openings?.find((o) => o.id === door)).toMatchObject({ offset: 2.4, width: 0.5 });
  });

  it("offset with a width that doesn't fit applies neither", async () => {
    const { tools, wall, door } = await room();
    const before = await wallOf(tools, wall);
    expect((await tools.setOpening({ opening: door, offset: 1.5, width: 2 })).isError).toBe(true); // 1.5 + 2 meets the window
    expect(await wallOf(tools, wall)).toEqual(before);
  });
});
