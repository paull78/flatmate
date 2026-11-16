import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// set_finish (finishes.14, .20, .27; AC-10): sets, changes and removes a room's finish on its label. A motif change
// follows withMotif (finishes.37: keep the colour and the direction, take the new motif's size and strength), given
// fields override it, the same motif keeps the room's values, and refusals are the domain's messages naming the range.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function summary(r: Reply): DrawingSummary {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

const finishOf = (s: DrawingSummary, label: string) => s.rooms.flatMap((r) => r.labels).find((l) => l.id === label)?.finish;

/** Claude labels a 4 × 3 room "Kitchen"; Alice watches the same project. */
async function kitchen(): Promise<{ tools: DrawingTools; label: string; alice: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Flat" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
  const labelled = summary(await tools.labelRoom({ point: { x: 2, y: 1.5 }, name: "Kitchen" }));
  const label = labelled.rooms[0]?.labels[0];
  if (!label) throw new Error("no label");
  expect(label.finish).toBeNull();
  return { tools, label: label.id, alice };
}

describe("set_finish (AC-10)", () => {
  it("set_finish planks on a label gives the defaults", async () => {
    const { tools, label } = await kitchen();
    const s = summary(await tools.setFinish({ label, motif: "planks" }));
    expect(finishOf(s, label)).toEqual({ motif: "planks", colour: "#c8a27a", strength: 45, size: 0.2, angle: 0 });
  });

  it("set_finish herringbone after planks keeps the colour and the direction and takes herringbone's size and strength", async () => {
    const { tools, label } = await kitchen();
    summary(await tools.setFinish({ label, motif: "planks", colour: "#D8BC94", strength: 60, size: 0.3, angle: 90 }));
    const s = summary(await tools.setFinish({ label, motif: "herringbone" }));
    expect(finishOf(s, label)).toEqual({ motif: "herringbone", colour: "#d8bc94", strength: 50, size: 0.09, angle: 135 });
    const back = summary(await tools.setFinish({ label, motif: "planks" }));
    expect(finishOf(back, label)).toEqual({ motif: "planks", colour: "#d8bc94", strength: 45, size: 0.2, angle: 90 });
  });

  it("with the same motif, omitted fields keep the room's values", async () => {
    const { tools, label } = await kitchen();
    summary(await tools.setFinish({ label, motif: "herringbone", colour: "#7a5236", strength: 70, size: 0.12, angle: 100 }));
    const s = summary(await tools.setFinish({ label, motif: "herringbone", angle: 10 }));
    expect(finishOf(s, label)).toEqual({ motif: "herringbone", colour: "#7a5236", strength: 70, size: 0.12, angle: 10 });
  });

  it("given fields override the motif-change rule; colour is lower-cased", async () => {
    const { tools, label } = await kitchen();
    summary(await tools.setFinish({ label, motif: "planks" }));
    const s = summary(await tools.setFinish({ label, motif: "squareTiles", colour: "#A9C9D6", strength: 30, size: 0.45, angle: 15 }));
    expect(finishOf(s, label)).toEqual({ motif: "squareTiles", colour: "#a9c9d6", strength: 30, size: 0.45, angle: 15 });
  });

  it('"none" removes the finish', async () => {
    const { tools, label } = await kitchen();
    summary(await tools.setFinish({ label, motif: "herringbone" }));
    const s = summary(await tools.setFinish({ label, motif: "none" }));
    expect(finishOf(s, label)).toBeNull();
  });

  it('size 0.9 refused with "finish.size must be 0.10–0.40"; the finish is unchanged', async () => {
    const { tools, label } = await kitchen();
    summary(await tools.setFinish({ label, motif: "planks" }));
    expect(await tools.setFinish({ label, motif: "planks", size: 0.9 })).toEqual({ text: "finish.size must be 0.10–0.40", isError: true });
    expect(await tools.setFinish({ label, motif: "mosaic", size: 0.01 })).toEqual({ text: "finish.size must be 0.020–0.050", isError: true });
    expect(await tools.setFinish({ label, motif: "planks", colour: "oak" })).toEqual({ text: "finish.colour must be #rrggbb", isError: true });
    expect(finishOf(summary(await tools.getDrawing()), label)).toEqual({ motif: "planks", colour: "#c8a27a", strength: 45, size: 0.2, angle: 0 });
  });

  it("an unknown label is refused, naming the id", async () => {
    const { tools } = await kitchen();
    expect(await tools.setFinish({ label: "nope", motif: "planks" })).toEqual({ text: "No room label has the id nope", isError: true });
  });

  it("another editor sees the finish Claude set", async () => {
    const { tools, label, alice } = await kitchen();
    summary(await tools.setFinish({ label, motif: "mosaic" }));
    await expect.poll(() => alice.drawing()?.zoneLabels[label]?.finish).toEqual({ motif: "mosaic", colour: "#a9c9d6", strength: 50, size: 0.025, angle: 0 });
  });
});

describe("set_finish on a deck (deck-floors.03, AC-06)", () => {
  /** The kitchen with a 0.45 platform over its left half. */
  async function withPlatform(): Promise<{ tools: DrawingTools; label: string; deck: string }> {
    const { tools, label } = await kitchen();
    const s = summary(await tools.addDeck({ centre: { x: 1, y: 1.5 }, width: 1.6, depth: 2 }));
    const deck = s.decks[0]?.id;
    if (deck === undefined) throw new Error("no deck");
    expect(s.decks[0]?.finish).toBeNull(); // get_drawing lists a deck's finish, none yet
    return { tools, label, deck };
  }
  const deckFinish = (s: DrawingSummary, id: string) => s.decks.find((d) => d.id === id)?.finish;

  it("set_finish with deck lays the motif's defaults on the deck, and get_drawing lists it; the room is untouched", async () => {
    const { tools, label, deck } = await withPlatform();
    const s = summary(await tools.setFinish({ deck, motif: "widePlanks" }));
    expect(deckFinish(s, deck)).toEqual(expect.objectContaining({ motif: "widePlanks" }));
    expect(finishOf(s, label)).toBeNull();
  });

  it("with the deck's own motif, omitted fields keep the deck's values; a new motif follows withMotif", async () => {
    const { tools, deck } = await withPlatform();
    summary(await tools.setFinish({ deck, motif: "planks", colour: "#a99c8a", size: 0.3 }));
    expect(deckFinish(summary(await tools.setFinish({ deck, motif: "planks", strength: 60 })), deck)).toEqual({ motif: "planks", colour: "#a99c8a", strength: 60, size: 0.3, angle: 0 });
    const herring = deckFinish(summary(await tools.setFinish({ deck, motif: "herringbone" })), deck);
    expect(herring).toEqual(expect.objectContaining({ motif: "herringbone", colour: "#a99c8a", angle: 45 }));
  });

  it("\"none\" removes it", async () => {
    const { tools, deck } = await withPlatform();
    summary(await tools.setFinish({ deck, motif: "planks" }));
    expect(deckFinish(summary(await tools.setFinish({ deck, motif: "none" })), deck)).toBeNull();
  });

  it("with both label and deck, or neither, it is refused; an unknown deck too", async () => {
    const { tools, label, deck } = await withPlatform();
    const both = await tools.setFinish({ label, deck, motif: "planks" });
    expect(both.isError).toBe(true);
    expect(both.text).toBe("Pass one of label, deck, wall, wallsOf, roof or outside");
    const neither = await tools.setFinish({ motif: "planks" });
    expect(neither.isError).toBe(true);
    expect(neither.text).toBe("Pass one of label, deck, wall, wallsOf, roof or outside");
    const unknown = await tools.setFinish({ deck: "nope", motif: "planks" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toBe("No deck has the id nope");
  });

  it("an out-of-range size is the domain's refusal naming the range", async () => {
    const { tools, deck } = await withPlatform();
    const r = await tools.setFinish({ deck, motif: "cementTiles", size: 0.5 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("0.15–0.40");
  });
});
