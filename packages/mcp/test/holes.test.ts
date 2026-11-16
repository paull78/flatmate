import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Holes in Claude's tools (stairwell.10, .14, .20, .34; AC-13): add_hole and set_hole take plan coordinates, delete takes a
// hole's id, get_drawing lists each deck's holes and its slab's area, refusals are the domain's words.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { hole?: string; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** Claude on the cabin: a 4 × 3 room, a 3.05 ceiling and a Loft at x 0.1–2.1 over the whole depth (stairwell.12). */
async function cabin(): Promise<{ tools: DrawingTools; loft: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Cabin" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 3 }));
  summary(await tools.setCeiling({ height: 3.05 }));
  const added = summary(await tools.addDeck({ preset: "loft", centre: { x: 1.1, y: 1.5 }, width: 2, depth: 2.8 }));
  return { tools, loft: added.result.deck ?? "" };
}
const NOTCH = { centre: { x: 1.75, y: 2.575 }, width: 0.7, depth: 0.65 };

describe("add_hole (AC-13)", () => {
  it("cuts the notch: its id in the result; get_drawing lists it under the loft with its corners, and the slab's area", async () => {
    const { tools, loft } = await cabin();
    const s = summary(await tools.addHole({ deck: loft, ...NOTCH }));
    expect(s.result.hole).toMatch(/\/h0$/);
    const d = s.decks.find((x) => x.id === loft);
    expect(d?.holes).toEqual([{ id: s.result.hole, centre: [1.75, 2.575], width: 0.7, depth: 0.65, corners: [[1.4, 2.25], [2.1, 2.25], [2.1, 2.9], [1.4, 2.9]], guard: { kind: "railing", height: 1 } }]);
    expect(d?.slabArea).toBeCloseTo(2 * 2.8 - 0.7 * 0.65, 3);
  });

  it("on a deck turned by 30° the centre lies where asked, the sides along the deck's axes", async () => {
    const { tools, loft } = await cabin();
    summary(await tools.delete({ ids: [loft] }));
    const p = summary(await tools.addDeck({ preset: "platform", centre: { x: 2.2, y: 1.5 }, width: 1.2, depth: 1.2, rotation: 30 }));
    const s = summary(await tools.addHole({ deck: p.result.deck ?? "", centre: { x: 2.2, y: 1.5 }, width: 0.4, depth: 0.3 }));
    const h = s.decks[0]?.holes[0];
    expect(h?.centre).toEqual([2.2, 1.5]);
    const [a, b] = h?.corners ?? [];
    const along = a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) * (180 / Math.PI) : NaN;
    expect(Math.abs(along - 30)).toBeLessThan(0.1); // corners come rounded to the millimetre
  });

  it("a refused hole reads as in the editor", async () => {
    const { tools, loft } = await cabin();
    const r = await tools.addHole({ deck: loft, centre: { x: 2.0, y: 1.5 }, width: 0.4, depth: 0.5 });
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toContain("A hole in Loft lies inside it");
  });
});

describe("set_hole and delete (AC-13)", () => {
  it("set_hole moves and resizes; delete removes it", async () => {
    const { tools, loft } = await cabin();
    const hole = summary(await tools.addHole({ deck: loft, ...NOTCH })).result.hole ?? "";
    const moved = summary(await tools.setHole({ hole, centre: { x: 1.8, y: 2.6 }, width: 0.6, depth: 0.6 }));
    expect(moved.decks[0]?.holes[0]).toMatchObject({ centre: [1.8, 2.6], width: 0.6, depth: 0.6 });
    const gone = summary(await tools.delete({ ids: [hole] }));
    expect(gone.decks[0]?.holes).toEqual([]);
    expect((await tools.setHole({ hole: "x/h0", width: 0.5 })).text).toContain("No hole has the id x/h0");
  });

  it("set_deck moving the loft carries its hole", async () => {
    const { tools, loft } = await cabin();
    summary(await tools.addHole({ deck: loft, ...NOTCH }));
    const moved = summary(await tools.setDeck({ deck: loft, centre: { x: 1.3, y: 1.5 } }));
    expect(moved.decks[0]?.holes[0]).toMatchObject({ centre: [1.95, 2.575], corners: [[1.6, 2.25], [2.3, 2.25], [2.3, 2.9], [1.6, 2.9]] });
  });
});

describe("a ladder through Claude's hole", () => {
  it("a ship's ladder rising west along the north wall is refused without the hole and placed with it", async () => {
    const { tools, loft } = await cabin();
    const ladder = { layout: "s0", kind: "shipsLadder", centre: { x: 1.95, y: 2.6 }, rotation: 90 };
    const refused = await tools.placeObject(ladder);
    expect(refused.text).toContain("Ship's ladder (0.00–2.15) and Loft (2.03–2.15) overlap");
    summary(await tools.addHole({ deck: loft, ...NOTCH }));
    expect((await tools.placeObject(ladder)).isError).toBe(false);
  });
});
