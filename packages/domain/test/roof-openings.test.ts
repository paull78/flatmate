import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { CEILING_ID, sameGuards, type Ceiling, type Document } from "../src/model";
import { ceilingAtPoint } from "../src/roof";
import { stairChecks } from "../src/queries/stair-checks";
import { stairGeometry } from "../src/queries/stairs";
import { kindOf } from "../src/kinds";
import { cutAt, wallRange } from "../src/queries/vertical";
import { levels } from "../src/queries/levels";
import { openingDefaults } from "../src/queries/openings";
import { guardRuns, missingGuards } from "../src/queries/guards";
import { rectDoc, tinyHouse, withDeck } from "./helpers";

// Openings, stairs, the cut and new walls under a slope (roofs.10, .17, .18, .19; AC-07, AC-13, AC-14).

const roofed = (doc: Document, c: Omit<Ceiling, "id">): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const shedOn = (doc: Document, height: number, falls: Ceiling["falls"] = "-y", pitch = 10): Document => roofed(doc, { height, shape: "shed", pitch, falls, overhang: 0.3 });
const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
/** A 6.00 × 2.55 m outer box; W1 is the bottom wall, from J1 (0.1, 0.1) to J2 (5.9, 0.1). */
const house = (): Document => rectDoc(0.1, 0.1, 5.9, 2.45);
const window = (offset: number, head: number): Command => ({ type: "addOpening", opId: "o1", wall: "W1", kind: "window", offset, width: 0.6, side: "left", hinge: "a", sill: 0.9, head });

describe("an opening's head under a slope (AC-14)", () => {
  // Falling −x: the bottom wall's ceiling rises from 2.30 at x 0 to 3.36 at x 6.
  const doc = (): Document => shedOn(house(), 2.3, "-x");

  it("near the high end a head may reach 0.10 under the ceiling over its own span", () => {
    expect(execute(doc(), window(4.8, 2.95)).ok).toBe(true);
  });

  it("the same window near the low end is refused, with the wall's top over its span", () => {
    const r = execute(doc(), window(0.2, 2.95));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error.message).toContain("2.35"); // the ceiling over x 0.3–0.9 at the outer face: 2.353
    expect(execute(doc(), window(0.2, 2.1)).ok).toBe(true);
  });

  it("a new window's default head fits the span it is placed on", () => {
    const low = shedOn(house(), 2, "-x");
    const d = openingDefaults(low, "W1", "window", 0, { from: 0.2, to: 0.8 });
    expect(d && "head" in d ? d.head : null).toBeLessThanOrEqual(2.053 - 0.1 + 1e-9);
    expect(execute(low, { ...window(0.2, 2.1), ...(d && "head" in d ? d : {}) }).ok).toBe(true);
  });
});

const headroomOf = (doc: Document): number => {
  const c = stairChecks(doc, "st/o0").find((x) => x.id === "headroom");
  return c && "value" in c ? c.value : Number.NaN;
};

describe("a stair's headroom over each tread (roofs.18, AC-13)", () => {
  /** The decks' tiny house under a 10° shed falling −x, with a loft over x 4.9–6.9 at +2.15 and a storage stair to it. */
  const build = (ceiling: Omit<Ceiling, "id">): Document => {
    const doc = withDeck(roofed(tinyHouse(), ceiling), { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top: 2.15, solid: false });
    return run(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind: "storageStair" }, at: { x: 4.9, y: 0.5 }, rotation: 270, deck: null, reaches: "L" });
  };

  it("reads the ceiling over the top tread, not the footprint's lowest corner", () => {
    const doc = build({ height: 2.6, shape: "shed", pitch: 10, falls: "-x", overhang: 0.3 });
    const o = doc.objects["st/o0"];
    const p = doc.placements["st/p0"] ?? Object.values(doc.placements).find((x) => x.object === "st/o0");
    const rule = o ? kindOf(o.kind)?.stair : null;
    if (!o || !p || !rule) throw new Error("no stair");
    const w = o.w[p.config] ?? 0;
    const d = o.d[p.config] ?? 0;
    const g = stairGeometry(rule, w, d, 2.15, null);
    const last = (g.treads - 1) * g.going;
    const front = 4.9 - d; // climbing toward +x, its back edge at x 4.9
    const pitchLast = g.pitch(last);
    const value = headroomOf(doc);
    expect(value).toBeCloseTo(ceilingAtPoint(doc, { x: front + last, y: 0 }) - pitchLast, 2);
    const oldRule = ceilingAtPoint(doc, { x: front, y: 0 }) - pitchLast;
    expect(value - oldRule).toBeCloseTo(Math.tan((10 * Math.PI) / 180) * last, 2);
  });

  it("is unchanged under a flat ceiling", () => {
    const value = headroomOf(build({ height: 3.2 }));
    expect(value).toBeCloseTo(3.2 - 9 * 0.215, 9);
  });
});

describe("guards beside full walls under a slope (roofs.19, AC-13)", () => {
  /** A loft against the right wall: its right edge lies along a full wall. */
  const loftDoc = (ceiling: Omit<Ceiling, "id">): Document =>
    withDeck(roofed(tinyHouse(), ceiling), { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top: 2.15, solid: false, ...sameGuards("railing") });

  it("the edges along full walls take no railing and no warning, as under a flat ceiling at the high side", () => {
    const length = (doc: Document): number => guardRuns(doc).filter((r) => r.deck === "L").reduce((s, r) => s + Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y), 0);
    const flat = loftDoc({ height: 3.4 });
    const shed = loftDoc({ height: 2.6, shape: "shed", pitch: 10, falls: "-x", overhang: 0.3 });
    expect(length(shed)).toBeCloseTo(length(flat), 3);
    expect(missingGuards(shed).length).toBe(missingGuards(flat).length);
  });
});

describe("the cut under a slope (roofs.10, AC-07)", () => {
  it("the floor is cut at 1.20 under a 2.75/3.20 shed, and a loft at 2.15 reaching the high wall's inner face at 2.657", () => {
    const doc = withDeck(shedOn(house(), 2.75), { id: "L", at: [3, 1.775], w: 5.6, d: 1.15, top: 2.15, solid: false });
    const [floor, loft] = levels(doc);
    expect(floor?.cut).toBe(1.2);
    expect(loft?.cut).toBe(2.657); // the highest ceiling over the loft, at y 2.35: 3.164
  });

  it("a low flat ceiling still halves", () => {
    expect(cutAt(roofed(house(), { height: 2 }), 0)).toBe(1);
  });

  it("a full wall's highest point decides its relation to the cut", () => {
    const knee = shedOn(house(), 1, "-y", 5); // the low wall rises 1.00 to 1.02, under the cut
    expect(wallRange(knee, "W1")?.top).toBeLessThan(1.2);
  });
});

describe("new walls under a slope", () => {
  it("a full wall drawn across the slope is valid and tops at its higher end", () => {
    const doc = shedOn(house(), 2.75);
    const next = run(doc, { type: "addWall", opId: "w9", from: { at: { x: 3, y: 0.2 } }, to: { at: { x: 3, y: 2.35 } } });
    const id = Object.keys(next.walls).find((k) => !doc.walls[k]);
    expect(id && wallRange(next, id)?.top).toBeGreaterThan(3.1);
  });
});
