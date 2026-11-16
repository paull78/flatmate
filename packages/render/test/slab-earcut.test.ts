import { describe, expect, it } from "vitest";
import { CANVAS_STYLE, floorView, planPicture, sceneFaces, view3dItems, type Primitive } from "@fm/editor";
import { clearRoomDoc, withCommands } from "@fm/editor/testing";
import type { Point } from "@fm/protocol";
import { LAYOUT, LAYOUT3D, triangles3d } from "../src/index";
import { newRecords, pushPolygon } from "../src/records";

// A stairwell stays open on a turned deck (fixes AC-14). A flush notch's sides land a fraction of a millimetre off the
// deck's, and earcut, given rings that nearly meet, filled the hole in 629 of these 1,080 cases, in 3D and on the GPU plan.
// The editor doesn't depend on @fm/render, so this lives here, as finish-earcut.test.ts does.

type Polygon = Extract<Primitive, { kind: "polygon" }>;

const NOTCHES = [
  { name: "east side", at: { x: 5.9, y: 5 }, w: 0.6, d: 0.6 },
  { name: "north side", at: { x: 5, y: 5.4 }, w: 0.6, d: 0.6 },
  { name: "corner", at: { x: 5.55, y: 5.35 }, w: 1.3, d: 0.7 },
];
const DECK = 2.4 * 1.4;
const TOP = 1;

const shoelace = (ring: readonly Point[]): number =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    return sum + (p.x * q.y - q.x * p.y) / 2;
  }, 0);

/** The area the GPU plan's triangles cover, overlaps counted twice. */
function earcutArea(p: Polygon): number {
  const out = newRecords("polygon");
  pushPolygon(out, p, () => [0, 0, 0, 1]);
  const stride = LAYOUT.polygon.strideFloats;
  const v = (k: number): Point => ({ x: out.floats[k * stride] ?? NaN, y: out.floats[k * stride + 1] ?? NaN });
  let area = 0;
  for (let k = 0; k + 2 < out.length / stride; k += 3) area += Math.abs(shoelace([v(k), v(k + 1), v(k + 2)]));
  return area;
}

/** The area of the 3D triangles at height `z`, overlaps counted twice. */
function topArea(fill: Float32Array, z: number): number {
  const stride = LAYOUT3D.face3d.strideFloats;
  let area = 0;
  for (let t = 0; t + 3 * stride <= fill.length; t += 3 * stride) {
    const at = (k: number): Point & { z: number } => ({ x: fill[t + k * stride] ?? NaN, y: fill[t + k * stride + 1] ?? NaN, z: fill[t + k * stride + 2] ?? NaN });
    const [a, b, c] = [at(0), at(1), at(2)];
    if (Math.abs(a.z - z) < 1e-4 && Math.abs(b.z - z) < 1e-4 && Math.abs(c.z - z) < 1e-4) area += Math.abs(shoelace([a, b, c]));
  }
  return area;
}

const TURNS = Array.from({ length: 360 }, (_, i) => i);

describe.each(NOTCHES)("a loft with a flush notch on the $name, at every turn", (notch) => {
  const base = withCommands(
    clearRoomDoc(12, 10, "r"),
    { type: "addDeck", opId: "k", preset: "loft", at: { x: 5, y: 5 }, w: 2.4, d: 1.4, top: TOP }, // below the cut, so the floor's plan fills it
    { type: "addDeckHole", opId: "h", deck: "k/k0", ...notch },
  );
  const slab = DECK - notch.w * notch.d;

  it("the plan's GPU triangles cover the slab and nothing more", () => {
    const wrong: number[] = [];
    for (const rotation of TURNS) {
      const doc = withCommands(base, { type: "setDeck", deckId: "k/k0", rotation });
      const polygons = planPicture(doc, floorView(doc, "s0"), CANVAS_STYLE, 40, true).decks.filter((p): p is Polygon => p.kind === "polygon");
      const area = polygons.reduce((sum, p) => sum + earcutArea(p), 0);
      if (Math.abs(area - slab) > 0.01) wrong.push(rotation);
    }
    expect(wrong).toEqual([]);
  });

  it("the 3D top's triangles cover the slab and nothing more", () => {
    const wrong: number[] = [];
    for (const rotation of TURNS) {
      const doc = withCommands(base, { type: "setDeck", deckId: "k/k0", rotation });
      const items = view3dItems(doc, "s0", null, new Set(), false).filter((i) => i.item === "deck");
      const { fill } = triangles3d(sceneFaces({ items, hidden: new Set() }), "#000000");
      if (Math.abs(topArea(fill, TOP) - slab) > 0.01) wrong.push(rotation);
    }
    expect(wrong).toEqual([]);
  });
});
