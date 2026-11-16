import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { clearanceWarnings, execute, useZones, zoneExtent, zoneRings, type Document } from "../src";
import { place, rectDoc, withStoredZone } from "./helpers";

// An `L` piece's front zone (catalog.04, .11, .13; AC-04): two strips at one depth, in front of the left arm's inner
// edge (strip 0) and the back arm's (strip 1), drawn as their union. A 6 × 5 room (inner faces 0.1 / 5.9, 0.1 / 4.9);
// a corner desk "k", arms 0.60, zone 0.80, anchored at (3, 4.9) against the top wall.
//   2.40 × 2.00: x 1.8–4.2, y 2.9–4.9, the inner corner at (2.4, 4.3). Left strip x 2.4–3.2, y 2.9–4.3; back strip
//   x 2.4–4.2, y 3.5–4.3: an L-shaped band.
//   1.60 × 1.20: x 2.2–3.8, y 3.7–4.9, the inner corner at (2.8, 4.3). Left strip x 2.8–3.6, y 3.7–4.3 lies inside the
//   back strip x 2.8–3.8, y 3.5–4.3: a rectangle.

const ID = "k/s0";
const big = (room: Document = rectDoc(0, 0, 6, 5)): Document =>
  place(room, { object: "k", kind: "cornerDesk", at: [3, 4.9], size: { w: { standard: 2.4 }, d: { standard: 2 } } });
const small = (): Document => place(rectDoc(0, 0, 6, 5), { object: "k", kind: "cornerDesk", at: [3, 4.9] });

/** A rectangle's corners as a sorted list of "x,y" strings, to the micrometre. */
const corners = (ring: readonly Point[]): string[] => ring.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort();
const box = (x0: number, y0: number, x1: number, y1: number): string[] => corners([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
const strips = (doc: Document) => (useZones(doc).get(ID) ?? []).map((z) => ({ side: z.side, strip: z.strip, corners: corners(z.quad) }));
const ring = (doc: Document) => zoneRings(doc).get(ID)?.find((z) => z.side === "front")?.ring ?? [];

describe("an L piece's front zone (AC-04)", () => {
  it("2.40 × 2.00: two strips, one in front of each inner edge, whose union is a six-corner L band", () => {
    const doc = big();
    expect(strips(doc)).toEqual([
      { side: "front", strip: 0, corners: box(2.4, 2.9, 3.2, 4.3) },
      { side: "front", strip: 1, corners: box(2.4, 3.5, 4.2, 4.3) },
    ]);
    const r = ring(doc);
    expect(r).toHaveLength(6);
    expect(corners(r)).toEqual(corners([{ x: 2.4, y: 4.3 }, { x: 2.4, y: 2.9 }, { x: 3.2, y: 2.9 }, { x: 3.2, y: 3.5 }, { x: 4.2, y: 3.5 }, { x: 4.2, y: 4.3 }]));
    const area = r.reduce((s, p, i) => { const q = r[(i + 1) % r.length] ?? p; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
    expect(area).toBeCloseTo(0.8 * 1.8 + 0.8 * 0.6, 9); // counter-clockwise, the corner square counted once
  });

  it("1.60 × 1.20: the left strip lies inside the back strip, and the union is the back strip's rectangle", () => {
    const doc = small();
    expect(strips(doc)).toEqual([
      { side: "front", strip: 0, corners: box(2.8, 3.7, 3.6, 4.3) },
      { side: "front", strip: 1, corners: box(2.8, 3.5, 3.8, 4.3) },
    ]);
    expect(corners(ring(doc))).toEqual(box(2.8, 3.5, 3.8, 4.3));
  });

  it("front start trims the left strip from the left arm's front end, end the back strip from the back arm's right end", () => {
    const r = execute(big(), { type: "setZoneExtent", placementId: ID, side: "front", extent: { depth: 0.8, start: 0.3, end: 0.5 } });
    if (!r.ok) throw new Error(r.error.message);
    expect(strips(r.value.doc)).toEqual([
      { side: "front", strip: 0, corners: box(2.4, 3.2, 3.2, 4.3) },
      { side: "front", strip: 1, corners: box(2.4, 3.5, 3.7, 4.3) },
    ]);
  });

  it("each strip keeps 0.10 m: an end leaving less is refused, though start + end exceed the width; a resize clamps when read", () => {
    const set = (start: number, end: number) => execute(big(), { type: "setZoneExtent", placementId: ID, side: "front", extent: { depth: 0.8, start, end } });
    expect(set(0, 1.75)).toMatchObject({ ok: false, error: { message: "A use zone is at least 0.10 m long" } }); // w − t2 = 1.80
    expect(set(1.35, 0)).toMatchObject({ ok: false, error: { message: "A use zone is at least 0.10 m long" } }); // d − t1 = 1.40
    expect(set(1.3, 1.7).ok).toBe(true); // 3.0 > w: a straight zone's rule would refuse it
    const stored = withStoredZone(big(), ID, "front", { depth: 0.8, start: 1.3, end: 1.7 });
    const p = stored.placements[ID];
    expect(p && zoneExtent(stored, p, "front")).toEqual({ depth: 0.8, start: 1.3, end: 1.7 });
    const shrunk = execute(stored, { type: "setObjectSize", objectId: "k", w: 1.6, d: { standard: 1.2 } });
    if (!shrunk.ok) throw new Error(shrunk.error.message);
    const q = shrunk.value.doc.placements[ID];
    const e = q ? zoneExtent(shrunk.value.doc, q, "front") : null;
    expect(e?.start).toBeCloseTo(0.5, 9); // d − t1 − 0.10
    expect(e?.end).toBeCloseTo(0.9, 9); // w − t2 − 0.10
    expect(shrunk.value.doc.placements[ID]?.zones).toMatchObject({ frontDepth: 0.8, frontStart: 1.3, frontEnd: 1.7 });
  });

  it("a piece standing in the left strip only blocks the zone; one in the corner square, in both strips, is reported once", () => {
    const left = place(big(), { object: "n", kind: "nightstand", at: [2.9, 3.4] }); // x 2.675–3.125, y 3.0–3.4
    expect(clearanceWarnings(left, "s0")).toEqual([{ zone: { table: "placements", id: ID, side: "front" }, against: { table: "placements", id: "n/s0" } }]);
    const both = place(big(), { object: "n", kind: "nightstand", at: [2.9, 4.1] }); // y 3.7–4.1
    expect(clearanceWarnings(both, "s0")).toEqual([{ zone: { table: "placements", id: ID, side: "front" }, against: { table: "placements", id: "n/s0" } }]);
  });

  it("an L piece's empty quarter does not block another piece's zone: it blocks by its arms", () => {
    // A wardrobe 1.20 × 0.60 turned 180°, x 2.7–3.9, y 2.1–2.7, its front zone y 2.7–3.3 reaching into the quarter.
    const doc = place(big(), { object: "w", kind: "wardrobe", at: [3.3, 2.1], rotation: 180 });
    expect(clearanceWarnings(doc, "s0")).toEqual([]);
    // Moved up onto the left arm's line: x 1.9–3.1, its zone over the left arm (x 1.8–2.4) is blocked by it.
    const onArm = place(big(), { object: "w", kind: "wardrobe", at: [2.5, 2.1], rotation: 180 });
    expect(clearanceWarnings(onArm, "s0")).toContainEqual({ zone: { table: "placements", id: "w/s0", side: "front" }, against: { table: "placements", id: ID } });
  });
});
