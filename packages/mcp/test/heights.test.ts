import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MESSAGES, MIN_HEIGHT, ceilingHeight, placementRange, wallRange } from "@fm/domain";
import type { Listing as DrawingSummary } from "./harness";
import { SCHEMAS } from "../src/schemas";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";
import { pngSize } from "./pictures";

// Heights in Claude's tools (heights.20, AC-08, AC-16, AC-19): set_size with height and elevation, set_wall_top,
// set_ceiling, and get_drawing listing the ceiling, the cut, half-wall tops and heights per configuration.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/** Claude and Alice on one project with a 4 × 5 room at (0, 0): inner faces at x 0.1 and 3.9, y 0.1 and 4.9. */
async function room(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession; walls: Record<"bottom" | "top", string> }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  const s = summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const bottom = s.walls.find((w) => w.from[1] === 0 && w.to[1] === 0)?.id ?? "";
  const top = s.walls.find((w) => w.from[1] === 5 && w.to[1] === 5)?.id ?? "";
  return { server, tools, alice, walls: { bottom, top } };
}

describe("set_ceiling and set_wall_top", () => {
  it("set_ceiling then get_drawing lists 2.20 and cut 1.10; another client gets the ceiling (AC-04)", async () => {
    const { server, tools, alice } = await room();
    const before = summary(await tools.getDrawing());
    expect([before.ceiling, before.cut]).toEqual([2.5, 1.2]);
    const s = summary(await tools.setCeiling({ height: 2.2 }));
    expect([s.ceiling, s.cut]).toEqual([2.2, 1.1]);
    await server.settle();
    const doc = alice.drawing();
    expect(doc && ceilingHeight(doc)).toBe(2.2);
    expect(await tools.setCeiling({ height: 0.9 })).toEqual({ text: "The ceiling must be between 1.00 and 10 m", isError: true });
  });

  it("set_wall_top 1.1 lists the top; \"ceiling\" removes it; a wall with a door replies with the openings text (AC-19)", async () => {
    const { server, tools, alice, walls } = await room();
    const half = summary(await tools.setWallTop({ wall: walls.bottom, top: 1.1 }));
    expect(half.walls.find((w) => w.id === walls.bottom)?.top).toBe(1.1);
    expect(half.walls.filter((w) => w.top !== undefined)).toHaveLength(1);
    await server.settle();
    const doc = alice.drawing();
    expect(doc && wallRange(doc, walls.bottom)).toEqual({ bottom: 0, top: 1.1 });
    const full = summary(await tools.setWallTop({ wall: walls.bottom, top: "ceiling" }));
    expect(full.walls.find((w) => w.id === walls.bottom)?.top).toBeUndefined();
    summary(await tools.addDoor({ wall: walls.top, offset: 1 }));
    expect(await tools.setWallTop({ wall: walls.top, top: 1.1 })).toEqual({ text: expect.stringMatching(/^Door \S+'s head at 2\.10 m is less than 0\.10 m under wall \S+'s top at 1\.10 m$/), isError: true });
    summary(await tools.setWallTop({ wall: walls.bottom, top: 1.1 }));
    expect(await tools.addWindow({ wall: walls.bottom, offset: 1 })).toEqual({ text: expect.stringMatching(/^Window \S+ is 0\.10 m tall; an opening must be at least 0\.30 m tall$/), isError: true });
    expect(await tools.setWallTop({ wall: walls.bottom, top: 2.6 })).toEqual({ text: "A wall can't be taller than the 2.50 m ceiling", isError: true });
  });

  it("a wall with a door goes down to 2.20 m but not to 2.19 m; a 2.03 m half wall takes a window (sills.02)", async () => {
    const { tools, walls } = await room();
    summary(await tools.addDoor({ wall: walls.top, offset: 1 }));
    expect(await tools.setWallTop({ wall: walls.top, top: 2.19 })).toEqual({ text: expect.stringMatching(/'s top at 2\.19 m$/), isError: true });
    expect(summary(await tools.setWallTop({ wall: walls.top, top: 2.2 })).walls.find((w) => w.id === walls.top)?.top).toBe(2.2);
    summary(await tools.setWallTop({ wall: walls.bottom, top: 2.03 }));
    expect(summary(await tools.addWindow({ wall: walls.bottom, offset: 1 })).walls.find((w) => w.id === walls.bottom)?.openings).toHaveLength(1);
  });
});

describe("set_size heights and refusals", () => {
  it("set_size elevation \"ceiling\" and a number; config required when the kind has two; get_drawing lists them", async () => {
    const { server, tools, alice } = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "liftBed", centre: { x: 2, y: 3.85 } }));
    const bed = placed.result.object ?? "";
    expect(placed.objects.find((o) => o.id === bed)?.sizes).toEqual({
      up: { width: 1.7, depth: 2.1, height: 0.35, elevation: "ceiling" },
      down: { width: 1.7, depth: 2.1, height: 0.35, elevation: 0.2 },
    });
    const missing = await tools.setSize({ object: bed, elevation: 1.9 });
    expect(missing).toEqual({ text: "Lift bed has the configurations up, down: pass config", isError: true });
    const raised = summary(await tools.setSize({ object: bed, config: "up", elevation: 1.9 }));
    expect(raised.objects.find((o) => o.id === bed)?.sizes.up).toEqual({ width: 1.7, depth: 2.1, height: 0.35, elevation: 1.9 });
    const back = summary(await tools.setSize({ object: bed, config: "up", elevation: "ceiling", height: 0.4 }));
    expect(back.objects.find((o) => o.id === bed)?.sizes.up).toEqual({ width: 1.7, depth: 2.1, height: 0.4, elevation: "ceiling" });
    await server.settle();
    const doc = alice.drawing();
    const p = doc && Object.values(doc.placements).find((x) => x.object === bed);
    expect(doc && p && placementRange(doc, p.id)).toEqual({ bottom: 2.1, top: 2.5 });
  });

  it("place_object kind mattress with no size makes a 1.60 × 2.00 × 0.25 piece on the floor with no use zone (AC-06)", async () => {
    const { tools } = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "mattress", centre: { x: 2, y: 2.5 } }));
    const mattress = placed.objects.find((o) => o.id === placed.result.object);
    expect(mattress?.kind).toBe("mattress");
    expect(mattress?.sizes).toEqual({ standard: { width: 1.6, depth: 2, height: 0.25, elevation: 0 } });
    expect(mattress?.placements["s0"]).toMatchObject({ on: "floor", sides: [] });
  });

  it("a desk under a loft bed is accepted; a wardrobe there is refused with the two ranges (AC-08)", async () => {
    const { tools } = await room();
    const loft = summary(await tools.placeObject({ layout: "s0", kind: "loftBed", centre: { x: 2, y: 3.85 } })).result.object ?? "";
    summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.6 } }));
    const wardrobe = await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: { x: 2, y: 3.5 } });
    expect(wardrobe.isError).toBe(true);
    // Named in placement-ID order, as I11 always names them (heights.46).
    expect([`Loft bed (1.45–1.80) and Wardrobe (0.00–2.05) overlap in Layout`, `Wardrobe (0.00–2.05) and Loft bed (1.45–1.80) overlap in Layout`]).toContain(wardrobe.text);
    expect(loft).not.toBe("");
  });

  it("a Murphy bed under 2.20 is refused with the ceiling text; set_size raising a piece through the ceiling too (AC-16)", async () => {
    const { tools } = await room();
    summary(await tools.setCeiling({ height: 2.2 }));
    expect(await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 2, y: 4.7 } })).toEqual({
      text: "Murphy bed (Closed) reaches 2.24 m in Layout; the ceiling is 2.20 m", isError: true,
    });
    const w = summary(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: { x: 2, y: 4.6 } })).result.object ?? "";
    expect(await tools.setSize({ object: w, height: 2.3 })).toEqual({ text: "Wardrobe reaches 2.30 m in Layout; the ceiling is 2.20 m", isError: true });
  });
});

describe("place_object's height (clarity.06, AC-09)", () => {
  /** A hollow deck over the whole room; returns its ID. */
  async function overRoom(tools: DrawingTools, args: { preset: "loft" } | { top: number; solid: false }): Promise<string> {
    const s = summary(await tools.addDeck({ centre: { x: 2, y: 2.5 }, width: 3.8, depth: 4.8, ...args }));
    return s.decks?.[0]?.id ?? "";
  }
  const AT = { x: 2, y: 2.5 };
  const sizesOf = (s: Edited, kind: string) => s.objects.find((o) => o.kind === kind)?.sizes;

  it("place_object with height 2.03 places the wardrobe under the loft", async () => {
    const { tools, server, alice } = await room();
    await overRoom(tools, { preset: "loft" });
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT, height: 2.03 }));
    const wardrobe = placed.objects.find((o) => o.id === placed.result.object);
    expect(wardrobe?.sizes).toEqual({ standard: { width: 1.2, depth: 0.6, height: 2.03, elevation: 0 } });
    expect(wardrobe?.placements["s0"]).toMatchObject({ on: "floor", centre: [AT.x, AT.y] }); // `at` is still the centre
    await server.settle();
    const doc = alice.drawing();
    const p = doc && Object.values(doc.placements).find((x) => x.object === wardrobe?.id);
    expect(doc && p && placementRange(doc, p.id)).toEqual({ bottom: 0, top: 2.03 });
  });

  it("without it, refused with the ranges in the reason: Claude's piece never lowers by itself", async () => {
    const { tools } = await room();
    await overRoom(tools, { preset: "loft" });
    const refused = await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("0.00–2.05");
    expect(refused.text).toContain("2.03");
    expect(summary(await tools.getDrawing()).objects).toEqual([]);
  });

  it("with a preset and a height, the height wins, and the preset's width, depth and elevation stay", async () => {
    const { tools } = await room();
    await overRoom(tools, { preset: "loft" });
    const wide = summary(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: { x: 2, y: 1 }, preset: "150 × 60", height: 2 }));
    expect(sizesOf(wide, "wardrobe")).toEqual({ standard: { width: 1.5, depth: 0.6, height: 2, elevation: 0 } });
    const shelf = summary(await tools.placeObject({ layout: "s0", kind: "shelf", centre: { x: 2, y: 4.7 }, preset: "Wall shelf", height: 0.25 }));
    expect(sizesOf(shelf, "shelf")).toEqual({ standard: { width: 0.8, depth: 0.25, height: 0.25, elevation: 1.5 } });
  });

  it("height on a Murphy bed or a stair is refused with a plain reason", async () => {
    const { tools } = await room();
    const refused = { text: MESSAGES.fixedHeight, isError: true };
    expect(await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 2, y: 4.7 }, height: 2 })).toEqual(refused);
    expect(await tools.placeObject({ layout: "s0", kind: "stair", centre: AT, height: 2 })).toEqual(refused);
    expect(await tools.placeObject({ layout: "s0", kind: "liftBed", centre: { x: 2, y: 3.85 }, height: 0.3 })).toEqual(refused);
    expect(summary(await tools.getDrawing()).objects).toEqual([]);
  });

  it("a height above the ceiling is refused", async () => {
    const { tools } = await room();
    expect(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT, height: 2.6 })).toEqual({ text: "Wardrobe reaches 2.60 m in Layout; the ceiling is 2.50 m", isError: true });
    expect(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT, height: 0.001 })).toEqual({ text: MESSAGES.objectHeight, isError: true });
  });

  it("landsOn uses the given height: a piece lands on a deck only at the height given", async () => {
    // A hollow deck with its top at 1.00 and its underside at 0.88, below the floor's cut: a desk (0.75) fits under it.
    const { tools } = await room();
    const deck = await overRoom(tools, { top: 1, solid: false });
    const onOf = (s: Edited, object: string | undefined) => s.objects.find((o) => o.id === object)?.placements["s0"]?.on;
    const low = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 1 } }));
    expect(onOf(low, low.result.object)).toBe("floor");
    const tall = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 2.5 }, height: 0.95 }));
    expect(onOf(tall, tall.result.object)).toBe(deck);
    // A chair (0.90) doesn't fit under; at 0.88 it touches the slab, and a height is stored to the millimetre.
    const chair = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 0.5, y: 4.5 } }));
    expect(onOf(chair, chair.result.object)).toBe(deck);
    const under = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 1.5, y: 4.5 }, height: 0.8804 }));
    expect(onOf(under, under.result.object)).toBe("floor");
    expect(under.objects.find((o) => o.id === under.result.object)?.sizes["standard"]?.height).toBe(0.88);
  });

  it("the parameter says it never lowers by itself, and takes the range set_size takes", () => {
    const parse = (height: unknown) => z.object(SCHEMAS.place_object).safeParse({ layout: "s0", kind: "wardrobe", centre: AT, height });
    expect(parse(2.03).success).toBe(true);
    expect(parse(MIN_HEIGHT).success).toBe(true);
    expect(parse(MIN_HEIGHT / 2).success).toBe(false);
    expect(parse(undefined).success).toBe(true);
    expect(SCHEMAS.place_object.height.description ?? "").toContain("never lowers");
  });
});

describe("clearance in height (AC-11)", () => {
  it("get_drawing lists no blocked zone for a desk under the raised lift bed, nor a wall cabinet at 1.40 over a door swing; at 1.19 it lists it (decks.18)", async () => {
    const { tools, walls } = await room();
    summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.6 } }));
    const under = summary(await tools.placeObject({ layout: "s0", kind: "liftBed", centre: { x: 2, y: 3.85 } }));
    expect(under.layouts.find((s) => s.id === "s0")?.blocked).toEqual([]);
    summary(await tools.addDoor({ wall: walls.bottom, offset: 0.2 })); // a swing x 0.2–1.0, y 0.1–0.9
    const cabinet = summary(await tools.placeObject({ layout: "s0", kind: "wallCabinet", centre: { x: 0.6, y: 0.275 }, rotation: 180 }));
    expect(cabinet.layouts.find((s) => s.id === "s0")?.blocked).toEqual([]);
    const lowered = summary(await tools.setSize({ object: cabinet.result.object ?? "", elevation: 1.19 }));
    expect(lowered.layouts.find((s) => s.id === "s0")?.blocked.map((b) => b.zone)).toEqual([expect.stringMatching(/swing$/)]);
  });
});

describe("look in 3D (AC-16, heights.32)", () => {
  const png = (r: Awaited<ReturnType<DrawingTools["look"]>>): Uint8Array => {
    if (!("png" in r)) throw new Error(r.text);
    return r.png;
  };
  const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

  it("view 3d returns a PNG of the look size, by default from yaw 225 and tilt 35; other angles and Night differ (AC-07)", async () => {
    const { tools } = await room();
    const bed = summary(await tools.placeObject({ layout: "s0", kind: "liftBed", centre: { x: 2, y: 3.85 } })).result.object ?? "";
    const night = summary(await tools.copyLayout({ from: "s0", name: "Night" })) as Edited & { result: { layout?: { id: string } } };
    const nightId = night.result.layout?.id ?? "";
    summary(await tools.setConfiguration({ layout: nightId, object: bed, config: "down" }));
    const r = await tools.look({ view: "3d" });
    expect("png" in r && r.text).toMatch(/^3D view of Layout, yaw 225°, tilt 35°/);
    const day0 = png(r);
    expect(pngSize(day0)).toEqual({ width: 1100, height: 1100 });
    expect(same(day0, png(await tools.look({ view: "3d", yaw: 45 })))).toBe(false);
    expect(same(day0, png(await tools.look({ view: "3d", tilt: 60 })))).toBe(false);
    expect(same(day0, png(await tools.look({ view: "3d", layout: nightId })))).toBe(false);
    expect(same(day0, png(await tools.look({ view: "3d", layout: "s0", yaw: 225, tilt: 35 })))).toBe(true);
    expect(same(png(await tools.look({ view: "3d", yaw: 405 })), png(await tools.look({ view: "3d", yaw: 45 })))).toBe(true); // taken mod 360
    const turned = await tools.look({ view: "3d", yaw: 300.5, tilt: 62 });
    expect("png" in turned && turned.text).toMatch(/^3D view of Layout, yaw 300.5°, tilt 62°/);
  }); // slow under load: the shared 30 s default covers it (snags.20)

  it("roof under a flat ceiling shows every wall from outside, no roof, and says so (inherit step 07, AC-09)", async () => {
    const { tools } = await room();
    const open = await tools.look({ view: "3d" });
    const outside = await tools.look({ view: "3d", roof: true });
    expect("png" in outside && outside.text).toMatch(/every wall shown from outside, no roof/);
    expect(same(png(open), png(outside))).toBe(false);
  });

  it("a tilt outside 10 to 90 is refused with the range (AC-07)", async () => {
    const { tools } = await room();
    for (const tilt of [5, 95, 9.99, 90.01]) expect(await tools.look({ view: "3d", tilt })).toEqual({ text: "The tilt is 10 to 90 degrees", isError: true });
    expect("png" in (await tools.look({ view: "3d", tilt: 10 }))).toBe(true);
    expect("png" in (await tools.look({ view: "3d", tilt: 90 }))).toBe(true);
  });

  it("an unknown state, a region in 3D or a yaw, tilt or state on the plan is refused with a reason; view plan behaves as before", async () => {
    const { tools } = await room();
    expect(await tools.look({ view: "3d", layout: "nope" })).toEqual({ text: "No layout has the id nope", isError: true });
    expect(await tools.look({ view: "3d", region: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } } })).toEqual({ text: "A region applies to the plan view only", isError: true });
    for (const args of [{ yaw: 45 }, { tilt: 60 }]) expect(await tools.look(args)).toEqual({ text: "A yaw and a tilt apply to the 3D view only", isError: true });
    expect((await tools.look({ layout: "s0" })).isError).toBe(false); // the plan draws a layout's pieces (mcp.03)
    expect(png(await tools.look({ view: "plan" }))).toEqual(png(await tools.look({})));
  });
});

describe("place_object's width and depth (sizing step 05, AC-15)", () => {
  const AT = { x: 2, y: 2.5 };
  const created = (s: Edited) => s.objects.find((o) => o.id === s.result.object);

  it("AC-15: a wardrobe 0.83 × 0.55 is placed at that size, centred where asked", async () => {
    const { tools } = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT, width: 0.83, depth: 0.55 }));
    const wardrobe = created(placed);
    expect(wardrobe?.sizes).toEqual({ standard: { width: 0.83, depth: 0.55, height: 2.05, elevation: 0 } });
    expect(wardrobe?.placements["s0"]).toMatchObject({ centre: [AT.x, AT.y] }); // the centre, not an anchor left on the default depth
    const read = summary(await tools.getDrawing()).objects.find((o) => o.id === wardrobe?.id);
    expect(read?.sizes["standard"]).toMatchObject({ width: 0.83, depth: 0.55 });
  });

  it("only one of the two is refused, each with its own words", async () => {
    const { tools } = await room();
    expect(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT, width: 0.83 })).toEqual({ text: "Give depth with width", isError: true });
    expect(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT, depth: 0.55 })).toEqual({ text: "Give width with depth", isError: true });
  });

  it("with a preset, the size wins and the preset's height and elevation stay", async () => {
    const { tools } = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "shelf", preset: "Wall shelf", centre: AT, width: 0.6, depth: 0.2 }));
    expect(created(placed)?.sizes).toEqual({ standard: { width: 0.6, depth: 0.2, height: 0.3, elevation: 1.5 } });
  });

  it("with a height too; on a Murphy bed width and depth set the closed piece, and a height is refused as before", async () => {
    const { tools } = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "wardrobe", centre: AT, width: 0.83, depth: 0.55, height: 1.8 }));
    expect(created(placed)?.sizes).toEqual({ standard: { width: 0.83, depth: 0.55, height: 1.8, elevation: 0 } });
    const murphy = summary(await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 2, y: 4.6 }, width: 1.4, depth: 0.45 }));
    expect(created(murphy)?.sizes).toMatchObject({ folded: { width: 1.4, depth: 0.45 }, down: { width: 1.4, depth: 2.1 } });
    expect((await tools.placeObject({ layout: "s0", kind: "murphyBed", centre: { x: 2, y: 1 }, width: 1.4, depth: 0.45, height: 2 })).text).toBe(MESSAGES.fixedHeight);
  });

  it("a stair kind is refused with the reason", async () => {
    const { tools } = await room();
    expect(await tools.placeObject({ layout: "s0", kind: "stair", centre: AT, width: 0.9, depth: 2 })).toEqual({ text: "A stair's size comes from its run and rise: place it without width and depth, then use set_stair", isError: true });
  });

  it("the schema takes 0.02 to 10 m", () => {
    const schema = z.object(SCHEMAS.place_object);
    const base = { layout: "s0", kind: "wardrobe", centre: AT };
    expect(schema.safeParse({ ...base, width: 0.01, depth: 0.5 }).success).toBe(false);
    expect(schema.safeParse({ ...base, width: 12, depth: 0.5 }).success).toBe(false);
    expect(schema.safeParse({ ...base, width: 0.1, depth: 10 }).success).toBe(true);
  });
});
