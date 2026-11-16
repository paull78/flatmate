import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { pointInPolygon, signedArea } from "../src/geometry";
import type { Document } from "../src/model";
import { floorRings, interiorPoint, onFloor } from "../src/queries/floor";
import { faceAt, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { A, C, loops, rectDoc, rectLoop } from "./helpers";

// A free column is a hole of the room around its centre: the room's area loses its body (pillars.01, AC-02).

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
type Place = Extract<Command, { type: "placeColumn" }>;
const place = (opId: string, x: number, y: number, extra: Partial<Place> = {}): Place => ({ type: "placeColumn", opId, at: { x, y }, width: 0.3, depth: 0.3, ...extra });

/** The area of the room holding p. */
function areaAt(doc: Document, x: number, y: number): number | null {
  const key = faceAt(doc, { x, y })?.key;
  const z = zones(doc).find((r) => r.face.key === key);
  if (!z) throw new Error(`no room at (${x}, ${y})`);
  return z.area;
}

/** A 6 × 4 m room of 0.20 walls: clear floor 5.80 × 3.80 = 22.04 m². */
const ROOM = rectDoc(0, 0, 6, 4);

describe("a free column's area (AC-02)", () => {
  it("a free 0.30 × 0.30 column takes 0.09 off its room", () => {
    const doc = run(ROOM, place("c", 2, 1));
    expect(validateDocument(doc).ok).toBe(true);
    expect(areaAt(ROOM, 2, 1)).toBeCloseTo(22.04, 9);
    expect(areaAt(doc, 2, 1)).toBeCloseTo(22.04 - 0.09, 9);
  });

  it("a turned one (30°, off-grid centre) too", () => {
    const doc = run(ROOM, place("t", 2.345, 1.234, { rotation: 30 }));
    expect(Math.abs((areaAt(doc, 3, 3) ?? 0) - (22.04 - 0.09))).toBeLessThan(1e-9);
  });

  it("it adds no room", () => {
    const doc = run(ROOM, place("c", 2, 1));
    expect(zones(doc)).toHaveLength(zones(ROOM).length);
    expect(zones(doc)).toHaveLength(1);
  });

  it("two free columns in two rooms each take their own", () => {
    const two = loops(rectLoop("P", 0, 0, 4, 4), rectLoop("Q", 5, 0, 9, 4));
    const doc = run(run(two, place("c", 2, 2)), place("d", 7, 2, { width: 0.4, depth: 0.2, rotation: 45 }));
    expect(zones(doc)).toHaveLength(2);
    expect(Math.abs((areaAt(doc, 1, 1) ?? 0) - ((areaAt(two, 1, 1) ?? 0) - 0.09))).toBeLessThan(1e-9);
    expect(Math.abs((areaAt(doc, 6, 1) ?? 0) - ((areaAt(two, 6, 1) ?? 0) - 0.08))).toBeLessThan(1e-9);
  });

  it("a free column in a room that already has a hole (a wall group): both are subtracted", () => {
    const apartment = loops(A, C);
    const before = areaAt(apartment, 1, 1) ?? 0;
    const doc = run(apartment, place("c", 1.5, 1.5));
    const room = zones(doc).find((z) => z.face.key === faceAt(doc, { x: 1, y: 1 })?.key);
    expect(room?.holes).toHaveLength(2);
    // The core's footprint is 3.20 × 3.20; the apartment's clear floor 9.80 × 7.80.
    expect(before).toBeCloseTo(9.8 * 7.8 - 3.2 * 3.2, 9);
    expect(Math.abs((room?.area ?? 0) - (before - 0.09))).toBeLessThan(1e-9);
  });

  it("removing the column restores the area exactly", () => {
    const doc = run(ROOM, place("t", 2.345, 1.234, { rotation: 30 }));
    const removed = run(doc, { type: "deleteEntities", ids: [{ table: "walls", id: "t/w0" }] });
    expect(removed.walls["t/w0"]).toBeUndefined();
    expect(areaAt(removed, 3, 3)).toBe(areaAt(ROOM, 3, 3));
  });

  it("the room's face key is unchanged by the column (holes.09)", () => {
    const doc = run(ROOM, place("c", 2, 1));
    expect(zones(doc).map((z) => z.face.key)).toEqual(zones(ROOM).map((z) => z.face.key));
  });

  it("the hole's footprint and outline are the column's body, clockwise", () => {
    const doc = run(ROOM, place("c", 2, 1, { width: 0.4, depth: 0.2 }));
    const [hole] = zones(doc)[0]?.holes ?? [];
    const round = (ring: readonly { x: number; y: number }[] | null | undefined) => (ring ?? []).map((p) => [+p.x.toFixed(9), +p.y.toFixed(9)]).sort();
    expect(round(hole?.footprint)).toEqual([[1.8, 0.9], [1.8, 1.1], [2.2, 0.9], [2.2, 1.1]]);
    expect(round(hole?.outline)).toEqual(round(hole?.footprint));
    expect(signedArea(hole?.footprint ?? [])).toBeLessThan(0);
    expect(zones(doc)[0]?.face.holes[0]).toMatchObject({ jointIds: ["c/j0", "c/j1"], wallIds: ["c/w0"] });
  });

  it("the floor rings, onFloor and the label point treat it as a hole", () => {
    // The room's centroid is (3, 2): a column there pushes the label point off it.
    const doc = run(ROOM, place("c", 3, 2, { width: 0.6, depth: 0.6 }));
    const zone = zones(doc)[0];
    if (!zone) throw new Error("no room");
    expect(floorRings(zone).holes).toHaveLength(1);
    expect(onFloor(zone, { x: 3, y: 2 })).toBe(false);
    expect(onFloor(zone, { x: 1, y: 1 })).toBe(true);
    const p = interiorPoint(zone);
    expect(p).not.toBeNull();
    if (p) expect(pointInPolygon(p, zone.holes[0]?.footprint ?? [])).toBe(false);
  });
});
