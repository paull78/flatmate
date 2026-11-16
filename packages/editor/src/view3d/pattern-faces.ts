import { ccw } from "./prism";
import type { Face3d, FloorLine, FloorShape } from "./types";

/**
 * The finest pattern spacing drawn in 3D, in metres, on every surface (surfaces.12, was 0.10 for floors, finishes.12):
 * finer patterns show their colour alone. Brick courses (0.065), subway tiles and corrugated ribs draw.
 */
export const MIN_SPACING_3D = 0.05;

// A floor's pattern in 3D, shared by floors, deck tops (faces.ts) and door thresholds (wall-faces.ts).

/**
 * A floor face with its pattern at height `z` (finishes.12, shown.12): the lines go with the face, after its outline
 * (finishes.54); each shape is a face of its own, in its colour, drawn without an outline.
 */
export function withPattern(face: Face3d, pattern: { lines: readonly FloorLine[]; shapes: readonly FloorShape[] }, z: number): Face3d[] {
  const lines = pattern.lines.map((l) => ({ a: { ...l.a, z }, b: { ...l.b, z }, color: l.color }));
  const shapes = pattern.shapes.map((s): Face3d => ({ points: ccw(s.ring).map((p) => ({ ...p, z })), holes: s.holes.map((h) => h.map((p) => ({ ...p, z }))), color: s.color, owner: face.owner, outline: false }));
  return [lines.length > 0 ? { ...face, lines } : face, ...shapes];
}
