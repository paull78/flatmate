import { add, defaultSize, kindConfigs, rotateAbout, type NewPiece } from "@fm/domain";
import type { Point } from "@fm/protocol";

// Multi-piece sets (seated.03, .06): a list of pieces and offsets, in the editor only. Nothing links the pieces once placed.
// Each offset is the piece's back edge's middle, from the overall box's back edge's middle, unturned: x along the width, y
// from −d (front) to 0 (back), as a footprint.
//
//   Bed and nightstands            Sofa and rug
//   ┌───┬──────────┬───┐ y 0       ┌────────────┐ y 0
//   │ n ├          ┤ n │           │    sofa    │
//   └───┤   bed    ├───┘           └────────────┘ −0.90   zone 0.50, its own
//       │          │               ┌─[ table ]──┐ −0.95   the rug, under the table
//       └──────────┘ −2.10         └────────────┘ −2.35

export type SetPiece = { kind: string; offset: Point };
export type FurnitureSet = { id: string; label: string; pieces: readonly SetPiece[] };

const NIGHTSTAND_X = 1.075; // half a 1.70 bed, and half a 0.45 nightstand

export const FURNITURE_SETS: readonly FurnitureSet[] = [
  {
    id: "bedAndNightstands",
    label: "Bed and nightstands",
    pieces: [
      { kind: "bed", offset: { x: 0, y: 0 } },
      { kind: "nightstand", offset: { x: -NIGHTSTAND_X, y: 0 } },
      { kind: "nightstand", offset: { x: NIGHTSTAND_X, y: 0 } },
    ],
  },
  {
    id: "sofaAndRug",
    label: "Sofa and rug",
    pieces: [
      { kind: "rug", offset: { x: 0, y: -0.95 } }, // first, so it draws under the others, centred on the table
      { kind: "sofa", offset: { x: 0, y: 0 } },
      { kind: "coffeeTable", offset: { x: 0, y: -1.4 } },
    ],
  },
];

export const furnitureSet = (id: string): FurnitureSet | undefined => FURNITURE_SETS.find((s) => s.id === id);

/** Whether a palette card or a quick add row is a set: its `kind` then holds the set's id. */
export const isFurnitureSet = (id: string): boolean => furnitureSet(id) !== undefined;

/** A piece's size at its kind's default, in its first configuration. */
function sizeOf(kind: string): { w: number; d: number; config: string } {
  const config = kindConfigs(kind)[0];
  const size = defaultSize(kind);
  const id = config?.id ?? "";
  return { w: size?.w[id] ?? 0, d: size?.d[id] ?? 0, config: id };
}

/** The set's overall box, unturned: wide enough for every piece about the centre line, and deep enough for the deepest. */
export function setBox(set: FurnitureSet): { w: number; d: number } {
  const halves = set.pieces.map((p) => Math.abs(p.offset.x) + sizeOf(p.kind).w / 2);
  const fronts = set.pieces.map((p) => sizeOf(p.kind).d - p.offset.y);
  return { w: 2 * Math.max(...halves), d: Math.max(...fronts) };
}

/** The set's pieces with the box's back edge's middle at `at`, turned to `rotation`: what the ghost draws and a click places. */
export function setPoses(set: FurnitureSet, at: Point, rotation: number): { kind: string; config: string; w: number; d: number; at: Point; rotation: number }[] {
  return set.pieces.map((p) => ({ kind: p.kind, ...sizeOf(p.kind), at: rotateAbout(add(p.offset, at), at, rotation), rotation }));
}

/** The set's pieces as new pieces of one layout, on one surface. */
export function setPieces(set: FurnitureSet, at: Point, rotation: number, state: string, deck: string | null): NewPiece[] {
  return setPoses(set, at, rotation).map((p) => ({ kind: p.kind, placements: [{ state, at: p.at, rotation: p.rotation, deck }] }));
}
