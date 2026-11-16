import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// A group move (mcp-fixes step 05, AC-01 to AC-04): move_object with objects moves and turns pieces of one layout as
// one edit, all or none, as the canvas's group drag and R do (mcp-fixes.02).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type XY = [number, number];
type Place = { centre: XY; rotation: number };

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const listing = async (tools: DrawingTools): Promise<DrawingSummary> => JSON.parse(ok(await tools.getDrawing({})));

/** Where each piece stands in `layout`: its one placement, or its own in that layout. */
async function places(tools: DrawingTools, layout: string, ids: readonly string[]): Promise<Place[]> {
  const s = await listing(tools);
  return ids.map((id) => {
    const o = s.objects.find((x) => x.id === id);
    const p = o?.placement ?? o?.placements?.[layout];
    if (!p) throw new Error(`${id} has no place in ${layout}`);
    return { centre: p.centre, rotation: p.rotation };
  });
}

/** A 6 × 4 m room with a sofa, coffee table and rug placed as a set; Day is the one layout. */
async function lounge(): Promise<{ tools: DrawingTools; day: string; set: string[] }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Group" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  const day = (await listing(tools)).layouts[0]?.id ?? "";
  const r = JSON.parse(ok(await tools.placeSet({ set: "sofaAndRug", layout: day, centre: { x: 2.5, y: 2 } }))) as { result: { objects: string[] } };
  return { tools, day, set: r.result.objects };
}

const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 2);

describe("move_object with objects (AC-01, AC-02)", () => {
  it("moves every piece by the same vector, keeping its turn", async () => {
    const { tools, day, set } = await lounge();
    const before = await places(tools, day, set);
    ok(await tools.moveObject({ layout: day, objects: set, centre: { x: 3.5, y: 2 } }));
    const after = await places(tools, day, set);
    const dx = (after[0]?.centre[0] ?? 0) - (before[0]?.centre[0] ?? 0);
    const dy = (after[0]?.centre[1] ?? 0) - (before[0]?.centre[1] ?? 0);
    expect(Math.hypot(dx, dy)).toBeGreaterThan(0.5);
    after.forEach((p, i) => {
      near(p.centre[0] - (before[i]?.centre[0] ?? 0), dx);
      near(p.centre[1] - (before[i]?.centre[1] ?? 0), dy);
      expect(p.rotation).toBe(before[i]?.rotation);
    });
  });

  it("turn 90 adds 90 to each rotation and turns the group about its box", async () => {
    const { tools, day, set } = await lounge();
    const before = await places(tools, day, set);
    ok(await tools.moveObject({ layout: day, objects: set, turn: 90 }));
    const after = await places(tools, day, set);
    after.forEach((p, i) => expect(p.rotation).toBe(((before[i]?.rotation ?? 0) + 90) % 360));
    // the vector from the sofa to the coffee table turns a quarter counter-clockwise
    const v = (ps: Place[]): XY => [(ps[1]?.centre[0] ?? 0) - (ps[0]?.centre[0] ?? 0), (ps[1]?.centre[1] ?? 0) - (ps[0]?.centre[1] ?? 0)];
    const [bx, by] = v(before);
    const [ax, ay] = v(after);
    near(ax, -by);
    near(ay, bx);
  });
});

describe("all or none (AC-03)", () => {
  it("a group move where one piece would collide is refused and nothing moves", async () => {
    const { tools, day, set } = await lounge();
    ok(await tools.placeObject({ layout: day, kind: "wardrobe", centre: { x: 5.2, y: 2 }, rotation: 270 }));
    const before = await places(tools, day, set);
    const r = await tools.moveObject({ layout: day, objects: set, centre: { x: 4.6, y: 2 } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Wardrobe/);
    expect(await places(tools, day, set)).toEqual(before);
  });
});

describe("what a group move refuses (AC-04)", () => {
  it("rotation, on, reaches or everyLayout with objects, object with objects, and a turn that isn't a quarter", async () => {
    const { tools, day, set } = await lounge();
    const refused = async (args: Parameters<DrawingTools["moveObject"]>[0], text: RegExp): Promise<void> => {
      const r = await tools.moveObject(args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(r.text).toMatch(text);
    };
    await refused({ layout: day, objects: set, rotation: 90 }, /centre and turn/);
    await refused({ layout: day, objects: set, on: "floor" }, /centre and turn/);
    await refused({ layout: day, objects: set, reaches: "nothing" }, /centre and turn/);
    await refused({ layout: day, objects: set, everyLayout: false }, /centre and turn/);
    await refused({ layout: day, object: set[0] ?? "", objects: set }, /not both/);
    await refused({ layout: day, objects: set, turn: 45 }, /0, 90, 180 or 270/);
    await refused({ layout: day, object: set[0] ?? "", turn: 90 }, /objects/);
    await refused({ layout: day }, /object/);
  });
});

describe("a group of shared pieces and exceptions", () => {
  it("moves the shared piece in every layout and the exception in this one only", async () => {
    const { tools, day, set } = await lounge();
    const night = (JSON.parse(ok(await tools.copyLayout({ from: day, name: "Night" }))) as { result: { layout: { id: string } } }).result.layout.id;
    const [rug, sofa] = [set[0] ?? "", set[1] ?? ""];
    const s = await listing(tools);
    expect(s.objects.find((o) => o.id === sofa)?.placement).toBeDefined(); // shared: one placement
    ok(await tools.moveObject({ layout: night, object: rug, everyLayout: false }));
    const nightRug = await places(tools, night, [rug]);
    const r = JSON.parse(ok(await tools.moveObject({ layout: day, objects: [rug, sofa], centre: { x: 3.5, y: 2 } }))) as {
      result: { objects: string[] }; changed: { updated: { placements?: { object: string; layout: string }[] } };
    };
    expect(r.result.objects).toEqual([rug, sofa]);
    expect(r.changed.updated.placements).toContainEqual({ object: rug, layout: day });
    const daySofa = (await places(tools, day, [sofa]))[0];
    const nightSofa = (await places(tools, night, [sofa]))[0];
    expect(nightSofa).toEqual(daySofa);
    expect(await places(tools, night, [rug])).toEqual(nightRug);
  });
});
