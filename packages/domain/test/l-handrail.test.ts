import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { emptyDocument, execute, rectangleRoom, validateDocument, type Command, type Document } from "../src";
import { applyPatch, invertPatch } from "../src/patch";

// An L keeps one handrail value (AC-13, guards.33): setStair's handrail on either flight sets both, in one command, so
// one undo restores both. The flights are found by the links that make the L: the lower one reaches its landing, the
// upper one starts at it. The 8 × 6 room's loft is at x 0.1–2.1, y 1.5–4.5, top 2.15; the L's upper flight has its back
// on the loft's edge at (2.1, 3).

const LOFT = "l/k0";
const UPPER = "ps/s0/o0";
const LOWER = "ps/s1/o0";
const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) doc = unwrap(execute(doc, c)).doc;
  return doc;
};
const room = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const ell: Command = { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape: "l-right" };
/** Each flight's rail when both its sides agree (edges.06), else both. */
const handrails = (doc: Document, ...ids: string[]): unknown[] => ids.map((id) => {
  const s = doc.objects[id]?.handrails;
  return s === undefined ? doc.objects[id]?.handrail : s.left === s.right ? s.left : s;
});

describe("setting Handrail on one flight of an L", () => {
  it.each([UPPER, LOWER])("on %s sets both flights, in one patch that one undo reverts", (flight) => {
    const before = room(ell);
    expect(handrails(before, UPPER, LOWER)).toEqual(["railing", "railing"]);
    const r = unwrap(execute(before, { type: "setStair", objectId: flight, handrail: "glass" }));
    expect(handrails(r.doc, UPPER, LOWER)).toEqual(["glass", "glass"]);
    expect(validateDocument(r.doc).ok).toBe(true);
    const put = r.patch.puts.filter((p) => p.table === "objects").map((p) => p.entity.id).sort();
    expect(put).toEqual([UPPER, LOWER].sort());
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(before);
  });

  it("back again from the other flight, both follow", () => {
    const glass = unwrap(execute(room(ell), { type: "setStair", objectId: UPPER, handrail: "glass" })).doc;
    const back = unwrap(execute(glass, { type: "setStair", objectId: LOWER, handrail: "railing" })).doc;
    expect(handrails(back, UPPER, LOWER)).toEqual(["railing", "railing"]);
  });

  it("leaves another stair up to the same loft alone", () => {
    const other: Command = { type: "placeObject", opId: "o", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 1.3 } }, at: { x: 1.1, y: 4.5 }, rotation: 180, deck: null, reaches: LOFT };
    const doc = room(ell, other);
    const fromL = unwrap(execute(doc, { type: "setStair", objectId: UPPER, handrail: "glass" })).doc;
    expect(handrails(fromL, UPPER, LOWER, "o/o0")).toEqual(["glass", "glass", "railing"]);
    const fromOther = unwrap(execute(doc, { type: "setStair", objectId: "o/o0", handrail: "glass" })).doc;
    expect(handrails(fromOther, UPPER, LOWER, "o/o0")).toEqual(["railing", "railing", "glass"]);
  });

  it("an other flight switched to a rung ladder takes none, and nothing is refused", () => {
    const doc = room(ell, { type: "setObjectKind", objectId: LOWER, kind: "rungLadder" });
    const r = unwrap(execute(doc, { type: "setStair", objectId: UPPER, handrail: "glass" }));
    expect(handrails(r.doc, UPPER)).toEqual(["glass"]);
    expect(Object.keys(r.doc.objects[LOWER] ?? {})).not.toContain("handrail");
  });

  it("a duplicated flight is no part of the L: setting either leaves the other alone", () => {
    const doc = room(ell);
    const rotation = doc.placements["ps/s0/p0"]?.rotation ?? 0;
    const copied = unwrap(execute(doc, { type: "duplicatePlacements", opId: "dp", copies: [{ placementId: "ps/s0/p0", at: { x: 6.5, y: 3 }, rotation }] })).doc;
    expect(copied.objects["dp/o0"]?.startsAt).toBe("ps/k0");
    const fromCopy = unwrap(execute(copied, { type: "setStair", objectId: "dp/o0", handrail: "glass" })).doc;
    expect(handrails(fromCopy, UPPER, LOWER, "dp/o0")).toEqual(["railing", "railing", "glass"]);
    const fromLower = unwrap(execute(copied, { type: "setStair", objectId: LOWER, handrail: "glass" })).doc;
    expect(handrails(fromLower, "dp/o0")).toEqual(["railing"]);
  });

  it("a straight stair up to the L's landing is no part of the L, either way", () => {
    const onLanding: Command = { type: "placeStair", opId: "st", state: "s0", kind: "stair", surface: null, deck: "ps/k0", at: { x: 4, y: 2.55 }, shape: "straight" };
    const doc = room(ell, onLanding);
    expect(doc.objects["st/s0/o0"]?.reaches).toBe("ps/k0");
    const fromStraight = unwrap(execute(doc, { type: "setStair", objectId: "st/s0/o0", handrail: "glass" })).doc;
    expect(handrails(fromStraight, UPPER, LOWER, "st/s0/o0")).toEqual(["railing", "railing", "glass"]);
    const fromUpper = unwrap(execute(doc, { type: "setStair", objectId: UPPER, handrail: "glass" })).doc;
    expect(handrails(fromUpper, "st/s0/o0")).toEqual(["railing"]);
  });

  it.each([LOWER, UPPER])("%s switched to a rung ladder and back takes the L's value again", (flight) => {
    const glass = unwrap(execute(room(ell), { type: "setStair", objectId: UPPER, handrail: "glass" })).doc;
    const ladder = unwrap(execute(glass, { type: "setObjectKind", objectId: flight, kind: "rungLadder" })).doc;
    const back = unwrap(execute(ladder, { type: "setObjectKind", objectId: flight, kind: "stair" })).doc;
    expect(handrails(back, UPPER, LOWER)).toEqual(["glass", "glass"]);
    expect(validateDocument(back).ok).toBe(true);
  });

  it("a straight flight sets only itself", () => {
    const straight = room({ ...ell, shape: "straight" } as Command);
    const r = unwrap(execute(straight, { type: "setStair", objectId: UPPER, handrail: "glass" }));
    expect(r.patch.puts.filter((p) => p.table === "objects").map((p) => p.entity.id)).toEqual([UPPER]);
  });
});
