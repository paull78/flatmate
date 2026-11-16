import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// Warnings as a change (mcp-fixes step 02, AC-08 to AC-10): an edit lists the blocked clearances it made and those it
// ended, not every standing one (mcp-fixes.04); label_room names its label.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Warning = { layout: string; zone: string; by: string };
type EditReply = { result?: Record<string, unknown>; warnings: { added: Warning[]; cleared: Warning[] } };

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const reply = (r: Reply): EditReply => JSON.parse(ok(r));
const listing = async (tools: DrawingTools): Promise<DrawingSummary> => JSON.parse(ok(await tools.getDrawing({})));

/** A 6 × 2.4 m room with a wardrobe against the upper wall, its front zone free; s0 is the one layout. */
async function room(): Promise<{ tools: DrawingTools; s0: string; wardrobe: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Warnings" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 2.4 }));
  const s0 = (await listing(tools)).layouts[0]?.id ?? "";
  const wardrobe = reply(await tools.placeObject({ layout: s0, kind: "wardrobe", centre: { x: 2, y: 2.0 } })).result?.object as string;
  return { tools, s0, wardrobe };
}

describe("warnings list what an edit added and cleared (AC-08)", () => {
  it("an edit that blocks a zone lists it under added, nothing cleared", async () => {
    const { tools, s0, wardrobe } = await room();
    const r = reply(await tools.placeObject({ layout: s0, kind: "plant", centre: { x: 2, y: 1.4 } }));
    expect(r.warnings.added.some((w) => w.layout === s0 && w.zone.includes(wardrobe))).toBe(true);
    expect(r.warnings.cleared).toEqual([]);
  });

  it("the next edit leaving it standing lists it in neither", async () => {
    const { tools, s0 } = await room();
    ok(await tools.placeObject({ layout: s0, kind: "plant", centre: { x: 2, y: 1.4 } }));
    const r = reply(await tools.placeObject({ layout: s0, kind: "chair", centre: { x: 5, y: 1 } }));
    expect(r.warnings).toEqual({ added: [], cleared: [] });
  });

  it("an edit that ends it lists it under cleared", async () => {
    const { tools, s0, wardrobe } = await room();
    const plant = reply(await tools.placeObject({ layout: s0, kind: "plant", centre: { x: 2, y: 1.4 } })).result?.object as string;
    const r = reply(await tools.moveObject({ layout: s0, object: plant, centre: { x: 4.5, y: 1.4 } }));
    expect(r.warnings.added).toEqual([]);
    expect(r.warnings.cleared.some((w) => w.zone.includes(wardrobe) && w.by.includes(plant))).toBe(true);
  });

  it("a delete that ends a block lists it under cleared", async () => {
    const { tools, s0, wardrobe } = await room();
    const plant = reply(await tools.placeObject({ layout: s0, kind: "plant", centre: { x: 2, y: 1.4 } })).result?.object as string;
    const r = reply(await tools.delete({ ids: [plant], layout: s0 }));
    expect(r.warnings.cleared.some((w) => w.zone.includes(wardrobe))).toBe(true);
  });
});

describe("an edit doesn't echo another layout's warnings (AC-09)", () => {
  it("a block standing in one layout stays out of an edit's reply in another", async () => {
    const { tools, s0 } = await room();
    const night = (reply(await tools.addLayout({ name: "Night" })).result?.layout as { id: string }).id;
    ok(await tools.placeObject({ layout: night, kind: "wardrobe", centre: { x: 4.5, y: 2.0 } }));
    const blocked = await listing(tools);
    const plant = reply(await tools.placeObject({ layout: night, kind: "plant", centre: { x: 4.5, y: 1.4 } })).result?.object as string;
    expect(plant).toBeTruthy();
    expect((await listing(tools)).layouts.find((l) => l.id === night)?.blocked.length).toBeGreaterThan(blocked.layouts.find((l) => l.id === night)?.blocked.length ?? 0);
    const r = reply(await tools.placeObject({ layout: s0, kind: "chair", centre: { x: 0.6, y: 0.6 } }));
    expect(r.warnings).toEqual({ added: [], cleared: [] });
  });
});

describe("label_room names its label (AC-10)", () => {
  it("replies result.label, the id set_finish takes", async () => {
    const { tools } = await room();
    const r = reply(await tools.labelRoom({ point: { x: 1, y: 1 }, name: "Studio" }));
    const label = r.result?.label as string;
    expect((await listing(tools)).rooms[0]?.labels.map((l) => l.id)).toContain(label);
    ok(await tools.setFinish({ label, motif: "planks" }));
  });
});
