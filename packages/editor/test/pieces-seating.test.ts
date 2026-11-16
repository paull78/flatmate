import { describe, expect, it } from "vitest";
import { execute, placementRange, unwrap, type Command, type Document } from "@fm/domain";
import { objectLook } from "../src/view/furniture";
import { PALETTE_KINDS } from "../src/view/palette";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";

// The stool, bar table, bench and storage chest (spec pieces, step 03): their symbols as the mock-up draws them
// (pieces.07), their palette places and presets. Footprint space: x from −w/2 to w/2, y from −d (front) to 0 (back).

type Segment = Extract<Primitive, { kind: "segment" }>;
const look = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 3, detail: "D" });
const D = (kind: string, w: number, d: number) => look(kind, w, d).filter((p) => p.color === "D");
const segs = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const fullArcs = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "arc" && Math.abs(p.to - p.from - 2 * Math.PI) < 1e-12);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const flat = (s: Segment) => near(s.a.y, s.b.y);
const upright = (s: Segment) => near(s.a.x, s.b.x) && !near(s.a.y, s.b.y);
const place = (kind: string, preset?: string): Command => ({ type: "placeObject", deck: null, opId: "a", state: "s0", object: preset === undefined ? { kind } : { kind, preset }, at: { x: 3, y: 3.9 } });
const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

describe("the seating and storage pieces on the plan (AC-03)", () => {
  it("a stool draws its seat and post as two circles about its centre, and no front line", () => {
    const arcs = fullArcs(D("stool", 0.4, 0.4));
    expect(arcs).toHaveLength(2);
    expect(arcs.every((a) => a.kind === "arc" && near(a.center.x, 0) && near(a.center.y, -0.2))).toBe(true);
    const front = (kind: string, w: number, d: number) => look(kind, w, d).some((p) => p.kind === "segment" && "px" in p.width && p.width.px === 3);
    expect(front("stool", 0.4, 0.4)).toBe(false);
    expect(front("barTable", 1.2, 0.6)).toBe(true); // the heavier front line, where a kind has one
  });

  it("a bar table draws its frame inset from the top and the footrest line across it", () => {
    const ps = segs(D("barTable", 1.2, 0.6));
    expect(ps.filter(flat).length).toBeGreaterThanOrEqual(3); // the frame's two long sides and the footrest
    expect(ps.some((s) => flat(s) && near(s.a.y, -0.3))).toBe(true);
  });

  it("a bench draws its cushions, split about every 0.60 m, and the lid's hinge line at the back", () => {
    const splits = (w: number) => segs(D("bench", w, 0.45)).filter(upright);
    expect(splits(1.2)).toHaveLength(1 + 2); // the cushion's two ends and one split
    expect(splits(0.6)).toHaveLength(2);
    expect(segs(D("bench", 1.2, 0.45)).some((s) => flat(s) && s.a.y > -0.1 && near(Math.abs(s.b.x - s.a.x), 1.2 - 0.08))).toBe(true);
  });

  it("a storage chest draws the lid's hinge line near the back and a handle at the front", () => {
    const ps = segs(D("storageChest", 0.8, 0.45)).filter(flat);
    expect(ps.some((s) => s.a.y > -0.1 && near(Math.abs(s.b.x - s.a.x), 0.8))).toBe(true);
    expect(ps.some((s) => s.a.y < -0.4 && Math.abs(s.b.x - s.a.x) < 0.2)).toBe(true);
  });
});

describe("the palette (AC-02)", () => {
  it("Sit and eat gains the stool, bar table and bench after the chair; Storage the chest after the chest of drawers", () => {
    const group = (name: string) => [...new Set(PALETTE_KINDS.find((g) => g.group === name)?.cards.map((c) => c.kind))];
    expect(group("Sit and eat")).toEqual(["foldingTable", "extendingTable", "roundTable", "seatedDining", "seatedRound", "sofa", "armchair", "chair", "stool", "barTable", "bench", "coffeeTable", "cornerSofa"]);
    expect(group("Storage")).toEqual(["wardrobe", "drawers", "storageChest", "shelf", "glassCabinet", "halfGlassCabinet", "tvUnit", "cornerWardrobe", "wallTv", "pegboard", "coatHooks", "coatStand"]);
  });
});

describe("standard heights as presets (AC-07, pieces.06)", () => {
  it("the bar table's counter-height preset places a 0.90 m table; the wall ledge hangs from 1.00 to 1.05", () => {
    const top = (preset: string) => {
      const doc = ok(roomDoc(), place("barTable", preset));
      return placementRange(doc, Object.keys(doc.placements)[0] ?? "");
    };
    expect(top("Counter height")).toMatchObject({ bottom: 0, top: 0.9 });
    expect(top("Wall ledge")).toMatchObject({ bottom: 1, top: 1.05 });
  });
});
