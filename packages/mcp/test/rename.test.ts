import { afterEach, describe, expect, it } from "vitest";
import type { EditorSession } from "../src/session";
import { TOOL_NAMES } from "../src/server";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// What a person can do, Claude can (mcp step 08, AC-13, AC-14, mcp.07): one rename for a room label, a layout or a
// piece; delete takes a layout, on its own.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Listing = {
  layouts: { id: string; name: string }[];
  rooms: { labels: { id: string; name: string }[] }[];
  objects: { id: string; name: string; placement?: unknown; placements?: Record<string, unknown> }[];
  decks: { id: string }[];
};

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const listing = async (tools: DrawingTools): Promise<Listing> => JSON.parse(ok(await tools.getDrawing({})));
const resultOf = (r: Reply): Record<string, unknown> => JSON.parse(ok(r)).result ?? {};

/** A labelled 6 × 4 room in two layouts, Day and Night, with a linked sofa and a chair only at Night. */
async function flat(): Promise<{ tools: DrawingTools; day: string; night: string; sofa: string; chair: string; label: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Rename" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  ok(await tools.labelRoom({ point: { x: 3, y: 2 }, name: "Room" }));
  const night = (resultOf(await tools.addLayout({ name: "Night" })).layout as { id: string }).id;
  const day = (await listing(tools)).layouts[0]?.id ?? "";
  const sofa = String(resultOf(await tools.placeObject({ layout: day, kind: "sofa", centre: { x: 3, y: 3.45 } })).object);
  const chair = String(resultOf(await tools.placeObject({ layout: night, kind: "chair", centre: { x: 1, y: 1 } })).object);
  ok(await tools.moveObject({ layout: night, object: chair, everyLayout: false })); // an exception, then out of Day
  ok(await tools.delete({ ids: [chair], layout: day }));
  const label = (await listing(tools)).rooms[0]?.labels[0]?.id ?? "";
  return { tools, day, night, sofa, chair, label };
}

describe("rename (AC-13)", () => {
  it("renames a room label, a layout and a piece", async () => {
    const { tools, night, sofa, label } = await flat();
    ok(await tools.rename({ id: label, name: "Studio" }));
    ok(await tools.rename({ id: night, name: "Guests" }));
    ok(await tools.rename({ id: sofa, name: "Couch" }));
    const s = await listing(tools);
    expect(s.rooms[0]?.labels[0]?.name).toBe("Studio");
    expect(s.layouts.find((l) => l.id === night)?.name).toBe("Guests");
    expect(s.objects.find((o) => o.id === sofa)?.name).toBe("Couch");
  });

  it("a deck, an area or a sheet is refused naming the tool that renames it", async () => {
    const { tools } = await flat();
    const deck = String(resultOf(await tools.addDeck({ centre: { x: 1, y: 3 }, width: 1.2, depth: 1 })).deck);
    expect(await tools.rename({ id: deck, name: "Step" })).toEqual({ text: `${deck} is a deck: rename it with set_deck`, isError: true });
    const area = String(resultOf(await tools.addArea({ centre: { x: 4.5, y: 1 }, width: 2, depth: 1.5 })).area);
    expect(await tools.rename({ id: area, name: "Nook" })).toEqual({ text: `${area} is a named area: rename it with set_area`, isError: true });
    expect(await tools.rename({ id: "auto/0", name: "Plan" })).toEqual({ text: "auto/0 is a sheet: rename it with set_sheet", isError: true });
  });

  it("an unknown id is refused naming what rename takes", async () => {
    const { tools } = await flat();
    expect(await tools.rename({ id: "nope", name: "X" })).toEqual({ text: "No room label, layout or piece has the id nope", isError: true });
  });

  it("rename replaces rename_room, and the tool count stays", () => {
    expect(TOOL_NAMES).toContain("rename");
    expect(TOOL_NAMES).not.toContain("rename_room");
    expect(TOOL_NAMES).toHaveLength(54);
  });
});

describe("delete takes a layout (AC-14)", () => {
  it("a layout id removes the layout and the pieces only it held; a linked piece stays in the others", async () => {
    const { tools, day, night, sofa, chair } = await flat();
    const r = JSON.parse(ok(await tools.delete({ ids: [night] })));
    expect(r.changed.deleted.layouts).toContain(night);
    const s = await listing(tools);
    expect(s.layouts.map((l) => l.id)).toEqual([day]);
    expect(s.objects.map((o) => o.id)).toEqual([sofa]);
    expect(s.objects.some((o) => o.id === chair)).toBe(false);
  });

  it("the last layout is refused with the app's reason", async () => {
    const { tools, day, night } = await flat();
    ok(await tools.delete({ ids: [night] }));
    expect(await tools.delete({ ids: [day] })).toEqual({ text: "A drawing keeps at least one layout", isError: true });
  });

  it("a layout id beside a wall id is refused and nothing changes", async () => {
    const { tools, night } = await flat();
    const before = await listing(tools);
    const wall = JSON.parse(ok(await tools.getDrawing({}))).walls[0].id;
    expect(await tools.delete({ ids: [night, wall] })).toEqual({ text: "Delete a layout on its own", isError: true });
    expect(await listing(tools)).toEqual(before);
  });
});
