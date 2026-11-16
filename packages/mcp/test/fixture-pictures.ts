import { readFileSync } from "node:fs";
import { fromStored, upgradeStored, type Document } from "@fm/domain";
import { capFaces, hiddenWalls, openingFaces, sceneFaces, STYLE_3D, view3dItems, type Bounds3, type Face3d, type Style3d } from "@fm/editor";
import { parseStoredDocument, unwrap } from "@fm/protocol";
import { packView3d, type Raster3d } from "@fm/render";
import { rasterFaces } from "../src/look3d-png";

// The real3d AC-16 fixtures (real3d.13): frozen pictures of a fixed set of drawings, each with the camera it was drawn
// with. Read by the AC-16 tests and by `scripts/refreeze-look3d.ts` (studio.06, .12), so both draw a fixture the same way.

export const FIXTURE_DIR = new URL("./fixtures/painter3d/", import.meta.url);
export type Picture = { file: string; drawing: string; state: string; turn: number; matrix: number[]; bounds: Bounds3; hidden: string[] };
export const index: { size: number; pictures: Picture[] } = JSON.parse(readFileSync(new URL("index.json", FIXTURE_DIR), "utf8"));

/** A frozen picture's turn as a yaw: turn 0 looked from the south-west, a quarter turn each. */
export const yawOf = (turn: number): number => (225 + 90 * turn) % 360;

/** A fixture drawing, loaded as the server loads a stored document: upgraded (fill on load), then parsed. */
export function drawing(name: string): Document {
  const stored = parseStoredDocument(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), "utf8")), "empty");
  if (!stored) throw new Error(`${name}.json is not a stored document`);
  return unwrap(fromStored(upgradeStored(stored)));
}

/** The faces a picture shows, as look draws them (finishes on): its drawing's items in its state, less the hidden walls. */
export function fixtureFaces(p: Picture, style: Style3d = STYLE_3D): Face3d[] {
  const doc = drawing(p.drawing);
  return sceneFaces({ items: view3dItems(doc, p.state, null, new Set(), true), hidden: hiddenWalls(doc, yawOf(p.turn)) }, style);
}

/** The joint caps' faces a picture shows (studio.10): those of the walls not hidden at its yaw. */
export function fixtureCapFaces(p: Picture): Face3d[] {
  const doc = drawing(p.drawing);
  const hidden = hiddenWalls(doc, yawOf(p.turn));
  return view3dItems(doc, p.state, null, new Set(), true).flatMap((i) => (i.item === "wall" && !hidden.has(i.wall) ? capFaces(`wall/${i.wall}`, i) : []));
}

/** What stands in the openings a picture shows (openings3d): those of the walls not hidden at its yaw. */
export function fixtureOpeningFaces(p: Picture): Face3d[] {
  const doc = drawing(p.drawing);
  const hidden = hiddenWalls(doc, yawOf(p.turn));
  return view3dItems(doc, p.state, null, new Set(), true).flatMap((i) => (i.item === "wall" && !hidden.has(i.wall) ? openingFaces(`wall/${i.wall}`, i, STYLE_3D) : []));
}

/**
 * The boxes of a picture's pieces of `kinds`, as plain blocks: a kind drawn in parts lies inside its box (parts AC-01), so
 * the box covers both its old look and its new one, including the air where the old look stood.
 */
export function fixturePieceBoxes(p: Picture, kinds: readonly string[]): Face3d[] {
  const items = view3dItems(drawing(p.drawing), p.state, null, new Set(), true).flatMap((i) => (i.item === "piece" && kinds.includes(i.objectKind) ? [{ ...i, objectKind: "block" }] : []));
  return sceneFaces({ items, hidden: new Set() });
}

/** `faces` drawn by raster3d with the camera the picture was frozen with. */
export function fixturePixels(p: Picture, faces: readonly Face3d[], style: Style3d = STYLE_3D): Raster3d {
  return rasterFaces(faces, packView3d(p.matrix, p.bounds), style);
}
