import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Document } from "../src/model";
import { wallChain } from "../src/queries/helpers";
import { levelOf, openingShown } from "../src/queries/levels";
import { rectDoc, withDeck, withOpening } from "./helpers";

// A wall's chain at the viewed level (review.09): the openings drawn solid there, and the dashed ones that overlap none
// of those along the wall. A 6 × 4 room (W1 along y 0, W4 the west wall) under a 3.00 m ceiling, a loft at 2.15 over its
// west end: the floor's cut at 1.20, the loft's at 2.15 + (3.00 − 2.15) / 2 = 2.575.

const base = (): Document => {
  const room = unwrap(execute(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: 3 })).doc;
  return withDeck(room, { id: "loft", at: [1.1, 2], w: 2, d: 3.8, top: 2.15, solid: false });
};
const openingIds = (doc: Document, wall: string, deck: string | null): string[] =>
  (wallChain(doc, wall, levelOf(doc, deck))?.pieces ?? []).flatMap((p) => (p.role === "opening" && p.left.kind === "opening" ? [p.left.id] : []));

describe("the chain at a level (review.09)", () => {
  // On the west wall W4 (from (0, 4) to (0, 0)), a floor window 0.90–2.00 and a loft window 2.30–2.75 over it.
  const stacked = (): Document =>
    withOpening(withOpening(base(), { id: "low", wall: "W4", kind: "window", offset: 1.5, width: 0.8, sill: 0.9, head: 2 }), { id: "high", wall: "W4", kind: "window", offset: 1.4, width: 1, sill: 2.3, head: 2.75 });

  it("the fixture draws the floor window solid and the loft window dashed at the floor, the loft window solid at the loft", () => {
    const doc = stacked();
    expect(openingShown(doc, "low", levelOf(doc, null))).toBe("cut");
    expect(openingShown(doc, "high", levelOf(doc, null))).toBe("above");
    expect(openingShown(doc, "high", levelOf(doc, "loft"))).toBe("cut");
    expect(openingShown(doc, "low", levelOf(doc, "loft"))).toBe("hidden");
  });

  it("measures the floor window only at the floor, and the loft window only at the loft", () => {
    const doc = stacked();
    expect(openingIds(doc, "W4", null)).toEqual(["low"]);
    expect(openingIds(doc, "W4", "loft")).toEqual(["high"]);
  });

  it("still measures a lone window above the floor's cut at the floor", () => {
    const doc = withOpening(base(), { id: "clerestory", wall: "W2", kind: "window", offset: 1, width: 1.2, sill: 2.2, head: 2.6 });
    expect(openingShown(doc, "clerestory", levelOf(doc, null))).toBe("above");
    expect(openingIds(doc, "W2", null)).toEqual(["clerestory"]);
  });

  it("measures a door once under a window over it with the same span", () => {
    const doc = withOpening(withOpening(base(), { id: "garden", wall: "W2", kind: "slidingGlass", offset: 1, width: 1.6 }), { id: "over", wall: "W2", kind: "window", offset: 1, width: 1.6, sill: 2.2, head: 2.6 });
    expect(openingIds(doc, "W2", null)).toEqual(["garden"]);
  });

  it("doesn't compile without a level (cycle home, AC-08): there is no every-level chain", () => {
    const doc = stacked();
    // @ts-expect-error a level is required
    const withoutLevel = () => wallChain(doc, "W4"); // never called: the compiler is the test
    expect(withoutLevel).toBeTypeOf("function");
  });
});
