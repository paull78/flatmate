import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// Edit replies (mcp step 01, AC-01 to AC-03): an edit replies with result, changed and warnings, never the drawing;
// get_drawing keeps the listing (mcp.01).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Row = string | { id: string } | { object: string; layout: string };
type Kinds = Record<string, Row[]>;
type Changed = { created: Kinds; updated: Kinds; deleted: Kinds };
/** Every id a group of kinds names: a row's id, a wall's or joint's id, a placement's piece. */
const ids = (k: Kinds): string[] => Object.values(k).flat().map((r) => (typeof r === "string" ? r : "id" in r ? r.id : r.object));
type Warning = { layout: string; zone: string; by: string };
type EditReply = { result?: Record<string, unknown>; changed: Changed; warnings: { added: Warning[]; cleared: Warning[] } };

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const reply = (r: Reply): EditReply => JSON.parse(ok(r));
const listing = async (tools: DrawingTools): Promise<DrawingSummary> => JSON.parse(ok(await tools.getDrawing({})));

async function room(): Promise<DrawingTools> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Replies" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 2.4 }));
  return tools;
}

/**
 * A furnished studio in two layouts, about the size of the 20 ft sample (7 × 4 m, eleven pieces, two windows), laid
 * out with no blocked clearance, as the samples are.
 */
async function studio(): Promise<{ tools: DrawingTools; night: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Studio" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 4 }));
  ok(await tools.labelRoom({ point: { x: 3.5, y: 2 }, name: "Studio" }));
  const night = (reply(await tools.addLayout({ name: "Night" })).result?.layout as { id: string }).id;
  const pieces: [string, number, number, number][] = [
    ["fridge", 0.45, 0.45, 180], ["sinkUnit", 1.25, 0.4, 180], ["hobUnit", 1.95, 0.4, 180], ["counter", 2.55, 0.4, 180],
    ["sofa", 5, 3.45, 0], ["coffeeTable", 5, 1.95, 0], ["wardrobe", 6.6, 1.2, 270], ["drawers", 1.0, 3.65, 0],
    ["chair", 4.0, 0.4, 180], ["shelf", 2.5, 3.7, 0], ["plant", 6.6, 3.6, 0],
  ];
  const s0 = (await listing(tools)).layouts[0]?.id ?? "";
  for (const [kind, x, y, rotation] of pieces) ok(await tools.placeObject({ layout: s0, kind, centre: { x, y }, rotation }));
  const walls = (await listing(tools)).walls;
  const lower = walls.find((w) => w.from[1] === 0 && w.to[1] === 0) ?? walls[0];
  ok(await tools.addWindow({ wall: lower?.id ?? "", offset: 3.2 }));
  ok(await tools.addWindow({ wall: lower?.id ?? "", offset: 4.6 }));
  expect((await listing(tools)).layouts.flatMap((l) => l.blocked.map((b) => `${b.zone} by ${b.by}`))).toEqual([]);
  return { tools, night };
}

describe("an edit's reply (AC-01)", () => {
  it("holds result, changed and warnings, and no drawing", async () => {
    const tools = await room();
    const wall = (await listing(tools)).walls[0]?.id ?? "";
    const r = reply(await tools.addDoor({ wall, offset: 1 }));
    expect(Object.keys(r).sort()).toEqual(["changed", "result", "warnings"]);
    expect(r.result).toMatchObject({ wall });
  });

  it("an edit with no result of its own still holds changed and warnings", async () => {
    const tools = await room();
    const r = reply(await tools.setCeiling({ height: 2.4 }));
    expect(Object.keys(r).sort()).toEqual(["changed", "warnings"]);
  });

  it("on a furnished studio an edit replies in under 1,000 characters, where the listing is many times that", async () => {
    const { tools } = await studio();
    const wall = (await listing(tools)).walls.find((w) => w.from[0] === 0 && w.to[0] === 0)?.id ?? "";
    const text = ok(await tools.addDoor({ wall, offset: 1.5, side: "right" }));
    expect(text.length).toBeLessThan(1000);
    expect(ok(await tools.getDrawing({})).length).toBeGreaterThan(5 * text.length);
  });

  it("a refused edit replies with the reason, as before", async () => {
    const tools = await room();
    const r = await tools.addWall({ a: { x: -1, y: 1 }, b: { x: 7, y: 1 } });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/^\{/);
  });

  it("draw_room, add_walls and set_zones reply the same way", async () => {
    const tools = await room();
    const drawn = reply(await tools.drawRoom({ corner: { x: 10, y: 0 }, width: 3, depth: 3 }));
    expect(drawn.changed.created.walls).toHaveLength(4);
    expect(drawn.changed.created.joints).toHaveLength(4);
    const walls = reply(await tools.addWalls({ walls: [{ a: { x: 20, y: 0 }, b: { x: 22, y: 0 } }] }));
    expect(walls.changed.created.walls).toHaveLength(1);
    expect(walls.changed.created.joints).toHaveLength(2);
    const s0 = (await listing(tools)).layouts[0]?.id ?? "";
    const wardrobe = reply(await tools.placeObject({ layout: s0, kind: "wardrobe", centre: { x: 2, y: 2 } })).result?.object as string;
    const zones = reply(await tools.setZones({ layout: s0, object: wardrobe, front: false }));
    expect(zones.changed.updated.placements).toContainEqual({ object: wardrobe, layout: s0 });
  });
});

describe("changed names every row the edit wrote (AC-02)", () => {
  it("a T-junction lists the new wall, both halves and the new joint", async () => {
    const tools = await room();
    const before = await listing(tools);
    const lower = before.walls.find((w) => w.from[1] === 0 && w.to[1] === 0);
    const r = reply(await tools.addWall({ a: { x: 3, y: 0 }, b: { x: 3, y: 2.4 } }));
    const after = await listing(tools);
    const newWalls = after.walls.filter((w) => !before.walls.some((b) => b.id === w.id)).map((w) => w.id);
    const newJoints = after.joints.filter((j) => !before.joints.some((b) => b.id === j.id)).map((j) => j.id);
    const touched = [...ids(r.changed.created), ...ids(r.changed.updated), ...ids(r.changed.deleted)];
    for (const id of [...newWalls, ...newJoints]) expect(touched).toContain(id);
    expect(newWalls.length).toBeGreaterThanOrEqual(2); // the new wall and at least one half of the split one
    expect(newJoints.length).toBeGreaterThanOrEqual(2);
    if (!after.walls.some((w) => w.id === lower?.id)) expect(ids(r.changed.deleted)).toContain(lower?.id);
  });

  it("deleting a piece in one layout lists the piece and that layout", async () => {
    const { tools, night } = await studio();
    const s = await listing(tools);
    const sofa = s.objects.find((o) => o.kind === "sofa")?.id ?? "";
    const s0 = s.layouts[0]?.id ?? "";
    ok(await tools.moveObject({ layout: night, object: sofa, everyLayout: false })); // an exception, placed per layout
    const r = reply(await tools.delete({ ids: [sofa], layout: night }));
    expect(r.changed.deleted).toEqual({ placements: [{ object: sofa, layout: night }] });
    expect(r.changed.updated.placements ?? []).not.toContainEqual({ object: sofa, layout: s0 });
  });

  it("deleting a piece that is the same in every layout lists the piece and every placement", async () => {
    const { tools, night } = await studio();
    const s = await listing(tools);
    const sofa = s.objects.find((o) => o.kind === "sofa")?.id ?? "";
    const r = reply(await tools.delete({ ids: [sofa], layout: night }));
    expect(r.changed.deleted.objects).toContain(sofa);
    expect(r.changed.deleted.placements).toContainEqual({ object: sofa, layout: night });
    expect(r.changed.deleted.placements).toContainEqual({ object: sofa, layout: s.layouts[0]?.id });
  });

  it("placing a piece lists it as created", async () => {
    const tools = await room();
    const s0 = (await listing(tools)).layouts[0]?.id ?? "";
    const r = reply(await tools.placeObject({ layout: s0, kind: "chair", centre: { x: 1, y: 1 } }));
    const object = r.result?.object as string;
    expect(r.changed.created.objects).toEqual([object]);
    expect(r.changed.created.placements).toEqual([{ object, layout: s0 }]);
  });
});

describe("changed is grouped by kind, a wall with its ends (mcp-fixes step 01, AC-05 to AC-07)", () => {
  it("draw_room lists four walls with their ends and four joints, and nothing else", async () => {
    const tools = await room();
    const r = reply(await tools.drawRoom({ corner: { x: 10, y: 0 }, width: 3, depth: 2 }));
    expect(Object.keys(r.changed.created).sort()).toEqual(["joints", "walls"]);
    expect(r.changed.updated).toEqual({});
    expect(r.changed.deleted).toEqual({});
    const walls = r.changed.created.walls as { id: string; from: number[]; to: number[] }[];
    const ends = walls.flatMap((w) => [w.from, w.to].map((p) => p.join(","))).sort();
    expect([...new Set(ends)]).toEqual(["10,0", "10,2", "13,0", "13,2"]);
    const joints = r.changed.created.joints as { id: string; at: number[] }[];
    expect(joints.map((j) => j.at.join(",")).sort()).toEqual(["10,0", "10,2", "13,0", "13,2"]);
    const listed = (await listing(tools)).walls;
    for (const w of walls) expect(listed.find((l) => l.id === w.id)).toMatchObject({ from: w.from, to: w.to });
  });

  it("a T-junction lists the split wall under updated.walls with its new ends", async () => {
    const tools = await room();
    const lower = (await listing(tools)).walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id ?? "";
    const r = reply(await tools.addWall({ a: { x: 3, y: 0 }, b: { x: 3, y: 2.4 } }));
    const split = (r.changed.updated.walls ?? []).find((w) => typeof w !== "string" && "id" in w && w.id === lower);
    const listed = (await listing(tools)).walls.find((w) => w.id === lower);
    expect(split).toEqual({ id: lower, from: listed?.from, to: listed?.to });
    expect(listed?.length).toBe(3);
  });

  it("place_object lists the object under created.objects and its placement as { object, layout }", async () => {
    const tools = await room();
    const s0 = (await listing(tools)).layouts[0]?.id ?? "";
    const r = reply(await tools.placeObject({ layout: s0, kind: "chair", centre: { x: 1, y: 1 } }));
    const object = r.result?.object as string;
    expect(r.changed.created).toEqual({ objects: [object], placements: [{ object, layout: s0 }] });
  });

  it("a deleted wall is listed with its ends from before the edit", async () => {
    const tools = await room();
    const wall = (await listing(tools)).walls.find((w) => w.from[1] === 0 && w.to[1] === 0);
    const r = reply(await tools.delete({ ids: [wall?.id ?? ""] }));
    expect(r.changed.deleted.walls).toContainEqual({ id: wall?.id, from: wall?.from, to: wall?.to });
  });
});

describe("warnings are the blocked clearances an edit added (AC-03, mcp-fixes.04)", () => {
  it("a plant before a wardrobe's front: the reply adds what every layout's blocked list now holds", async () => {
    const { tools } = await studio();
    const s = await listing(tools);
    const wardrobe = s.objects.find((o) => o.kind === "wardrobe")?.id ?? "";
    const s0 = s.layouts[0]?.id ?? "";
    const r = reply(await tools.placeObject({ layout: s0, kind: "plant", centre: { x: 6.0, y: 1.2 } }));
    const after = await listing(tools);
    const blocked = after.layouts.flatMap((l) => l.blocked.map((b) => ({ layout: l.id, ...b })));
    expect(blocked.some((b) => b.zone.includes(wardrobe))).toBe(true);
    expect(r.warnings).toEqual({ added: blocked, cleared: [] });
  });

  it("no warnings: both lists empty", async () => {
    const tools = await room();
    const s0 = (await listing(tools)).layouts[0]?.id ?? "";
    expect(reply(await tools.placeObject({ layout: s0, kind: "plant", centre: { x: 3, y: 1.2 } })).warnings).toEqual({ added: [], cleared: [] });
  });
});
