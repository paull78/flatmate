import { afterEach, describe, expect, it } from "vitest";
import type { Listing as DrawingSummary } from "./harness";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Layouts linked by default, for Claude (review.05–.07, AC-03, AC-07): place_object says when a new piece went into one
// layout only; move_object's everyLayout links or unlinks; get_drawing marks an exception with two or more layouts.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Summary = DrawingSummary & { result: { object?: string; layout?: { id: string; name: string }; note?: string } };
const reply = (r: Reply): Summary => {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
};
const objectIn = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id);

/** A 4 × 5 room with Layout (s0) and Night, both empty. */
async function twoLayouts(): Promise<{ tools: DrawingTools; server: TestServer; alice: EditorSession; night: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = reply(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  reply(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const night = reply(await tools.addLayout({ name: "Night" })).result.layout?.id ?? "";
  return { tools, server, alice, night };
}

describe("place_object", () => {
  it("places a piece in every layout, with no note", async () => {
    const { tools, night } = await twoLayouts();
    const s = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } }));
    const chair = objectIn(s, s.result.object ?? "");
    expect(chair?.placements[night]).toMatchObject({ centre: [1, 1] });
    expect(chair).not.toHaveProperty("linked");
    expect(s.result.note).toBeUndefined();
  });

  it("says when a piece went into one layout only, naming the layout it didn't fit in", async () => {
    const { tools, night } = await twoLayouts();
    const table = reply(await tools.placeObject({ layout: night, kind: "coffeeTable", centre: { x: 2, y: 2 } })).result.object ?? "";
    reply(await tools.moveObject({ layout: night, object: table, everyLayout: false }));
    reply(await tools.delete({ ids: [table], layout: "s0" })); // an exception now, so it leaves Layout only
    const s = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 2, y: 2 } }));
    expect(s.result.note).toBe("Only in Layout: it doesn't fit in Night");
    expect(objectIn(s, s.result.object ?? "")?.placements[night]).toBeNull();
  });
});

describe("move_object's everyLayout", () => {
  it("false makes an exception: a later move moves one layout's copy, and get_drawing marks it", async () => {
    const { tools, night } = await twoLayouts();
    const chair = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).result.object ?? "";
    const off = reply(await tools.moveObject({ layout: night, object: chair, everyLayout: false }));
    expect(objectIn(off, chair)).toMatchObject({ linked: false });
    const moved = reply(await tools.moveObject({ layout: night, object: chair, centre: { x: 3, y: 3 } }));
    expect(objectIn(moved, chair)?.placements["s0"]).toMatchObject({ centre: [1, 1] });
    expect(objectIn(moved, chair)?.placements[night]).toMatchObject({ centre: [3, 3] });
  });

  it("true copies this layout's place to every layout", async () => {
    const { tools, night } = await twoLayouts();
    const chair = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).result.object ?? "";
    reply(await tools.moveObject({ layout: night, object: chair, everyLayout: false }));
    reply(await tools.moveObject({ layout: night, object: chair, centre: { x: 3, y: 3 } }));
    const on = reply(await tools.moveObject({ layout: night, object: chair, everyLayout: true }));
    expect(objectIn(on, chair)?.placements["s0"]).toMatchObject({ centre: [3, 3] });
    expect(objectIn(on, chair)).not.toHaveProperty("linked");
  });

  it("true is refused, naming the layout, where the piece doesn't fit", async () => {
    const { tools, night } = await twoLayouts();
    const chair = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).result.object ?? "";
    reply(await tools.moveObject({ layout: night, object: chair, everyLayout: false }));
    reply(await tools.moveObject({ layout: night, object: chair, centre: { x: 3, y: 3 } }));
    const table = reply(await tools.placeObject({ layout: "s0", kind: "coffeeTable", centre: { x: 3, y: 3 } })).result.object ?? "";
    expect(table).not.toBe("");
    const r = await tools.moveObject({ layout: night, object: chair, everyLayout: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Layout/);
  });

  it("with a move: false unlinks first, so the move is this layout's; true links after, copying where it ended up", async () => {
    const { tools, night } = await twoLayouts();
    const chair = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).result.object ?? "";
    const off = reply(await tools.moveObject({ layout: night, object: chair, centre: { x: 3, y: 3 }, everyLayout: false }));
    expect(objectIn(off, chair)?.placements["s0"]).toMatchObject({ centre: [1, 1] });
    expect(objectIn(off, chair)?.placements[night]).toMatchObject({ centre: [3, 3] });
    const on = reply(await tools.moveObject({ layout: night, object: chair, centre: { x: 2, y: 2 }, everyLayout: true }));
    expect(objectIn(on, chair)?.placements["s0"]).toMatchObject({ centre: [2, 2] });
  });
});

describe("move_object's everyLayout with a move is checked as a whole (knownbugs AC-12)", () => {
  it("false with a move the rules refuse changes nothing: the piece stays linked and in place", async () => {
    const { tools, night } = await twoLayouts();
    const chair = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).result.object ?? "";
    const r = await tools.moveObject({ layout: night, object: chair, centre: { x: 0, y: 2 }, everyLayout: false }); // onto the left wall
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/wall/i);
    const s = reply(await tools.getDrawing({}));
    expect(objectIn(s, chair)).not.toHaveProperty("linked"); // an exception is marked `linked: false`
    expect(objectIn(s, chair)?.placements[night]).toMatchObject({ centre: [1, 1] });
  });

  it("true with a link the rules refuse changes nothing: the piece stays where it was, an exception", async () => {
    const { tools, night } = await twoLayouts();
    const chair = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).result.object ?? "";
    reply(await tools.moveObject({ layout: night, object: chair, centre: { x: 3, y: 3 }, everyLayout: false }));
    // A table in Layout only, where Night's chair would be moved to: the move fits in Night, the link can't copy it to Layout.
    const table = reply(await tools.placeObject({ layout: "s0", kind: "coffeeTable", centre: { x: 2, y: 4 }, everyLayout: false })).result.object ?? "";
    expect(table).not.toBe("");
    const r = await tools.moveObject({ layout: night, object: chair, centre: { x: 2, y: 4 }, everyLayout: true });
    expect(r.isError, r.text).toBe(true);
    const s = reply(await tools.getDrawing({}));
    expect(objectIn(s, chair)?.placements[night]).toMatchObject({ centre: [3, 3] }); // the move was not sent
    expect(objectIn(s, chair)?.placements["s0"]).toMatchObject({ centre: [1, 1] });
  });

  it("an accepted one replies with the rows of both edits", async () => {
    const { tools, night } = await twoLayouts();
    const raw = createTools(sessions[0] ?? fail("no session"));
    const chair = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } })).result.object ?? "";
    const r = await raw.moveObject({ layout: night, object: chair, centre: { x: 3, y: 3 }, everyLayout: false });
    expect(r.isError, r.text).toBe(false);
    const updated: Record<string, string[]> = JSON.parse(r.text).changed.updated;
    expect(updated.objects).toEqual([chair]); // the unlink writes the object's row
    expect(updated.placements).toHaveLength(1); // the move writes Night's copy
  });
});

function fail(message: string): never { throw new Error(message); }

describe("get_drawing", () => {
  it("marks no exception with one layout", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = withListings(createTools(claude));
    reply(await tools.createProject({ name: "One" }));
    reply(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
    const s = reply(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1, y: 1 } }));
    expect(objectIn(s, s.result.object ?? "")).not.toHaveProperty("linked");
  });
});
