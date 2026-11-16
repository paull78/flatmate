import { unwrap, type Point } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import { stairFits } from "../src/commands/place-stair";
import { stairShortfall } from "../src/commands/stair-shortfall";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { stairEdges, stairOnEdge, type StairParts, type StairRequest } from "../src/queries/stair-edge";
import { rectangleRoom } from "../src/scripts";
import { rng } from "./helpers";

// How short a stair on a deck's edge is (AC-12, stairdraw.19): its run less the longest run that passes the commit's
// own fit (stairFits) with its back kept on the edge, to the millimetre; the domain's reason when no run fits.
//
//        LOFT +2.15 (x 3.37–5.47, y 3.71–5.31)
//  ══════╤═════╤══════  the loft's front edge, y 3.71
//        │  ▼  │        the Stair runs 2.988 toward −y, to y 0.722
//        │     │        2.00 of free floor, to y 1.71
//      ┌─┴─────┴─┐
//      │   box   │      y 1.11–1.71
//      └─────────┘

const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

/** The sample room of stair-edge.test.ts: inner x 0.47–5.47, y 0.31–5.31, ceiling 3.20, a loft at +2.15 top right. */
const LOFT = "loft/k0";
const room = (): Document =>
  run(emptyDocument(), [
    ...rectangleRoom({ x: 0.37, y: 0.21 }, 5.2, 5.2, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4.42, y: 4.51 }, w: 2.1, d: 1.6, name: "Loft" },
    { type: "addState", opId: "n", name: "Night" },
  ]);
/** A 0.60 box whose back edge's middle is at `at`, facing −y, in the Day layout. */
const box = (doc: Document, at: Point, opId = "b", rotation = 0): Document =>
  run(doc, [{ type: "placeObject", opId, state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at, rotation, deck: null }]);

const ask = (at: Point, extra: Partial<StairRequest> = {}): StairRequest => ({ state: "s0", kind: "stair", deck: LOFT, at, shape: "straight", surface: null, ...extra });
const partsOf = (doc: Document, req: StairRequest): StairParts => unwrap(stairOnEdge(doc, req));
/** The parts with the first flight's run set to `d`. */
const withRun = (parts: StairParts, d: number): StairParts => ({ ...parts, flights: parts.flights.map((f, i) => (i === 0 ? { ...f, d } : f)) });
const mm = (v: number): number => Math.round(v * 1000) / 1000;

describe("stairShortfall (AC-12)", () => {
  it("a Stair with 2.00 m of free floor in front of its 2.99 m run is 0.99 short", () => {
    const doc = box(room(), { x: 4.2, y: 1.71 });
    const parts = partsOf(doc, ask({ x: 4.2, y: 3.71 }));
    expect(parts.flights[0]?.d).toBe(2.988);
    const s = stairShortfall(doc, parts, "s0");
    if (s === null || !("short" in s)) throw new Error(`no shortfall: ${JSON.stringify(s)}`);
    // The longest run is the 2.00 of free floor, give or take the 1 mm within which solids only touch.
    expect(Math.abs(s.short - 0.988)).toBeLessThanOrEqual(0.001 + 1e-9);
    expect(s.short.toFixed(2)).toBe("0.99");
  });

  it("› a piece right at the edge gives the domain's reason, with no shortfall", () => {
    const doc = box(room(), { x: 4.2, y: 3.71 }); // its back on the loft's edge, under the stair's first tread
    const parts = partsOf(doc, ask({ x: 4.2, y: 3.71 }));
    const fit = stairFits(doc, parts, "s0");
    if (fit.ok) throw new Error("it fits");
    expect(stairShortfall(doc, parts, "s0")).toEqual({ reason: fit.error });
  });

  it("› a stair that fits has no shortfall", () => {
    const doc = room();
    expect(stairShortfall(doc, partsOf(doc, ask({ x: 4.2, y: 3.71 })), "s0")).toBeNull();
  });

  it("› an L gives the reason only, never a shortfall", () => {
    // The box under the lower flight (x 2.692–4.05, y 1.452–2.352): the L doesn't fit, and no run is shortened.
    const doc = box(room(), { x: 3.3, y: 2.2 });
    const parts = partsOf(doc, ask({ x: 4.5, y: 3.71 }, { shape: "l-left" }));
    const fit = stairFits(doc, parts, "s0");
    if (fit.ok) throw new Error("the L fits");
    expect(stairShortfall(doc, parts, "s0")).toEqual({ reason: fit.error });
  });

  it("› shortfall agrees with stairFits: the run less the shortfall fits, and 2 mm more doesn't", () => {
    // Boxes at random places and angles in front of the loft's front edge, and on a deck turned 30° (its edges off
    // the axes), for a Stair and a storage stair: wherever there is a shortfall, it is the fit's own boundary.
    const turned = run(room(), [{ type: "addDeck", opId: "t", preset: "loft", at: { x: 1.6, y: 3.9 }, w: 1.4, d: 1.2, rotation: 30, name: "Turned" }]);
    const edge = stairEdges(turned, null, 0.9).find((e) => e.deck === "t/k0" && e.normal.y < -0.5);
    if (!edge) throw new Error("no edge on the turned deck");
    const middle = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    const random = rng(9);
    let shorts = 0;
    for (let i = 0; i < 40; i++) {
      const onTurned = i % 2 === 1;
      const at = onTurned ? middle : { x: mm(3.9 + random() * 1.1), y: 3.71 };
      const out = onTurned ? edge.normal : { x: 0, y: -1 };
      const t = 0.15 + random() * 2.6;
      const side = (random() - 0.5) * 1.2;
      const where = { x: mm(at.x + out.x * t - out.y * side), y: mm(at.y + out.y * t + out.x * side) };
      const placed = execute(onTurned ? turned : room(), {
        type: "placeObject", opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: where, rotation: Math.floor(random() * 360), deck: null,
      });
      if (!placed.ok) continue; // a box through a wall or the deck
      const doc = placed.value.doc;
      const parts = partsOf(doc, ask(at, { kind: i % 4 < 2 ? "stair" : "storageStair", deck: onTurned ? "t/k0" : LOFT }));
      const d = parts.flights[0]?.d ?? 0;
      const s = stairShortfall(doc, parts, "s0");
      if (s === null) {
        expect(stairFits(doc, parts, "s0").ok).toBe(true);
        continue;
      }
      if (!("short" in s)) {
        expect(stairFits(doc, withRun(parts, 0.1), "s0").ok).toBe(false);
        continue;
      }
      shorts++;
      const longest = mm(d - s.short);
      expect(stairFits(doc, withRun(parts, longest), "s0").ok).toBe(true);
      expect(stairFits(doc, withRun(parts, mm(longest + 0.002)), "s0").ok).toBe(false);
    }
    expect(shorts).toBeGreaterThan(5);
  });
});
