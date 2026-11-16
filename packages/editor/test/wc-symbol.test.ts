import { describe, expect, it } from "vitest";
import { inConvex, kindOf, shapeRing } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import { hasCistern } from "../src/view/piece-counts";
import type { Primitive } from "../src/view/scene-types";
import { appearanceOf } from "../src/view3d/parts";

// The WC (symbols AC-01, AC-02, AC-03): a pan with an inner oval, and a cistern band from 0.60 m deep, in the plan and in 3D.

const ends = (ps: readonly Primitive[]): Point[] =>
  ps.flatMap((p) => (p.kind === "segment" ? [p.a, p.b] : p.kind === "arc" ? [p.center] : []));
const detail = (w: number, d: number) => objectLook("toilet", "standard", w, d, { line: "L", frontPx: 9, detail: "D" }).filter((p) => p.color === "D");
/** The straight band a cistern draws: a segment across most of the width, along x. */
const bands = (w: number, d: number) => detail(w, d).filter((p) => p.kind === "segment" && Math.abs(p.a.y - p.b.y) < 1e-9 && Math.abs(p.a.x - p.b.x) > 0.8 * w);

describe("the WC's plan symbol", () => {
  it("wall-hung, it draws a pan and an inner oval with no cistern or heavier front, all inside its ring (AC-01)", () => {
    const [w, d] = [0.36, 0.54];
    expect(kindOf("toilet")).toMatchObject({ outline: "pan", front: false });
    expect(bands(w, d)).toEqual([]);
    expect(detail(w, d).length).toBeGreaterThan(8); // the oval's short lines
    const look = objectLook("toilet", "standard", w, d, { line: "L", frontPx: 9, detail: "D" });
    expect(look.some((p) => p.kind === "segment" && "px" in p.width && p.width.px === 9)).toBe(false);
    const ring = shapeRing("pan", w, d);
    for (const p of ends(furnitureSymbol("toilet", "standard", w, d))) expect(inConvex(p, ring, 1e-9), `${p.x}, ${p.y}`).toBe(true);
  });

  it.each([[0.54, false], [0.59, false], [0.6, true], [0.65, true]] as const)("at %s m deep, the cistern is %s, in the rule and the plan (AC-02)", (d, want) => {
    expect(hasCistern(d)).toBe(want);
    expect(bands(0.4, d).length > 0).toBe(want);
  });

  it("keeps every line inside its ring at every preset and at thin sizes", () => {
    for (const [w, d] of [[0.36, 0.54], [0.4, 0.65], [0.45, 0.6], [0.1, 0.1], [0.1, 3], [2, 0.65], [3, 3]] as const) {
      const ring = shapeRing("pan", w, d);
      for (const p of ends(furnitureSymbol("toilet", "standard", w, d))) expect(inConvex(p, ring, 1e-9), `${w} × ${d}: ${p.x}, ${p.y}`).toBe(true);
    }
  });
});

describe("the WC's 3D parts", () => {
  const tall = (d: number) => appearanceOf("toilet")("standard", 0.4, d, 0.9).filter((p) => (p.shape === "ring" || p.shape === "outline") && p.z1 === 0.9 && p.z0 === 0);
  it("has a cistern reaching the top exactly where the plan draws one (AC-02)", () => {
    expect(tall(0.65)).toHaveLength(1);
    expect(tall(0.54)).toEqual([]);
  });
});

describe("the WC's sizes (AC-03)", () => {
  it("defaults to wall-hung 0.36 × 0.54, 0.42 high, with Wall-hung, Standard and Composting", () => {
    expect(kindOf("toilet")?.configs[0]).toMatchObject({ w: 0.36, d: 0.54, h: 0.42 });
    expect(kindOf("toilet")?.presets.map((p) => p.id)).toEqual(["Wall-hung", "Standard", "Composting"]);
    expect(kindOf("toilet")?.presets.map((p) => [p.w, p.h?.standard])).toEqual([[0.36, 0.42], [0.4, 0.9], [0.45, 0.9]]);
  });
});
