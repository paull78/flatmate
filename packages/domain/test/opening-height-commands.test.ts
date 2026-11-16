import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document, Opening } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { openingHeightsFor } from "../src/queries/openings";
import { rectDoc, withOpening } from "./helpers";

// Heights in the commands (sills step 03, AC-08's domain half; sills.07): addOpening and setOpening take a sill and a
// head, and a kind switch between doors and windows keeps the head and takes the new kind's sill. The 6 × 4 room under
// a 3.05 ceiling: W1 runs (0, 0) → (6, 0).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const room = (): Document => run(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: 3.05 });
const on = (o: Partial<Opening>): Document => withOpening(room(), { id: "x", wall: "W1", offset: 1, ...o });
const heights = (doc: Document) => [doc.openings.x?.sill, doc.openings.x?.head];
const set = (doc: Document, c: Partial<Extract<Command, { type: "setOpening" }>>): Document => run(doc, { type: "setOpening", openingId: "x", ...c });

describe("heights in the opening commands (sills step 03)", () => {
  it("addOpening takes a sill and a head", () => {
    const doc = run(room(), { type: "addOpening", opId: "w", wall: "W1", kind: "window", offset: 1, sill: 2.4, head: 2.9 });
    expect([doc.openings["w/d0"]?.sill, doc.openings["w/d0"]?.head]).toEqual([2.4, 2.9]);
  });

  it("setOpening sets them, and refuses a pair that doesn't fit, leaving the drawing as it was", () => {
    const doc = on({ kind: "window" });
    expect(heights(set(doc, { sill: 1.2, head: 2.4 }))).toEqual([1.2, 2.4]);
    expect(heights(set(doc, { head: 2.95 }))).toEqual([0.9, 2.95]);
    const r = execute(doc, { type: "setOpening", openingId: "x", head: 3 });
    expect(r.ok ? "accepted" : r.error.violations[0]?.plain).toBe("A window's head must be at least 0.10 m under its wall's top, at 3.05 m");
    expect(heights(doc)).toEqual([0.9, 2.1]);
  });

  it("a kind switch keeps the head and takes the new kind's sill", () => {
    expect(heights(set(on({ kind: "window", sill: 1.2, head: 1.8 }), { kind: "swing" }))).toEqual([0, 1.8]);
    expect(heights(set(on({ kind: "swing" }), { kind: "window" }))).toEqual([0.9, 2.1]);
    expect(heights(set(on({ kind: "casement", width: 0.6, sill: 1.1, head: 1.7 }), { kind: "twoLeaf" }))).toEqual([1.1, 1.7]);
    expect(heights(set(on({ kind: "swing", head: 1.9 }), { kind: "passage" }))).toEqual([0, 1.9]);
  });

  it("a door too low to be a window is refused as one", () => {
    const r = execute(on({ kind: "swing", head: 1.1 }), { type: "setOpening", openingId: "x", kind: "window" });
    expect(r.ok ? "accepted" : r.error.violations[0]?.plain).toBe("An opening must be at least 0.30 m tall");
  });

  it("heights given with a kind switch win over the switch's", () => {
    expect(heights(set(on({ kind: "swing" }), { kind: "window", sill: 1.5, head: 2 }))).toEqual([1.5, 2]);
  });

  it("openingHeightsFor: a given sill keeps the height, a given height keeps the sill, to the millimetre", () => {
    const win = { kind: "window" as const, sill: 0.9, head: 2.1 };
    expect(openingHeightsFor(win, "window", { sill: 1.2 })).toEqual({ sill: 1.2, head: 2.4 });
    expect(openingHeightsFor(win, "window", { height: 0.6 })).toEqual({ sill: 0.9, head: 1.5 });
    expect(openingHeightsFor(win, "window", { sill: 2.4, height: 0.5 })).toEqual({ sill: 2.4, head: 2.9 });
    expect(openingHeightsFor(win, "swing", { height: 1.9 })).toEqual({ sill: 0, head: 1.9 });
    expect(openingHeightsFor(win, "swing")).toEqual({ sill: 0, head: 2.1 });
  });

  it("a switch that clamps the width and moves the sill is one patch, undone in one step", () => {
    const doc = on({ kind: "window", width: 2.4, sill: 1.2, head: 1.8 });
    const r = unwrap(execute(doc, { type: "setOpening", openingId: "x", kind: "swing" }));
    expect(r.doc.openings.x).toMatchObject({ kind: "swing", width: 2, sill: 0, head: 1.8 });
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch))).openings.x).toEqual(doc.openings.x);
  });
});
