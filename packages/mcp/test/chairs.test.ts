import { afterEach, describe, expect, it } from "vitest";
import { OPTION_REFUSALS } from "@fm/domain";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// set_chairs (library.10, AC-05): Claude turns "Round chairs" on or off for a table or desk with chairs by its object
// id, in every layout, through `setOption` like set_desk; get_drawing lists the options that are on as names, in
// OBJECT_OPTIONS order. A 4 × 5 room: a dining set in the middle, a desk with chair and a desk against the top wall.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function room(): Promise<{ tools: DrawingTools; alice: EditorSession; set: string; deskSet: string; desk: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const placed = async (kind: string, x: number, y: number) => summary(await tools.placeObject({ layout: "s0", kind, centre: { x, y } })).result.object ?? "";
  const set = await placed("seatedRound", 2, 2);
  const deskSet = await placed("deskSet", 1, 4.5);
  const desk = await placed("desk", 3, 4.6);
  return { tools, alice, set, deskSet, desk };
}

const listed = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id);

describe("set_chairs (AC-05)", () => {
  it("set_chairs turns round chairs on and get_drawing lists options", async () => {
    const { tools, alice, set, deskSet } = await room();
    expect(listed(summary(await tools.getDrawing()), set)).not.toHaveProperty("options");
    const on = summary(await tools.setChairs({ object: set, round: true }));
    expect(on.result).toEqual({ object: set });
    expect(listed(on, set)).toMatchObject({ options: ["roundChairs"] });
    expect(listed(summary(await tools.getDrawing()), set)).toMatchObject({ options: ["roundChairs"] });
    await expect.poll(() => alice.drawing()?.objects[set]?.options).toEqual({ roundChairs: true }); // the other client sees it

    // A desk with chair takes both; the list follows OBJECT_OPTIONS, whichever was turned on first.
    summary(await tools.setChairs({ object: deskSet, round: true }));
    const both = summary(await tools.setDesk({ object: deskSet, computer: true }));
    expect(listed(both, deskSet)).toMatchObject({ options: ["computer", "roundChairs"] });
    expect(listed(summary(await tools.setChairs({ object: deskSet, round: false })), deskSet)).toMatchObject({ options: ["computer"] });

    const off = summary(await tools.setChairs({ object: set, round: false }));
    expect(listed(off, set)).not.toHaveProperty("options");
    await expect.poll(() => alice.drawing()?.objects[set]?.options).toBeUndefined();
  });

  it("set_chairs turns a loose chair's round chairs on (seated.05)", async () => {
    const { tools } = await room();
    const loose = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 3.5, y: 2 } })).result.object ?? "";
    expect(listed(summary(await tools.setChairs({ object: loose, round: true })), loose)).toMatchObject({ options: ["roundChairs"] });
  });

  it("set_chairs on a desk is refused with the domain's reason", async () => {
    const { tools, desk } = await room();
    const r = await tools.setChairs({ object: desk, round: true });
    expect(r).toEqual({ isError: true, text: OPTION_REFUSALS.roundChairs });
    expect(r.text).toBe("Only a chair, or a table or desk with chairs, takes round chairs");
  });

  it("set_chairs on an unknown object names the id", async () => {
    const { tools } = await room();
    expect(await tools.setChairs({ object: "nope", round: true })).toEqual({ isError: true, text: "No object has the id nope" });
  });
});

describe("break_apart (AC-10)", () => {
  it("splits a set into its table and chairs, and the other client sees one edit", async () => {
    const { tools, alice, set } = await room();
    const reply = await tools.breakApart({ object: set });
    expect(reply.isError, reply.text).toBe(false);
    const out = summary(reply);
    expect(listed(out, set)).toBeUndefined();
    expect(out.objects.filter((o) => o.kind === "chair")).toHaveLength(4);
    expect(out.objects.filter((o) => o.kind === "roundTable")).toHaveLength(1);
    await expect.poll(() => alice.drawing()?.objects[set]).toBeUndefined();
  });

  it("on a piece that isn't a set it says so, plainly, and changes nothing", async () => {
    const { tools, desk } = await room();
    const r = await tools.breakApart({ object: desk });
    expect(r).toEqual({ text: "Only a table or desk with chairs breaks apart", isError: true });
    expect(listed(summary(await tools.getDrawing()), desk)).toBeDefined();
  });

  it("names an unknown object", async () => {
    const { tools } = await room();
    expect(await tools.breakApart({ object: "nope" })).toEqual({ text: "No object has the id nope", isError: true });
  });
});

describe("place_set (AC-12, AC-13)", () => {
  const empty = async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = withListings(createTools(claude));
    summary(await tools.createProject({ name: "Sets" }));
    summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 5 }));
    return tools;
  };

  it("places the pieces as independent objects, in one edit", async () => {
    const tools = await empty();
    const reply = await tools.placeSet({ set: "bedAndNightstands", layout: "s0", centre: { x: 3, y: 2.5 } });
    expect(reply.isError, reply.text).toBe(false);
    const drawn = summary(reply);
    expect(drawn.objects.map((o) => o.kind).sort()).toEqual(["bed", "nightstand", "nightstand"]);
  });

  it("where one piece doesn't fit it places nothing and says why", async () => {
    const tools = await empty();
    // The bed's centre in the room, the box's left end through the wall.
    const reply = await tools.placeSet({ set: "bedAndNightstands", layout: "s0", centre: { x: 1, y: 2.5 } });
    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(/Nightstand/);
    expect(summary(await tools.getDrawing()).objects).toEqual([]);
  });

  it("refuses an unknown set and layout by name", async () => {
    const tools = await empty();
    expect(await tools.placeSet({ set: "nope", layout: "s0", centre: { x: 3, y: 2.5 } })).toEqual({ text: "Unknown set nope", isError: true });
    expect((await tools.placeSet({ set: "sofaAndRug", layout: "nope", centre: { x: 3, y: 2.5 } })).text).toBe("No layout has the id nope");
  });

  it("a set's pieces can each be moved, and a turned set stays inside the room", async () => {
    const tools = await empty();
    const reply = await tools.placeSet({ set: "sofaAndRug", layout: "s0", centre: { x: 3, y: 2.5 }, rotation: 90 });
    expect(reply.isError, reply.text).toBe(false);
    const sofa = summary(reply).objects.find((o) => o.kind === "sofa");
    const moved = await tools.moveObject({ object: sofa?.id ?? "", layout: "s0", centre: { x: 5, y: 2.5 } });
    expect(moved.isError, moved.text).toBe(false);
  });
});

