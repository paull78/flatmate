import { describe, expect, it } from "vitest";
import { kindOf, outlineOf, shapeRing } from "@fm/domain";
import { furnitureSymbol } from "../src/view/furniture";
import { PALETTE } from "../src/view/palette";
import { searchPalette } from "../src/view/palette-search";
import type { Primitive } from "../src/view/scene-types";

// The hung pieces' and the coat stand's plan symbols, palette cards and aliases (hangings step 02, AC-01, AC-03):
// inside the footprint at every preset, a detail beyond the outline, in Basic and Storage, found by quick add.

const NEW = ["picture", "mirror", "clock", "wallTv", "pegboard", "coatHooks", "coatStand"] as const;
type P = { x: number; y: number };
const points = (p: Primitive): P[] => {
  switch (p.kind) {
    case "segment": return [p.a, p.b];
    case "arc": return [{ x: p.center.x - p.radius, y: p.center.y - p.radius }, { x: p.center.x + p.radius, y: p.center.y + p.radius }];
    case "polygon": return [...p.points];
    default: return [];
  }
};

describe("the new kinds' symbols (step 02, AC-03)", () => {
  it("draw inside the footprint, with a detail beyond the outline, at every preset", () => {
    for (const id of NEW) {
      for (const p of kindOf(id)?.presets ?? []) {
        const d = p.d.standard ?? 0;
        const symbol = furnitureSymbol(id, "standard", p.w, d);
        expect(symbol.length, `${id} ${p.id}`).toBeGreaterThan(shapeRing(outlineOf(id), p.w, d).length);
        for (const q of symbol.flatMap(points)) {
          expect(q.x >= -p.w / 2 - 1e-3 && q.x <= p.w / 2 + 1e-3 && q.y >= -d - 1e-3 && q.y <= 1e-3, `${id} ${p.id} (${q.x}, ${q.y})`).toBe(true);
        }
      }
    }
  });

  it("the coat stand draws its pole and hooks inside its round outline", () => {
    const symbol = furnitureSymbol("coatStand", "standard", 0.45, 0.45);
    expect(symbol.some((p) => p.kind === "arc" && p.radius < 0.05)).toBe(true); // the pole
    expect(symbol.filter((p) => p.kind === "segment").length).toBeGreaterThanOrEqual(4); // the hooks
  });

  it("the pegboard and the coat hooks draw one mark per tool or hook, more on a wider piece", () => {
    const marks = (id: string, w: number, d: number) => furnitureSymbol(id, "standard", w, d).filter((p) => p.kind === "segment").length;
    expect(marks("coatHooks", 1.2, 0.08)).toBeGreaterThan(marks("coatHooks", 0.6, 0.08));
    expect(marks("pegboard", 1.2, 0.1)).toBeGreaterThan(marks("pegboard", 0.6, 0.1));
  });
});

describe("the palette and quick add (step 02, AC-01)", () => {
  it("Basic holds Picture, Mirror and Clock; Storage the Wall TV, Pegboard, Coat hooks and Coat stand", () => {
    const group = (name: string) => PALETTE.find((g) => g.group === name)?.cards.map((c) => c.kind) ?? [];
    for (const id of ["picture", "mirror", "clock"]) expect(group("Basic"), id).toContain(id);
    for (const id of ["wallTv", "pegboard", "coatHooks", "coatStand"]) expect(group("Storage"), id).toContain(id);
  });

  it("quick add finds them by name and by everyday words", () => {
    const top = (q: string): string | undefined => searchPalette(q)[0]?.kind;
    expect(top("mirror")).toBe("mirror");
    expect(top("poster")).toBe("picture");
    expect(top("wall clock")).toBe("clock");
    expect(top("television")).toBe("wallTv");
    expect(top("coat rack")).toBe("coatHooks");
    expect(top("hat stand")).toBe("coatStand");
    expect(top("towel warmer")).toBe("towelRail");
  });
});
