import { describe, expect, it } from "vitest";
import type { Document, Trailer } from "@fm/domain";
import { cardFrame3d, view3dFrame } from "../../src/view3d-state";
import { DEFAULT_ANGLES, type Bounds3 } from "../../src/view3d/camera3d";
import { lookScene3d } from "../../src/view3d/look3d";
import { STYLE_3D } from "../../src/view3d/style";
import { framedBounds, SURROUNDINGS } from "../../src/view3d/surroundings";
import { trailerFaces } from "../../src/view3d/trailer-faces";
import type { Face3d } from "../../src/view3d/types";
import { clearRoomDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";

// The trailer drawn from its settings (trailer.02, .04, .05; AC-01, AC-03, AC-04, AC-10): the hitch on the chosen short
// end, two or three axles, a tongue box; the defaults draw today's trailer exactly.

const wide: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 7, y: 2.5 }, top: 2.5 };
const deep: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 2.5, y: 7 }, top: 2.5 };
const tiny: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, top: 2.5 };
const DEFAULT: Trailer = { hitch: "high", axles: 2, tongueBox: false };
const faces = (shell: Bounds3, trailer: Partial<Trailer> = {}): Face3d[] => trailerFaces(framedBounds(SURROUNDINGS.wheels, shell), STYLE_3D, { ...DEFAULT, ...trailer });
const owned = (fs: readonly Face3d[], prefix: string): Face3d[] => fs.filter((f) => f.owner.startsWith(prefix));
const range = (fs: readonly Face3d[], k: "x" | "y" | "z"): [number, number] => {
  const v = fs.flatMap((f) => f.points.map((p) => p[k]));
  return [Math.min(...v), Math.max(...v)];
};
const mid = ([a, b]: [number, number]): number => (a + b) / 2;
const owners = (fs: readonly Face3d[], prefix: string): string[] => [...new Set(owned(fs, prefix).map((f) => f.owner))];

describe("the defaults", () => {
  it("draw today's trailer face for face (frozen before this step)", async () => {
    await expect(JSON.stringify({ wide: faces(wide), deep: faces(deep), tiny: faces(tiny) })).toMatchFileSnapshot("./__snapshots__/trailer-default.json");
  });
});

describe("the hitch (AC-01)", () => {
  it("on a house long along x the drawbar is past the right end by default and past the left end on the low one", () => {
    expect(range(owned(faces(wide), "trailer/drawbar"), "x")[0]).toBeGreaterThanOrEqual(wide.max.x - 1e-9);
    const low = owned(faces(wide, { hitch: "low" }), "trailer/drawbar");
    expect(range(low, "x")[1]).toBeLessThanOrEqual(wide.min.x + 1e-9);
    expect(range(owned(faces(wide, { hitch: "low" }), "trailer/jack"), "x")[1]).toBeLessThan(wide.min.x);
  });

  it("on a house long along y it stays on a short end: past the top or the bottom", () => {
    expect(range(owned(faces(deep), "trailer/drawbar"), "y")[0]).toBeGreaterThanOrEqual(deep.max.y - 1e-9);
    expect(range(owned(faces(deep, { hitch: "low" }), "trailer/drawbar"), "y")[1]).toBeLessThanOrEqual(deep.min.y + 1e-9);
  });

  it("the axles sit 0.3 m from the middle toward the hitch, whichever end it is", () => {
    const axleMid = (fs: Face3d[]): number => mid(range(owned(fs, "trailer/axle-"), "x"));
    expect(axleMid(faces(wide))).toBeCloseTo(3.5 + 0.3, 9);
    expect(axleMid(faces(wide, { hitch: "low" }))).toBeCloseTo(3.5 - 0.3, 9);
  });
});

describe("three axles (AC-03)", () => {
  it("three axles and six wheels, 0.84 m apart, centred where the pair is", () => {
    for (const hitch of ["low", "high"] as const) {
      const fs = faces(wide, { axles: 3, hitch });
      expect(owners(fs, "trailer/axle-"), hitch).toHaveLength(3);
      expect(owners(fs, "trailer/wheel-"), hitch).toHaveLength(6);
      const centres = owners(fs, "trailer/axle-").map((o) => mid(range(owned(fs, o), "x"))).sort((a, b) => a - b);
      expect(centres[1]! - centres[0]!, hitch).toBeCloseTo(0.84, 9);
      expect(centres[2]! - centres[1]!, hitch).toBeCloseTo(0.84, 9);
      expect(centres[1], hitch).toBeCloseTo(3.5 + (hitch === "high" ? 0.3 : -0.3), 9);
    }
  });
});

describe("the tongue box (AC-04)", () => {
  it("on, it stands on the drawbar against the end wall, 0.60 m along it, 0.90 m above the bar", () => {
    for (const hitch of ["low", "high"] as const) {
      const fs = faces(wide, { tongueBox: true, hitch });
      const box = owned(fs, "trailer/tongue-box");
      expect(box.length, hitch).toBeGreaterThan(0);
      const [x0, x1] = range(box, "x");
      if (hitch === "high") expect([x0, x1].map((v) => Math.round(v * 1e6) / 1e6), hitch).toEqual([7, 7.6]);
      else expect([x0, x1].map((v) => Math.round(v * 1e6) / 1e6), hitch).toEqual([-0.6, 0]);
      const bar = owned(fs, "trailer/drawbar");
      const barTop = range(bar, "z")[1];
      expect(range(box, "z")[0], hitch).toBeCloseTo(barTop, 9);
      expect(range(box, "z")[1], hitch).toBeCloseTo(barTop + 0.9, 9);
      expect(range(box, "y"), hitch).toEqual([0.3, 2.2]);
    }
  });

  it("off there is none; with a drawbar under 0.90 m there is none", () => {
    expect(owned(faces(wide), "trailer/tongue-box")).toEqual([]);
    const short: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 2, y: 0.6 }, top: 2.5 }; // its drawbar is 0.86 m: the frame clamps it
    const bar = range(owned(faces(short), "trailer/drawbar"), "x");
    expect(bar[1] - short.max.x).toBeGreaterThan(0.35);
    expect(bar[1] - short.max.x).toBeLessThan(0.9);
    expect(owned(faces(short, { tongueBox: true }), "trailer/tongue-box")).toEqual([]);
  });

  it("on a deck narrower than 1.20 m it is half the deck's width", () => {
    const narrow: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 7, y: 1 }, top: 2.5 };
    expect(range(owned(faces(narrow, { tongueBox: true }), "trailer/tongue-box"), "y")).toEqual([0.25, 0.75]);
  });
});

describe("the panel, look and cards (AC-10)", () => {
  const set = (doc: Document, key: string, value: string): Document => withCommands(doc, { type: "setProjectField", key, value });
  const doc = set(set(set(set(clearRoomDoc(7, 2.5, "c"), "surroundings", "wheels"), "trailerHitch", "low"), "trailerAxles", "3"), "tongueBox", "on");

  it("draw the same trailer from the project's settings", () => {
    const look = lookScene3d(doc, "s0", DEFAULT_ANGLES);
    if ("refused" in look) throw new Error(look.refused);
    const trailer = owned(look.faces, "trailer/");
    expect(owners(trailer, "trailer/wheel-")).toHaveLength(6);
    expect(owners(trailer, "trailer/tongue-box").length).toBeGreaterThan(0);
    const s = FakeShell.withDocument(doc);
    s.key("3");
    expect(view3dFrame(s.state)?.scene.trailer).toEqual(trailer);
    expect(cardFrame3d(doc, "s0", null, DEFAULT_ANGLES.yaw, DEFAULT_ANGLES.tilt)?.scene.trailer).toEqual(trailer);
  });
});
