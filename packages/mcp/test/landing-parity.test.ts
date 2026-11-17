import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Claude's piece lands where a person's does (knownbugs AC-07, principle 8): place_object and move_object give the
// landing rule the piece's role (a stair's pose, a wheel well, a beam), as the Object tool's ghost does.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});
type Placed = DrawingSummary & { result: { object?: string; deck?: string } };
const parsed = (r: Reply): Placed => {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
};
const onOf = (s: DrawingSummary, object: string): string | undefined => s.objects.find((o) => o.id === object)?.placements?.["s0"]?.on;

/** A 6 × 4 room under a 3.20 m ceiling with a 3 × 3 platform: x 2.5 to 5.5, y 0.5 to 3.5, top 0.45. */
async function house() {
  const claude = new TestServer().join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  parsed(await tools.createProject({ name: "Landing" }));
  parsed(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  parsed(await tools.setCeiling({ height: 3.2 }));
  const platform = parsed(await tools.addDeck({ preset: "platform", centre: { x: 4, y: 2 }, width: 3, depth: 3 })).result.deck ?? "";
  return { tools, platform };
}

describe("Claude's landing takes the piece's role", () => {
  it("a ceiling-hung beam over a platform lands on the floor, as a click's", async () => {
    const { tools } = await house();
    const placed = parsed(await tools.placeObject({ layout: "s0", kind: "beam", centre: { x: 4, y: 2 } }));
    expect(onOf(placed, placed.result.object ?? "")).toBe("floor");
  });

  it("a wheel well over a platform lands on the floor, and is refused there, not put on the platform", async () => {
    const { tools } = await house();
    const r = await tools.placeObject({ layout: "s0", kind: "wheelWell", centre: { x: 4, y: 2 } });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain("floor only"); // it never asked for the platform
  });

  it("an open stair on a platform over a low block is placed, as a click's", async () => {
    const { tools, platform } = await house();
    parsed(await tools.placeObject({ layout: "s0", kind: "block", centre: { x: 4.6, y: 2 }, width: 0.5, depth: 0.5, height: 0.3, on: platform }));
    const placed = parsed(await tools.placeObject({ layout: "s0", kind: "openStair", centre: { x: 4, y: 2 }, rotation: 90 }));
    expect(onOf(placed, placed.result.object ?? "")).toBe(platform);
  });
});

// A set's box is as tall as its tallest piece (0.90 for the sofa and rug), for Claude as for the ghost (knownbugs AC-02):
// with a box 1.00 m tall, a set under a 0.95 m underside landed on the deck, and one with 0.95 m of room was refused.
describe("place_set takes the set's own height", () => {
  it("under a low loft whose underside is at 0.95 m the sofa and rug land on the floor", async () => {
    const claude = new TestServer().join("Claude").session;
    sessions.push(claude);
    const tools = withListings(createTools(claude));
    parsed(await tools.createProject({ name: "Set" }));
    parsed(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
    parsed(await tools.addDeck({ preset: "loft", centre: { x: 3, y: 2 }, width: 5.6, depth: 3.6, top: 1.07 }));
    const placed = parsed(await tools.placeSet({ set: "sofaAndRug", layout: "s0", centre: { x: 3, y: 2 } })) as Placed & { result: { objects?: string[] } };
    const ids = placed.result.objects ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(onOf(placed, id)).toBe("floor");
  });
});
