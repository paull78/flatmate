import { describe, expect, it } from "vitest";
import type { Document } from "../src/model";
import { interiorPoint, onFloor } from "../src/queries/floor";
import { faceAt, zones, type Zone } from "../src/queries/zones";
import { loops, rectDoc, rectLoop, type Spec } from "./helpers";

/** Apartment A (0..10 × 0..8) round core C (3.5..6.5 × 2.5..5.5, moved dx along x); all walls 0.20 m. */
function apartmentWithCore(dx = 0, labels: Spec["labels"] = []): Document {
  return loops(rectLoop("A", 0, 0, 10, 8), rectLoop("C", 3.5 + dx, 2.5, 6.5 + dx, 5.5), { labels });
}

function zoneWith(doc: Document, wallId: string): Zone {
  const z = zones(doc).find((zone) => zone.face.wallIds.includes(wallId));
  if (!z) throw new Error(`no zone with ${wallId}`);
  return z;
}

function expectAt(p: { x: number; y: number } | null, x: number, y: number, digits: number): void {
  expect(p?.x).toBeCloseTo(x, digits);
  expect(p?.y).toBeCloseTo(y, digits);
}

describe("onFloor", () => {
  it("counts hole footprints as off the floor", () => {
    const apartment = zoneWith(apartmentWithCore(), "A1");
    expect(onFloor(apartment, { x: 1, y: 1 })).toBe(true);
    expect(onFloor(apartment, { x: 3.3, y: 4 })).toBe(true);
    expect(onFloor(apartment, { x: 5, y: 4 })).toBe(false); // core interior
    expect(onFloor(apartment, { x: 3.45, y: 4 })).toBe(false); // core wall body: outside the outline, inside the footprint
    expect(onFloor(apartment, { x: 0.05, y: 4 })).toBe(false); // the apartment's own wall body
  });

  it("falls back to centrelines when the area is unavailable", () => {
    // The group's 0.50 m walls reach to x = 0.05, past the room's floor edge at 0.1 (AC-05).
    const room = zoneWith(loops(rectLoop("R", 0, 0, 4, 3), rectLoop("G", 0.3, 1, 1.3, 2, 0.5)), "R1");
    expect(room.floor).toBeNull();
    expect(room.area).toBeNull();
    expect(onFloor(room, { x: 0.2, y: 1.5 })).toBe(true); // outside the outline, though inside the 0.05..1.55 footprint
    expect(onFloor(room, { x: 0.8, y: 1.5 })).toBe(false);
  });
});

describe("interiorPoint", () => {
  it("is the centroid when it is on the floor", () => {
    expectAt(interiorPoint(zoneWith(rectDoc(0, 0, 6, 4), "W1")), 3, 2, 9);
  });

  it("skips a centred core and breaks the span tie to the left", () => {
    // Without the core it would be the centroid (5, 4); the spans [0.1, 3.4] and [6.6, 9.9] differ only by float noise.
    expectAt(interiorPoint(zoneWith(loops(rectLoop("A", 0, 0, 10, 8)), "A1")), 5, 4, 9);
    expectAt(interiorPoint(zoneWith(apartmentWithCore(), "A1")), 1.75, 4, 6);
  });

  it("takes the widest span, not the first", () => {
    // Footprint 2.4..5.6 holds the centroid (5, 4); spans [0.1, 2.4] and [5.6, 9.9].
    expectAt(interiorPoint(zoneWith(apartmentWithCore(-1), "A1")), 7.75, 4, 6);
  });

  it("uses a vertical span when no horizontal span is wider than 2·EPS", () => {
    // A flush core: its footprint touches the room's floor on both sides, so the spans at y = 5 have no width.
    const room = zoneWith(loops(rectLoop("R", 0, 0, 4, 10), rectLoop("C", 0.2, 3.5, 3.8, 6.5)), "R1");
    expect(room.area).toBeCloseTo(37.24 - 12.16, 6);
    // Vertical spans at x = 2: [0.1, 3.4] and [6.6, 9.9] tie, so the lower wins.
    expectAt(interiorPoint(room), 2, 1.75, 6);

    // Here float noise leaves a sliver of about 1e-16 m between the floor's edge and the footprint at x = 0.1: on the
    // floor, but not a span. The vertical spans at x = 2.15 are [0.1, 1.9] and [5.1, 9.9].
    const noisy = zoneWith(loops(rectLoop("R", 0, 0, 4.3, 10), rectLoop("C", 0.2, 2, 4.1, 5)), "R1");
    expect(noisy.area).not.toBeNull();
    expectAt(interiorPoint(noisy), 2.15, 7.5, 6);
  });

  it("skips a candidate on a footprint's edge", () => {
    // Core 3.5..6.5 × 1.1..3.9: its footprint's top edge is at y = 4, through the centroid (5, 4). The horizontal span
    // at y = 4 runs along that edge, so its midpoint is (5, 4) too; the vertical span [4, 7.9] at x = 5 gives (5, 5.95).
    const doc = loops(rectLoop("A", 0, 0, 10, 8), rectLoop("C", 3.5, 1.1, 6.5, 3.9));
    expectAt(interiorPoint(zoneWith(doc, "A1")), 5, 5.95, 6);
  });

  it("in a nested room avoids its own hole", () => {
    const doc = loops(rectLoop("A", 0, 0, 10, 8), rectLoop("C", 3.5, 2.5, 6.5, 5.5), rectLoop("K", 4.7, 3.7, 5.3, 4.3, 0.1));
    // The stairwell's centroid (5, 4) is in column K's footprint 4.65..5.35; spans [3.6, 4.65] and [5.35, 6.4] tie.
    expectAt(interiorPoint(zoneWith(doc, "C1")), 4.125, 4, 6);
  });

  it("of an unavailable room uses centreline rings", () => {
    const doc = loops(rectLoop("R", 0, 0, 1, 1, 0.5), rectLoop("G", 0.4, 0.4, 0.6, 0.6, 0.5));
    const room = zoneWith(doc, "R1");
    expect(room.area).toBeNull();
    const p = interiorPoint(room);
    expectAt(p, 0.2, 0.5, 9);
    expect(p && faceAt(doc, p)?.key).toBe(room.face.key);
  });
});
