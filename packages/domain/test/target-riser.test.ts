import { describe, expect, it } from "vitest";
import { STAIR_RULES, parseLayoutObject, recommendedRun, stairGeometry, stairRuleOf, type Document } from "../src";
import { risersFor } from "../src/queries/stairs";
import { execute } from "../src/commands/execute";
import { serialize } from "../src/serialize";
import { fromStored } from "../src/shape-tables";
import { stairChecks } from "../src/queries/stair-checks";
import { undersideOf } from "../src/queries/underside";
import { tinyHouse, withDeck } from "./helpers";

// A stair's target riser (riser.01, .09, .11): the count is the rise over the target, rounded up, through one argument
// every reader must pass, and a stair with none reads as its kind.

const main = STAIR_RULES.solid;

describe("the riser count from a target", () => {
  it("rounds the rise up by the target, and follows the rise", () => {
    expect(risersFor(main, 2.15, 0.18)).toBe(12);
    expect(risersFor(main, 2.5, 0.18)).toBe(14);
    expect(risersFor(main, 2.15, 0.16)).toBe(14);
  });

  it("reads as the kind with no target, for every kind", () => {
    for (const rule of Object.values(STAIR_RULES)) {
      expect(risersFor(rule, 2.15, null)).toBe(Math.max(2, Math.ceil(2.15 / rule.maxRiser - 1e-9)));
    }
  });

  it("keeps an exact multiple at that multiple", () => {
    expect(risersFor(main, 1.8, 0.18)).toBe(10);
  });

  it("gives the actual riser and going from the count", () => {
    const g = stairGeometry(main, 0.9, 2.99, 2.15, 0.18);
    expect(g.risers).toBe(12);
    expect(g.riser).toBeCloseTo(0.1792, 3);
    expect(g.going).toBeCloseTo(2.99 / 11, 6);
  });

  it("fits the run to the target's count", () => {
    const riser = 2.15 / 14;
    expect(recommendedRun(main, 2.15, 0.16)).toBeCloseTo(Math.min(0.3, Math.max(0.25, 0.63 - 2 * riser)) * 13, 6);
    expect(recommendedRun(main, 2.15, 0.16)).not.toBeCloseTo(recommendedRun(main, 2.15, null), 2);
  });
});

function withStair(riser?: unknown): Document {
  const doc = withDeck(tinyHouse(), { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top: 2.15, solid: false });
  const r = execute(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind: "openStair", size: { w: 0.9, d: 2.2 } }, at: { x: 4.9, y: 1.25 }, rotation: 270, deck: null, reaches: "L" });
  if (!r.ok) throw new Error(r.error.message);
  const o = r.value.doc.objects["st/o0"];
  if (!o) throw new Error("no stair");
  return riser === undefined ? r.value.doc : { ...r.value.doc, objects: { ...r.value.doc.objects, [o.id]: { ...o, riser: riser as number } } };
}

describe("the stored target", () => {
  it("parses back on a stair, and a stair without one stays without the key", () => {
    const o = withStair(0.18).objects["st/o0"];
    expect(parseLayoutObject(o)).toEqual(o);
    const plain = withStair().objects["st/o0"];
    expect(parseLayoutObject(plain)).toEqual(plain);
    expect(Object.keys(parseLayoutObject(plain) ?? {})).not.toContain("riser");
  });

  it("is refused out of range, as text, or on furniture", () => {
    const o = withStair(0.18).objects["st/o0"];
    expect(parseLayoutObject({ ...o, riser: 0.05 })).toBeNull();
    expect(parseLayoutObject({ ...o, riser: 0.4 })).toBeNull();
    expect(parseLayoutObject({ ...o, riser: "0.18" })).toBeNull();
    const chair = { id: "c", kind: "chair", name: "Chair", w: { standard: 0.5 }, d: { standard: 0.5 }, h: { standard: 0.9 }, z: { standard: 0 } };
    expect(parseLayoutObject(chair)).not.toBeNull();
    expect(parseLayoutObject({ ...chair, riser: 0.18 })).toBeNull();
  });

  it("round-trips through a save, and a saved stair gains no key", () => {
    const saved = (d: Document) => {
      const r = fromStored(JSON.parse(JSON.stringify(serialize(d))));
      if (!r.ok) throw new Error(r.error.message);
      return r.value.objects["st/o0"];
    };
    expect(saved(withStair(0.18))?.riser).toBe(0.18);
    expect(Object.keys(saved(withStair()) ?? {})).not.toContain("riser");
  });

  it("is read by the checks and the underside", () => {
    const rule = stairRuleOf("openStair");
    if (!rule) throw new Error("no rule");
    const riserCheck = (d: Document): number => {
      const c = stairChecks(d, "st/o0").find((x) => x.id === "riser");
      if (!c || c.id !== "riser") throw new Error("no riser check");
      return c.value;
    };
    expect(riserCheck(withStair())).toBeCloseTo(2.15 / risersFor(rule, 2.15, null), 3);
    expect(riserCheck(withStair(0.16))).toBeCloseTo(2.15 / 14, 3);
    const u = (d: Document) => {
      const under = undersideOf(d, Object.keys(d.placements).find((id) => d.placements[id]?.object === "st/o0") ?? "");
      if (!under) throw new Error("no underside");
      return under.at(1);
    };
    expect(u(withStair(0.16))).not.toBeCloseTo(u(withStair()), 3);
  });
});
