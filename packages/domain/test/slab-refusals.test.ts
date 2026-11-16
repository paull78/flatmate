import { describe, expect, it } from "vitest";
import { anchorAt } from "../src/queries/footprints";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { LOFT, cabinDoc, notchedCabin, run } from "./cabin";

// A hole under something, and what rises through holding the hole (stairwell.18; AC-03, AC-08).

const result = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const plain = (doc: Document, cmd: Command): string | undefined => {
  const r = execute(doc, cmd);
  return r.ok ? undefined : (r.error.violations?.find((v) => v.plain)?.plain ?? r.error.message);
};
const hole = (x: number, y: number, w: number, d: number): Command => ({ type: "addDeckHole", opId: "h", deck: LOFT, at: { x, y }, w, d });

describe("a hole under something (AC-03)", () => {
  it("under a box standing on the loft: refused, naming it", () => {
    const doc = run(cabinDoc(), { type: "setCeiling", height: 3.5 }, { type: "placeObject", opId: "c", state: "s0", object: { kind: "block", size: { w: 0.5, d: 0.5 } }, at: anchorAt({ x: 0.6, y: 0.6 }, 0.5, 0), rotation: 0, deck: LOFT });
    expect(result(doc, hole(0.6, 0.6, 0.4, 0.4))).toBe("Custom box stands over a hole in Loft in Layout");
  });

  it("under a wall standing on the loft: refused, naming it", () => {
    const doc = run(cabinDoc(), { type: "addWall", opId: "kw", base: LOFT, top: 0.6, from: { at: { x: 0.5, y: 1.0 } }, to: { at: { x: 1.5, y: 1.0 } } });
    expect(result(doc, hole(1.0, 1.0, 0.4, 0.4))).toMatch(/^Wall kw\/w0 stands over a hole in Loft/);
    expect(plain(doc, hole(1.0, 1.0, 0.4, 0.4))).toBe("A wall stands over a hole in Loft");
  });

  it("under a post on the loft, and over a post reaching up to it: refused, naming it", () => {
    const on = run(cabinDoc(), { type: "placeColumn", opId: "p", at: { x: 0.6, y: 2.0 }, width: 0.3, depth: 0.3, base: LOFT });
    expect(plain(on, hole(0.6, 2.0, 0.4, 0.4))).toBe("A column stands over a hole in Loft");
    const under = run(cabinDoc(), { type: "placeColumn", opId: "p", at: { x: 0.6, y: 1.0 }, width: 0.3, depth: 0.3, top: LOFT });
    expect(plain(under, hole(0.6, 1.0, 0.4, 0.4))).toBe("A column reaches up to a hole in Loft");
  });
});

describe("what rises through holds the hole (AC-08)", () => {
  const withLadder = (): Document => run(notchedCabin(), { type: "placeObject", opId: "lad", state: "s0", object: { kind: "shipsLadder" }, at: anchorAt({ x: 1.95, y: 2.6 }, 1.1, 90), rotation: 90, deck: null });
  const refusal = "Ship's ladder (0.00–2.15) and Loft (2.03–2.15) overlap in Layout";

  it("shrinking, moving or deleting the notch the ladder rises through is refused, naming the ladder", () => {
    expect(result(withLadder(), { type: "setDeckHole", holeId: "notch/h0", w: 0.6, at: { x: 1.8, y: 2.575 } })).toBe(refusal);
    expect(result(withLadder(), { type: "setDeckHole", holeId: "notch/h0", at: { x: 1.0, y: 2.575 } })).toBe(refusal);
    expect(result(withLadder(), { type: "deleteEntities", ids: [{ table: "deckHoles", id: "notch/h0" }] })).toBe(refusal);
  });
});
