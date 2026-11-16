import { afterEach, describe, expect, it } from "vitest";
import { CEILING_ID, PLAIN_WHITE, execute, motifDefaults, motifsFor, outsideOf, roomWallsOf, sideFinishes, sidesOf, type Command, type Document } from "@fm/domain";

const sideOf = (doc: Document, wall: string) => { const w = doc.walls[wall]; return w ? sidesOf(w) : undefined; };
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// set_finish on walls and the roof (surfaces step 14, inherit step 03, AC-10): one target of label, deck, wall + side,
// wallsOf, roof or outside; lower + height for a band; reset returns a custom side; each gives the document the matching
// Properties edit gives; get_drawing lists room and house defaults and only custom sides.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function summary(r: Reply): DrawingSummary {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** Claude draws a 4 × 3 room labelled "Bath"; returns its tools, session, the label and the bottom wall. */
async function bath(): Promise<{ tools: DrawingTools; claude: EditorSession; label: string; wall: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Flat" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
  const s = summary(await tools.labelRoom({ point: { x: 2, y: 1.5 }, name: "Bath" }));
  const label = s.rooms[0]?.labels[0]?.id;
  const wall = s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id; // the bottom wall
  if (!label || !wall) throw new Error("no room");
  return { tools, claude, label, wall };
}

const docOf = (s: EditorSession): Document => {
  const d = s.drawing();
  if (!d) throw new Error("no drawing");
  return d;
};
/** The document `cmd` gives on `doc`, as Properties' edit would. */
const expected = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};

describe("set_finish on walls and the roof (step 14, AC-09)", () => {
  it("wall + side on an inherited side customises it as Customize does, and get_drawing lists only that side", async () => {
    const { tools, claude, wall } = await bath();
    const before = docOf(claude);
    const s = summary(await tools.setFinish({ wall, side: "left", motif: "subwayTiles", lower: true, height: 1.2 }));
    expect(docOf(claude).walls).toEqual(expected(before, { type: "setWallSide", wallId: wall, side: "left", finish: PLAIN_WHITE, lower: motifDefaults("subwayTiles"), height: 1.2 }).walls);
    expect(s.walls.find((w) => w.id === wall)?.sides).toEqual({ left: { finish: PLAIN_WHITE, lower: { finish: motifDefaults("subwayTiles"), height: 1.2 } } });
    expect(s.walls.find((w) => w.id !== wall)?.sides).toBeUndefined();
  });

  it("wallsOf sets the room's walls default, listed with its label; a custom side keeps its own", async () => {
    const { tools, claude, label, wall } = await bath();
    summary(await tools.setFinish({ wall, side: "left", motif: "brick" }));
    const before = docOf(claude);
    const s = summary(await tools.setFinish({ wallsOf: label, motif: "plain", colour: "#f2f0eb" }));
    expect(docOf(claude)).toEqual(expected(before, { type: "setRoomWallFinishes", labelId: label, part: "finish", finish: { ...motifDefaults("plain"), colour: "#f2f0eb" } }));
    expect(s.rooms[0]?.labels[0]?.walls).toEqual({ finish: { ...motifDefaults("plain"), colour: "#f2f0eb" }, lower: null });
    expect(sideFinishes(docOf(claude), wall)?.left?.source).toBe("custom");
  });

  it("outside sets the house's outside walls default, listed once", async () => {
    const { tools, claude } = await bath();
    summary(await tools.setFinish({ outside: true, motif: "widePlanks", colour: "#9c6b44" }));
    const s = summary(await tools.setFinish({ outside: true, lower: true, motif: "brick", height: 0.6 }));
    const want = { finish: { ...motifDefaults("widePlanks"), colour: "#9c6b44" }, lower: { finish: motifDefaults("brick"), height: 0.6 } };
    expect(outsideOf(docOf(claude))).toEqual(want);
    expect(s.outside).toEqual(want);
  });

  it("reset returns a custom side to the default it faces; with a motif it is refused", async () => {
    const { tools, claude, label, wall } = await bath();
    summary(await tools.setFinish({ wallsOf: label, motif: "plain" }));
    summary(await tools.setFinish({ wall, side: "left", motif: "brick" }));
    const r = await tools.setFinish({ wall, side: "left", reset: true, motif: "plain" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/reset takes no motif/);
    summary(await tools.setFinish({ wall, side: "left", reset: true }));
    expect(sidesOf(docOf(claude).walls[wall]!)).toBeUndefined();
    expect(sideFinishes(docOf(claude), wall)?.left?.source).toBe("room");
    expect(roomWallsOf(docOf(claude).zoneLabels[label]!)?.finish?.motif).toBe("plain");
  });

  it("roof: true gives Properties' Covering under a gable, and get_drawing lists it with the roof", async () => {
    const { tools, claude } = await bath();
    summary(await tools.setCeiling({ shape: "gable" }));
    const before = docOf(claude);
    const s = summary(await tools.setFinish({ roof: true, motif: "standingSeam" }));
    expect(docOf(claude).ceilings[CEILING_ID]).toEqual(expected(before, { type: "setRoofCovering", finish: motifDefaults("standingSeam") }).ceilings[CEILING_ID]);
    expect(s.roof?.covering).toEqual(motifDefaults("standingSeam"));
  });

  it("refuses two targets, none, a motif that doesn't suit its target and a roof under a flat ceiling", async () => {
    const { tools, label, wall } = await bath();
    const refusal = async (args: Parameters<DrawingTools["setFinish"]>[0]) => {
      const r = await tools.setFinish(args);
      expect(r.isError).toBe(true);
      return r.text;
    };
    expect(await refusal({ label, wall, side: "left", motif: "plain" })).toMatch(/one of label, deck, wall, wallsOf, roof or outside/);
    expect(await refusal({ motif: "plain" })).toMatch(/one of label, deck, wall, wallsOf, roof or outside/);
    expect(await refusal({ label })).toMatch(/Pass motif/);
    expect(await refusal({ label, reset: true })).toMatch(/reset returns a custom wall side: pass it with wall and side/);
    expect(await refusal({ label, motif: "brick" })).toBe(`brick suits walls, not floors: a floor takes ${motifsFor("floor").join(", ")}`);
    expect(await refusal({ wall, side: "left", motif: "herringbone" })).toMatch(/^herringbone suits floors, not walls/);
    expect(await refusal({ wall, motif: "plain" })).toMatch(/side/);
    expect(await refusal({ roof: true, motif: "standingSeam" })).toMatch(/A flat ceiling has no roof/);
  });

  it("the same motif keeps a side's values; none can't remove a custom side's finish, only its band", async () => {
    const { tools, claude, wall } = await bath();
    summary(await tools.setFinish({ wall, side: "right", motif: "planks", colour: "#7a5236" }));
    summary(await tools.setFinish({ wall, side: "right", motif: "planks", size: 0.3 }));
    expect(sideOf(docOf(claude), wall)?.right?.finish).toEqual({ ...motifDefaults("planks"), colour: "#7a5236", size: 0.3 });
    const r = await tools.setFinish({ wall, side: "right", motif: "none" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/pass reset/);
    summary(await tools.setFinish({ wall, side: "right", lower: true, motif: "subwayTiles" }));
    summary(await tools.setFinish({ wall, side: "right", lower: true, motif: "none" }));
    expect(sideOf(docOf(claude), wall)?.right).toEqual({ finish: { ...motifDefaults("planks"), colour: "#7a5236", size: 0.3 }, lower: null });
  });
});

describe("a wall on a loft takes no default (cycle home, AC-01)", () => {
  /** The Bath under a 5.20 m ceiling, its walls sage, with a loft at 2.45 m carrying a wall. */
  async function loftWall(): Promise<{ tools: DrawingTools; claude: EditorSession; wall: string }> {
    const { tools, claude, label } = await bath();
    summary(await tools.setFinish({ wallsOf: label, motif: "plain", colour: "#a8b59a" }));
    summary(await tools.setFinish({ wallsOf: label, motif: "subwayTiles", lower: true, height: 1.2 }));
    summary(await tools.setCeiling({ height: 5.2 }));
    summary(await tools.addDeck({ preset: "loft", centre: { x: 2, y: 1.5 }, width: 3.8, depth: 2.8, top: 2.45 }));
    const deck = Object.keys(docOf(claude).decks)[0] ?? "";
    const before = new Set(Object.keys(docOf(claude).walls));
    summary(await tools.addWall({ a: { x: 2, y: 0.1 }, b: { x: 2, y: 2.9 }, on: deck }));
    const wall = Object.keys(docOf(claude).walls).find((id) => !before.has(id)) ?? "";
    return { tools, claude, wall };
  }

  it("get_drawing lists it with no sides, and what it shows is nothing", async () => {
    const { tools, claude, wall } = await loftWall();
    const s = summary(await tools.getDrawing({}));
    expect(s.walls.find((w) => w.id === wall)?.sides).toBeUndefined();
    expect(sideFinishes(docOf(claude), wall)).toEqual({ left: null, right: null });
  });

  it("set_finish on one of its sides starts from nothing: no band from the room below", async () => {
    const { tools, claude, wall } = await loftWall();
    const s = summary(await tools.setFinish({ wall, side: "left", motif: "brick" }));
    expect(s.walls.find((w) => w.id === wall)?.sides).toEqual({ left: { finish: motifDefaults("brick"), lower: null } });
    expect(sideFinishes(docOf(claude), wall)?.right).toBeNull();
  });
});
