import { afterEach, describe, expect, it } from "vitest";
import type { Listing } from "./harness";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// A window's dressing through Claude's tools (hangings step 06, AC-05): add_window and set_opening take `sheer` and
// `shutterBox`; get_drawing lists them only when set; a door refuses them, as Properties' edit would be refused.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = Listing & { result: { opening?: string } };
const summary = (r: Reply): Edited => {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
};

/** Claude and Alice on a 6 × 4 room; `bottom` is the wall along y 0. */
async function room(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession; bottom: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Flat" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  return { server, tools, alice, bottom: s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id ?? "" };
}
const listed = (s: Listing, wall: string, id: string) => s.walls.find((w) => w.id === wall)?.openings?.find((o) => o.id === id);

describe("a window's dressing through Claude's tools (step 06, AC-05)", () => {
  it("add_window takes a sheer to the floor and a shutter box; get_drawing lists them; Alice's document has them", async () => {
    const { server, tools, alice, bottom } = await room();
    const s = summary(await tools.addWindow({ wall: bottom, offset: 2.5, width: 1, sheer: "floor", shutterBox: true }));
    const id = s.result.opening ?? "";
    expect(listed(s, bottom, id)).toMatchObject({ sheer: "floor", shutterBox: true });
    await server.settle();
    expect(alice.drawing()?.openings[id]).toMatchObject({ sheer: "floor", shutterBox: true });
  });

  it("set_opening changes and clears them; a plain window lists neither", async () => {
    const { tools, bottom } = await room();
    const id = summary(await tools.addWindow({ wall: bottom, offset: 2.5, width: 1 })).result.opening ?? "";
    const plain = summary(await tools.getDrawing({}));
    expect(Object.keys(listed(plain, bottom, id) ?? {})).not.toContain("sheer");
    expect(listed(summary(await tools.setOpening({ opening: id, sheer: "glass" })), bottom, id)).toMatchObject({ sheer: "glass" });
    const cleared = summary(await tools.setOpening({ opening: id, sheer: "none", shutterBox: false }));
    expect(Object.keys(listed(cleared, bottom, id) ?? {})).not.toContain("sheer");
    expect(Object.keys(listed(cleared, bottom, id) ?? {})).not.toContain("shutterBox");
  });

  it("a door refuses them, naming why; a box with no room above the head names 0.25 m", async () => {
    const { tools, bottom } = await room();
    const door = summary(await tools.addDoor({ wall: bottom, offset: 1, width: 0.8 })).result.opening ?? "";
    const r = await tools.setOpening({ opening: door, sheer: "floor" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/A door takes no sheer curtain or shutter box/);
    const high = summary(await tools.addWindow({ wall: bottom, offset: 3, width: 1, sill: 1.1, height: 1.2 })).result.opening ?? ""; // head 2.30
    const box = await tools.setOpening({ opening: high, shutterBox: true });
    expect(box.isError).toBe(true);
    expect(box.text).toMatch(/0\.25 m/);
  });
});
