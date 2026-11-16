import { describe, expect, it } from "vitest";
import { arcPath } from "../src/panels/symbol-svg";

// A palette card's arcs (symbols.16). SVG's sweep flag 1 turns clockwise as seen, and a card shows the world with y up, as
// the canvas does: a world counter-clockwise arc stays counter-clockwise as seen, so its sweep is 0. With sweep 1 every
// partial arc bulged inward: a bathtub's head and a basin's corners were pinched, and only a full circle looked right.

const sweepOf = (d: string | null): string => {
  const flags = /A\S+ \S+ 0 (\d) (\d)/.exec(d ?? "");
  return flags?.[2] ?? "";
};

/** The side of the chord from a to b that the arc's centre lies on, seen on screen: positive is to the left of travel. */
const centreSide = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

describe("arcPath", () => {
  it("draws a quarter arc about its centre: from (r, 0) to (0, r) in the world, sweeping counter-clockwise as seen", () => {
    const d = arcPath({ x: 0, y: 0 }, 1, 0, Math.PI / 2);
    expect(sweepOf(d)).toBe("0");
    // On screen y runs down, so the arc goes from (1, 0) to (0, −1) and its centre (0, 0) lies to the left of that chord as
    // seen, which with y down is a negative cross product. SVG sweep 0 puts the centre on exactly that side.
    expect(centreSide([1, 0], [0, -1], [0, 0])).toBeLessThan(0);
  });

  it("takes the large arc only past a half turn, and keeps a full circle", () => {
    expect(/A\S+ \S+ 0 (\d)/.exec(arcPath({ x: 0, y: 0 }, 1, 0, 1.5 * Math.PI) ?? "")?.[1]).toBe("1");
    expect(/A\S+ \S+ 0 (\d)/.exec(arcPath({ x: 0, y: 0 }, 1, 0, Math.PI / 2) ?? "")?.[1]).toBe("0");
    expect(arcPath({ x: 0, y: 0 }, 1, 0, 2 * Math.PI)?.match(/A/g)).toHaveLength(2);
    expect(arcPath({ x: 0, y: 0 }, 1, 1, 1)).toBeNull();
  });
});
