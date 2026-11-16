import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { deckView, placementRange } from "@fm/domain";
import type { Listing as DrawingSummary } from "./harness";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";
import { pngSize } from "./pictures";
import { SCHEMAS } from "../src/schemas";

// Decks in Claude's tools (spec "MCP", decks.08, .11, .16; AC-12, AC-04 and AC-03 through MCP): add_deck, set_deck,
// delete on a deck, `on` in place_object and move_object, the landing rule without it, and get_drawing's decks.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/**
 * Claude and Alice on one project with a 4 × 5 room at (0, 0): inner faces at x 0.1 and 3.9, y 0.1 and 4.9; the
 * bottom wall runs along y 0.
 */
async function room(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession; bottom: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const bottom = s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id ?? "";
  return { server, tools, alice, bottom };
}

/** A 2.40 × 1.40 platform flush with the bottom wall's inner face: x 0.8 to 3.2, y 0.1 to 1.5. */
const PLATFORM = { preset: "platform", centre: { x: 2, y: 0.8 }, width: 2.4, depth: 1.4 } as const;
/** A loft over the top of the room, flush with three inner faces: x 0.1 to 3.9, y 2.8 to 4.9. */
const LOFT = { preset: "loft", centre: { x: 2, y: 3.85 }, width: 3.8, depth: 2.1 } as const;

const placementOf = (s: DrawingSummary, object: string) => s.objects.find((o) => o.id === object)?.placements["s0"];

describe("add_deck", () => {
  it("add_deck adds a platform and returns its ID", async () => {
    const { server, tools, alice } = await room();
    const s = summary(await tools.addDeck(PLATFORM));
    const id = s.result.deck ?? "";
    expect(id).toMatch(/\/k0$/);
    expect(s.counts.decks).toBe(1);
    expect(s.decks).toEqual([
      {
        id, name: "Platform", centre: [2, 0.8], width: 2.4, depth: 1.4, rotation: 0,
        corners: [[0.8, 0.1], [3.2, 0.1], [3.2, 1.5], [0.8, 1.5]], top: 0.45, solid: true, range: { bottom: 0, top: 0.45 }, holes: [], slabArea: 3.36, finish: null, guards: { upper: { kind: "none", height: 1 }, right: { kind: "none", height: 1 }, lower: { kind: "none", height: 1 }, left: { kind: "none", height: 1 } },
      },
    ]);
    await server.settle();
    const doc = alice.drawing();
    expect(doc && deckView(doc, id)?.top).toBe(0.45);
  });

  it("get_drawing lists a deck's guard, add_deck and set_deck set it, and the default goes by its top (guards AC-09)", async () => {
    const { tools } = await room();
    const loft = summary(await tools.addDeck(LOFT));
    const id = loft.result.deck ?? "";
    expect(loft.decks.find((d) => d.id === id)?.guards?.upper.kind).toBe("railing");
    const glass = summary(await tools.setDeck({ deck: id, guard: "glass" }));
    expect(glass.decks.find((d) => d.id === id)?.guards?.upper.kind).toBe("glass");
    const given = summary(await tools.addDeck({ ...PLATFORM, guard: "railing" }));
    expect(given.decks.find((d) => d.id === given.result.deck)?.guards?.upper.kind).toBe("railing");
  });

  it("a guard no choice offers is refused, by the schema's words (guards AC-09)", () => {
    const parsed = z.object(SCHEMAS.set_deck).safeParse({ deck: "k", guard: "wood" });
    expect(parsed.success).toBe(false);
    expect(z.object(SCHEMAS.set_deck).safeParse({ deck: "k", guard: "none" }).success).toBe(true);
  });

  it("add_deck takes the loft preset, defaults to a platform, and lets top, solid and name override the preset", async () => {
    const { tools } = await room();
    const loft = summary(await tools.addDeck(LOFT));
    const loftId = loft.result.deck ?? "";
    expect(loft.decks.find((d) => d.id === loftId)).toMatchObject({ name: "Loft", top: 2.15, solid: false, range: { bottom: 2.03, top: 2.15 } });
    const plain = summary(await tools.addDeck({ centre: { x: 2, y: 0.8 }, width: 2, depth: 1.4 }));
    expect(plain.decks.find((d) => d.id === plain.result.deck)).toMatchObject({ name: "Platform", top: 0.45, solid: true });
    const bench = summary(await tools.addDeck({ preset: "loft", name: "Bench", centre: { x: 0.6, y: 2 }, width: 1, depth: 0.6, top: 0.5, solid: true, rotation: 90 }));
    expect(bench.decks.find((d) => d.id === bench.result.deck)).toMatchObject({ name: "Bench", top: 0.5, solid: true, rotation: 90, width: 1, depth: 0.6 });
    expect(bench.counts.decks).toBe(3);
  });

  it("add_deck outside the building is refused with \"must lie over the building\"", async () => {
    const { tools } = await room();
    expect(await tools.addDeck({ ...PLATFORM, centre: { x: 10, y: 0.8 } })).toEqual({ text: "Platform must lie over the building", isError: true });
    expect(summary(await tools.getDrawing()).counts.decks).toBe(0);
  });
});

describe("set_deck and delete", () => {
  it("set_deck moves a platform and its sofa; a position with a size is a resize and leaves the sofa in place", async () => {
    const { server, tools, alice } = await room();
    const deck = summary(await tools.addDeck(PLATFORM)).result.deck ?? "";
    const sofa = summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 0.8 } })).result.object ?? "";
    const moved = summary(await tools.setDeck({ deck, centre: { x: 2.3, y: 0.8 } }));
    expect(moved.result.deck).toBe(deck);
    expect(moved.decks[0]?.centre).toEqual([2.3, 0.8]);
    expect(placementOf(moved, sofa)).toMatchObject({ centre: [2.3, 0.8], on: deck });
    // A new centre and a new width in one call: a resize (decks.39), so the sofa stays where it is on the plan.
    const resized = summary(await tools.setDeck({ deck, centre: { x: 2.4, y: 0.8 }, width: 2.6 }));
    expect(resized.decks[0]).toMatchObject({ centre: [2.4, 0.8], width: 2.6 });
    expect(placementOf(resized, sofa)).toMatchObject({ centre: [2.3, 0.8], on: deck });
    // Raising it raises the sofa with it.
    summary(await tools.setDeck({ deck, top: 0.6 }));
    await server.settle();
    const doc = alice.drawing();
    const p = doc && Object.values(doc.placements).find((x) => x.object === sofa);
    expect(doc && p && placementRange(doc, p.id)).toEqual({ bottom: 0.6, top: 1.5 });
  });

  it("set_deck rotation on a furnished deck is refused with \"carries\"; an unknown deck is named", async () => {
    const { tools } = await room();
    const deck = summary(await tools.addDeck(PLATFORM)).result.deck ?? "";
    summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 0.8 } }));
    expect(await tools.setDeck({ deck, rotation: 90 })).toEqual({ text: "Platform carries Sofa in Layout; move it off first", isError: true });
    expect(await tools.setDeck({ deck: "nope", top: 1 })).toEqual({ text: "No deck has the id nope", isError: true });
  });

  it("delete on a furnished deck is refused; an empty deck deletes", async () => {
    const { tools } = await room();
    const deck = summary(await tools.addDeck(PLATFORM)).result.deck ?? "";
    const sofa = summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 0.8 } })).result.object ?? "";
    expect(await tools.delete({ ids: [deck] })).toEqual({ text: "Platform carries Sofa in Layout; move it off first", isError: true });
    summary(await tools.moveObject({ layout: "s0", object: sofa, centre: { x: 2, y: 2.5 } }));
    expect(summary(await tools.delete({ ids: [deck] })).counts.decks).toBe(0);
  });
});

describe("standing on a deck", () => {
  it("place_object with on: loft puts a piece on it; a bed too tall for it there is refused with the ceiling text", async () => {
    const { server, tools, alice } = await room();
    summary(await tools.setCeiling({ height: 3.05 }));
    const loft = summary(await tools.addDeck(LOFT)).result.deck ?? "";
    // Without on, the bed would land on the floor under the loft; on the loft it reaches 3.15 (decks.44).
    expect(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 3.85 }, on: loft })).toEqual({
      text: "Bed reaches 3.15 m in Layout; the ceiling is 3.05 m", isError: true,
    });
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "nightstand", centre: { x: 0.5, y: 4.5 }, on: loft }));
    const stand = placed.result.object ?? "";
    expect(placementOf(placed, stand)).toMatchObject({ centre: [0.5, 4.5], on: loft });
    await server.settle();
    const doc = alice.drawing();
    const p = doc && Object.values(doc.placements).find((x) => x.object === stand);
    expect(p?.deck).toBe(loft);
    expect(doc && p && placementRange(doc, p.id)).toEqual({ bottom: 2.15, top: 2.75 });
  });

  it("place_object without on over the platform lands on it; under the loft it stays on the floor (AC-03)", async () => {
    const { tools } = await room();
    const platform = summary(await tools.addDeck(PLATFORM)).result.deck ?? "";
    summary(await tools.addDeck(LOFT));
    const s1 = summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 0.8 } }));
    expect(placementOf(s1, s1.result.object ?? "")?.on).toBe(platform);
    const s2 = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.5 } }));
    expect(placementOf(s2, s2.result.object ?? "")?.on).toBe("floor");
    // `on: "floor"` over the platform names the floor, which the platform fills: refused with the two ranges.
    const refused = await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1.2, y: 0.8 }, on: "floor" });
    expect(refused).toEqual({ text: "Chair (0.00–0.90) and Platform (0.00–0.45) overlap in Layout", isError: true });
  });

  it("move_object without on lands the piece: a sofa moved off the platform stands on the floor, and back on it", async () => {
    const { tools } = await room();
    const platform = summary(await tools.addDeck(PLATFORM)).result.deck ?? "";
    const sofa = summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 2.5 } })).result.object ?? "";
    const onto = summary(await tools.moveObject({ layout: "s0", object: sofa, centre: { x: 2, y: 0.8 } }));
    expect(placementOf(onto, sofa)).toMatchObject({ centre: [2, 0.8], on: platform });
    // Turned in place on the platform, it stays on it (its current surface first).
    const turned = summary(await tools.moveObject({ layout: "s0", object: sofa, rotation: 180 }));
    expect(placementOf(turned, sofa)).toMatchObject({ centre: [2, 0.8], rotation: 180, on: platform });
    const off = summary(await tools.moveObject({ layout: "s0", object: sofa, centre: { x: 2, y: 2.5 } }));
    expect(placementOf(off, sofa)).toMatchObject({ centre: [2, 2.5], on: "floor" });
  });

  it("move_object nudging a nightstand under the loft keeps it on the floor: its own old place doesn't count", async () => {
    const { tools } = await room();
    summary(await tools.setCeiling({ height: 3.05 })); // room for it on the loft too (2.15–2.75)
    const loft = summary(await tools.addDeck(LOFT)).result.deck ?? "";
    const stand = summary(await tools.placeObject({ layout: "s0", kind: "nightstand", centre: { x: 1, y: 4 } })).result.object ?? "";
    const nudged = summary(await tools.moveObject({ layout: "s0", object: stand, centre: { x: 1.1, y: 4 } }));
    expect(placementOf(nudged, stand)).toMatchObject({ centre: [1.1, 4], on: "floor" });
    expect(loft).not.toBe("");
  });

  it("move_object with only on moves a bed onto the loft in place, at 2.15–2.50 (AC-04)", async () => {
    const { server, tools, alice } = await room();
    const loft = summary(await tools.addDeck(LOFT)).result.deck ?? "";
    const bed = summary(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 3.85 } })).result.object ?? "";
    const before = summary(await tools.setSize({ object: bed, height: 0.35 }));
    expect(placementOf(before, bed)?.on).toBe("floor");
    const up = summary(await tools.moveObject({ layout: "s0", object: bed, on: loft }));
    expect(placementOf(up, bed)).toEqual({ ...placementOf(before, bed), on: loft });
    const loftRow = up.decks.find((d) => d.id === loft);
    const size = up.objects.find((o) => o.id === bed)?.sizes["standard"];
    expect([loftRow?.top, size?.elevation, size?.height]).toEqual([2.15, 0, 0.35]);
    await server.settle();
    const doc = alice.drawing();
    const p = doc && Object.values(doc.placements).find((x) => x.object === bed);
    expect(doc && p && placementRange(doc, p.id)).toEqual({ bottom: 2.15, top: 2.5 });
    // And back down with on: "floor".
    expect(placementOf(summary(await tools.moveObject({ layout: "s0", object: bed, on: "floor" })), bed)?.on).toBe("floor");
  });

  it("on naming no deck fails with \"No deck\"", async () => {
    const { tools } = await room();
    const sofa = summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 2.5 } })).result.object ?? "";
    expect(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 4 }, on: "k9" })).toEqual({ text: "No deck has the id k9", isError: true });
    expect(await tools.moveObject({ layout: "s0", object: sofa, on: "k9" })).toEqual({ text: "No deck has the id k9", isError: true });
    // A placement ID is not a deck either.
    expect((await tools.moveObject({ layout: "s0", object: sofa, on: sofa })).text).toBe(`No deck has the id ${sofa}`);
  });
});

describe("the sample scene through the tools (decks.20)", () => {
  it("a 0.45 platform under the window, a sofa landed on it, get_drawing shows it there, look in 3D draws it", async () => {
    const { tools, bottom } = await room();
    summary(await tools.addWindow({ wall: bottom, offset: 1.5, width: 1 }));
    const added = summary(await tools.addDeck({ preset: "platform", centre: { x: 2, y: 0.8 }, width: 2.4, depth: 1.4, top: 0.45 }));
    const platform = added.result.deck ?? "";
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "sofa", centre: { x: 2, y: 0.8 }, rotation: 180 }));
    const sofa = placed.result.object ?? "";
    const s = summary(await tools.getDrawing());
    expect(s.decks.find((d) => d.id === platform)).toMatchObject({ name: "Platform", top: 0.45, solid: true });
    expect(placementOf(s, sofa)).toMatchObject({ centre: [2, 0.8], rotation: 180, on: platform });
    const look = await tools.look({ view: "3d" });
    if (!("png" in look)) throw new Error(look.text);
    expect(pngSize(look.png).width).toBeGreaterThan(0);
  });
});
