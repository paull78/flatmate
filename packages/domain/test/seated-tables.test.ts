import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import { canSwitchKind, kindOf, presetSize } from "../src/kinds";
import { clearanceWarnings } from "../src/queries/clearance";
import { parseLayoutObject } from "../src/shape";
import { diningSeats, diningTable, roundChairs, roundSetTable } from "../src/sets";
import { place, rectDoc } from "./helpers";

// Tables with room to sit (seated.01): kinds whose chairs stand clear of the table.

const R = 0.6;

describe("the new table sets", () => {
  it.each([
    ["4 seats", 1.2, 2, 1.2, 0.8, 4],
    ["6 seats", 2.6, 2.1, 1.4, 0.9, 6],
    ["8 seats", 3.2, 2.1, 2, 0.9, 8],
    ["10 seats", 3.8, 2.1, 2.6, 0.9, 10],
  ])("the dining table at %s is %s × %s around a %s × %s table, seating %s (AC-01)", (id, w, d, tw, td, seats) => {
    const size = presetSize("seatedDining", id);
    expect(size?.w.standard).toBeCloseTo(w, 9);
    expect(size?.d.standard).toBeCloseTo(d, 9);
    const table = diningTable(w, d, R);
    expect([table.w, table.d]).toEqual([expect.closeTo(tw, 9), expect.closeTo(td, 9)]);
    expect(diningSeats(table.w)).toBe(seats);
  });

  it.each([["4 seats", 2.16, 0.9, 4], ["6 seats", 2.46, 1.2, 6], ["8 seats", 2.76, 1.5, 8]])("the round table at %s is Ø %s around a Ø %s table, seating %s (AC-02)", (id, D, t, seats) => {
    const size = presetSize("seatedRound", id);
    expect(size?.w.standard).toBeCloseTo(D, 9);
    const table = roundSetTable(D, R);
    expect(table).toBeGreaterThanOrEqual(t - 1e-9);
    expect(table).toBeLessThan(t + 0.02); // the diameter is rounded up to the centimetre
    expect(roundChairs(table)).toBe(seats);
  });

  it("keep the palette's names, and their reach is 0.60", () => {
    expect(kindOf("seatedDining")).toMatchObject({ label: "Dining table with chairs", retired: false, aggregate: { reach: R, chairs: "sides" }, options: ["roundChairs"] });
    expect(kindOf("seatedRound")).toMatchObject({ label: "Round table with chairs", retired: false, outline: "round", aggregate: { reach: R, chairs: "around" }, options: ["roundChairs"] });
  });

  it.each(["seatedDining", "seatedRound"])("%s has a 0.15 m use zone on all four sides by default (AC-03)", (kind) => {
    expect(kindOf(kind)?.sides).toEqual({ front: true, back: true, left: true, right: true });
    expect(kindOf(kind)?.configs[0]?.zone).toBe(0.15);
  });

  it("a wall 0.10 m beyond a long side warns, one 0.20 m beyond doesn't (AC-03)", () => {
    // A 4-seat set, 1.20 × 2.00, its back edge at `at`'s y. The room's top inner face is at y 3.9.
    const warned = (gap: number) => {
      const doc = place(rectDoc(0, 0, 6, 4), { object: "t", kind: "seatedDining", at: [3, 3.9 - gap] });
      return clearanceWarnings(doc, "s0");
    };
    expect(warned(0.1).length).toBeGreaterThan(0);
    expect(warned(0.2)).toEqual([]);
  });
});

describe("the old tables are gone (AC-18, seated.24)", () => {
  it.each(["diningSet", "roundDiningSet"])("%s has no row, can't be placed, and a stored one doesn't parse", (kind) => {
    expect(kindOf(kind)).toBeNull();
    const r = execute(rectDoc(0, 0, 6, 4), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind }, at: { x: 3, y: 2 } });
    expect(r.ok ? "placed" : r.error.message).toBe("Unknown kind");
    const row = { id: "t", kind, name: "Table", w: { standard: 1.2 }, d: { standard: 1.3 }, h: { standard: 0.9 }, z: { standard: 0 } };
    expect(parseLayoutObject(row)).toBeNull();
  });
});

describe("the Kind switch", () => {
  it.each([
    ["extendingTable", "seatedDining"], ["seatedDining", "extendingTable"], ["desk", "deskSet"], ["deskSet", "desk"], ["sofa", "seatedRound"], ["seatedDining", "seatedRound"],
  ])("%s can't switch to %s: a set's size doesn't mean what a plain piece's does", (from, to) => {
    expect(canSwitchKind(from, to)).toBe(false);
  });

  it("other pieces still switch", () => {
    expect(canSwitchKind("sofa", "armchair")).toBe(true);
  });
});
