import { afterEach, describe, expect, it } from "vitest";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// The listing without repeats (mcp step 02, AC-04): a piece placed the same in every layout lists one `placement`;
// one placed differently somewhere lists `placements` per layout, as before; `classes` is gone (mcp.01, mcp.12).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Place = { centre: [number, number]; rotation: number; config: string; on: string };
type Listed = { id: string; kind: string; placement?: Place; placements?: Record<string, Place | null>; linked?: false };
type Listing = { layouts: { id: string }[]; objects: Listed[]; classes?: unknown };

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const json = (r: Reply): { result?: { object?: string; layout?: { id: string } } } => JSON.parse(ok(r));
const listing = async (tools: DrawingTools): Promise<Listing> => JSON.parse(ok(await tools.getDrawing({})));

/** A 6 × 4 room in two layouts, Day and Night. */
async function twoLayouts(): Promise<{ tools: DrawingTools; day: string; night: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Listing" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  const night = json(await tools.addLayout({ name: "Night" })).result?.layout?.id ?? "";
  const day = (await listing(tools)).layouts[0]?.id ?? "";
  return { tools, day, night };
}

describe("a piece placed the same in every layout (AC-04)", () => {
  it("lists one placement and no per-layout map", async () => {
    const { tools, day } = await twoLayouts();
    const sofa = json(await tools.placeObject({ layout: day, kind: "sofa", centre: { x: 3, y: 3.4 } })).result?.object;
    const o = (await listing(tools)).objects.find((x) => x.id === sofa);
    expect(o?.placement).toMatchObject({ centre: [3, 3.4], rotation: 0, config: "standard", on: "floor" });
    expect(o).not.toHaveProperty("placements");
    expect(o).not.toHaveProperty("linked");
  });

  it("a linked piece whose configuration differs by layout lists placements per layout", async () => {
    const { tools, day, night } = await twoLayouts();
    const bed = json(await tools.placeObject({ layout: day, kind: "murphyBed", centre: { x: 3, y: 3.7 } })).result?.object ?? "";
    ok(await tools.setConfiguration({ layout: night, object: bed, config: "down" }));
    const o = (await listing(tools)).objects.find((x) => x.id === bed);
    expect(o).not.toHaveProperty("placement");
    expect(o?.placements?.[day]?.config).toBe("folded");
    expect(o?.placements?.[night]?.config).toBe("down");
  });

  it("an exception lists placements per layout, null where absent, and linked: false", async () => {
    const { tools, day, night } = await twoLayouts();
    const chair = json(await tools.placeObject({ layout: day, kind: "chair", centre: { x: 1, y: 1 } })).result?.object ?? "";
    ok(await tools.moveObject({ layout: day, object: chair, everyLayout: false }));
    ok(await tools.delete({ ids: [chair], layout: night }));
    const o = (await listing(tools)).objects.find((x) => x.id === chair);
    expect(o?.linked).toBe(false);
    expect(o?.placements?.[day]).toMatchObject({ centre: [1, 1] });
    expect(o?.placements?.[night]).toBeNull();
  });

  it("with one layout, a piece lists one placement", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = createTools(claude);
    ok(await tools.createProject({ name: "One" }));
    ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 4 }));
    const s0 = (await listing(tools)).layouts[0]?.id ?? "";
    ok(await tools.placeObject({ layout: s0, kind: "chair", centre: { x: 1, y: 1 } }));
    expect((await listing(tools)).objects[0]?.placement).toMatchObject({ centre: [1, 1] });
  });
});

describe("classes leave the listing (AC-04)", () => {
  it("no classes key, even with pieces", async () => {
    const { tools, day } = await twoLayouts();
    ok(await tools.placeObject({ layout: day, kind: "sofa", centre: { x: 3, y: 3.4 } }));
    expect(await listing(tools)).not.toHaveProperty("classes");
  });
});
