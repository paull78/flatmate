import { afterEach, describe, expect, it } from "vitest";
import type { EditorSession } from "../src/session";
import { createTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// Claude's tools follow the overhang rule (steps.06, .11, AC-09): place_object and move_object with `on` a platform let
// a piece reach up to 0.30 m past its edge, its centre on it, and refuse past that with validation's words.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

const json = (r: Reply): { result: { object?: string } } => {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
};

/** A 7 × 2.5 room under 3.05 with a platform at +0.45 over x 2.6–4.6, y 1.3–2.4 (its front edge y 1.30). */
async function studio() {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  json(await tools.createProject({ name: "Overhang" }));
  json(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 2.5 }));
  json(await tools.setCeiling({ height: 3.05 }));
  const deck = (JSON.parse((await tools.addDeck({ preset: "platform", centre: { x: 3.6, y: 1.85 }, width: 2, depth: 1.1 })).text) as { result: { deck: string } }).result.deck;
  return { tools, deck };
}

describe("overhanging a platform through Claude's tools (AC-09)", () => {
  it("place_object on the platform, its 0.60 m bar table reaching 0.20 past the front edge, is accepted", async () => {
    const { tools, deck } = await studio();
    // An object's position is its footprint's centre: y 1.40, so the table spans y 1.10–1.70.
    json(await tools.placeObject({ layout: "s0", kind: "barTable", centre: { x: 3.6, y: 1.4 }, on: deck }));
  });

  it("move_object 0.35 past the edge (a 0.80 m deep table, its centre on the platform) is refused with the reach words", async () => {
    const { tools, deck } = await studio();
    const object = json(await tools.placeObject({ layout: "s0", kind: "barTable", centre: { x: 3.6, y: 1.8 }, on: deck })).result.object ?? "";
    json(await tools.setSize({ object, width: 1.2, depth: 0.8 }));
    const r = await tools.moveObject({ layout: "s0", object, centre: { x: 3.6, y: 1.35 }, on: deck });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("reaches more than 0.30 m past");
  });
});
