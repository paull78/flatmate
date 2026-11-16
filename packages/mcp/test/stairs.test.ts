import { afterEach, describe, expect, it } from "vitest";
import type { Listing as DrawingSummary } from "./harness";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";
import { emptyDocument, execute, heightsOf, rectangleRoom, STAIR_LANDING, stairEdges, stairOnEdge, unwrap, type Command, type Document } from "@fm/domain";
import { stairLine } from "../src/stair-lines";

// Stairs in Claude's tools (spec "MCP", stairs.10, .18, .20; AC-12, AC-15): place_object and move_object with a stair
// kind and `reaches` (links are explicit, stairdraw.08), set_size on a stair, and get_drawing's stair line (reach,
// risers, going, run, warnings) worded from the domain's checks.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string; objects?: string[]; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

/**
 * A 7 × 2.5 room at (0, 0) under a 3.20 ceiling (inner faces x 0.1 to 6.9, y 0.1 to 2.4) with a loft over x 0.1 to 3.6
 * at its preset top, 2.15.
 */
async function studio(): Promise<{ tools: DrawingTools; loft: string; session: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Studio" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 2.5 }));
  summary(await tools.setCeiling({ height: 3.2 }));
  const loft = summary(await tools.addDeck({ preset: "loft", centre: { x: 1.85, y: 1.25 }, width: 3.5, depth: 2.3 })).result.deck ?? "";
  return { tools, loft, session: claude };
}

/**
 * A 6 × 6 room at (0, 0) under a 3.20 ceiling (inner faces x and y 0.1 to 5.9) with a loft over x 2 to 4, y 4.2 to 5.8
 * at 2.15: an L from its bottom edge (y 4.2) fits turning either way.
 */
async function squareRoom(): Promise<{ tools: DrawingTools; loft: string; session: EditorSession; server: TestServer }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Square" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 6 }));
  summary(await tools.setCeiling({ height: 3.2 }));
  const loft = summary(await tools.addDeck({ preset: "loft", centre: { x: 3, y: 5 }, width: 2, depth: 1.6 })).result.deck ?? "";
  return { tools, loft, session: claude, server };
}

/** A storage stair (0.60 × 1.99) facing +x with its back edge on the loft's right edge, x 3.6. */
const STAIR = { layout: "s0", kind: "storageStair", centre: { x: 4.595, y: 1.95 }, rotation: 90 } as const;

const stairOf = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id)?.stair;

describe("place_object with a stair kind", () => {
  it("place_object storageStair against the loft's edge with reaches lists \"reaches Loft +2.15, 10 risers of 0.215, going 0.221\" and the headroom warning", async () => {
    const { tools, loft } = await studio();
    const placed = summary(await tools.placeObject({ ...STAIR, reaches: loft }));
    const id = placed.result.object ?? "";
    const s = summary(await tools.getDrawing());
    expect(stairOf(s, id)).toEqual({
      line: "reaches Loft +2.15, 10 risers of 0.215, going 0.221, run 1.99",
      handrails: { left: "railing", right: "railing" },
      warnings: ["Headroom 1.27 m over the flight (1.88 wanted)"],
    });
    expect(Object.values(s.objects.find((o) => o.id === id)?.sizes ?? {}).map((z) => z.height)).toEqual([2.15]); // the domain's linked rise
  });

  it("move_object with reaches links and with \"nothing\" unlinks; place_object without reaches links nothing", async () => {
    const { tools, loft } = await studio();
    // Its back edge on the loft's edge, but no reaches: it reaches nothing (AC-09, AC-15).
    const placed = summary(await tools.placeObject(STAIR));
    const id = placed.result.object ?? "";
    expect(stairOf(placed, id)?.line).toBe("reaches nothing, 10 risers of 0.215, going 0.221, run 1.99");
    const linked = summary(await tools.moveObject({ layout: "s0", object: id, reaches: loft }));
    expect(stairOf(linked, id)?.line).toBe("reaches Loft +2.15, 10 risers of 0.215, going 0.221, run 1.99");
    expect(linked.objects.find((o) => o.id === id)?.placements["s0"]?.centre).toEqual([4.595, 1.95]); // reaches alone keeps it in place
    // Moved and linked in one call, then unlinked: the height stays.
    const moved = summary(await tools.moveObject({ layout: "s0", object: id, centre: { x: 5.095, y: 1.95 }, reaches: "nothing" }));
    expect(stairOf(moved, id)?.line).toBe("reaches nothing, 10 risers of 0.215, going 0.221, run 1.99");
    const back = summary(await tools.moveObject({ layout: "s0", object: id, centre: { x: 4.595, y: 1.95 } }));
    expect(stairOf(back, id)?.line).toBe("reaches nothing, 10 risers of 0.215, going 0.221, run 1.99"); // touching links nothing
  });

  it("move_object refuses reaches on furniture and an unknown deck", async () => {
    const { tools, loft } = await studio();
    const desk = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 5.5, y: 0.5 } })).result.object ?? "";
    expect(await tools.moveObject({ layout: "s0", object: desk, reaches: loft })).toEqual({ text: "Only a stair reaches a deck", isError: true });
    const stair = summary(await tools.placeObject(STAIR)).result.object ?? "";
    const unknown = await tools.moveObject({ layout: "s0", object: stair, reaches: "zz/k9" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("zz/k9");
  });

  it("place_object away from every deck reaches nothing and keeps the kind's height", async () => {
    const { tools } = await studio();
    const s = summary(await tools.placeObject({ ...STAIR, centre: { x: 5.5, y: 1.95 } }));
    expect(stairOf(s, s.result.object ?? "")?.line).toBe("reaches nothing, 10 risers of 0.215, going 0.221, run 1.99");
  });

  it("place_object refuses reaches on furniture and an unknown deck", async () => {
    const { tools, loft } = await studio();
    expect(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 5.5, y: 1.5 }, reaches: loft })).toEqual({ text: "Only a stair reaches a deck", isError: true });
    const unknown = await tools.placeObject({ ...STAIR, reaches: "zz/k9" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("zz/k9");
  });

  it("set_size on a stair sets width and run; the risers follow", async () => {
    const { tools, loft } = await studio();
    const id = summary(await tools.placeObject({ ...STAIR, reaches: loft })).result.object ?? "";
    const s = summary(await tools.setSize({ object: id, width: 0.8, depth: 2.4 }));
    expect(stairOf(s, id)?.line).toBe("reaches Loft +2.15, 10 risers of 0.215, going 0.267, run 2.40");
    // The back edge stays on the loft's edge, so the stair still reaches it.
    expect(stairOf(s, id)?.warnings.some((w) => w.startsWith("Doesn't reach"))).toBe(false);
    const raised = summary(await tools.setDeck({ deck: loft, top: 2.4 }));
    expect(stairOf(raised, id)?.line).toBe("reaches Loft +2.40, 11 risers of 0.218, going 0.240, run 2.40");
  });

  it("placing a stair in one layout shows it in every layout's listing", async () => {
    const { tools } = await studio();
    const night = summary(await tools.addLayout({ name: "Night" })).layouts.find((st) => st.name === "Night")?.id ?? "";
    const s = summary(await tools.placeObject(STAIR));
    const placements = s.objects.find((o) => o.id === s.result.object)?.placements ?? {};
    expect(Object.keys(placements).sort()).toEqual(["s0", night].sort());
    expect(placements["s0"]?.centre).toEqual([4.595, 1.95]);
    expect(placements[night]?.centre).toEqual([4.595, 1.95]);
  });

  it("moved off the loft's edge, the stair keeps its rise and warns \"doesn't reach the Loft\"", async () => {
    const { tools, loft } = await studio();
    const id = summary(await tools.placeObject({ ...STAIR, reaches: loft })).result.object ?? "";
    const s = summary(await tools.moveObject({ layout: "s0", object: id, centre: { x: 5.095, y: 1.95 } }));
    expect(stairOf(s, id)?.line).toBe("reaches Loft +2.15, 10 risers of 0.215, going 0.221, run 1.99");
    expect(stairOf(s, id)?.warnings).toContain("Doesn't reach the Loft");
  });

  it("furniture has no stair line", async () => {
    const { tools } = await studio();
    const s = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 5.5, y: 1.5 } }));
    expect(s.objects.find((o) => o.id === s.result.object)).not.toHaveProperty("stair");
  });
});

/** The flight as stored: its back edge's middle and rotation in `state`, its size and rise, what it reaches and stands on. */
function flightIn(doc: Document | null, id: string, state: string) {
  const o = doc?.objects[id];
  const p = Object.values(doc?.placements ?? {}).find((q) => q.object === id && q.state === state);
  if (o === undefined || p === undefined) throw new Error(`no flight ${id} in ${state}`);
  return { at: p.at, rotation: p.rotation, w: o.w[p.config], d: o.d[p.config], h: heightsOf(o, p.config)?.h, reaches: o.reaches, on: p.deck };
}

describe("add_stair (stairdraw.16, .20, AC-15)", () => {
  it("add_stair places Storage steps at a platform's edge: 3 risers of 0.150 over 0.70, no handrails (steps.03, .16, AC-01)", async () => {
    const { tools } = await studio();
    // A platform at +0.45 over x 5.0–6.6, y 1.5–2.4: its front edge at y 1.5 faces the room.
    const deck = summary(await tools.addDeck({ preset: "platform", centre: { x: 5.8, y: 1.95 }, width: 1.6, depth: 0.9 })).result.deck ?? "";
    const placed = summary(await tools.addStair({ layout: "s0", kind: "storageSteps", deck, at: { x: 5.8, y: 1.5 } }));
    const id = placed.result.objects?.[0] ?? placed.result.object ?? "";
    const object = placed.objects.find((o) => o.id === id);
    expect(object?.kind).toBe("storageSteps");
    expect(object?.sizes["standard"]?.depth).toBeCloseTo(0.7, 6);
    expect(stairOf(placed, id)?.line).toMatch(/3 risers of 0\.150/);
    expect(stairOf(placed, id)?.handrails).toEqual({ left: "none", right: "none" });
    expect(stairOf(placed, id)?.warnings).toEqual([]);
  });

  it("add_stair straight on the loft's edge places what stairOnEdge gives for that point", async () => {
    // Two fixtures where the rules change the answer: a point 4 mm off the loft's right edge, off the grid; and a
    // platform turned 30°, a point 3 mm outside one of its edges and off its middle.
    const loftCase = async () => {
      const { tools, loft, session } = await studio();
      return { tools, session, kind: "storageStair", deck: loft, at: { x: 3.6043, y: 1.3171 } };
    };
    const turnedCase = async () => {
      const { tools, session } = await studio();
      const deck = summary(await tools.addDeck({ preset: "platform", centre: { x: 5.6, y: 1.25 }, width: 1, depth: 0.8, rotation: 30 })).result.deck ?? "";
      const doc = session.drawing();
      if (doc === null) throw new Error("no drawing");
      const edge = stairEdges(doc, null, 0.6).find((e) => e.deck === deck && e.normal.x < -0.5); // the edge facing the loft's side
      if (edge === undefined) throw new Error("no edge facing -x");
      const t = 0.4137;
      const at = { x: edge.a.x + (edge.b.x - edge.a.x) * t + edge.normal.x * 0.003, y: edge.a.y + (edge.b.y - edge.a.y) * t + edge.normal.y * 0.003 };
      return { tools, session, kind: "shipsLadder", deck, at };
    };
    for (const make of [loftCase, turnedCase]) {
      const { tools, session, kind, deck, at } = await make();
      const before = session.drawing();
      if (before === null) throw new Error("no drawing");
      const parts = stairOnEdge(before, { state: "s0", kind, deck, at, shape: "straight", surface: null });
      if (!parts.ok) throw new Error(parts.error);
      expect(parts.value.flights).toHaveLength(1);
      const [flight] = parts.value.flights;
      const placed = summary(await tools.addStair({ layout: "s0", kind, deck, at }));
      const id = placed.result.object ?? "";
      expect(id).toMatch(/\/s0\/o0$/); // the flight's id, read from the patch
      expect(flightIn(session.drawing(), id, "s0")).toEqual({ at: flight?.at, rotation: flight?.rotation, w: flight?.w, d: flight?.d, h: flight?.h, reaches: deck, on: null });
      expect(stairOf(placed, id)?.line.startsWith(`reaches ${placed.decks.find((d) => d.id === deck)?.name} +`)).toBe(true);
    }
  });

  it("add_stair on the loft's edge places what stairOnEdge gives for each shape: straight, l-left and l-right, returning the flights and the landing", async () => {
    // 3 mm below the loft's bottom edge and 1.37 cm off its middle, off the grid.
    const at = { x: 3.0137, y: 4.197 };
    for (const shape of ["straight", "l-left", "l-right"] as const) {
      const { tools, loft, session } = await squareRoom();
      const before = session.drawing();
      if (before === null) throw new Error("no drawing");
      const parts = stairOnEdge(before, { state: "s0", kind: "stair", deck: loft, at, shape, surface: null });
      if (!parts.ok) throw new Error(`${shape}: ${parts.error}`);
      const placed = summary(await tools.addStair({ layout: "s0", kind: "stair", deck: loft, at, shape }));
      const ids = parts.value.landing === null ? [placed.result.object ?? ""] : (placed.result.objects ?? []);
      expect(ids).toHaveLength(parts.value.flights.length);
      expect(placed.result.object).toBe(ids[0]); // the flight on the edge
      const landing = parts.value.landing;
      if (landing === null) {
        expect(placed.result).not.toHaveProperty("deck");
        expect(placed.result).not.toHaveProperty("objects");
      } else {
        // The ids, read from the patch: the landing deck, then the upper flight and the lower.
        const deck = placed.result.deck ?? "";
        expect(deck).toMatch(/\/k0$/);
        expect(ids[0]).toMatch(/\/s0\/o0$/);
        expect(ids[1]).toMatch(/\/s1\/o0$/);
        const stored = session.drawing()?.decks[deck];
        expect(stored && { at: stored.at, w: stored.w, d: stored.d, rotation: stored.rotation, top: stored.top, solid: stored.solid })
          .toEqual({ at: landing.at, w: landing.w, d: landing.d, rotation: landing.rotation, top: landing.top, solid: true });
      }
      const resolve = (id: string | null) => (id === STAIR_LANDING ? placed.result.deck : id);
      for (const [i, f] of parts.value.flights.entries()) {
        const id = ids[i] ?? "";
        expect(flightIn(session.drawing(), id, "s0")).toEqual({ at: f.at, rotation: f.rotation, w: f.w, d: f.d, h: f.h, reaches: resolve(f.reaches), on: null });
        expect(session.drawing()?.objects[id]?.startsAt ?? null).toBe(resolve(f.startsAt) ?? null);
      }
    }
  });

  it("add_stair l-left mirrors l-right: seen from the floor facing the edge, its lower flight is on the left", async () => {
    // Facing the loft's bottom edge from the floor is looking +y, so the left is −x.
    const at = { x: 3, y: 4.2 };
    const lowerX = async (shape: "l-left" | "l-right") => {
      const { tools, loft } = await squareRoom();
      const placed = summary(await tools.addStair({ layout: "s0", kind: "stair", deck: loft, at, shape }));
      const [upper, lower] = placed.result.objects ?? [];
      const centre = (id: string | undefined) => placed.objects.find((o) => o.id === id)?.placements.s0?.centre;
      return { upper: centre(upper), lower: centre(lower) };
    };
    const left = await lowerX("l-left");
    const right = await lowerX("l-right");
    expect(left.upper).toEqual(right.upper);
    const [lx = NaN, ly = NaN] = left.lower ?? [];
    const [rx = NaN, ry = NaN] = right.lower ?? [];
    expect(lx).toBeLessThan(at.x);
    expect(rx).toBeGreaterThan(at.x);
    expect(lx).toBeCloseTo(2 * at.x - rx, 6);
    expect(ly).toBeCloseTo(ry, 6);
  });

  it("get_drawing after an L lists the landing deck and the upper flight starting at it", async () => {
    const { tools, loft } = await squareRoom();
    const placed = summary(await tools.addStair({ layout: "s0", kind: "stair", deck: loft, at: { x: 3, y: 4.2 }, shape: "l-right" }));
    const s = summary(await tools.getDrawing({}));
    const landing = s.decks.find((d) => d.id === placed.result.deck);
    expect(landing).toMatchObject({ name: "Landing", solid: true });
    expect(landing?.width).toBe(landing?.depth);
    const [upper, lower] = placed.result.objects ?? [];
    // The landing's top is 1.075: half the 12 risers to the loft's 2.15.
    expect(landing?.top).toBe(1.075);
    expect(stairOf(s, upper ?? "")?.line).toBe("starts at Landing +1.08, reaches Loft +2.15, 6 risers of 0.179, going 0.272, run 1.36");
    expect(stairOf(s, lower ?? "")?.line.startsWith("reaches Landing +1.08, 6 risers of ")).toBe(true);
  });

  it("add_stair moves Claude's cursor to an L's landing, and to a straight flight's centre", async () => {
    for (const shape of ["l-right", "straight"] as const) {
      const { tools, loft, server, session } = await squareRoom();
      const alice = server.join("Alice").session;
      sessions.push(alice);
      const project = session.project();
      expect(project !== null && (await alice.openProject(project.id)).ok).toBe(true);
      const placed = summary(await tools.addStair({ layout: "s0", kind: "stair", deck: loft, at: { x: 3, y: 4.2 }, shape }));
      await server.settle();
      const landing = placed.result.deck === undefined ? undefined : session.drawing()?.decks[placed.result.deck];
      const [fx = NaN, fy = NaN] = placed.objects.find((o) => o.id === placed.result.object)?.placements.s0?.centre ?? [];
      const at = alice.collaborators().find((c) => c.name === "Claude")?.at;
      if (shape === "straight") {
        expect(at?.x).toBeCloseTo(fx, 3);
        expect(at?.y).toBeCloseTo(fy, 3);
      } else expect(at).toEqual(landing?.at);
    }
  });

  it("add_stair places the flight in every layout state, with shape straight by default or given", async () => {
    const { tools, loft, session } = await studio();
    const night = summary(await tools.addLayout({ name: "Night" })).layouts.find((st) => st.name === "Night")?.id ?? "";
    const id = summary(await tools.addStair({ layout: "s0", kind: "storageStair", deck: loft, at: { x: 3.6, y: 1.3 }, shape: "straight" })).result.object ?? "";
    expect(flightIn(session.drawing(), id, night)).toEqual(flightIn(session.drawing(), id, "s0"));
  });

  it("add_stair refuses a point off any edge that catches, a non-stair kind, and a stair that doesn't fit, each with the domain's reason", async () => {
    const { tools, loft, session } = await studio();
    const ask = { layout: "s0", kind: "storageStair", deck: loft };
    const objects = () => Object.keys(session.drawing()?.objects ?? {}).length;
    // 5 cm off the right edge; on the left edge, flush against the wall.
    expect(await tools.addStair({ ...ask, at: { x: 3.65, y: 1.3 } })).toEqual({ text: "Not on an edge a stair can go up to", isError: true });
    expect(await tools.addStair({ ...ask, at: { x: 0.1, y: 1.25 } })).toEqual({ text: "Not on an edge a stair can go up to", isError: true });
    expect(await tools.addStair({ ...ask, kind: "desk", at: { x: 3.6, y: 1.3 } })).toEqual({ text: "Only a stair or a ladder goes up to a deck", isError: true });
    // A kind that doesn't turn makes no L, worded with its label.
    for (const shape of ["l-left", "l-right"] as const) {
      expect(await tools.addStair({ ...ask, kind: "shipsLadder", at: { x: 3.6, y: 1.3 }, shape })).toEqual({ text: "Ship's ladder doesn't turn", isError: true });
    }
    // A desk in front of the edge: the fit's own reason, the two named in id order (layout-states.56).
    summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 4.8, y: 1.3 } }));
    const before = objects();
    const blocked = await tools.addStair({ ...ask, at: { x: 3.6, y: 1.3 } });
    expect(blocked.isError).toBe(true);
    expect(["Storage stair (0.00–2.15) and Desk (0.00–0.75) overlap in Layout", "Desk (0.00–0.75) and Storage stair (0.00–2.15) overlap in Layout"]).toContain(blocked.text);
    expect(objects()).toBe(before);
    // A 0.45 platform takes 3 risers of a Stair: too few to split into two flights.
    const platform = summary(await tools.addDeck({ preset: "platform", centre: { x: 6.3, y: 1.25 }, width: 1, depth: 1 })).result.deck ?? "";
    expect(await tools.addStair({ ...ask, kind: "stair", deck: platform, at: { x: 5.8, y: 1.25 }, shape: "l-left" })).toEqual({ text: "Too low for an L: each flight needs two risers", isError: true });
  });

  it("add_stair refuses an unknown layout state or deck, naming the id", async () => {
    const { tools, loft } = await studio();
    expect(await tools.addStair({ layout: "zz", kind: "storageStair", deck: loft, at: { x: 3.6, y: 1.3 } })).toEqual({ text: "No layout has the id zz", isError: true });
    expect(await tools.addStair({ layout: "s0", kind: "storageStair", deck: "zz/k9", at: { x: 3.6, y: 1.3 } })).toEqual({ text: "No deck has the id zz/k9", isError: true });
  });
});

describe("a spiral stair (stairs.21, AC-09)", () => {
  it("lists its turn and diameter in place of the going and run; set_size keeps it square", async () => {
    const { tools, loft } = await studio();
    // 1.60 square, facing +x with its back edge on the loft's right edge (x 3.6): x 3.6–5.2, y 0.45–2.05.
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "spiralStair", centre: { x: 4.4, y: 1.25 }, rotation: 90, reaches: loft }));
    const id = placed.result.object ?? "";
    expect(stairOf(placed, id)).toEqual({ line: "reaches Loft +2.15, 10 risers of 0.215, turn 270°, diameter 1.60", handrail: "railing", warnings: ["Headroom 1.05 m over the flight (2.00 wanted)"] });
    const s = summary(await tools.setSize({ object: id, width: 1.4, depth: 1.6 }));
    expect(stairOf(s, id)?.line).toBe("reaches Loft +2.15, 10 risers of 0.215, turn 270°, diameter 1.40");
    expect(Object.values(s.objects.find((o) => o.id === id)?.sizes ?? {}).map((z) => [z.width, z.depth])).toEqual([[1.4, 1.4]]);
  });

  it("place_object on free floor gives a spiral its one zone on the side you walk in from, the back at 2.15 (edge-catch.10, .23, AC-07)", async () => {
    const { tools } = await studio();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "spiralStair", centre: { x: 5.5, y: 1.25 }, rotation: 0 }));
    const sides = Object.values(placed.objects.find((o) => o.id === placed.result.object)?.placements ?? {}).map((p) => p?.sides);
    expect(sides).toEqual([["back"]]);
  });
});

describe("a stair starting at a deck's edge (stairs.49, AC-07)", () => {
  it("names the start deck: \"starts at Platform +1.08, reaches Loft +2.15, 6 risers of 0.178, going 0.274, run 1.37\"", () => {
    // The L's second flight: a 0.90 × 0.90 platform at +1.08 over x 0.73–1.63, y 1.5–2.4; the loft over x 3.0–4.9; the
    // flight between them, its front edge on the platform's right edge and its back edge on the loft's left edge. It
    // reaches the loft; nothing sets startsAt before the gesture's L, so the fixture writes it.
    const cmds: Command[] = [
      ...rectangleRoom({ x: 0, y: 0 }, 5, 2.5, "lr"),
      { type: "setCeiling", height: 3.2 },
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 3.95, y: 1.25 }, w: 1.9, d: 2.3, name: "Loft" },
      { type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.18, y: 1.95 }, w: 0.9, d: 0.9, top: 1.08, name: "Platform" },
      { type: "placeObject", opId: "f2", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 1.37 } }, at: { x: 3, y: 1.95 }, rotation: 270, deck: null, reaches: "loft/k0" },
    ];
    const placed = cmds.reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument());
    const flight = placed.objects["f2/o0"];
    if (!flight) throw new Error("no flight");
    const doc = { ...placed, objects: { ...placed.objects, "f2/o0": { ...flight, startsAt: "plat/k0" } } };
    expect(stairLine(doc, "f2/o0")?.line).toBe("starts at Platform +1.08, reaches Loft +2.15, 6 risers of 0.178, going 0.274, run 1.37");
  });
});

describe("set_stair (AC-07)", () => {
  const placed = async () => {
    const { tools, loft, session } = await studio();
    const id = summary(await tools.placeObject({ layout: "s0", kind: "stair", centre: { x: 5.1, y: 1.25 }, rotation: 90, reaches: loft })).result.object ?? "";
    return { tools, id, session };
  };

  it("sets a target riser, and get_drawing reports the result and the target", async () => {
    const { tools, id } = await placed();
    const s = summary(await tools.setStair({ object: id, riser: 0.16 }));
    expect(s.result.object).toBe(id);
    const line = stairOf(summary(await tools.getDrawing()), id)?.line ?? "";
    expect(line).toContain("14 risers of 0.154, target riser 0.16");
  });

  it("sets a going, keeping the riser and setting the run", async () => {
    const { tools, id } = await placed();
    summary(await tools.setStair({ object: id, going: 0.2 }));
    expect(stairOf(summary(await tools.getDrawing()), id)?.line ?? "").toContain("going 0.200, run 2.20");
  });

  it("takes both as one edit", async () => {
    const { tools, id, session } = await placed();
    const before = session.drawing();
    summary(await tools.setStair({ object: id, riser: 0.16, going: 0.2 }));
    expect(stairOf(summary(await tools.getDrawing()), id)?.line ?? "").toContain("14 risers of 0.154, target riser 0.16, going 0.200, run 2.60");
    expect(before).not.toBe(session.drawing());
  });

  it("clears the target with null", async () => {
    const { tools, id } = await placed();
    summary(await tools.setStair({ object: id, riser: 0.16 }));
    summary(await tools.setStair({ object: id, riser: null }));
    const line = stairOf(summary(await tools.getDrawing()), id)?.line ?? "";
    expect(line).toContain("12 risers");
    expect(line).not.toContain("target");
  });

  it("refuses what Properties refuses, with the reason, and changes nothing", async () => {
    const { tools, id, session } = await placed();
    const before = session.drawing();
    const bad = await tools.setStair({ object: id, riser: 0.05 });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/riser must be between/i);
    expect(session.drawing()).toBe(before);
  });

  it("asks for at least one value, and names an unknown object", async () => {
    const { tools, id } = await placed();
    expect((await tools.setStair({ object: id })).isError).toBe(true);
    const unknown = await tools.setStair({ object: "nope", riser: 0.16 });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("nope");
  });
});

describe("set_stair options (steps.07, AC-07, AC-11)", () => {
  it("set_stair hooks on a rung ladder is one edit; get_drawing lists it; on a stair it is refused with the reason", async () => {
    const { tools, loft } = await studio();
    const placed = summary(await tools.addStair({ layout: "s0", kind: "rungLadder", deck: loft, at: { x: 3.6, y: 1.0 } }));
    const ladder = placed.result.object ?? "";
    const set = summary(await tools.setStair({ object: ladder, hooks: true }));
    expect(set.objects.find((o) => o.id === ladder)?.options).toEqual(["hooks"]);
    const stair = summary(await tools.placeObject(STAIR)).result.object ?? "";
    const refused = await tools.setStair({ object: stair, hooks: true });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Only a rung ladder takes hooks");
  });

  it("set_stair leftEntry on a winder with a riser is one edit; add_stair places a winder with its winders in the stair line", async () => {
    const { tools } = await squareRoom();
    const doc = await tools.getDrawing({});
    const loft = summary(doc).decks?.[0]?.id ?? "";
    const placed = summary(await tools.addStair({ layout: "s0", kind: "winderStair", deck: loft, at: { x: 3, y: 4.2 } }));
    const winder = placed.result.object ?? "";
    expect(stairOf(placed, winder)?.line).toMatch(/12 risers of 0\.179, 3 winders, going 0\.272, run 3\.07/);
    const set = summary(await tools.setStair({ object: winder, riser: 0.18, leftEntry: true }));
    expect(set.objects.find((o) => o.id === winder)?.options).toEqual(["leftEntry"]);
  });
});
