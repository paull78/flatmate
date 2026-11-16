import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import type { OrCeiling } from "../src/kinds";
import { CEILING_ID, type Document, type Wall } from "../src/model";
import { execute } from "../src/commands/execute";
import { landing } from "../src/queries/landing";
import { levelOf } from "../src/queries/levels";
import { footprintFit, placementFit, type PlacementFit } from "../src/queries/fit";
import { footprintQuad, quadCentre } from "../src/queries/footprints";
import { faceAt } from "../src/queries/zones";
import { placementRange } from "../src/queries/vertical";
import { freeFloor, furnishedRooms } from "../src/queries/free-floor";
import { placedShape } from "../src/shapes";
import { validateDocument } from "../src/validate";
import { place, tinyHouse, withDeck } from "./helpers";

// Pieces against decks (spec "Standing on a deck", decks.04, .11, .15): a piece on a deck lies inside it (instead of
// inside one room), collides with no deck in height, and lies wholly below the underside of a deck it overlaps but
// doesn't stand on. Each case is asked of validation and of footprintFit, which must agree (heights.27).
//
// The tiny house: inner faces x 0.1 and 6.9, y 0.1 and 2.4, a 2.03 m partition P on x = 2 (body x 1.9–2.1).
// The loft (top 2.15, underside 2.03) spans P: x 0.8–3.2, y 0.6–2.4, flush with the top wall's inner face.
// The platform (solid, top 0.45) stands in the main room: x 3.5–5.5, y 0.55–1.95.

const LOFT = { id: "loft", name: "Loft", at: [2, 1.5] as [number, number], w: 2.4, d: 1.8, top: 2.15, solid: false };
const PLATFORM = { id: "plat", name: "Platform", at: [4.5, 1.25] as [number, number], w: 2, d: 1.4, top: 0.45, solid: true };
const withLoft = (): Document => withDeck(tinyHouse(), LOFT);
const withPlatform = (): Document => withDeck(tinyHouse(), PLATFORM);
const size = (w: number, d: number, h: number, z: OrCeiling = 0) => ({ w: { standard: w }, d: { standard: d }, h: { standard: h }, z: { standard: z } });
const MATTRESS = size(2.4, 1.6, 0.35); // 2.40 × 1.60, 0.35 high
const SOFA = size(1.8, 0.9, 0.8);

/** Validation's texts for a document, or [] when valid. */
const refusals = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => v.message);
};

/** footprintFit for a placement already in `doc`, ignoring itself, on its own surface. */
function fitOf(doc: Document, id: string): PlacementFit {
  const p = doc.placements[id];
  const o = p && doc.objects[p.object];
  const w = p && o?.w[p.config];
  const d = p && o?.d[p.config];
  const h = p && o?.h[p.config];
  const z = p && o?.z[p.config];
  if (!p || !o || w === undefined || d === undefined || h === undefined || z === undefined) throw new Error(`no piece ${id}`);
  const centre = quadCentre(footprintQuad(p.at, w, d, p.rotation));
  return footprintFit(doc, placedShape(o.kind, p.at, w, d, p.rotation), p.state, { h, z }, p.deck, [id], centre);
}

/** Validation's texts and footprintFit's answer for the one placement `id` in `doc`. */
const judged = (doc: Document, id: string): { refusals: string[]; fit: PlacementFit } => ({ refusals: refusals(doc), fit: fitOf(doc, id) });
const accepted = { refusals: [], fit: { fits: true, reason: null } };

describe("pieces against decks", () => {
  it("the fixtures are valid", () => {
    expect(refusals(withLoft())).toEqual([]);
    expect(refusals(withPlatform())).toEqual([]);
  });

  it("a piece standing on a deck touches it and doesn't collide", () => {
    const doc = place(withPlatform(), { object: "sofa", kind: "sofa", at: [4.5, 1.95], state: "Day", size: SOFA, deck: "plat" }); // x 3.6–5.4, y 1.05–1.95
    expect(judged(doc, "sofa/Day")).toEqual(accepted);
    expect(placementFit(withPlatform(), { kind: "sofa", state: "Day", at: { x: 4.5, y: 1.95 }, rotation: 0, config: "standard", w: 1.8, d: 0.9, surface: "plat" })).toEqual({ fits: true, reason: null });
  });

  it("a sofa on the floor over a solid platform collides with the piece–deck text", () => {
    const doc = place(withPlatform(), { object: "sofa", kind: "sofa", at: [4.5, 1.95], state: "Day", size: SOFA, deck: null });
    expect(judged(doc, "sofa/Day")).toEqual({ refusals: ["Sofa (0.00–0.80) and Platform (0.00–0.45) overlap in Day"], fit: { fits: false, reason: "deck" } });
    // Half on it, half off, still collides; beside it, touching its edge, fits.
    expect(fitOf(place(withPlatform(), { object: "sofa", kind: "sofa", at: [3.5, 1.95], state: "Day", size: SOFA, deck: null }), "sofa/Day")).toEqual({ fits: false, reason: "deck" });
    expect(judged(place(withPlatform(), { object: "sofa", kind: "sofa", at: [4.5, 2.4], state: "Day", size: size(1.8, 0.45, 0.8), deck: null }), "sofa/Day")).toEqual(accepted);
  });

  it("a desk on the floor under a loft fits (0.75 < 2.03), across the loft's edge too", () => {
    expect(judged(place(withLoft(), { object: "desk", kind: "desk", at: [3, 2.4], state: "Day", deck: null }), "desk/Day")).toEqual(accepted); // x 2.4–3.6
    expect(judged(place(withLoft(), { object: "desk", kind: "desk", at: [2.75, 2.4], state: "Day", deck: null }), "desk/Day")).toEqual(accepted); // x 2.15–3.35
  });

  it("a wardrobe (2.05) under a loft (2.03) collides; one 2.03 tall touches the underside and fits", () => {
    const tall = place(withLoft(), { object: "w", kind: "wardrobe", at: [3, 2.4], state: "Day", deck: null });
    expect(judged(tall, "w/Day")).toEqual({ refusals: ["Wardrobe (0.00–2.05) and Loft (2.03–2.15) overlap in Day"], fit: { fits: false, reason: "deck" } });
    const flush = place(withLoft(), { object: "w", kind: "wardrobe", at: [3, 2.4], state: "Day", size: size(1.2, 0.6, 2.15 - 0.12), deck: null });
    expect(judged(flush, "w/Day")).toEqual(accepted);
  });

  it("a bed on a loft lies inside it: 1 mm outside accepted, 2 mm refused \"Bed lies outside Loft in Night\"", () => {
    const bed = (x: number): Document => place(withLoft(), { object: "bed", kind: "bed", at: [x, 2.4], state: "Night", size: MATTRESS, deck: "loft" });
    expect(judged(bed(2), "bed/Night")).toEqual(accepted); // flush with the loft's sides: x 0.8–3.2
    expect(judged(bed(2.001), "bed/Night")).toEqual(accepted);
    expect(judged(bed(2.002), "bed/Night")).toEqual({ refusals: ["Bed lies outside Loft in Night"], fit: { fits: false, reason: "outsideDeck" } });
    expect(judged(bed(1.998), "bed/Night")).toEqual({ refusals: ["Bed lies outside Loft in Night"], fit: { fits: false, reason: "outsideDeck" } });
  });

  it("a bed on a loft over the bathroom partition is accepted though it spans two rooms; on the floor it meets the partition", () => {
    // Flush with the top wall on a loft flush with the same wall (AC-05), its middle on the partition's centreline.
    const on = place(withLoft(), { object: "bed", kind: "bed", at: [2, 2.4], state: "Night", size: MATTRESS, deck: "loft" });
    expect(judged(on, "bed/Night")).toEqual(accepted);
    const floor = place(withLoft(), { object: "bed", kind: "bed", at: [2, 2.4], state: "Night", size: MATTRESS, deck: null });
    expect(judged(floor, "bed/Night")).toEqual({ refusals: ["Bed (0.00–0.35) overlaps a 2.03 m wall in Night"], fit: { fits: false, reason: "wall" } });
  });

  it("a bed on a turned platform lies inside it within the tolerance, and may overhang it (steps.06; the reach in stands-on.test.ts)", () => {
    // A platform turned 90°: x 3.8–5.2, y 0.25–2.25; a 1.40 × 2.00 bed on it, back on y 2.25.
    const turned = withDeck(tinyHouse(), { ...PLATFORM, rotation: 90 });
    const bed = (y: number): Document => place(turned, { object: "bed", kind: "bed", at: [4.5, y], state: "Night", size: size(1.4, 2, 0.35), deck: "plat" });
    expect(judged(bed(2.25), "bed/Night")).toEqual(accepted);
    expect(judged(bed(2.2509), "bed/Night")).toEqual(accepted);
    expect(judged(bed(2.252), "bed/Night")).toEqual(accepted);
    // Flush with the top wall's face (y 2.4), 0.15 past the platform: still on it.
    expect(judged(bed(2.4), "bed/Night")).toEqual(accepted);
  });

  it("a lift bed on the floor with Up = \"ceiling\" overlapping a loft hangs under the loft's underside (beams.06), and from the ceiling where it doesn't overlap it", () => {
    const lift = (x: number, config: string): Document => place(withLoft(), { object: "lift", kind: "liftBed", at: [x, 2.4], state: "Day", config, deck: null });
    expect(judged(lift(3.5, "up"), "lift/Day")).toEqual(accepted); // x 2.65–4.35
    expect(placementRange(lift(3.5, "up"), "lift/Day")).toEqual({ bottom: 2.03 - 0.35, top: 2.03 });
    expect(judged(lift(4.05, "up"), "lift/Day")).toEqual(accepted); // x 3.2–4.9: touches the loft's edge
    expect(judged(lift(3.5, "down"), "lift/Day")).toEqual(accepted); // 0.20–0.55, below the loft
  });

  it("a piece hanging above a platform it doesn't stand on is refused; standing on it, it fits", () => {
    const shelf = (deck: string | null): Document => place(withPlatform(), { object: "s", kind: "block", at: [4.5, 1.95], state: "Day", size: size(0.6, 0.35, 0.5, 1.4 - (deck ? 0.45 : 0)), deck });
    expect(judged(shelf(null), "s/Day")).toEqual({ refusals: ["Custom box (1.40–1.90) is above Platform in Day, which it doesn't stand on"], fit: { fits: false, reason: "deck" } });
    expect(judged(shelf("plat"), "s/Day")).toEqual(accepted);
  });

  it("a piece on a loft past the ceiling is refused with the ceiling text", () => {
    const wardrobe = place(withLoft(), { object: "w", kind: "wardrobe", at: [2.5, 2.4], state: "Night", deck: "loft" }); // x 1.9–3.1
    expect(judged(wardrobe, "w/Night")).toEqual({ refusals: ["Wardrobe reaches 4.20 m in Night; the ceiling is 2.50 m"], fit: { fits: false, reason: "ceiling" } });
    const low = place(withLoft(), { object: "w", kind: "wardrobe", at: [2.5, 2.4], state: "Night", size: size(1.2, 0.6, 0.35), deck: "loft" });
    expect(judged(low, "w/Night")).toEqual(accepted);
  });

  it("a piece on a deck still collides with another piece on it, and with a full wall first", () => {
    let doc = place(withPlatform(), { object: "sofa", kind: "sofa", at: [4.5, 1.95], state: "Day", size: SOFA, deck: "plat" });
    doc = place(doc, { object: "t", kind: "coffeeTable", at: [4.5, 1.5], state: "Day", deck: "plat" }); // y 1.0–1.5, into the sofa
    expect(judged(doc, "t/Day")).toEqual({ refusals: ["Coffee table (0.45–0.90) and Sofa (0.45–1.25) overlap in Day"], fit: { fits: false, reason: "object" } });
    const flush = withDeck(tinyHouse(), { ...PLATFORM, at: [5.9, 1.7] }); // x 4.9–6.9, y 1.0–2.4, flush with two walls
    const onFlush = (x: number): Document => place(flush, { object: "c", kind: "chair", at: [x, 2.4], state: "Day", deck: "plat" });
    expect(judged(onFlush(6.675), "c/Day")).toEqual(accepted); // x 6.45–6.90: flush with the same wall as its platform
    expect(fitOf(onFlush(6.7), "c/Day")).toEqual({ fits: false, reason: "wall" }); // into the wall, and off the platform
    expect(refusals(onFlush(6.7))[0]).toBe("Chair (0.45–1.35) overlaps a wall in Day");
  });
});

describe("a piece hung from the ceiling on its own deck (review of decks.04)", () => {
  // Its own deck is solid up to its top for it: a "ceiling" elevation can put its bottom below the deck's top.
  const withCeiling = (doc: Document, height: number): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, height } } });

  it("a 2.30 box hung from the ceiling on a 0.45 platform (0.20–2.50) is refused with the piece–deck text", () => {
    const box = (h: number): Document => place(withPlatform(), { object: "b", kind: "block", at: [4.5, 1.95], state: "Day", size: size(0.6, 0.6, h, "ceiling"), deck: "plat" });
    expect(judged(box(2.3), "b/Day")).toEqual({ refusals: ["Custom box (0.20–2.50) and Platform (0.00–0.45) overlap in Day"], fit: { fits: false, reason: "deck" } });
    expect(judged(box(2.05), "b/Day")).toEqual(accepted); // 0.45–2.50: on the top exactly
    expect(judged(box(2.0505), "b/Day")).toEqual(accepted); // 0.5 mm into it: within the tolerance
    expect(judged(box(2.052), "b/Day")).toEqual({ refusals: ["Custom box (0.45–2.50) and Platform (0.00–0.45) overlap in Day"], fit: { fits: false, reason: "deck" } });
  });

  it("a lift bed Up on a loft under a 2.40 ceiling (2.05–2.40) is refused through the loft", () => {
    const lift = (ceiling: number): Document =>
      place(withCeiling(withLoft(), ceiling), { object: "lift", kind: "liftBed", at: [2, 2.4], state: "Day", config: "up", size: { w: { up: 2.4, down: 2.4 }, d: { up: 1.6, down: 1.6 } }, deck: "loft" });
    expect(judged(lift(2.4), "lift/Day")).toEqual({ refusals: ["Lift bed (2.05–2.40) and Loft (2.03–2.15) overlap in Day"], fit: { fits: false, reason: "deck" } });
    expect(judged(lift(2.5), "lift/Day")).toEqual(accepted); // 2.15–2.50: on the loft's top
  });

  it("landing answers the floor for a new lift bed Up there, and validation accepts it under the loft (beams.06)", () => {
    const doc = withCeiling(withLoft(), 2.4);
    const ring = placedShape("liftBed", { x: 3.5, y: 2.4 }, 1.7, 2.1, 0); // x 2.65–4.35: across the loft's edge
    const centre = quadCentre(footprintQuad({ x: 3.5, y: 2.4 }, 1.7, 2.1, 0));
    const up = { h: 0.35, z: "ceiling" as const };
    expect(landing(doc, { state: "Day", ring, parts: [ring], heights: up, current: undefined, ignore: [], centre }, levelOf(doc, null))).toEqual({ kind: "surface", deck: null });
    const onFloor = place(doc, { object: "lift", kind: "liftBed", at: [3.5, 2.4], state: "Day", config: "up", deck: null });
    expect(refusals(onFloor)).toEqual([]);
    // Inside the loft, viewing the loft, it lands on it under a 2.50 ceiling; viewing the floor, the loft is no
    // candidate (levels.08). Under 2.40 nothing fits: the floor, refused.
    const inside = placedShape("liftBed", { x: 2, y: 2.4 }, 2.4, 1.6, 0);
    const middle = quadCentre(footprintQuad({ x: 2, y: 2.4 }, 2.4, 1.6, 0));
    const high = withCeiling(withLoft(), 2.5);
    const insideLoft = { state: "Day", ring: inside, parts: [inside], heights: up, current: undefined, ignore: [], centre: middle };
    expect(landing(high, insideLoft, levelOf(high, "loft"))).toEqual({ kind: "surface", deck: "loft" });
    expect(landing(high, insideLoft, levelOf(high, null))).toEqual({ kind: "surface", deck: null });
    expect(landing(doc, insideLoft, levelOf(doc, null))).toEqual({ kind: "surface", deck: null });
  });

  it("lowering the ceiling to 2.30 under a ceiling-hung bed on a loft is refused", () => {
    // x 2.2–3.2, clear of the partition, which a bed down to 1.95 would also meet.
    const doc = place(withLoft(), { object: "lift", kind: "liftBed", at: [2.7, 2.4], state: "Day", config: "up", size: { w: { up: 1, down: 1 }, d: { up: 1.6, down: 1.6 } }, deck: "loft" });
    expect(refusals(doc)).toEqual([]);
    const r = execute(doc, { type: "setCeiling", height: 2.3 });
    expect(r.ok ? "accepted" : r.error.message).toBe("Lift bed (1.95–2.30) and Loft (2.03–2.15) overlap in Day");
    expect(execute(doc, { type: "setCeiling", height: 2.5 }).ok).toBe(true);
  });
});

describe("free floor with pieces on decks (decks.04)", () => {
  // The partition lowered to 0.30 and a hollow deck (0.33–0.45) across it: x 1–3, y 0.55–1.95.
  const low = (): Document => {
    const doc = tinyHouse();
    const p: Wall | undefined = doc.walls.P;
    if (!p) throw new Error("no partition");
    return withDeck({ ...doc, walls: { ...doc.walls, P: { ...p, top: 0.3 } } }, { id: "k", name: "Step", at: [2, 1.25], w: 2, d: 1.4, top: 0.45, solid: false });
  };
  const roomAt = (doc: Document, p: Point): string => faceAt(doc, p)?.key ?? "none";

  it("a piece on a deck spanning two rooms takes free floor in the room holding its centre", () => {
    const base = low();
    expect(refusals(base)).toEqual([]);
    const main = roomAt(base, { x: 4, y: 1 });
    const bath = roomAt(base, { x: 1, y: 1 });
    const doc = place(base, { object: "t", kind: "coffeeTable", at: [2.3, 1.6], state: "Day", deck: "k" }); // x 1.8–2.8, centre (2.3, 1.35)
    expect(refusals(doc)).toEqual([]);
    const before = freeFloor(base, "Day");
    const after = freeFloor(doc, "Day");
    expect((before.get(main) ?? 0) - (after.get(main) ?? 0)).toBeCloseTo(0.5, 9);
    expect(after.get(bath)).toBe(before.get(bath));
    expect([...furnishedRooms(doc)]).toEqual([main]);
  });
});
