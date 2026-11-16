import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { objectLook } from "../src/view/furniture";
import { objectsLayer } from "../src/view/objects-layer";
import { PALETTE_KINDS } from "../src/view/palette";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";

// The wall unit and the electric fireplace (spec pieces, step 04): their symbols (pieces.07), the presets hung above the
// cut drawn dashed, and their palette places. Footprint space: x from −w/2 to w/2, y from −d (front) to 0 (back).

type Segment = Extract<Primitive, { kind: "segment" }>;
const D = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 3, detail: "D" }).filter((p) => p.color === "D");
const segs = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const fullArcs = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "arc" && Math.abs(p.to - p.from - 2 * Math.PI) < 1e-12);
const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

/** What the canvas draws for a wall unit of `preset` hung on the bottom wall at x 3 (its back on the face y 0.1). */
function drawn(preset: string): Primitive[] {
  const doc = ok(roomDoc(), { type: "placeObject", deck: null, opId: "u", state: "s0", object: { kind: "wallUnit", preset }, at: { x: 3, y: 0.1 }, rotation: 180 });
  return objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80).filter((p) => {
    const pts = p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : [];
    return pts.length > 0 && pts.every((q) => q.x >= 2.5 && q.x <= 3.5 && q.y >= 0.1 - 1e-6 && q.y <= 0.4);
  });
}

describe("the wall unit and the electric fireplace on the plan (AC-03, AC-04)", () => {
  it("a wall unit draws its box and one diagonal, the plan sign of a unit hung on a wall", () => {
    const ps = segs(D("wallUnit", 0.8, 0.2));
    expect(ps.filter((s) => Math.abs(s.a.x - s.b.x) > 1e-6 && Math.abs(s.a.y - s.b.y) > 1e-6)).toHaveLength(1);
    expect(ps.length).toBeGreaterThanOrEqual(5);
  });

  it("an electric fireplace draws its glass front's line and a row of flame rings, one per about 0.20 m", () => {
    expect(fullArcs(D("electricFireplace", 1, 0.2))).toHaveLength(5);
    expect(fullArcs(D("electricFireplace", 0.4, 0.2))).toHaveLength(3);
  });

  it("the mini-split head and the electrical panel draw dashed; the water heater, wall heater and AC their symbol", () => {
    for (const preset of ["Mini-split head", "Electrical panel"]) {
      const ps = drawn(preset);
      expect(ps.length, preset).toBeGreaterThan(0);
      expect(ps.every((p) => p.kind === "segment" && p.dash !== undefined), preset).toBe(true);
    }
    for (const preset of ["Water heater", "Wall heater", "Through-wall AC"]) {
      const ps = drawn(preset);
      expect(ps.some((p) => p.kind === "polygon"), preset).toBe(true);
      expect(ps.some((p) => p.kind === "segment" && p.dash === undefined), preset).toBe(true);
    }
  });
});

describe("the palette (AC-02)", () => {
  it("Basic gains the electric fireplace and the wall unit after the radiator and the wood stove", () => {
    const basic = [...new Set(PALETTE_KINDS.find((g) => g.group === "Basic")?.cards.map((c) => c.kind))];
    expect(basic).toEqual(["block", "roundBlock", "cornerBlock", "plant", "palm", "fern", "rosette", "radiator", "wheelWell", "beam", "woodStove", "electricFireplace", "wallUnit", "rug", "roundRug", "picture", "mirror", "clock"]);
  });
});
