import { describe, expect, it } from "vitest";
import { guardPosts, guardRuns, type Command, type Document } from "@fm/domain";
import { faces3d, itemKey } from "../../src/view3d/faces";
import { guardBoxes } from "../../src/view3d/guard-faces";
import { view3dItems } from "../../src/view3d/items";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, Item3d } from "../../src/view3d/types";
import { cabinDoc, withCommands } from "../builders";

// Guards in 3D (AC-07): a Railing has posts and a top rail, a Glass guard a pane in the windows' glass colour under a top
// rail. The cabin's loft has one open edge, x 2.10, y 0.10–2.90, from 2.15 up to the 3.05 ceiling.

const LOFT = "loft/k0";
const items = (doc: Document): Item3d[] => view3dItems(doc, "s0", null, new Set(), false);
const guards = (doc: Document): Item3d[] => items(doc).filter((i) => i.item === "guard");
const facesOf = (doc: Document): Face3d[] => guards(doc).flatMap((i) => faces3d(i));
const zs = (fs: readonly Face3d[]): number[] => fs.flatMap((f) => f.points.map((p) => p.z));
const glass: Command = { type: "setDeck", deckId: LOFT, guard: "glass" };

describe("a side's guard in 3D (edges AC-03)", () => {
  it("a 0.30 guard on the open right side rises 0.30 above the loft", () => {
    const fs = facesOf(withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guardRight: { height: 0.3 } }));
    expect(Math.min(...zs(fs))).toBeCloseTo(2.15, 6);
    expect(Math.max(...zs(fs))).toBeCloseTo(2.45, 6);
  });

  it("None on the open right side draws no guard; None on a side against a wall changes nothing", () => {
    expect(guards(withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guardRight: { kind: "none" } }))).toEqual([]);
    expect(facesOf(withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guardFront: { kind: "none" } }))).toEqual(facesOf(cabinDoc()));
  });
});

describe("a Railing in 3D", () => {
  it("rises from its deck to the run's top", () => {
    const fs = facesOf(cabinDoc());
    expect(Math.min(...zs(fs))).toBeCloseTo(2.15, 6);
    expect(Math.max(...zs(fs))).toBeCloseTo(3.05, 6);
  });

  it("has a post at each of the plan's post marks, and a top rail along the run", () => {
    const doc = cabinDoc();
    const [run] = guardRuns(doc);
    if (!run) throw new Error("no run");
    const fs = facesOf(doc);
    for (const post of guardPosts(run)) {
      const here = fs.filter((f) => f.points.some((p) => Math.abs(p.x - post.x) < 0.05 && Math.abs(p.y - post.y) < 0.05 && Math.abs(p.z - 2.15) < 1e-6));
      expect(here.length, `a post at ${post.y}`).toBeGreaterThan(0);
    }
    const low = 3.05 - 0.1;
    const rail = fs.filter((f) => f.points.every((p) => p.z > low));
    const ys = rail.flatMap((f) => f.points.map((p) => p.y));
    expect(Math.min(...ys)).toBeLessThanOrEqual(0.1 + 1e-6);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(2.9 - 1e-6);
  });

  it("its top rail is thin: below it, only posts stand", () => {
    const fs = facesOf(cabinDoc());
    const long = fs.filter((f) => { const ys = f.points.map((p) => p.y); return Math.max(...ys) - Math.min(...ys) > 1; });
    expect(long.length).toBeGreaterThan(0);
    for (const f of long) expect(Math.min(...f.points.map((p) => p.z))).toBeGreaterThan(3.05 - 0.1);
  });

  it("uses no glass", () => {
    expect(facesOf(cabinDoc()).some((f) => f.color === STYLE_3D.glass)).toBe(false);
  });
});

describe("a Glass guard in 3D", () => {
  it("is a pane in the windows' glass colour, under a top rail, with no posts", () => {
    const fs = facesOf(withCommands(cabinDoc(), glass));
    const pane = fs.filter((f) => f.color === STYLE_3D.glass);
    expect(pane.length).toBeGreaterThan(0);
    const paneTop = Math.max(...zs(pane));
    expect(paneTop).toBeLessThan(3.05);
    expect(Math.min(...zs(pane))).toBeCloseTo(2.15, 6);
    expect(fs.some((f) => f.color !== STYLE_3D.glass && f.points.every((p) => p.z >= paneTop - 1e-6))).toBe(true);
    // No posts: below the rail, everything is the pane.
    expect(fs.filter((f) => f.color !== STYLE_3D.glass).every((f) => f.points.every((p) => p.z >= paneTop - 1e-6))).toBe(true);
  });
});

describe("the items", () => {
  it("None adds none", () => {
    expect(guards(withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guard: "none" }))).toEqual([]);
  });

  it("each run has its own key", () => {
    const doc = withCommands(cabinDoc(), { type: "addDeckHole", opId: "n", deck: LOFT, at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 });
    const keys = guards(doc).map(itemKey);
    expect(keys.length).toBe(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("every layout has them, a deck being shared", () => {
    const doc = withCommands(cabinDoc(), { type: "addState", opId: "n", name: "Night" });
    expect(view3dItems(doc, "n/s0", null, new Set(), false).filter((i) => i.item === "guard")).toHaveLength(1);
  });
});

describe("found in review: under 4 cm of headroom", () => {
  it.each([2.17, 2.18, 2.19, 2.155])("the guard stays between its deck and the ceiling at %s, with no inverted box", (height) => {
    for (const guard of ["railing", "glass"] as const) {
      const doc = withCommands(cabinDoc(), { type: "setCeiling", height }, { type: "setDeck", deckId: LOFT, guard });
      const boxes = guards(doc).flatMap((i) => (i.item === "guard" ? guardBoxes(i) : []));
      expect(boxes.length).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.bottom).toBeGreaterThanOrEqual(2.15 - 1e-9);
        expect(b.top).toBeLessThanOrEqual(height + 1e-9);
        expect(b.top).toBeGreaterThan(b.bottom);
      }
    }
  });
});
