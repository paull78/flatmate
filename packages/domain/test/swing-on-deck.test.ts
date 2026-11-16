import { describe, expect, it } from "vitest";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { clearanceWarnings, swingZone, zoneBlocks } from "../src/queries/clearance";
import { LOFT, LOFT_DOOR, LOFT_WALL, SHELL_WALL, STATE, levelsHouse, run } from "./fixtures/levels-house";

// A door on a wall standing on a deck has a swing zone (cycle home, spec: levels, AC-04, AC-05): the floor door's rectangle,
// cut at its deck's edge, with its 1.20 m band from the deck's top. On the levels fixture the loft wall runs x 2.5 from
// y 0.1 to 3.9 and its door (y 2.7–3.5) opens west: the swing is x 1.6–2.4, y 2.7–3.5, over the loft (top 2.45).

const stool = (opId: string, x: number, y: number, deck: string | null): Command =>
  ({ type: "placeObject", opId, state: STATE, object: { kind: "stool" }, at: { x, y }, deck });
/** The blocked swings only: `<opening>: <blockers>`. */
const swings = (doc: Document): string[] => zoneBlocks(doc, STATE)
  .filter((b) => b.zone.table === "openings")
  .map((b) => `${b.zone.id}: ${b.blockers.map((x) => (x.kind === "piece" ? x.name : x.kind)).join(", ")}`);
const box = (ring: readonly { x: number; y: number }[] | null): number[] | null => {
  if (!ring) return null;
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return [r(Math.min(...ring.map((p) => p.x))), r(Math.min(...ring.map((p) => p.y))), r(Math.max(...ring.map((p) => p.x))), r(Math.max(...ring.map((p) => p.y)))];
};

describe("a door on a loft's wall has a swing zone", () => {
  it("the same square a floor door has, on its opening side", () => {
    expect(box(swingZone(levelsHouse(), LOFT_DOOR))).toEqual([1.6, 2.7, 2.4, 3.5]);
    expect(swings(levelsHouse())).toEqual([]);
  });

  it("a piece on the loft in the swing blocks it (AC-04)", () => {
    expect(swings(run(levelsHouse(), stool("b", 2, 3.2, LOFT)))).toEqual([`${LOFT_DOOR}: Stool`]);
  });

  it("a piece under the loft in the same spot blocks nothing (AC-04)", () => {
    expect(clearanceWarnings(run(levelsHouse(), stool("b", 2, 3.2, null)), STATE)).toEqual([]);
  });

  it("a wall on the loft across the swing blocks it; a floor wall stopping under the loft does not", () => {
    const across = (base: string | undefined, top?: number): Command =>
      ({ type: "addWall", opId: "x", from: { at: { x: 2, y: 2.8 } }, to: { at: { x: 2, y: 3.4 } }, ...(base ? { base } : {}), ...(top === undefined ? {} : { top }) });
    expect(swings(run(levelsHouse(), across(LOFT)))).toEqual([`${LOFT_DOOR}: wall`]);
    expect(swings(run(levelsHouse(), across(undefined, 2)))).toEqual([]);
  });

  it("a kind with no clearance has none on a deck either", () => {
    const doc = run(levelsHouse(), { type: "addOpening", opId: "p", wall: LOFT_WALL, kind: "passage", offset: 1.5, width: 0.8 });
    expect(swingZone(doc, "p/d0")).toBeNull();
  });
});

describe("a deck door's swing stops at its deck's edge (AC-05)", () => {
  // A second wall on the loft at x 3.9, its east face 0.10 m from the loft's edge (x 4.1), with a door opening east.
  const nearEdge = (): Document => run(levelsHouse(),
    { type: "addWall", opId: "e", from: { at: { x: 3.9, y: 0.1 } }, to: { at: { x: 3.9, y: 3.9 } }, base: LOFT },
    { type: "addOpening", opId: "ed", wall: "e/w0", kind: "swing", offset: 1.5, width: 0.8, side: "right" });

  it("is cut there: 0.10 m deep where a floor door's would be 0.80", () => {
    expect(box(swingZone(nearEdge(), "ed/d0"))).toEqual([4, 1.6, 4.1, 2.4]);
  });

  it("a full-height floor wall beyond the edge, inside the uncut square, gives no warning", () => {
    const doc = run(nearEdge(), { type: "addWall", opId: "f", from: { at: { x: 4.5, y: 1.2 } }, to: { at: { x: 4.5, y: 2.8 } } });
    expect(swings(doc)).toEqual([]);
  });

  it("a door whose swing lies wholly past the edge has no zone", () => {
    const doc = run(levelsHouse(),
      { type: "addWall", opId: "e", from: { at: { x: 4, y: 0.1 } }, to: { at: { x: 4, y: 3.9 } }, base: LOFT },
      { type: "addOpening", opId: "ed", wall: "e/w0", kind: "swing", offset: 1.5, width: 0.8, side: "right" });
    expect(swingZone(doc, "ed/d0")).toBeNull();
  });
});

describe("a floor door under the loft keeps the floor's band (AC-06)", () => {
  // A swing door in the south shell wall under the loft, opening into the room: its swing is x 1.0–1.8, y 0.1–0.9.
  const floorDoor = (): Document => run(levelsHouse(), { type: "addOpening", opId: "fd", wall: SHELL_WALL, kind: "swing", offset: 1, width: 0.8, side: "left" });

  it("a floor piece in its swing blocks it; a loft piece over the same spot does not", () => {
    expect(box(swingZone(floorDoor(), "fd/d0"))).toEqual([1, 0.1, 1.8, 0.9]);
    expect(swings(run(floorDoor(), stool("b", 1.4, 0.6, null)))).toEqual(["fd/d0: Stool"]);
    expect(swings(run(floorDoor(), stool("b", 1.7, 0.6, LOFT)))).toEqual([]);
  });
});
