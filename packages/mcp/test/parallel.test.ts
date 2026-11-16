import { afterEach, describe, expect, it } from "vitest";
import { createTools } from "../src/tools";
import type { EditorSession } from "../src/session";
import { TestServer } from "./harness";

// spec: mcp: parallel calls run in arrival order, each against the settled drawing after the previous one's outcome
// (fixes AC-15). A handler used to read the drawing when its call arrived, so the call behind it overwrote its change.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

async function room() {
  const { session } = new TestServer().join("Claude");
  sessions.push(session);
  const tools = createTools(session);
  await tools.createProject({ name: "Parallel" });
  await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 8, depth: 6 });
  return { session, tools };
}

const onlyDeck = (session: EditorSession) => {
  const [deck] = Object.values(session.drawing()?.decks ?? {});
  if (!deck) throw new Error("no deck");
  return deck;
};

describe("parallel tool calls", () => {
  it("set_deck {centre} and set_deck {width} both land", async () => {
    const { session, tools } = await room();
    await tools.addDeck({ preset: "platform", centre: { x: 2, y: 2 }, width: 1, depth: 1 });
    const { id } = onlyDeck(session);
    const replies = await Promise.all([tools.setDeck({ deck: id, centre: { x: 3, y: 3 } }), tools.setDeck({ deck: id, width: 1.5 })]);
    expect(replies.map((r) => r.isError)).toEqual([false, false]);
    expect(onlyDeck(session).at).toEqual({ x: 3, y: 3 });
    expect(onlyDeck(session).w).toBe(1.5);
  });

  it("four in a row keep every field", async () => {
    const { session, tools } = await room();
    await tools.addDeck({ preset: "platform", centre: { x: 2, y: 2 }, width: 1, depth: 1 });
    const { id } = onlyDeck(session);
    await Promise.all([tools.setDeck({ deck: id, centre: { x: 3, y: 2 } }), tools.setDeck({ deck: id, width: 1.5 }), tools.setDeck({ deck: id, centre: { x: 4, y: 4 } }), tools.setDeck({ deck: id, depth: 1.2 })]);
    expect(onlyDeck(session).at).toEqual({ x: 4, y: 4 });
    expect([onlyDeck(session).w, onlyDeck(session).d]).toEqual([1.5, 1.2]);
  });

  it("move_object {at} and move_object {rotation} both land", async () => {
    const { session, tools } = await room();
    await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 2, y: 2 } });
    const [object] = Object.keys(session.drawing()?.objects ?? {});
    if (!object) throw new Error("no object");
    await Promise.all([tools.moveObject({ object, layout: "s0", centre: { x: 5, y: 3 } }), tools.moveObject({ object, layout: "s0", rotation: 90 })]);
    const [p] = Object.values(session.drawing()?.placements ?? {});
    expect(p?.rotation).toBe(90);
    expect(p?.at.x).toBeGreaterThan(4);
  });

  it("a call that fails doesn't stop the one behind it", async () => {
    const { session, tools } = await room();
    await tools.addDeck({ preset: "platform", centre: { x: 2, y: 2 }, width: 1, depth: 1 });
    const { id } = onlyDeck(session);
    const [bad, good] = await Promise.all([tools.setDeck({ deck: "no-such-deck", centre: { x: 3, y: 2 } }), tools.setDeck({ deck: id, centre: { x: 3, y: 2 } })]);
    expect(bad.isError).toBe(true);
    expect(good.isError).toBe(false);
    expect(onlyDeck(session).at.x).toBe(3);
  });

  it("a read in the same burst sees the edit before it", async () => {
    const { session, tools } = await room();
    await tools.addDeck({ preset: "platform", centre: { x: 2, y: 2 }, width: 1, depth: 1 });
    const { id } = onlyDeck(session);
    const [, read] = await Promise.all([tools.setDeck({ deck: id, centre: { x: 3, y: 2 } }), tools.getDrawing()]);
    expect(read.text).toMatch(/"(at|center|centre)":\s*\[\s*3,/);
  });
});
