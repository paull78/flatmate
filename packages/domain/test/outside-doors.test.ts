import { describe, expect, it } from "vitest";
import { emptyDocument, execute, outsideDoors, rectangleRoom, type Command, type Document } from "../src";

// The doors that open to the outside (trailer.06, .15; AC-05): a door-type opening on a floor wall with no room on one
// side, its span on that side's face and the normal pointing out. The editor draws steps from these.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
/** A 7 × 2.5 room of 0.20 m walls on centrelines; c-1/w0 runs along y = 0 from x 0 to 7, the room above it. */
const room = (...more: Command[]): Document => build(...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "c"), ...more);
const door = (kind: "swing" | "window" | "curtain" | "passage" | "slidingGlass", wall = "c-1/w0", offset = 3): Command => ({ type: "addOpening", opId: "d", wall, kind, offset, ...(kind === "slidingGlass" ? {} : { width: 0.8 }) });

describe("outsideDoors", () => {
  it("a door on the shell's wall is outside: its span on the outer face, its normal pointing out", () => {
    const [d] = outsideDoors(room(door("swing")));
    expect(d?.id).toBe("d/d0");
    expect(d?.out.x).toBeCloseTo(0, 9);
    expect(d?.out.y).toBeCloseTo(-1, 9);
    expect([d?.a.x, d?.b.x].sort()).toEqual([3, 3.8]);
    expect(d?.a.y).toBeCloseTo(-0.1, 9); // the outer face: half the wall's 0.20 below its centreline
    expect(d?.b.y).toBeCloseTo(-0.1, 9);
  });

  it("an open passage and a sliding glass door count; a window and a curtain don't", () => {
    expect(outsideDoors(room(door("passage")))).toHaveLength(1);
    expect(outsideDoors(room(door("slidingGlass")))).toHaveLength(1);
    expect(outsideDoors(room(door("window")))).toEqual([]);
    expect(outsideDoors(room(door("curtain")))).toEqual([]);
  });

  it("a door between two rooms doesn't", () => {
    const split = room(
      { type: "addWall", opId: "p", from: { at: { x: 4, y: 0 } }, to: { at: { x: 4, y: 2.5 } } },
      { type: "addOpening", opId: "d", wall: "p/w0", kind: "swing", offset: 0.8, width: 0.8 },
    );
    expect(outsideDoors(split)).toEqual([]);
  });

  it("a door on a loft's wall doesn't", () => {
    const loft = room(
      { type: "setCeiling", height: 4.4 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 2, y: 1.25 }, w: 3.8, d: 2.3 },
      { type: "addWall", opId: "k", from: { at: { x: 1, y: 0.5 } }, to: { at: { x: 1, y: 2 } }, base: "l/k0" },
      { type: "addOpening", opId: "d", wall: "k/w0", kind: "swing", offset: 0.3, width: 0.8 },
    );
    expect(outsideDoors(loft)).toEqual([]);
  });
});
