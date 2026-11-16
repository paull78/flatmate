import { afterEach, describe, expect, it } from "vitest";
import { DECK_PRESETS, DEFAULT_WALL_THICKNESS } from "@fm/domain";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Walls on a loft over MCP (spec "Walls on a loft" and "MCP", pillars.08, .09, .58; AC-17's last clause): add_wall and
// add_walls take `on`, sent as addWall's base; get_drawing lists `on` for a wall on a deck and its `top` as a height
// above its base, as set_wall_top takes it (pillars.50 c); a wall on a deck ends flush against the floor's walls, takes
// no door and makes no room.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result?: { deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

const HALF = DEFAULT_WALL_THICKNESS / 2;
const LOFT_TOP = DECK_PRESETS.loft.top;

/** A 4 × 5 room at (0, 0) with a hollow loft over its top, flush with three inner faces: x 0.1 to 3.9, y 2.8 to 4.9. */
async function loftRoom(): Promise<{ tools: DrawingTools; loft: string; before: Edited }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Studio" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const before = summary(await tools.addDeck({ preset: "loft", centre: { x: 2, y: 3.85 }, width: 3.8, depth: 2.1 }));
  return { tools, loft: before.result?.deck ?? "", before };
}

/** The wall whose ID the reply lists but `before` doesn't. */
function added(before: DrawingSummary, after: DrawingSummary): DrawingSummary["walls"] {
  const old = new Set(before.walls.map((w) => w.id));
  return after.walls.filter((w) => !old.has(w.id));
}

describe("add_wall with on", () => {
  it("adds a wall based on the loft, drawn to the room's north wall it ends flush on its inner face and splits nothing (AC-17, AC-09)", async () => {
    const { tools, loft, before } = await loftRoom();
    const s = summary(await tools.addWall({ a: { x: 2, y: 3 }, b: { x: 2, y: 5 }, on: loft }));
    const [wall, ...rest] = added(before, s);
    expect(rest).toEqual([]);
    expect(wall?.on).toBe(loft);
    expect(wall?.from).toEqual([2, 3]);
    expect(wall?.to).toEqual([2, 5 - HALF]);
    expect(wall).not.toHaveProperty("top"); // up to the ceiling
    // The room's walls, joints and rooms are as they were: the north wall isn't split.
    expect(s.walls.filter((w) => w.id !== wall?.id)).toEqual(before.walls);
    expect(s.joints.filter((j) => j.id !== wall?.a && j.id !== wall?.b)).toEqual(before.joints);
    expect(s.rooms).toEqual(before.rooms);
  });

  it("floor walls list no on, and on: floor is the floor", async () => {
    const { tools, before } = await loftRoom();
    for (const w of before.walls) expect(w).not.toHaveProperty("on");
    const s = summary(await tools.addWall({ a: { x: 0, y: 2 }, b: { x: 4, y: 2 }, on: "floor" }));
    const [wall] = added(before, s);
    expect(wall).toBeDefined();
    expect(wall).not.toHaveProperty("on");
    expect(s.rooms).toHaveLength(2);
  });

  it("a door on a wall on the loft is added, its height above the loft's top (sills.03)", async () => {
    const { tools, loft, before } = await loftRoom();
    summary(await tools.setCeiling({ height: 4.2 })); // the loft's walls follow it, so a door fits
    const s = summary(await tools.addWall({ a: { x: 1, y: 3.5 }, b: { x: 3, y: 3.5 }, on: loft }));
    const wall = added(before, s)[0]?.id ?? "";
    const door = summary(await tools.addDoor({ wall, offset: 0.5, height: 1.5 }));
    expect(door.walls.find((w) => w.id === wall)?.openings).toEqual([expect.objectContaining({ kind: "swing", height: 1.5 })]);
  });

  it("four walls on the loft closing a loop add no room (AC-06)", async () => {
    const { tools, loft, before } = await loftRoom();
    const loop = [
      { a: { x: 1, y: 3.2 }, b: { x: 3, y: 3.2 } },
      { a: { x: 3, y: 3.2 }, b: { x: 3, y: 4.5 } },
      { a: { x: 3, y: 4.5 }, b: { x: 1, y: 4.5 } },
      { a: { x: 1, y: 4.5 }, b: { x: 1, y: 3.2 } },
    ];
    const s = summary(await tools.addWalls({ walls: loop.map((w) => ({ ...w, on: loft })) }));
    const walls = added(before, s);
    expect(walls).toHaveLength(4);
    for (const w of walls) expect(w.on).toBe(loft);
    expect(s.rooms).toEqual(before.rooms);
  });

  it("set_wall_top 0.90 on a wall on the loft reads back top 0.90, a height above the loft (pillars.50 c)", async () => {
    const { tools, loft, before } = await loftRoom();
    const s = summary(await tools.addWall({ a: { x: 1, y: 3.5 }, b: { x: 3, y: 3.5 }, on: loft }));
    const wall = added(before, s)[0]?.id ?? "";
    summary(await tools.setCeiling({ height: LOFT_TOP + 0.9 })); // the studio's 3.05: the wall reaches it exactly
    const t = summary(await tools.setWallTop({ wall, top: 0.9 }));
    expect(t.walls.find((w) => w.id === wall)?.top).toBe(0.9);
  });
});
