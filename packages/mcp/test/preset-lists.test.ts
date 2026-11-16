import { OBJECT_KINDS } from "@fm/domain";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Listing as DrawingSummary } from "./harness";
import { SCHEMAS } from "../src/schemas";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { presetNamesOf } from "../src/preset-names";
import { TestServer, withListings } from "./harness";

// The spec's preset lists in Claude's tools (catalog.07, AC-06), and the landing heights (catalog.49): place_object
// asks the landing rule with the preset's height, not the kind's default.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}
const parse = (input: unknown) => z.object(SCHEMAS.place_object).safeParse(input);

/** Claude on a project with a 4 × 5 room at (0, 0): inner faces at x 0.1 and 3.9, y 0.1 and 4.9. */
async function room(): Promise<DrawingTools> {
  const claude = new TestServer().join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Kitchen" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  return tools;
}

const AT = { x: 2, y: 2.5 };
const sizesOf = (s: Edited) => s.objects.find((o) => o.id === s.result.object)?.sizes.standard;

describe("place_object and set_size take the spec's presets (AC-06)", () => {
  it("fridge Under-counter is 0.60 × 0.60 × 0.85", async () => {
    const tools = await room();
    expect(sizesOf(summary(await tools.placeObject({ layout: "s0", kind: "fridge", centre: AT, preset: "Under-counter" })))).toEqual({ width: 0.6, depth: 0.6, height: 0.85, elevation: 0 });
  });

  it("shelf Wall shelf hangs at 1.50, 0.30 tall", async () => {
    const tools = await room();
    expect(sizesOf(summary(await tools.placeObject({ layout: "s0", kind: "shelf", centre: AT, preset: "Wall shelf" })))).toEqual({ width: 0.8, depth: 0.25, height: 0.3, elevation: 1.5 });
  });

  it("set_size brings a default fridge to Under-counter and a default shelf to Wall shelf", async () => {
    const tools = await room();
    const fridge = summary(await tools.placeObject({ layout: "s0", kind: "fridge", centre: { x: 1, y: 2.5 } })).result.object ?? "";
    expect(sizesOf(summary(await tools.setSize({ object: fridge, preset: "Under-counter" })))).toEqual({ width: 0.6, depth: 0.6, height: 0.85, elevation: 0 });
    const shelf = summary(await tools.placeObject({ layout: "s0", kind: "shelf", centre: { x: 3, y: 2.5 } })).result.object ?? "";
    expect(sizesOf(summary(await tools.setSize({ object: shelf, preset: "Wall shelf" })))).toEqual({ width: 0.8, depth: 0.25, height: 0.3, elevation: 1.5 });
  });

  it("from Wall shelf, set_size Bookcase is accepted and stands on the floor at 2.00, and Standard at 1.50: no stale height or elevation", async () => {
    const tools = await room();
    const shelf = summary(await tools.placeObject({ layout: "s0", kind: "shelf", centre: AT, preset: "Wall shelf" })).result.object ?? "";
    const bookcase = summary(await tools.setSize({ object: shelf, preset: "Bookcase" }));
    expect(sizesOf(bookcase)).toEqual({ width: 0.8, depth: 0.3, height: 2, elevation: 0 });
    expect(bookcase.objects.find((o) => o.id === shelf)?.placements["s0"]?.on).toBe("floor");
    summary(await tools.setSize({ object: shelf, preset: "Wall shelf" }));
    const standard = summary(await tools.setSize({ object: shelf, preset: "Standard" }));
    expect(sizesOf(standard)).toEqual({ width: 0.8, depth: 0.4, height: 1.5, elevation: 0 });
    expect(standard.objects.find((o) => o.id === shelf)?.placements["s0"]?.on).toBe("floor");
  });

  it.each([
    ["toilet", undefined, 0.36, 0.54], ["toilet", "Standard", 0.4, 0.65], ["bidet", undefined, 0.36, 0.54],
    ["vanityUnit", undefined, 1, 0.5], ["vanityUnit", "140 × 50", 1.4, 0.5],
    ["palm", undefined, 0.9, 0.9], ["palm", "120 × 120", 1.2, 1.2], ["fern", "40 × 40", 0.4, 0.4], ["rosette", "50 × 50", 0.5, 0.5],
  ] as const)("place_object places a %s (preset %s) at %s × %s (symbols AC-03, AC-07, AC-09)", async (kind, preset, width, depth) => {
    const tools = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind, centre: AT, ...(preset ? { preset } : {}) }));
    expect(sizesOf(placed)).toEqual(expect.objectContaining({ width, depth }));
  });

  it("a preset of another kind is refused with this kind's list", async () => {
    const tools = await room();
    expect(await tools.placeObject({ layout: "s0", kind: "toilet", centre: AT, preset: "12 V" })).toEqual({ text: "Toilet has the presets Wall-hung, Standard, Composting", isError: true });
  });

  it("the enum holds every preset of every kind, and its description lists them with their heights", () => {
    for (const kind of OBJECT_KINDS.filter((k) => !k.retired)) {
      for (const name of presetNamesOf(kind.id)) expect(parse({ layout: "s0", kind: kind.id, centre: AT, preset: name }).success, `${kind.id} ${name}`).toBe(true);
    }
    const description = SCHEMAS.place_object.preset.unwrap().description ?? "";
    expect(description).toContain("fridge: Tall 60 × 65 h 190, 70 cm 70 × 65 h 200, Under-counter 60 × 60 h 85, Compact 48 × 50 h 85, US French door 91 × 75 h 178, 12 V 45 × 50 h 55");
    expect(description).toContain("shelf: Standard 80 × 40 h 150, Bookcase 80 × 30 h 200, Cube 77 × 39 h 77, Wall shelf 80 × 25 h 30 at 150");
    expect(description).toContain("hobUnit: 2 burners 30 × 60, 4 burners 60 × 60, 5 burners 75 × 60, 6 burners 90 × 60");
  });
});

describe("the landing heights (catalog.49)", () => {
  /**
   * A hollow deck, x 1 to 3, y 1.5 to 3.5, top 0.80, so its underside is at 0.68: a 0.55 12 V fridge stands under it
   * and a 1.90 fridge doesn't. With the ceiling at 3.00, the 1.90 fridge does fit on the deck (0.80–2.70).
   */
  async function lowDeck(): Promise<{ tools: DrawingTools; deck: string }> {
    const tools = await room();
    summary(await tools.setCeiling({ height: 3 }));
    const deck = summary(await tools.addDeck({ preset: "loft", name: "Low", centre: { x: 2, y: 2.5 }, width: 2, depth: 2, top: 0.8 })).result.deck ?? "";
    return { tools, deck };
  }
  const onOf = (s: Edited) => s.objects.find((o) => o.id === s.result.object)?.placements["s0"]?.on;

  it("a 12 V fridge lands on the floor under the deck, where only its preset height fits", async () => {
    const { tools } = await lowDeck();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "fridge", centre: AT, preset: "12 V" }));
    expect(onOf(placed)).toBe("floor");
    expect(sizesOf(placed)).toMatchObject({ height: 0.55 });
  });

  it("the kind's default height there lands on the deck, so the case tells them apart", async () => {
    const { tools, deck } = await lowDeck();
    expect(onOf(summary(await tools.placeObject({ layout: "s0", kind: "fridge", centre: AT })))).toBe(deck);
  });
});
