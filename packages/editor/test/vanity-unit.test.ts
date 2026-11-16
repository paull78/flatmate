import { describe, expect, it } from "vitest";
import { kindOf } from "@fm/domain";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import { vanityBasins } from "../src/view/piece-counts";
import { PALETTE_KINDS } from "../src/view/palette";
import type { Primitive } from "../src/view/scene-types";
import { appearanceOf } from "../src/view3d/parts";

// The vanity unit (symbols AC-07, AC-08): a cabinet with one centred basin, or two from 1.40 m wide, the same count in 3D.

type Arc = Extract<Primitive, { kind: "arc" }>;
const arcs = (ps: readonly Primitive[]): Arc[] => ps.flatMap((p) => (p.kind === "arc" ? [p] : []));
const full = (a: Arc) => Math.abs(a.to - a.from - 2 * Math.PI) < 1e-12;
const detail = (w: number) => objectLook("vanityUnit", "standard", w, 0.5, { line: "L", frontPx: 1, detail: "D" }).filter((p) => p.color === "D");
const drains = (w: number) => arcs(detail(w)).filter(full);
const bowls = (w: number) => appearanceOf("vanityUnit")("standard", w, 0.5, 1.05).flatMap((p) => p.panels ?? []).filter((q) => q.normal === "+z" && q.slot === "metal");

describe("the vanity unit", () => {
  it("is a Bathroom card, sized 1.00 × 0.50 with widths from 60 to 140 cm", () => {
    expect(kindOf("vanityUnit")).toMatchObject({ label: "Vanity unit", outline: "rect", semanticClass: "IfcSanitaryTerminal WASHHANDBASIN" });
    expect(kindOf("vanityUnit")?.configs[0]).toMatchObject({ w: 1, d: 0.5, zone: 0.7, h: 1.05 });
    expect(kindOf("vanityUnit")?.presets.map((p) => [p.id, p.w])).toEqual([["60", 0.6], ["80", 0.8], ["100", 1], ["120", 1.2], ["140", 1.4]]);
    expect(PALETTE_KINDS.find((g) => g.group === "Bathroom")?.cards.some((c) => c.kind === "vanityUnit")).toBe(true);
  });

  it.each([[0.6, 1], [1, 1], [1.2, 1], [1.39, 1], [1.4, 2], [2, 2]] as const)("at %s m wide it has %s basins, in the rule, the plan and 3D (AC-07)", (w, n) => {
    expect(vanityBasins(w)).toBe(n);
    expect(drains(w)).toHaveLength(n);
    expect(bowls(w)).toHaveLength(n);
  });

  it("centres one basin, and centres two in their halves (AC-07)", () => {
    expect(drains(1.2)[0]?.center.x).toBeCloseTo(0, 9);
    expect(drains(1.4).map((a) => a.center.x).sort((a, b) => a - b)).toEqual([expect.closeTo(-0.35, 9), expect.closeTo(0.35, 9)]);
  });

  it("keeps every line inside its rectangle, at thin sizes too", () => {
    for (const [w, d] of [[0.6, 0.5], [1.4, 0.5], [0.1, 0.1], [10, 0.1], [0.3, 3]] as const) {
      for (const p of furnitureSymbol("vanityUnit", "standard", w, d)) {
        const points = p.kind === "segment" ? [p.a, p.b] : p.kind === "arc" ? [p.center] : [];
        for (const q of points) {
          expect(Math.abs(q.x), `${w} × ${d}`).toBeLessThanOrEqual(w / 2 + 1e-9);
          expect(q.y, `${w} × ${d}`).toBeLessThanOrEqual(1e-9);
          expect(q.y, `${w} × ${d}`).toBeGreaterThanOrEqual(-d - 1e-9);
        }
      }
    }
  });
});
