import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// place_object's everyLayout (mcp-fixes step 04, AC-12, AC-13): false places an exception in one layout, true every
// layout or nothing, omitted every layout where it fits, else one with a note (mcp-fixes.05).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const listing = async (tools: DrawingTools): Promise<DrawingSummary> => JSON.parse(ok(await tools.getDrawing({})));

/** A 6 × 2.4 m room in two layouts, Day (s0) and Night. */
async function flat(): Promise<{ tools: DrawingTools; day: string; night: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Every layout" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 2.4 }));
  const day = (await listing(tools)).layouts[0]?.id ?? "";
  ok(await tools.rename({ id: day, name: "Day" }));
  const night = (JSON.parse(ok(await tools.addLayout({ name: "Night" }))) as { result: { layout: { id: string } } }).result.layout.id;
  return { tools, day, night };
}

/** A wardrobe in Day only, where Night is free. */
async function blockedInDay(tools: DrawingTools, day: string): Promise<void> {
  ok(await tools.placeObject({ layout: day, kind: "wardrobe", centre: { x: 2, y: 2 }, everyLayout: false }));
}

describe("everyLayout on place_object (AC-12, AC-13)", () => {
  it("false places the piece in the named layout only, an exception", async () => {
    const { tools, night } = await flat();
    const r = JSON.parse(ok(await tools.placeObject({ layout: night, kind: "desk", centre: { x: 4, y: 1 }, everyLayout: false }))) as { result: { object: string } };
    const desk = (await listing(tools)).objects.find((o) => o.id === r.result.object);
    expect(desk?.linked).toBe(false);
    expect(desk?.placement).toBeUndefined();
    expect(Object.entries(desk?.placements ?? {}).filter(([, p]) => p !== null).map(([l]) => l)).toEqual([night]);
  });

  it("true where the piece doesn't fit in another layout is refused, naming that layout, and nothing is placed", async () => {
    const { tools, day, night } = await flat();
    await blockedInDay(tools, day);
    const before = (await listing(tools)).objects.length;
    const r = await tools.placeObject({ layout: night, kind: "chair", centre: { x: 2, y: 2 }, everyLayout: true });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Day");
    expect((await listing(tools)).objects.length).toBe(before);
  });

  it("omitted falls back to the one layout with a note, as before", async () => {
    const { tools, day, night } = await flat();
    await blockedInDay(tools, day);
    const r = JSON.parse(ok(await tools.placeObject({ layout: night, kind: "chair", centre: { x: 2, y: 2 } }))) as { result: { note?: string } };
    expect(r.result.note).toContain("Day");
  });

  it("false on a kind that stands in every layout (a beam) is refused", async () => {
    const { tools, night } = await flat();
    const r = await tools.placeObject({ layout: night, kind: "beam", centre: { x: 3, y: 1.2 }, everyLayout: false });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/every layout/);
  });
});
