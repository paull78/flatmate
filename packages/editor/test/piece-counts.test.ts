import { describe, expect, it } from "vitest";
import { sofaSeats } from "../src/view/piece-counts";

// The sofa's seat count, shared by the plan symbol and the 3D cushions (seating.03).
describe("piece counts", () => {
  it("sofa seats at 0.70 m", () => {
    // 0.70 m a seat between min(0.15, w/4) arms: 2 under 2.05 m, 3 to 2.75 m, then 4; half seats round up.
    const widths = [1.5, 1.8, 2.04, 2.05, 2.1, 2.74, 2.75, 2.8, 0.3];
    expect(widths.map(sofaSeats)).toEqual([2, 2, 2, 3, 3, 3, 4, 4, 1]);
    // A computed 2.05 m, stored as 2.0499999999999994 (2.4999… seats), still rounds up.
    expect(sofaSeats(2.05 + 1.98 - 1.98)).toBe(3);
  });
});
