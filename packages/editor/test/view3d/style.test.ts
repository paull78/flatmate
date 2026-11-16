import { describe, expect, it } from "vitest";
import { SLOTS, STYLE_3D } from "../../src/view3d/style";

// The material slots (parts.05, .24): three shades each, and no slot's top close enough to the floor, a deck's top, the
// selection or the background to be mistaken for it (the e2e colour tolerance is 14).

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const distance = (a: string, b: string): number => Math.hypot(...rgb(a).map((v, i) => v - (rgb(b)[i] ?? 0)));

describe("the material slots", () => {
  it("the slots include a flame for the electric fireplace's tongues (pieces.20)", () => {
    expect(SLOTS).toContain("flame");
  });

  it("every slot has a top, a lit and a shaded hex shade", () => {
    for (const slot of SLOTS) for (const shade of Object.values(STYLE_3D.slots[slot])) expect(shade).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("no slot's top is within 14 of the floor, a deck's top, the selection blue or the background", () => {
    for (const slot of SLOTS) {
      const top = STYLE_3D.slots[slot].top;
      for (const other of [STYLE_3D.floor, STYLE_3D.deck.top, STYLE_3D.selected.top, STYLE_3D.background]) expect(distance(top, other), `${slot} vs ${other}`).toBeGreaterThan(14);
    }
  });

  it("a deck's top is apart from the floor: at least 40 in some channel, so a platform doesn't read as floor (studio.04, AC-05)", () => {
    expect(Math.max(...rgb(STYLE_3D.deck.top).map((v, i) => Math.abs(v - (rgb(STYLE_3D.floor)[i] ?? 0))))).toBeGreaterThanOrEqual(40);
  });
});

describe("frames, leaves and glass (openings3d)", () => {
  const apart = (a: string, b: string) => Math.max(...rgb(a).map((v, i) => Math.abs(v - (rgb(b)[i] ?? 0))));

  it("joinery is at least 30 off a wall's lit and shaded sides in some channel, so a door doesn't vanish (AC-13)", () => {
    for (const shade of Object.values(STYLE_3D.joinery)) {
      for (const wall of [STYLE_3D.wall.lit, STYLE_3D.wall.shaded]) expect(apart(shade, wall), `${shade} vs ${wall}`).toBeGreaterThanOrEqual(30);
    }
  });

  it("a curtain rod is lighter than the dark slot and at least 30 off the wall's side it stands against (openkinds.35)", () => {
    const sum = (hex: string) => rgb(hex).reduce((a, v) => a + v, 0);
    for (const k of ["lit", "shaded"] as const) {
      expect(sum(STYLE_3D.rod[k]), k).toBeGreaterThan(sum(STYLE_3D.slots.dark[k]));
      expect(apart(STYLE_3D.rod[k], STYLE_3D.wall[k]), k).toBeGreaterThanOrEqual(30);
    }
  });

  it("glass differs from joinery and from the old pale tint (AC-05)", () => {
    for (const other of [...Object.values(STYLE_3D.joinery), "#d6e6f5"]) expect(STYLE_3D.glass).not.toBe(other);
    expect(apart(STYLE_3D.glass, "#d6e6f5")).toBeGreaterThanOrEqual(20);
  });

  it("a curtain's fabric stands off the walls like joinery, and is neither joinery nor glass (openkinds.04)", () => {
    for (const fabric of [STYLE_3D.fabric.lit, STYLE_3D.fabric.shaded]) { // the folds' two tones (openkinds.33)
      for (const wall of [STYLE_3D.wall.lit, STYLE_3D.wall.shaded]) expect(apart(fabric, wall), `${fabric} vs ${wall}`).toBeGreaterThanOrEqual(30);
      for (const other of [...Object.values(STYLE_3D.joinery), STYLE_3D.glass]) expect(apart(fabric, other), `${fabric} vs ${other}`).toBeGreaterThanOrEqual(30);
    }
  });
});
