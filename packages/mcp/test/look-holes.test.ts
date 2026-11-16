import { describe, expect, it } from "vitest";
import { anchorAt, emptyDocument, execute, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import { camera3d, lookScene3d, shellBounds, STYLE_3D } from "@fm/editor";
import { look3dPixels } from "../src/look3d-png";
import { rgb } from "./pictures";

// Look in 3D through a hole (stairwell.09; AC-12): straight down over the cabin, the pixel at the notch's centre at the
// loft's top shows the ladder rising through it, not the loft's oak; with no ladder, no oak either.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const cabin = (): Document => run(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "cabin"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 },
  { type: "addDeckHole", opId: "notch", deck: "loft/k0", at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 });
const ladder: Command = { type: "placeObject", opId: "lad", state: "s0", object: { kind: "shipsLadder" }, at: anchorAt({ x: 1.95, y: 2.6 }, 1.1, 90), rotation: 90, deck: null };

/** The colour where (x, y, z) lands in a top-down look. */
function pixelAt(doc: Document, p: { x: number; y: number; z: number }): [number, number, number] {
  const angles = { yaw: 225, tilt: 90 };
  const scene = lookScene3d(doc, "s0", angles);
  if ("refused" in scene) throw new Error(scene.refused);
  const bounds = shellBounds(doc);
  if (!bounds) throw new Error("no bounds");
  const { width, height, pixels } = look3dPixels(scene);
  const c = camera3d(bounds, angles).project(p);
  const px = Math.round(((c.x + 1) / 2) * width);
  const py = Math.round(((1 - c.y) / 2) * height);
  const i = 4 * (py * width + px);
  return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
}
const near = (a: readonly number[], b: readonly number[]): boolean => a.every((v, k) => Math.abs(v - (b[k] ?? 0)) <= 8);
const oak = Object.values(STYLE_3D.deck).map(rgb);

describe("look in 3D through the notch (AC-12)", () => {
  it("the notch shows the ladder, not the loft; the slab beside it shows the loft", () => {
    const doc = run(cabin(), ladder);
    const inHole = pixelAt(doc, { x: 1.9, y: 2.6, z: 2.15 });
    expect(oak.some((c) => near(inHole, c)), String(inHole)).toBe(false);
    expect(Object.values(STYLE_3D.stair).map(rgb).some((c) => near(inHole, c)), String(inHole)).toBe(true);
    expect(oak.some((c) => near(pixelAt(doc, { x: 0.8, y: 1.5, z: 2.15 }), c))).toBe(true);
  });
});
