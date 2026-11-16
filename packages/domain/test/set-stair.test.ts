import { describe, expect, it } from "vitest";
import { invertPatch, rectangleRoom, recommendedRun, stairGeometry, stairRuleOf, type Command, type Document } from "../src";
import { applyPatch } from "../src/patch";
import { execute } from "../src/commands/execute";
import { emptyDocument } from "../src/model";
import { validateDocument } from "../src/validate";

// setStair (riser.01, .02, .07, .11): a target riser keeps the run; a going keeps the riser and sets the run; bad values
// and a run that doesn't fit are refused with nothing changed.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/** An 8 × 3 m room under a 3.05 ceiling, with a loft over x 6–8, and a stair of `kind` at its edge rising toward +x. */
function house(kind = "stair", d = 2.99, w = 0.9): Document {
  let doc = emptyDocument();
  for (const cmd of [...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"), { type: "setCeiling", height: 3.05 } satisfies Command, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 6.95, y: 1.5 }, w: 1.9, d: 2.8 } satisfies Command]) doc = run(doc, cmd);
  return run(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w, d } }, at: { x: 6, y: 1.5 }, rotation: 270, deck: null, reaches: "loft/k0" });
}
const ID = "st/o0";
const obj = (doc: Document) => {
  const o = doc.objects[ID];
  if (!o) throw new Error("no stair");
  return o;
};
const numbers = (doc: Document) => {
  const o = obj(doc);
  const rule = stairRuleOf(o.kind);
  if (!rule) throw new Error("no rule");
  return stairGeometry(rule, o.w.standard ?? 0, o.d.standard ?? 0, o.h.standard ?? 0, o.riser ?? null);
};

describe("a typed riser (AC-01, AC-02)", () => {
  it("sets the count and stays what was asked when the loft moves", () => {
    const doc = run(house(), { type: "setStair", objectId: ID, riser: 0.18 });
    expect(obj(doc).riser).toBe(0.18);
    expect(numbers(doc).risers).toBe(12);
    expect(numbers(doc).riser).toBeCloseTo(0.179, 3);
    const raised = run(doc, { type: "setDeck", deckId: "loft/k0", top: 2.5 });
    expect(obj(raised).riser).toBe(0.18);
    expect(numbers(raised).risers).toBe(14);
    expect(numbers(raised).riser).toBeCloseTo(0.179, 3);
  });

  it("keeps the run and the footprint; the going gives way", () => {
    const before = house();
    const doc = run(before, { type: "setStair", objectId: ID, riser: 0.16 });
    expect(numbers(doc).risers).toBe(14);
    expect(numbers(doc).going).toBeCloseTo(0.23, 3);
    expect(obj(doc).d.standard).toBe(2.99);
    expect(doc.placements).toEqual(before.placements);
  });

  it("clears with null, leaving no key", () => {
    const doc = run(run(house(), { type: "setStair", objectId: ID, riser: 0.16 }), { type: "setStair", objectId: ID, riser: null });
    expect(Object.keys(obj(doc))).not.toContain("riser");
    expect(numbers(doc).risers).toBe(12);
  });

  it.each([0.05, 0.4, Number.NaN])("refuses %s", (riser) => {
    expect(refusal(house(), { type: "setStair", objectId: ID, riser })).toMatch(/riser/i);
  });

  it("makes Fit run use the target's count", () => {
    const doc = run(house(), { type: "setStair", objectId: ID, riser: 0.16 });
    const rule = stairRuleOf("stair");
    if (!rule) throw new Error("no rule");
    expect(recommendedRun(rule, 2.15, obj(doc).riser ?? null)).not.toBeCloseTo(recommendedRun(rule, 2.15, null), 2);
  });
});

describe("a typed going (AC-02)", () => {
  it("keeps the riser and sets the run, the top still on the deck", () => {
    const start = run(house(), { type: "setStair", objectId: ID, riser: 0.16 });
    const doc = run(start, { type: "setStair", objectId: ID, going: 0.27 });
    expect(obj(doc).d.standard).toBeCloseTo(3.51, 3);
    expect(numbers(doc).risers).toBe(14);
    expect(numbers(doc).going).toBeCloseTo(0.27, 3);
    expect(doc.placements).toEqual(start.placements);
  });

  it("refuses a run that doesn't fit, naming why, with nothing changed", () => {
    const doc = house();
    const r = execute(doc, { type: "setStair", objectId: ID, going: 0.6 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message.length).toBeGreaterThan(0);
  });

  it.each([0.04, 0.7, Number.NaN])("refuses %s", (going) => {
    expect(refusal(house(), { type: "setStair", objectId: ID, going })).toMatch(/going/i);
  });

  it("takes both together as one edit: the count first, then the going", () => {
    const doc = run(house(), { type: "setStair", objectId: ID, riser: 0.16, going: 0.25 });
    expect(numbers(doc).risers).toBe(14);
    expect(obj(doc).d.standard).toBeCloseTo(3.25, 3);
  });

  it("undoes as one patch", () => {
    const before = house();
    const r = execute(before, { type: "setStair", objectId: ID, riser: 0.16, going: 0.25 });
    if (!r.ok) throw new Error(r.error.message);
    const back = applyPatch(r.value.doc, invertPatch(r.value.patch));
    expect(back.ok && back.value).toEqual(before);
  });
});

describe("other kinds, and what keeps the target (AC-06)", () => {
  it("a rung ladder's target is its spacing, and its going sets its run by the spaces", () => {
    const doc = run(house("rungLadder", 0.6, 0.45), { type: "setStair", objectId: ID, riser: 0.28 });
    expect(numbers(doc).riser).toBeLessThanOrEqual(0.28);
    const typed = run(doc, { type: "setStair", objectId: ID, going: 0.08 });
    expect(numbers(typed).going).toBeCloseTo(0.08, 3);
    expect(obj(typed).d.standard).toBeCloseTo(0.08 * numbers(typed).risers, 3);
  });

  it("a spiral takes a riser and refuses a going", () => {
    const doc = run(house("spiralStair", 1.6, 1.6), { type: "setStair", objectId: ID, riser: 0.18 });
    expect(obj(doc).riser).toBe(0.18);
    expect(refusal(doc, { type: "setStair", objectId: ID, going: 0.25 })).toMatch(/spiral/i);
  });

  it("refuses furniture", () => {
    const doc = run(house(), { type: "placeObject", opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 1, y: 1 }, deck: null });
    expect(refusal(doc, { type: "setStair", objectId: "c/o0", riser: 0.18 })).toMatch(/stair/i);
  });

  it("a duplicate keeps the target; switching the kind clears it", () => {
    const doc = run(house(), { type: "setStair", objectId: ID, riser: 0.16 });
    const placement = Object.keys(doc.placements)[0] ?? "";
    const dup = run(doc, { type: "duplicatePlacements", opId: "dup", copies: [{ placementId: placement, at: { x: 6, y: 0.6 }, rotation: 270 }] });
    expect(dup.objects["dup/o0"]?.riser).toBe(0.16);
    const switched = run(doc, { type: "setObjectKind", objectId: ID, kind: "openStair" });
    expect(Object.keys(obj(switched))).not.toContain("riser");
  });

  it("keeps the target through a move, a size change and a layout", () => {
    let doc = run(house(), { type: "setStair", objectId: ID, riser: 0.16 });
    const placement = Object.keys(doc.placements)[0] ?? "";
    doc = run(doc, { type: "setObjectSize", objectId: ID, w: 0.8, d: { standard: 2.8 } });
    doc = run(doc, { type: "movePlacement", placementId: placement, at: { x: 6, y: 1.4 }, rotation: 270 });
    doc = run(doc, { type: "addState", opId: "n", name: "Night" });
    expect(obj(doc).riser).toBe(0.16);
    expect(validateDocument(doc).ok).toBe(true);
  });
});
