import { describe, expect, it } from "vitest";
import { add, rotateAbout } from "../src/geometry";
import { defaultSize, kindOf, SEAT_BACK } from "../src/kinds";
import { SEATED_REACH, CHAIR_W, deskSetDepth, diningChairsPerSide, diningEnds, diningSeats, diningTable, roundChairs, roundSetDiameter, roundSetTable } from "../src/sets";
import { shapeRing } from "../src/shapes";

// The aggregates' geometry the domain owns (spec "Seating: aggregates", seating.07, .15): chair counts by size, the
// round set's table inside its circle, the desk set's depth.

describe("diningChairsPerSide: max(1, round(w / 0.60)) a side", () => {
  it.each([
    [1.2, 2], [1.4, 2], [1.5, 3], [1.6, 3], [1.8, 3], [2.4, 4], [0.5, 1], [0.1, 1],
  ])("%s m → %s", (w, n) => {
    expect(diningChairsPerSide(w)).toBe(n);
  });
});

describe("the end rule (library.06, AC-04): a chair at each end from a 1.40 m table", () => {
  it.each([
    [1.2, 2, false, 4], [1.39, 2, false, 4], [1.4, 2, true, 6], [2, 3, true, 8], [2.6, 4, true, 10],
  ])("a %s m table: %s a side, ends %s, %s seats", (table, side, ends, seats) => {
    expect(diningChairsPerSide(table)).toBe(side);
    expect(diningEnds(table)).toBe(ends);
    expect(diningSeats(table)).toBe(seats);
  });

  it("the table inside the piece: less a backrest at each side, and at each end when its length with end chairs is 1.40 or more", () => {
    expect(diningTable(1.2, 1, SEAT_BACK)).toEqual({ w: 1.2, d: expect.closeTo(0.8, 9), ends: false });
    expect(diningTable(1.6, 1.1, SEAT_BACK)).toEqual({ w: expect.closeTo(1.4, 9), d: expect.closeTo(0.9, 9), ends: true });
    expect(diningTable(2.8, 1.1, SEAT_BACK)).toEqual({ w: expect.closeTo(2.6, 9), d: expect.closeTo(0.9, 9), ends: true });
    // A 1.50 piece would leave a 1.30 table with end chairs: no ends, the table is the piece's length.
    expect(diningTable(1.5, 1.1, SEAT_BACK)).toEqual({ w: 1.5, d: expect.closeTo(0.9, 9), ends: false });
  });

  it("the dining set's presets: 4 seats 1.20 × 2.00, 6 seats 2.60 × 2.10, 8 seats 3.20 × 2.10, 10 seats 3.80 × 2.10, seating what they name", () => {
    const presets = kindOf("seatedDining")?.presets ?? [];
    expect(presets.map((p) => [p.id, p.w, p.d.standard, p.seats])).toEqual([
      ["4 seats", 1.2, 2, 4], ["6 seats", 2.6, 2.1, 6], ["8 seats", 3.2, 2.1, 8], ["10 seats", 3.8, 2.1, 10],
    ]);
    for (const p of presets) expect(diningSeats(diningTable(p.w, p.d.standard ?? 0, SEATED_REACH).w), p.id).toBe(p.seats);
  });
});

describe("roundChairs: 4 under a 1.10 m table, 6 under 1.40, else 8", () => {
  it.each([
    [0.9, 4], [1, 4], [1.0999, 4], [1.1, 6], [1.2, 6], [1.3, 6], [1.4, 8], [1.5, 8],
  ])("%s m → %s", (t, n) => {
    expect(roundChairs(t)).toBe(n);
  });
});

describe("the chair's size has one owner", () => {
  it("CHAIR_W is the chair kind's default width", () => {
    expect(CHAIR_W).toBe(defaultSize("chair")?.w.standard);
  });
});

describe("roundSetTable and roundSetDiameter", () => {
  const tables = Array.from({ length: 29 }, (_, i) => 0.6 + i * 0.05);

  it("are exact inverses for tables 0.60 to 2.00 m", () => {
    for (const t of tables) {
      expect(roundSetTable(roundSetDiameter(t, SEAT_BACK), SEAT_BACK), String(t)).toBeGreaterThanOrEqual(t - 1e-9);
      expect(roundSetTable(roundSetDiameter(t, SEAT_BACK), SEAT_BACK), String(t)).toBeCloseTo(t, 12);
      const D = roundSetDiameter(t, SEAT_BACK);
      expect(roundSetDiameter(roundSetTable(D, SEAT_BACK), SEAT_BACK), String(t)).toBeCloseTo(D, 12);
    }
  });

  it("grow with each other, and the piece is larger than the table", () => {
    for (const t of tables) expect(roundSetDiameter(t, SEAT_BACK)).toBeGreaterThan(t);
    tables.slice(1).forEach((t, i) => expect(roundSetDiameter(t, SEAT_BACK)).toBeGreaterThan(roundSetDiameter(tables[i] ?? 0, SEAT_BACK)));
  });

  it("the table is never negative, even in a piece too small for a chair", () => {
    for (const D of [0.1, 0.3, 0.5]) expect(roundSetTable(D, SEAT_BACK), String(D)).toBeGreaterThanOrEqual(0);
  });

  it("every chair, fully tucked (its back strip flush at the table's radius), has its backrest corners inside the piece's fit ring, at any angle", () => {
    for (const t of tables) {
      const D = roundSetDiameter(t, SEAT_BACK);
      const r = roundSetTable(D, SEAT_BACK) / 2;
      const ring = shapeRing("round", D, D); // footprint space: the centre is (0, −D/2)
      const centre = { x: 0, y: -D / 2 };
      for (let k = 0; k < 64; k++) {
        const angle = (k / 64) * 360;
        for (const sx of [-1, 1]) {
          const corner = rotateAbout(add(centre, { x: (sx * CHAIR_W) / 2, y: r + SEAT_BACK }), centre, angle);
          expect(insideConvex(ring, corner, 1e-9), `t ${t} angle ${angle}`).toBe(true);
        }
      }
    }
  });

  it("the round set's presets hold tables of at least 0.90, 1.20 and 1.50 m, with 4, 6 and 8 chairs", () => {
    const presets = kindOf("seatedRound")?.presets ?? [];
    expect(presets.map((p) => p.id)).toEqual(["4 seats", "6 seats", "8 seats"]);
    const tablesIn = presets.map((p) => roundSetTable(p.w, SEATED_REACH));
    [0.9, 1.2, 1.5].forEach((t, i) => expect(tablesIn[i] ?? 0).toBeGreaterThanOrEqual(t - 1e-9));
    expect(tablesIn.map(roundChairs)).toEqual([4, 6, 8]);
    // Rounded up to the centimetre: each is the smallest whole centimetre holding its table.
    for (const [i, t] of [0.9, 1.2, 1.5].entries()) {
      const p = presets[i];
      expect(p?.w).toBe(p?.d.standard);
      expect(roundSetTable((p?.w ?? 0) - 0.01, SEATED_REACH)).toBeLessThan(t);
    }
  });
});

describe("deskSetDepth", () => {
  it("is the desk's depth plus the chair's backrest", () => {
    expect(deskSetDepth(0.6)).toBeCloseTo(0.7, 12);
    expect(deskSetDepth(0.8)).toBeCloseTo(0.8 + SEAT_BACK, 12);
  });
});

/** Whether `p` lies inside the counter-clockwise convex ring, within `eps`. */
function insideConvex(ring: readonly { x: number; y: number }[], p: { x: number; y: number }, eps: number): boolean {
  return ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -eps;
  });
}
