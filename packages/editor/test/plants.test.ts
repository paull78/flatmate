import { describe, expect, it } from "vitest";
import { kindOf, shapeRing, signedArea } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { furnitureSymbol, objectLook, restRings } from "../src/view/furniture";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { shapedFills } from "../src/view/shapes";
import { place, reach } from "./object-look-helpers";

// The plants (symbols.19): a solid canopy with dark lines, so each reads on any floor. At rest a plant fills its canopy and
// draws no ring of its round shape; selected, ghosted or refused it fills that ring, which is also what it fits by.

const PLANTS = ["plant", "palm", "fern", "rosette"] as const;
const polys = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p] : []));
const look = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 1, detail: "D" });
const inRound = (w: number, d: number) => {
  const ring = shapeRing("round", w, d);
  return (q: Point) =>
    ring.every((a, i) => {
      const b = ring[(i + 1) % ring.length] ?? a;
      return (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) >= -1e-9;
    });
};

describe("the plants", () => {
  it.each([
    ["plant", "Plant", 0.4, 1.2, [0.3, 0.4, 0.6]],
    ["palm", "Palm", 0.9, 1.8, [0.6, 0.9, 1.2]],
    ["fern", "Fern", 0.6, 0.8, [0.4, 0.6, 0.8]],
    ["rosette", "Rosette", 0.4, 0.3, [0.3, 0.4, 0.5]],
  ] as const)("%s is round, has no front line, and has its size and presets (AC-09)", (kind, label, size, h, presets) => {
    expect(kindOf(kind)).toMatchObject({ outline: "round", front: false, label, semanticClass: "IfcFurnishingElement USERDEFINED" });
    expect(kindOf(kind)?.configs[0]).toMatchObject({ w: size, d: size, h, zone: null });
    expect(kindOf(kind)?.presets.map((p) => p.w)).toEqual(presets);
  });

  it.each(PLANTS)("%s keeps its canopy and every line inside its round ring, at any size and stretched (symbols.19)", (kind) => {
    for (const [w, d] of [[0.3, 0.3], [0.6, 0.6], [1.2, 1.2], [0.8, 0.2], [0.1, 0.1]] as const) {
      const inside = inRound(w, d);
      for (const q of restRings(kind, w, d)[0] ?? []) expect(inside(q), `${kind} ${w} × ${d} canopy (${q.x}, ${q.y})`).toBe(true);
      for (const q of furnitureSymbol(kind, "standard", w, d).flatMap(reach)) expect(inside(q), `${kind} ${w} × ${d} (${q.x}, ${q.y})`).toBe(true);
    }
  });

  it.each(PLANTS)("%s draws its canopy as its outline in the strong line, not a ring of its round shape (symbols.19)", (kind) => {
    const canopy = restRings(kind, 0.6, 0.6)[0] ?? [];
    const lines = look(kind, 0.6, 0.6).filter((p) => p.kind === "segment" && p.color === "L");
    expect(lines.length).toBeGreaterThanOrEqual(canopy.length);
    expect(canopy.length).not.toBe(32);
    for (const c of canopy) expect(lines.some((p) => p.kind === "segment" && Math.hypot(p.a.x - c.x, p.a.y - c.y) < 1e-9), `${kind} at (${c.x}, ${c.y})`).toBe(true);
  });

  it.each([["plant", 0.6], ["fern", 0.5], ["rosette", 0.5], ["palm", 0.3]] as const)("%s fills at least %s of its circle, so its lines have a ground on any floor", (kind, share) => {
    const canopy = restRings(kind, 1, 1)[0] ?? [];
    expect(signedArea(canopy)).toBeGreaterThan((share * Math.PI) / 4);
  });

  it.each(PLANTS)("selected in a drawing, %s fills its whole round ring; at rest, its canopy (AC-10)", (kind) => {
    const doc = place(kind, "standard", 0.6, 0.6);
    const rest = polys(objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80));
    const picked = polys(objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "p", 80));
    expect(rest[0]?.points).toHaveLength(restRings(kind, 0.6, 0.6)[0]?.length ?? -1);
    expect(picked[0]?.points).toHaveLength(32);
  });

  it("ghosts and refusals read the round ring: shapedFills stays it", () => {
    for (const kind of PLANTS) expect(shapedFills(kind, 0.6, 0.6, { x: 0, y: 0 }, 0, [])[0]).toHaveLength(32);
  });

  it("a palm has a midrib per frond, a plant seven dark veins, at under 200 lines each", () => {
    const strong = (kind: string) => look(kind, 0.9, 0.9).filter((p) => p.kind === "segment" && p.color === "L").length - (restRings(kind, 0.9, 0.9)[0]?.length ?? 0);
    expect(strong("palm")).toBe(9);
    expect(strong("plant")).toBe(7);
    for (const kind of PLANTS) expect(look(kind, 0.9, 0.9).length, kind).toBeLessThan(200);
  });
});

describe("any other kind", () => {
  it("keeps its whole shape as its fill", () => {
    expect(restRings("sofa", 2, 0.9)[0]).toHaveLength(4);
    expect(restRings("roundTable", 1, 1)[0]).toHaveLength(32);
  });
});
