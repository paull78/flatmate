import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";
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


const G = (kind: string, height = 1) => ({ kind, height });
const deckOf = (s: DrawingSummary, id: string) => s.decks.find((d) => d.id === id);

// A guard per side through Claude's tools (edges AC-12): get_drawing lists the four sides by plan name, add_deck and
// set_deck take guards by those names (each a kind and an optional height) or one guard for all four.
describe("deck guards by plan name", () => {
  it("get_drawing lists four sides by plan name, each a kind and a height", async () => {
    const { tools } = await room();
    const loft = summary(await tools.addDeck(LOFT));
    expect(deckOf(loft, loft.result.deck ?? "")?.guards).toEqual({ upper: G("railing"), right: G("railing"), lower: G("railing"), left: G("railing") });
    expect(deckOf(loft, loft.result.deck ?? "")).not.toHaveProperty("guard");
  });

  it("set_deck guards.right none changes only the right side", async () => {
    const { tools } = await room();
    const id = summary(await tools.addDeck(LOFT)).result.deck ?? "";
    const after = summary(await tools.setDeck({ deck: id, guards: { right: { kind: "none" } } }));
    expect(deckOf(after, id)?.guards).toEqual({ upper: G("railing"), right: G("none"), lower: G("railing"), left: G("railing") });
  });

  it("set_deck with a height only keeps the kind", async () => {
    const { tools } = await room();
    const id = summary(await tools.addDeck(LOFT)).result.deck ?? "";
    const after = summary(await tools.setDeck({ deck: id, guards: { lower: { height: 0.3 } } }));
    expect(deckOf(after, id)?.guards?.lower).toEqual(G("railing", 0.3));
  });

  it("a turned deck's sides are named as they face now, and set_deck reads names after its own turn", async () => {
    const { tools } = await room();
    const id = summary(await tools.addDeck({ ...PLATFORM, top: 0.45, guards: { right: { kind: "glass" } } })).result.deck ?? "";
    // Turned 90° (same footprint, the width and depth swapped), the side that faced +x faces +y: upper.
    const turned = summary(await tools.setDeck({ deck: id, rotation: 90, width: 1.4, depth: 2.4, guards: { lower: { kind: "railing" } } }));
    expect(deckOf(turned, id)?.guards).toEqual({ upper: G("glass"), right: G("none"), lower: G("railing"), left: G("none") });
  });

  it("add_deck guard glass sets all four, and guards override it per side", async () => {
    const { tools } = await room();
    const one = summary(await tools.addDeck({ ...PLATFORM, guard: "glass" }));
    expect(deckOf(one, one.result.deck ?? "")?.guards).toEqual({ upper: G("glass"), right: G("glass"), lower: G("glass"), left: G("glass") });
    const mixed = summary(await tools.addDeck({ ...LOFT, guard: "glass", guards: { left: { kind: "none", height: 0.5 } } }));
    expect(deckOf(mixed, mixed.result.deck ?? "")?.guards?.left).toEqual(G("none", 0.5));
  });

  it("a height out of range is refused by the schema, and a side name it doesn't know too", () => {
    expect(z.object(SCHEMAS.set_deck).safeParse({ deck: "k", guards: { right: { height: 1.2 } } }).success).toBe(false);
    expect(z.object(SCHEMAS.set_deck).safeParse({ deck: "k", guards: { front: { kind: "none" } } }).success).toBe(false);
    expect(z.object(SCHEMAS.set_deck).safeParse({ deck: "k", guards: { right: { kind: "none", height: 0.3 } } }).success).toBe(true);
  });
});

// A hole's guard through Claude's tools (edges AC-12): add_hole and set_hole take guard, get_drawing lists it.
describe("a hole's guard", () => {
  it("add_hole takes a guard, set_hole changes it, get_drawing lists it", async () => {
    const { tools } = await room();
    const deck = summary(await tools.addDeck(LOFT)).result.deck ?? "";
    const added = summary(await tools.addHole({ deck, centre: { x: 2, y: 3.85 }, width: 1, depth: 0.8 }));
    const hole = (s: DrawingSummary, id: string) => s.decks.find((d) => d.id === deck)?.holes.find((h) => h.id === id);
    const id = (added.result as { hole?: string }).hole ?? "";
    expect(hole(added, id)?.guard).toEqual(G("railing"));
    const glass = summary(await tools.setHole({ hole: id, guard: { kind: "glass", height: 0.6 } }));
    expect(hole(glass, id)?.guard).toEqual(G("glass", 0.6));
    const kept = summary(await tools.setHole({ hole: id, guard: { kind: "none" } }));
    expect(hole(kept, id)?.guard).toEqual(G("none", 0.6));
    const given = summary(await tools.addHole({ deck, centre: { x: 0.8, y: 3.85 }, width: 0.5, depth: 0.5, guard: { kind: "glass" } }));
    expect(hole(given, (given.result as { hole?: string }).hole ?? "")?.guard).toEqual(G("glass"));
  });

  it("the schema refuses a height out of range", () => {
    expect(z.object(SCHEMAS.set_hole).safeParse({ hole: "h", guard: { height: 0.2 } }).success).toBe(false);
    expect(z.object(SCHEMAS.add_hole).safeParse({ deck: "k", centre: { x: 1, y: 1 }, width: 1, depth: 1, guard: { kind: "none" } }).success).toBe(true);
  });
});
